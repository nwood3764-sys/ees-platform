-- =============================================================================
-- The Outlook add-in files an email onto EVERY object a thread can live on.
--
-- Nicholas, 2026-09-03: "It needs to have all the objects. Why would you limit
-- it to five?"
--
-- It was limited because the add-in's picker carried its own hand-written list
-- — six objects in `search_records_for_email_log`, five plus a contacts
-- special case in `log-email-to-record`, and six `<option>` tags in the
-- taskpane's HTML — written when the add-in shipped (2026-07-27) and never
-- widened since. Enrollments, incentives, assessments, buildings, units and
-- service appointments all carry a Communications card and could not be filed
-- onto.
--
-- The set of objects an email can be FILED on is not a matter of opinion: it
-- is exactly the set a conversation can be ANCHORED to, which
-- conversation_anchor_columns() already derives from the conversations table's
-- own foreign keys. So this stops being a list at all.
--
-- ON DYNAMIC SQL. The old function's comment promised "explicit per-object
-- static queries — never interpolated into dynamic SQL — so this cannot be
-- turned into an arbitrary-table read", and that guarantee is kept: the table
-- name must match a row of conversation_anchor_columns() (derived from
-- pg_catalog, twelve rows) before anything is built, every column identifier
-- comes from the catalog and is quoted with %I, and the caller's search text
-- is BOUND with USING and never interpolated. The function stays SECURITY
-- INVOKER, so RLS — including the geographic state scope — decides what the
-- picker can find.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. What an object is CALLED, for surfaces that cannot read the app bundle.
--
-- The Outlook add-in is served as static files and cannot import objectNav.js,
-- so it has to be told. The label is DERIVED from the table name; this table
-- holds only the objects the derivation gets wrong — today exactly one, the
-- object renamed from Incentive Application to Incentive on 2026-09-03.
-- Renaming an object again is then a row here, not a code change.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.object_display_labels (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  odl_record_number    text NOT NULL DEFAULT '',
  odl_object_name      text NOT NULL,
  odl_label            text NOT NULL,
  odl_label_plural     text NOT NULL,
  odl_notes            text,
  odl_owner            uuid REFERENCES public.users(id),
  odl_created_at       timestamptz NOT NULL DEFAULT now(),
  odl_created_by       uuid REFERENCES public.users(id),
  odl_updated_at       timestamptz NOT NULL DEFAULT now(),
  odl_updated_by       uuid REFERENCES public.users(id),
  odl_is_deleted       boolean NOT NULL DEFAULT false,
  odl_deleted_at       timestamptz,
  odl_deleted_by       uuid REFERENCES public.users(id),
  odl_deletion_reason  text
);

CREATE UNIQUE INDEX IF NOT EXISTS object_display_labels_object_name_key
  ON public.object_display_labels (odl_object_name)
  WHERE odl_is_deleted = false;

COMMENT ON TABLE public.object_display_labels IS
  'What an object is called on screen, for the objects whose label is not their table name humanized. Read by surfaces outside the app bundle (the Outlook add-in); the app itself reads the same overrides from src/lib/objectNav.js, and scripts/email-log-targets-fixture.mjs pins the two to each other.';

