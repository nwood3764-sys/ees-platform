-- ============================================================================
-- System Information audit fields — foundation
-- ----------------------------------------------------------------------------
-- Nicholas, 2026-08-22: "on specific records, I needed fields for the system
-- information. Every single record should have this: create date, created by,
-- last modified date and time, last modified by user. Every single page layout
-- needs that under the System Information section."
--
-- Putting the four fields on a page layout is only half the job — a field that
-- renders "—" forever is worse than no field. Before the layouts can carry
-- them, the DATA has to be real on every object:
--
--   * 21 of the 105 objects that have a record page were missing at least one
--     of the four columns outright (activities had no created_by at all,
--     picklist_values / roles had no updated_* pair, page_layouts had no
--     updated_by, ...).
--   * "Last Modified" was fiction almost everywhere: only 27 of 96 tables with
--     an updated_at column had anything maintaining it, and NOTHING in the
--     platform stamped updated_by — the one client-side write path
--     (saveRecord) sends only the changed fields and never touched it. Every
--     per-service hand-written `<prefix>_updated_by: userId` was a workaround
--     for the missing platform rule.
--
-- This migration builds that platform rule once, data-driven, in three
-- purpose-named artifacts:
--
--   1. record_audit_column_overrides — the registry for objects whose audit
--      columns are NOT named by convention. Seeded with the two append-only
--      system logs (audit_log, field_history), whose own performed-at /
--      changed-at columns ARE their create + modify stamps; a duplicate
--      created_at on 742k audit rows would be the same data twice.
--   2. resolve_record_audit_columns(object) — convention first (the table's
--      dominant column prefix), registry override second. One definition of
--      "which columns are this object's audit fields", used by the installer
--      here and by the page-layout migration that follows.
--   3. install_record_audit_stamping(object) — adds any of the four columns
--      the object is missing and installs a generated per-object BEFORE
--      INSERT OR UPDATE trigger that stamps them. Per-object (not one generic
--      jsonb trigger) because properties carries 828 columns: a to_jsonb /
--      jsonb_populate_record round trip per row would tax every write on the
--      platform's biggest table. The generated function assigns the four
--      columns directly.
--
-- Rules the stamping enforces (Salesforce parity):
--   INSERT  created_at := supplied value, else now()
--           created_by := supplied value, else the acting app user
--           updated_at/updated_by := the create stamp (a new record's last
--           modification IS its creation — never blank)
--   UPDATE  created_at/created_by are immutable (a NULL may still be filled in,
--           so historical backfills stay possible)
--           updated_at := now(); updated_by := the acting app user
--
-- current_app_user_id() returns NULL for service-role / edge-function writes
-- with no signed-in user; the stamp then leaves the prior value rather than
-- nulling a known one.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Override registry
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS seq_record_audit_column_overrides;

