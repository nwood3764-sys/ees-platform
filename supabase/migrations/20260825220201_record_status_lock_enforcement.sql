-- A submitted record is locked in the DATABASE, not only in the browser
-- (Nicholas, 2026-08-25: "once a record is submitted, we definitely need to
-- lock the fields... when we submit something that's under review, our users
-- can't edit the details").
--
-- Locking already existed as a CONCEPT: picklist_values.picklist_locks_record
-- flags a status as locking, and the record page hides Edit, shows a "Locked"
-- chip and lets a System Administrator through. Three things were missing.
--
--   1. NOTHING ENFORCED IT. The rule lived entirely in RecordDetail.jsx. Any
--      other path -- a list-view inline edit, bulk_update_records, an import,
--      the REST API, a future screen -- wrote to a submitted record happily.
--      A lock a determined click can walk around is not a lock.
--   2. ONLY ENROLLMENTS HAD LOCKING STATUSES. incentive_applications, which is
--      the Project Payment Request actually sent to the program, had nine
--      statuses and not one of them locked.
--   3. NOBODY COULD CONFIGURE IT. picklist_locks_record was on no page layout,
--      so flagging a status was a database change.
--
-- All three are addressed here. The flag stays the single source of truth --
-- this adds enforcement behind it rather than a second rule beside it.

-- 1) The registry: which column carries the status that can lock each object.
CREATE TABLE IF NOT EXISTS public.record_status_lock_sources (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rsls_record_number text NOT NULL DEFAULT '',
  rsls_object        text NOT NULL,
  rsls_status_column text NOT NULL,
  rsls_is_active     boolean NOT NULL DEFAULT true,
  rsls_notes         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES public.users(id),
  updated_by         uuid REFERENCES public.users(id),
  is_deleted         boolean NOT NULL DEFAULT false,
  deletion_reason    text,
  CONSTRAINT record_status_lock_sources_object_key UNIQUE (rsls_object)
);

ALTER TABLE public.record_status_lock_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rsls_read ON public.record_status_lock_sources;
CREATE POLICY rsls_read ON public.record_status_lock_sources
  FOR SELECT USING ( (SELECT public.app_user_can('record_status_lock_sources','read')) );
DROP POLICY IF EXISTS rsls_write ON public.record_status_lock_sources;
CREATE POLICY rsls_write ON public.record_status_lock_sources
  FOR ALL USING ( (SELECT public.app_is_admin()) ) WITH CHECK ( (SELECT public.app_is_admin()) );

-- 2) The enforcement generator: one trigger function per object with the status
--    column baked in as STATIC sql. The 2026-08-23 state-scoping lesson -- a
--    generic function with a dynamic EXECUTE re-plans once per row.
CREATE OR REPLACE FUNCTION public.install_record_status_lock(p_object text)
RETURNS text LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $installer$
DECLARE v_col text; v_fn text;
BEGIN
  SELECT rsls_status_column INTO v_col
    FROM public.record_status_lock_sources
   WHERE rsls_object = p_object AND rsls_is_active AND is_deleted IS NOT TRUE;
  IF v_col IS NULL THEN
    RETURN format('%s: not registered, nothing installed', p_object);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = p_object AND c.relkind = 'r') THEN
    RETURN format('%s: no such table', p_object);
  END IF;

  v_fn := 'enforce_status_lock_' || p_object;

  EXECUTE format($gen$
    CREATE OR REPLACE FUNCTION public.%I() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_catalog'
    AS $fn$
    DECLARE v_status_label text;
    BEGIN
      -- Automation, migrations and service-role work are not a user editing a
      -- record and carry no app user. Rollups, cascades and scheduled jobs have
      -- to keep working on a submitted record.
      IF public.current_app_user_id() IS NULL THEN RETURN NEW; END IF;
      -- A System Administrator is the documented way to correct or unlock.
      IF public.app_is_admin() THEN RETURN NEW; END IF;

      SELECT COALESCE(pv.picklist_label, pv.picklist_value) INTO v_status_label
        FROM public.picklist_values pv
       WHERE pv.id = OLD.%I AND pv.picklist_locks_record IS TRUE;

      IF v_status_label IS NOT NULL THEN
        RAISE EXCEPTION
          'This record is locked because its status is "%%". Only a System Administrator can change it.',
          v_status_label
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END $fn$;
  $gen$, v_fn, v_col);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_zzz_status_lock ON public.%I', p_object);
  EXECUTE format(
    'CREATE TRIGGER trg_zzz_status_lock BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.%I()', p_object, v_fn);

  EXECUTE format('REVOKE ALL ON FUNCTION public.%I() FROM PUBLIC, anon, authenticated', v_fn);

  RETURN format('%s: locked on %s', p_object, v_col);
END $installer$;

REVOKE ALL ON FUNCTION public.install_record_status_lock(text) FROM PUBLIC, anon, authenticated;

-- 3) Register each object's PRIMARY status column: of the columns on that table
--    that are a picklist FK and end in "_status" (or are bare "status"), the
--    SHORTEST name. A longer one is a qualified sub-status -- an approval, an
--    occupancy, a CO reading -- and is a field on the record, never the
--    record's own lifecycle. A dominant-column-prefix rule was tried first and
--    is wrong here: it reads work_orders as "work" and project_payment_requests
--    as "payment", which picks no primary status at all.
INSERT INTO public.record_status_lock_sources (rsls_object, rsls_status_column, rsls_notes)
SELECT DISTINCT ON (c.relname)
       c.relname, a.attname,
       'Registered by derivation: shortest picklist-backed status column on the table.'
  FROM pg_constraint con
  JOIN pg_class c  ON c.oid = con.conrelid AND c.relkind = 'r'
  JOIN pg_class rf ON rf.oid = con.confrelid AND rf.relname = 'picklist_values'
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = con.conkey[1]
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
 WHERE con.contype = 'f'
   AND array_length(con.conkey, 1) = 1
   AND (a.attname = 'status' OR a.attname LIKE '%\_status')
 ORDER BY c.relname, length(a.attname), a.attname