ALTER TABLE public.object_display_labels ENABLE ROW LEVEL SECURITY;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='object_display_labels' AND policyname='app_select_object_display_labels') THEN
    CREATE POLICY app_select_object_display_labels ON public.object_display_labels
      FOR SELECT USING (public.current_app_user_id() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='object_display_labels' AND policyname='app_write_object_display_labels') THEN
    CREATE POLICY app_write_object_display_labels ON public.object_display_labels
      FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.set_object_display_label_record_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.odl_record_number IS NULL OR btrim(NEW.odl_record_number) = '' THEN
    NEW.odl_record_number := 'ODL-' || lpad(nextval('public.object_display_labels_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE SEQUENCE IF NOT EXISTS public.object_display_labels_seq;

DROP TRIGGER IF EXISTS trg_odl_record_number ON public.object_display_labels;
CREATE TRIGGER trg_odl_record_number BEFORE INSERT ON public.object_display_labels
  FOR EACH ROW EXECUTE FUNCTION public.set_object_display_label_record_number();

DROP TRIGGER IF EXISTS trg_odl_block_hard_delete ON public.object_display_labels;
CREATE TRIGGER trg_odl_block_hard_delete BEFORE DELETE ON public.object_display_labels
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

SELECT public.install_record_audit_stamping('object_display_labels');

-- Configuration, not a record about a place: visible whatever states a user is
-- restricted to. Registered so record_state_scope_status() stays complete.
INSERT INTO public.record_state_scope_sources (
  rsss_record_number, rsss_object_name, rsss_resolution_kind, rsss_path_order, rsss_notes
)
SELECT '', 'object_display_labels', 'platform_configuration', 1,
       'What an object is called is configuration, not a record in a state.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.record_state_scope_sources
  WHERE rsss_object_name = 'object_display_labels' AND rsss_is_deleted = false
);

INSERT INTO public.object_display_labels (odl_object_name, odl_label, odl_label_plural, odl_notes)
SELECT 'incentive_applications', 'Incentive', 'Incentives',
       'Renamed 2026-09-03. The table keeps its name; only what people read changed.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.object_display_labels
  WHERE odl_object_name = 'incentive_applications' AND odl_is_deleted = false
);