CREATE TABLE public.record_audit_column_overrides (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raco_record_number        text NOT NULL,
  raco_object               text NOT NULL,          -- table name
  raco_created_at_column    text,
  raco_created_by_column    text,
  raco_updated_at_column    text,
  raco_updated_by_column    text,
  -- An append-only log: its rows are written once and never modified, so the
  -- platform does NOT install stamping on it and does NOT add columns to it —
  -- the columns named above already are its create + modify stamps.
  raco_is_immutable_log     boolean NOT NULL DEFAULT false,
  raco_notes                text,
  raco_owner                uuid REFERENCES users(id),
  raco_created_by           uuid REFERENCES users(id),
  raco_created_at           timestamptz NOT NULL DEFAULT now(),
  raco_updated_by           uuid REFERENCES users(id),
  raco_updated_at           timestamptz NOT NULL DEFAULT now(),
  raco_is_deleted           boolean NOT NULL DEFAULT false,
  raco_deleted_at           timestamptz,
  raco_deleted_by           uuid REFERENCES users(id),
  raco_deletion_reason      text,
  is_seed_data              boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX uq_raco_object ON public.record_audit_column_overrides (raco_object)
  WHERE raco_is_deleted = false;

CREATE OR REPLACE FUNCTION public.set_raco_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog' AS $fn$
BEGIN
  NEW.raco_record_number := generate_record_number('RACO-', 'seq_record_audit_column_overrides');
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_raco_rn BEFORE INSERT ON public.record_audit_column_overrides
  FOR EACH ROW EXECUTE FUNCTION set_raco_record_number();
CREATE TRIGGER trg_audit_raco AFTER INSERT OR UPDATE OR DELETE ON public.record_audit_column_overrides
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_raco_no_hard_delete BEFORE DELETE ON public.record_audit_column_overrides
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();

ALTER TABLE public.record_audit_column_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY raco_select ON public.record_audit_column_overrides
  FOR SELECT TO authenticated USING (true);
CREATE POLICY raco_insert ON public.record_audit_column_overrides
  FOR INSERT TO authenticated WITH CHECK (app_user_can('record_audit_column_overrides','create'));
CREATE POLICY raco_update ON public.record_audit_column_overrides
  FOR UPDATE TO authenticated USING (app_user_can('record_audit_column_overrides','update'))
  WITH CHECK (app_user_can('record_audit_column_overrides','update'));
CREATE POLICY raco_delete ON public.record_audit_column_overrides
  FOR DELETE TO authenticated USING (app_user_can('record_audit_column_overrides','delete'));

INSERT INTO public.record_audit_column_overrides
  (raco_record_number, raco_object,
   raco_created_at_column, raco_created_by_column,
   raco_updated_at_column, raco_updated_by_column,
   raco_is_immutable_log, raco_notes)
VALUES
  ('', 'audit_log', 'al_performed_at', 'al_performed_by', 'al_performed_at', 'al_performed_by',
   true, 'Append-only audit trail. The row IS the record of who did what and when; it is written once and never modified, so its performed-at/performed-by columns are both its create and its last-modified stamp.'),
  ('', 'field_history', 'fh_changed_at', 'fh_changed_by', 'fh_changed_at', 'fh_changed_by',
   true, 'Append-only field history. Same reasoning as audit_log — changed-at/changed-by are the create and last-modified stamp.');

-- ---------------------------------------------------------------------------
-- 2) resolve_record_audit_columns(object)
-- ---------------------------------------------------------------------------
-- Returns the four audit column names for an object, plus whether it is an
-- append-only log. Registry override wins; otherwise the platform convention:
-- the table's dominant column prefix ('' when it uses bare names), with the
-- `<role>_id` spelling accepted for the user columns (tasks.created_by_id).
-- When a column does not exist yet, the CANONICAL name is returned — that is
-- the name install_record_audit_stamping() creates.
-- Small shared helper: the first name in `p_candidates` that is a live column
-- on `p_relation`, else `p_fallback`. Keeps the resolver below readable.
CREATE OR REPLACE FUNCTION public._first_existing_column(p_relation oid, p_candidates text[], p_fallback text)
RETURNS text
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_catalog' AS $$
  SELECT COALESCE(
    (SELECT c FROM unnest(p_candidates) WITH ORDINALITY AS t(c, ord)
      WHERE EXISTS (
        SELECT 1 FROM pg_attribute a
         WHERE a.attrelid = p_relation AND a.attname = t.c
           AND a.attnum > 0 AND NOT a.attisdropped)
      ORDER BY t.ord LIMIT 1),
    p_fallback);
$$;

CREATE OR REPLACE FUNCTION public.resolve_record_audit_columns(p_table text)
RETURNS TABLE (
  created_at_column text,
  created_by_column text,
  updated_at_column text,
  updated_by_column text,
  is_immutable_log  boolean
)
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'pg_catalog' AS $$
DECLARE
  v_oid     oid;
  v_prefix  text;
  v_ov      public.record_audit_column_overrides%ROWTYPE;