ON CONFLICT (rsls_object) DO NOTHING;

-- 4) Install enforcement on everything registered.
DO $install$
DECLARE r record;
BEGIN
  FOR r IN SELECT rsls_object FROM public.record_status_lock_sources
            WHERE rsls_is_active AND is_deleted IS NOT TRUE ORDER BY rsls_object
  LOOP
    PERFORM public.install_record_status_lock(r.rsls_object);
  END LOOP;
END $install$;

-- 5) The Project Payment Request locks once it is with the program. Mirrors the
--    enrollment set exactly: Corrections Needed stays EDITABLE, because that is
--    the status that exists precisely so somebody can fix something. Pre-Approved
--    stays editable too -- the application is still being worked at that point.
UPDATE public.picklist_values
   SET picklist_locks_record = true
 WHERE picklist_object = 'incentive_applications'
   AND picklist_field  = 'ia_status'
   AND picklist_value IN (
     'Incentive Application Submitted — Awaiting Program Response',
     'Incentive Application Approved',
     'Incentive Application Denied',
     'Incentive Application Withdrawn'
   );

-- 6) Make it configurable: the flag joins the picklist value layout, so which
--    statuses lock is an admin edit rather than a migration.
UPDATE public.page_layout_widgets w
SET widget_config = jsonb_set(w.widget_config, '{fields}',
      (w.widget_config->'fields') || jsonb_build_array(jsonb_build_object(
         'name','picklist_locks_record','type','boolean',
         'label','Locks Record When Selected'))),
    updated_at = now()
FROM public.page_layout_sections s, public.page_layouts pl
WHERE s.id = w.section_id AND pl.id = s.page_layout_id
  AND pl.page_layout_object = 'picklist_values'
  AND pl.is_deleted IS NOT TRUE AND s.is_deleted IS NOT TRUE AND w.is_deleted IS NOT TRUE
  AND w.widget_config ? 'fields'
  AND w.widget_config->'fields' @> '[{"name":"picklist_is_active"}]'
  AND NOT (w.widget_config->'fields' @> '[{"name":"picklist_locks_record"}]');

-- 7) Report which objects are registered, how many of their statuses lock, and
--    whether enforcement is actually installed -- so a new object cannot fall
--    off the way the navigation allowlists did.
CREATE OR REPLACE FUNCTION public.record_status_lock_status()
RETURNS TABLE(object_name text, status_column text, locking_values integer, enforced boolean)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_catalog'
AS $fn$
  SELECT s.rsls_object,
         s.rsls_status_column,
         (SELECT count(*)::integer FROM public.picklist_values pv
           WHERE pv.picklist_object = s.rsls_object
             AND pv.picklist_locks_record IS TRUE
             AND pv.picklist_is_active),
         EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                  WHERE c.relname = s.rsls_object AND t.tgname = 'trg_zzz_status_lock')
    FROM public.record_status_lock_sources s
   WHERE s.rsls_is_active AND s.is_deleted IS NOT TRUE
   ORDER BY s.rsls_object;
$fn$;

REVOKE ALL ON FUNCTION public.record_status_lock_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_status_lock_status() TO authenticated;

DO $verify$
DECLARE v_missing integer; v_enr integer; v_ia integer; v_layout integer; v_wo text;
BEGIN
  SELECT count(*) INTO v_missing FROM public.record_status_lock_status() WHERE NOT enforced;
  IF v_missing > 0 THEN
    RAISE EXCEPTION '% registered object(s) have no status-lock trigger', v_missing;
  END IF;

  -- The case the first attempt got wrong: work_orders must lock on its own
  -- lifecycle, not on an approval sub-status.
  SELECT status_column INTO v_wo FROM public.record_status_lock_status() WHERE object_name = 'work_orders';
  IF v_wo <> 'work_order_status' THEN
    RAISE EXCEPTION 'work_orders registered the wrong status column: %', v_wo;
  END IF;

  SELECT locking_values INTO v_enr FROM public.record_status_lock_status() WHERE object_name = 'enrollments';
  SELECT locking_values INTO v_ia  FROM public.record_status_lock_status() WHERE object_name = 'incentive_applications';
  IF COALESCE(v_enr,0) <> 4 OR COALESCE(v_ia,0) <> 4 THEN
    RAISE EXCEPTION 'expected 4 locking statuses on enrollments and 4 on incentive applications, found % and %', v_enr, v_ia;
  END IF;

  SELECT count(*) INTO v_layout
    FROM public.page_layouts pl
    JOIN public.page_layout_sections s ON s.page_layout_id = pl.id AND s.is_deleted IS NOT TRUE
    JOIN public.page_layout_widgets w ON w.section_id = s.id AND w.is_deleted IS NOT TRUE
   WHERE pl.page_layout_object = 'picklist_values' AND pl.is_deleted IS NOT TRUE
     AND w.widget_config->'fields' @> '[{"name":"picklist_locks_record"}]';
  IF v_layout = 0 THEN
    RAISE EXCEPTION 'the locks-record flag did not reach the picklist value layout';
  END IF;
END $verify$;

NOTIFY pgrst, 'reload schema';