-- -----------------------------------------------------------------------------
-- 2. The label itself — derived, with the table above as the exception list.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.object_display_label(p_object text)
 RETURNS TABLE(label text, label_plural text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH override AS (
    SELECT odl_label, odl_label_plural
    FROM public.object_display_labels
    WHERE odl_object_name = p_object AND odl_is_deleted = false
  ),
  derived AS (
    SELECT btrim((
      SELECT string_agg(initcap(w), ' ')
      FROM unnest(string_to_array(coalesce(p_object, ''), '_')) AS w
    )) AS plural
  ),
  singular AS (
    SELECT plural,
           CASE
             WHEN plural LIKE '%ies' THEN left(plural, length(plural) - 3) || 'y'
             WHEN plural LIKE '%ses' THEN left(plural, length(plural) - 2)
             WHEN plural LIKE '%s' AND plural NOT LIKE '%ss' THEN left(plural, length(plural) - 1)
             ELSE plural
           END AS one
    FROM derived
  )
  SELECT coalesce((SELECT odl_label FROM override), (SELECT one FROM singular)),
         coalesce((SELECT odl_label_plural FROM override), (SELECT plural FROM singular));
$function$;

REVOKE ALL ON FUNCTION public.object_display_label(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.object_display_label(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Which columns identify a record of this object.
--
-- Anchored on <prefix>_record_number, the same anchor recordInsertDefaults
-- uses: all 162 record-carrying tables have exactly one, and a record number is
-- never a business field. Everything else follows the prefix.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_log_target_columns(p_object text)
 RETURNS TABLE(
   prefix               text,
   name_column          text,
   record_number_column text,
   deleted_column       text,
   updated_column       text,
   email_column         text
 )
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_prefix text;
  v_rn     text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_anchor_columns() a WHERE a.object_name = p_object
  ) THEN
    RAISE EXCEPTION 'an email cannot be filed on %: a conversation cannot be anchored to it', p_object
      USING HINT = 'Allowed: ' || (
        SELECT string_agg(a.object_name, ', ' ORDER BY a.object_name)
        FROM public.conversation_anchor_columns() a
      );
  END IF;

  SELECT c.column_name::text INTO v_rn
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = p_object
    AND c.column_name LIKE '%\_record\_number'
  ORDER BY c.ordinal_position
  LIMIT 1;
  IF v_rn IS NULL THEN
    RAISE EXCEPTION '% has no record-number column, so its records cannot be identified in the picker', p_object;
  END IF;
  v_prefix := left(v_rn, length(v_rn) - length('_record_number'));

  RETURN QUERY
  SELECT
    v_prefix,
    (SELECT c.column_name::text FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=p_object AND c.column_name = v_prefix || '_name'),
    v_rn,
    (SELECT c.column_name::text FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=p_object
        AND c.column_name IN (v_prefix || '_is_deleted', 'is_deleted')
      ORDER BY (c.column_name = v_prefix || '_is_deleted') DESC LIMIT 1),
    (SELECT c.column_name::text FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=p_object
        AND c.column_name IN (v_prefix || '_updated_at', 'updated_at')
      ORDER BY (c.column_name = v_prefix || '_updated_at') DESC LIMIT 1),
    -- Only the object's OWN email column. properties carries nine, eight of
    -- them HUD import text about somebody else; searching those would bury the
    -- record you are looking for.
    (SELECT c.column_name::text FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=p_object
        AND c.column_name = v_prefix || '_email' AND c.data_type = 'text');
END;
$function$;

REVOKE ALL ON FUNCTION public.email_log_target_columns(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_log_target_columns(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. The objects the add-in offers, and what to call them.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_email_log_objects()
 RETURNS TABLE(object_name text, label text, label_plural text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT a.object_name, l.label, l.label_plural
  FROM public.conversation_anchor_columns() a
  CROSS JOIN LATERAL public.object_display_label(a.object_name) l
  ORDER BY l.label;
$function$;

COMMENT ON FUNCTION public.list_email_log_objects() IS
  'Every object an email can be filed onto from the Outlook add-in — exactly the objects a conversation can be anchored to, so the picker can never offer a record a thread could not live on, and never miss one that can.';

REVOKE ALL ON FUNCTION public.list_email_log_objects() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_email_log_objects() TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. The picker's search, over any of them.
--
-- Reproduces what the six hand-written branches did — label falls back to the
-- record number, the sublabel carries the record number and the object's own
-- email address, results are newest-first — for every object instead of six.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_records_for_email_log(
  p_object text,
  p_query  text DEFAULT NULL,
  p_limit  integer DEFAULT 20
)
 RETURNS TABLE(
   rec_object   text,
   rec_id       uuid,
   rec_label    text,
   rec_sublabel text
 )
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c        record;
  v_limit  int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_pattern text := CASE
    WHEN p_query IS NULL OR btrim(p_query) = '' THEN NULL
    ELSE '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  END;
  v_label    text;
  v_sublabel text;
  v_match    text;
  v_sql      text;
BEGIN
  -- Raises by name for an object no thread can be anchored to.
  SELECT * INTO c FROM public.email_log_target_columns(p_object);

  v_label := CASE
    WHEN c.name_column IS NULL THEN format('t.%I', c.record_number_column)
    ELSE format('coalesce(nullif(btrim(t.%I), %L), t.%I)', c.name_column, '', c.record_number_column)
  END;

  v_sublabel := CASE
    WHEN c.email_column IS NULL THEN format('t.%I', c.record_number_column)
    ELSE format('btrim(concat_ws(%L, t.%I, nullif(btrim(t.%I), %L)))',
                ' · ', c.record_number_column, c.email_column, '')
  END;

  v_match := format('t.%I ILIKE $1 ESCAPE ''\''', c.record_number_column);
  IF c.name_column IS NOT NULL THEN
    v_match := v_match || format(' OR t.%I ILIKE $1 ESCAPE ''\''', c.name_column);
  END IF;
  IF c.email_column IS NOT NULL THEN
    v_match := v_match || format(' OR t.%I ILIKE $1 ESCAPE ''\''', c.email_column);
  END IF;

  v_sql := format(
    'SELECT %L::text, t.id, %s, %s FROM public.%I t WHERE t.%I = false AND ($1 IS NULL OR (%s)) ORDER BY t.%I DESC NULLS LAST LIMIT %s',
    p_object, v_label, v_sublabel, p_object, c.deleted_column, v_match, c.updated_column, v_limit
  );

  RETURN QUERY EXECUTE v_sql USING v_pattern;
END;
$function$;

COMMENT ON FUNCTION public.search_records_for_email_log(text,text,integer) IS
  'The LEAP Outlook add-in''s record picker: finds records of any object a conversation can be anchored to. SECURITY INVOKER, so a user only ever finds records RLS already lets them see. The object must be a row of conversation_anchor_columns() and every column identifier comes from the catalog; the search text is bound, never interpolated.';

REVOKE ALL ON FUNCTION public.search_records_for_email_log(text,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_records_for_email_log(text,text,integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. The record an email is being filed onto: does it exist, and what is it
--    called? Replaces the edge function's hand-written soft-delete-column map.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_log_target(p_object text, p_id uuid)
 RETURNS TABLE(rec_object text, rec_id uuid, rec_label text, rec_number text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c    record;
  v_sql text;
BEGIN
  SELECT * INTO c FROM public.email_log_target_columns(p_object);

  v_sql := format(
    'SELECT %L::text, t.id, %s, t.%I FROM public.%I t WHERE t.id = $1 AND t.%I = false',
    p_object,
    CASE WHEN c.name_column IS NULL THEN format('t.%I', c.record_number_column)
         ELSE format('coalesce(nullif(btrim(t.%I), %L), t.%I)', c.name_column, '', c.record_number_column) END,
    c.record_number_column, p_object, c.deleted_column
  );

  RETURN QUERY EXECUTE v_sql USING p_id;
END;
$function$;

COMMENT ON FUNCTION public.email_log_target(text,uuid) IS
  'The record an email is being filed onto, if it exists and is not deleted — used by log-email-to-record in place of a hand-written per-object soft-delete-column map.';

REVOKE ALL ON FUNCTION public.email_log_target(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_log_target(text,uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Prove it, on every object rather than on the one that prompted it.
-- -----------------------------------------------------------------------------
DO $do$
DECLARE
  r       record;
  v_n     int;
  v_rows  int;
  v_label text;
BEGIN
  -- Every anchor object resolves its columns and answers a search.
  FOR r IN SELECT object_name FROM public.conversation_anchor_columns() ORDER BY 1 LOOP
    PERFORM * FROM public.email_log_target_columns(r.object_name);
    EXECUTE 'SELECT count(*) FROM public.search_records_for_email_log($1, NULL, 5)'
      INTO v_rows USING r.object_name;
  END LOOP;

  SELECT count(*) INTO v_n FROM public.list_email_log_objects();
  IF v_n <> 12 THEN
    RAISE EXCEPTION 'the add-in would be offered % objects, expected 12', v_n;
  END IF;

  -- The six the add-in already had must still be there.
  SELECT count(*) INTO v_n FROM public.list_email_log_objects()
   WHERE object_name IN ('opportunities','properties','accounts','contacts','projects','work_orders');
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'the picker lost one of the six objects it already offered';
  END IF;

  -- And the six it did not: this is the whole point.
  SELECT count(*) INTO v_n FROM public.list_email_log_objects()
   WHERE object_name IN ('enrollments','incentive_applications','assessments','buildings','units','service_appointments');
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'the picker is still missing an object a thread can be anchored to';
  END IF;

  -- The renamed object reads as renamed, from the override table.
  SELECT label INTO v_label FROM public.list_email_log_objects() WHERE object_name = 'incentive_applications';
  IF v_label IS DISTINCT FROM 'Incentive' THEN
    RAISE EXCEPTION 'the incentive object reads "%" in the add-in picker', v_label;
  END IF;
  -- …and an object with no override is humanized from its table name.
  SELECT label INTO v_label FROM public.list_email_log_objects() WHERE object_name = 'service_appointments';
  IF v_label IS DISTINCT FROM 'Service Appointment' THEN
    RAISE EXCEPTION 'a plain object reads "%" instead of its humanized name', v_label;
  END IF;

  -- CONTROL — an object no thread can be anchored to is refused by name, so
  -- the picker can never be pointed at an arbitrary table.
  BEGIN
    PERFORM * FROM public.search_records_for_email_log('work_steps', NULL, 1);
    RAISE EXCEPTION 'searching an unanchorable object was allowed';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%cannot be filed on work_steps%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM public.search_records_for_email_log('users', NULL, 1);
    RAISE EXCEPTION 'searching the users table was allowed';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%cannot be filed on users%' THEN RAISE; END IF;
  END;
END
$do$;

NOTIFY pgrst, 'reload schema';