BEGIN
  SELECT * INTO v_ov
  FROM public.record_audit_column_overrides
  WHERE raco_object = p_table AND raco_is_deleted = false
  LIMIT 1;

  IF FOUND THEN
    created_at_column := v_ov.raco_created_at_column;
    created_by_column := v_ov.raco_created_by_column;
    updated_at_column := v_ov.raco_updated_at_column;
    updated_by_column := v_ov.raco_updated_by_column;
    is_immutable_log  := v_ov.raco_is_immutable_log;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT c.oid INTO v_oid
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = p_table AND c.relkind = 'r';
  IF v_oid IS NULL THEN
    RETURN;   -- not a base table in public — nothing to resolve
  END IF;

  -- Dominant prefix, voted on by every column that carries a standard suffix.
  -- Longest prefix breaks a tie so a table whose only vote is a one-off column
  -- (vehicles.vehicle_odometer_updated_at) still loses to the real prefix.
  SELECT v.pfx INTO v_prefix
  FROM (
    SELECT p.pfx
    FROM (
      SELECT CASE
               WHEN a.attname ~ '^(created_at|created_by|updated_at|updated_by|record_number|is_deleted|owner)$'
               THEN ''
               ELSE regexp_replace(a.attname,
                      '_(created_at|created_by|updated_at|updated_by|record_number|is_deleted|owner)$', '')
             END AS pfx
      FROM pg_attribute a
      WHERE a.attrelid = v_oid AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attname ~ '(^|_)(created_at|created_by|updated_at|updated_by|record_number|is_deleted|owner)$'
    ) p
    GROUP BY p.pfx
    ORDER BY count(*) DESC, length(p.pfx) DESC
    LIMIT 1
  ) v;
  v_prefix := COALESCE(v_prefix, '');

  created_at_column := public._first_existing_column(v_oid,
    ARRAY[CASE WHEN v_prefix = '' THEN 'created_at' ELSE v_prefix || '_created_at' END, 'created_at'],
    CASE WHEN v_prefix = '' THEN 'created_at' ELSE v_prefix || '_created_at' END);
  created_by_column := public._first_existing_column(v_oid,
    ARRAY[CASE WHEN v_prefix = '' THEN 'created_by' ELSE v_prefix || '_created_by' END,
          'created_by',
          CASE WHEN v_prefix = '' THEN 'created_by_id' ELSE v_prefix || '_created_by_id' END,
          'created_by_id'],
    CASE WHEN v_prefix = '' THEN 'created_by' ELSE v_prefix || '_created_by' END);
  updated_at_column := public._first_existing_column(v_oid,
    ARRAY[CASE WHEN v_prefix = '' THEN 'updated_at' ELSE v_prefix || '_updated_at' END, 'updated_at'],
    CASE WHEN v_prefix = '' THEN 'updated_at' ELSE v_prefix || '_updated_at' END);
  updated_by_column := public._first_existing_column(v_oid,
    ARRAY[CASE WHEN v_prefix = '' THEN 'updated_by' ELSE v_prefix || '_updated_by' END,
          'updated_by',
          CASE WHEN v_prefix = '' THEN 'updated_by_id' ELSE v_prefix || '_updated_by_id' END,
          'updated_by_id'],
    CASE WHEN v_prefix = '' THEN 'updated_by' ELSE v_prefix || '_updated_by' END);
  is_immutable_log := false;
  RETURN NEXT;
END $$;

-- ---------------------------------------------------------------------------
-- Every object that has a record page, as an array. Returned as an array (not a
-- cursor) so callers can ALTER these very tables while iterating — page_layouts
-- is itself on the list.
CREATE OR REPLACE FUNCTION public.record_page_objects()
RETURNS text[]
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_catalog' AS $$
  SELECT COALESCE(array_agg(DISTINCT pl.page_layout_object ORDER BY pl.page_layout_object), ARRAY[]::text[])
  FROM public.page_layouts pl
  JOIN pg_class cl ON cl.relname = pl.page_layout_object AND cl.relkind = 'r'
  JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
  WHERE pl.is_deleted = false AND pl.page_layout_type = 'record_detail';
$$;

-- 3) install_record_audit_stamping(object)
-- ---------------------------------------------------------------------------
-- Adds whichever of the four audit columns the object is missing, then
-- generates and installs that object's stamping trigger. Idempotent: safe to
-- re-run, and the way any NEW object gets audit fields from here on.
--
-- SECURITY DEFINER because it performs DDL; EXECUTE is revoked from every
-- client role below — this is an admin/migration tool, never callable from the
-- app. The functions it GENERATES are SECURITY INVOKER (the default): they only
-- assign columns on the row being written, so they need no elevated rights.
CREATE OR REPLACE FUNCTION public.install_record_audit_stamping(p_table text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog' AS $$
DECLARE
  r       record;
  v_oid   oid;
  v_fn    text;
  v_added text[] := ARRAY[]::text[];
  c       text;
BEGIN
  SELECT cl.oid INTO v_oid
  FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace
  WHERE n.nspname = 'public' AND cl.relname = p_table AND cl.relkind = 'r';
  IF v_oid IS NULL THEN
    RETURN format('%s: not a public base table — skipped', p_table);
  END IF;

  SELECT * INTO r FROM public.resolve_record_audit_columns(p_table);
  IF NOT FOUND THEN
    RETURN format('%s: audit columns unresolved — skipped', p_table);
  END IF;
  IF r.is_immutable_log THEN
    RETURN format('%s: append-only log — stamping not installed (create+modify = %s / %s)',
                  p_table, r.created_at_column, r.created_by_column);
  END IF;

  -- Timestamp columns: added WITHOUT a default so existing rows stay NULL and
  -- the migration can backfill them from a real source. The default is set
  -- afterwards, below, as defence-in-depth for any write path that somehow
  -- bypasses the trigger.
  FOREACH c IN ARRAY ARRAY[r.created_at_column, r.updated_at_column] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = v_oid AND a.attname = c
                      AND a.attnum > 0 AND NOT a.attisdropped) THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN %I timestamptz', p_table, c);
      v_added := v_added || c;
    END IF;
  END LOOP;

  FOREACH c IN ARRAY ARRAY[r.created_by_column, r.updated_by_column] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = v_oid AND a.attname = c
                      AND a.attnum > 0 AND NOT a.attisdropped) THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN %I uuid REFERENCES public.users(id)', p_table, c);
      v_added := v_added || c;
    END IF;
  END LOOP;

  -- One generated function per object, assigning the four columns directly —
  -- see the header for why this is not a single generic jsonb trigger.
  v_fn := 'stamp_' || p_table || '_audit_fields';
  IF length(v_fn) > 63 THEN
    v_fn := 'stamp_' || left(p_table, 37) || '_' || left(md5(p_table), 6) || '_audit_fields';
  END IF;

  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public.%1$I() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_catalog' AS $body$
    DECLARE
      v_user uuid;
    BEGIN
      v_user := public.current_app_user_id();
      IF TG_OP = 'INSERT' THEN
        NEW.%2$I := COALESCE(NEW.%2$I, now());
        NEW.%3$I := COALESCE(NEW.%3$I, v_user);
        NEW.%4$I := COALESCE(NEW.%4$I, NEW.%2$I);
        NEW.%5$I := COALESCE(NEW.%5$I, NEW.%3$I);
      ELSE
        NEW.%2$I := COALESCE(OLD.%2$I, NEW.%2$I);
        NEW.%3$I := COALESCE(OLD.%3$I, NEW.%3$I);
        NEW.%4$I := now();
        NEW.%5$I := COALESCE(v_user, NEW.%5$I, OLD.%5$I);
      END IF;
      RETURN NEW;
    END $body$;
  $f$, v_fn, r.created_at_column, r.created_by_column, r.updated_at_column, r.updated_by_column);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_record_audit_fields ON public.%I', p_table);
  EXECUTE format(
    'CREATE TRIGGER trg_record_audit_fields BEFORE INSERT OR UPDATE ON public.%I '
    'FOR EACH ROW EXECUTE FUNCTION public.%I()', p_table, v_fn);

  RETURN format('%s: stamping installed on (%s, %s, %s, %s)%s',
                p_table, r.created_at_column, r.created_by_column,
                r.updated_at_column, r.updated_by_column,
                CASE WHEN array_length(v_added, 1) IS NULL THEN ''
                     ELSE ' — columns added: ' || array_to_string(v_added, ', ') END);
END $$;

REVOKE ALL ON FUNCTION public.install_record_audit_stamping(text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Install on every object that has a record page, then backfill
-- ---------------------------------------------------------------------------
DO $install$
DECLARE t text; msg text; v_tables text[];
BEGIN
  -- Materialize the object list BEFORE looping: a FOR-over-query cursor keeps
  -- page_layouts open for the whole loop, and page_layouts is itself one of the
  -- objects being altered ("cannot ALTER TABLE ... used by active queries").
  v_tables := public.record_page_objects();
  FOREACH t IN ARRAY v_tables LOOP
    msg := public.install_record_audit_stamping(t);
    RAISE NOTICE '%', msg;
  END LOOP;
END $install$;

-- Backfill runs with triggers suppressed for two reasons: the stamping trigger
-- installed above would otherwise overwrite every backfilled updated_at with
-- now() (defeating the whole point), and the audit logger would write ~15k
-- snapshot rows recording a migration as if a person had edited each record.
SET session_replication_role = replica;

-- 4a) Objects whose "who created this" was already recorded under a different
--     name. Each is the same fact under an older column, not a new guess.
UPDATE public.activities                 SET created_by = performed_by     WHERE created_by IS NULL AND performed_by     IS NOT NULL;
UPDATE public.asset_assignments          SET created_by = assigned_by      WHERE created_by IS NULL AND assigned_by      IS NOT NULL;
UPDATE public.comments                   SET created_by = author_user_id   WHERE created_by IS NULL AND author_user_id   IS NOT NULL;
UPDATE public.documents                  SET created_by = uploaded_by      WHERE created_by IS NULL AND uploaded_by      IS NOT NULL;
UPDATE public.notifications              SET created_by = triggered_by     WHERE created_by IS NULL AND triggered_by     IS NOT NULL;
UPDATE public.photos                     SET created_by = taken_by         WHERE created_by IS NULL AND taken_by         IS NOT NULL;
UPDATE public.user_page_layout_overrides SET created_by = user_id          WHERE created_by IS NULL AND user_id          IS NOT NULL;

-- 4b) Generic pass. A record that has never been edited was last modified when
--     it was created — that is the truth, and it is what Salesforce shows.
--     Nothing is invented: a NULL created_by (unknown author, e.g. an import)
--     stays NULL rather than being attributed to someone.
DO $backfill$
DECLARE
  t text;
  r record;
  n bigint;
BEGIN
  FOREACH t IN ARRAY public.record_page_objects() LOOP
    SELECT * INTO r FROM public.resolve_record_audit_columns(t);
    CONTINUE WHEN NOT FOUND OR r.is_immutable_log;

    EXECUTE format(
      'UPDATE public.%1$I SET %2$I = COALESCE(%2$I, %4$I), %4$I = COALESCE(%4$I, %2$I), %5$I = COALESCE(%5$I, %3$I) '
      'WHERE %2$I IS NULL OR %4$I IS NULL OR (%5$I IS NULL AND %3$I IS NOT NULL)',
      t, r.created_at_column, r.created_by_column, r.updated_at_column, r.updated_by_column);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE '% : % row(s) backfilled', t, n; END IF;
  END LOOP;
END $backfill$;

SET session_replication_role = origin;

-- 4c) Defence in depth for any write path that bypasses the trigger.
DO $defaults$
DECLARE t text; r record; c text;
BEGIN
  FOREACH t IN ARRAY public.record_page_objects() LOOP
    SELECT * INTO r FROM public.resolve_record_audit_columns(t);
    CONTINUE WHEN NOT FOUND OR r.is_immutable_log;
    FOREACH c IN ARRAY ARRAY[r.created_at_column, r.updated_at_column] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns ic
         WHERE ic.table_schema = 'public' AND ic.table_name = t
           AND ic.column_name = c AND ic.column_default IS NOT NULL)
      THEN
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT now()', t, c);
      END IF;
    END LOOP;
  END LOOP;
END $defaults$;

NOTIFY pgrst, 'reload schema';
