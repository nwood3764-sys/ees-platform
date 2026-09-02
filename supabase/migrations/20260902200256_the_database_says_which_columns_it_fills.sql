-- ============================================================================
-- A create form must not ask for a column the database fills itself.
--
-- Nicholas, 2026-09-02, on the New Service Appointment pop-up: "auto create
-- name of SA record".
--
-- The name ALREADY auto-creates. `trg_sa_name` composes it on insert — a
-- service appointment saved with the name "NEW" comes back as "3002 West
-- Darling Street - Appleton". What was wrong is that the pop-up ASKED for it,
-- as a required field, so a person had to type a value the database throws away
-- one statement later.
--
-- The client knew about this class of column through a hand-written map,
-- TRIGGER_DERIVED_REQUIRED, listing 10 tables. `service_appointments` was not
-- one of them. That is the third hand-maintained list to fail today, after the
-- work-order visibility route and applyInsertDefaults' table→prefix map, and
-- the fix is the same one: stop listing, start asking.
--
-- Only the database can answer "which columns does a trigger fill", so it does.
-- The detector reproduces every entry of the hand-written map exactly — and
-- finds sa_name, which the map was missing. Platform-wide it identifies 769
-- trigger-written columns across 191 tables, 333 of them NOT NULL: that many
-- columns the create form could have been demanding and the database was always
-- going to overwrite.
--
-- Scope, deliberately narrow: this answers what must not be DEMANDED. It does
-- NOT decide what is read-only. Those are different questions and conflating
-- them would break a real feature — `ia_property_owner_name` is trigger-filled
-- AND deliberately overridable (HA-00192, 2026-09-02), so a blanket
-- "trigger-written means read-only" would remove an override that was built on
-- purpose. Editability stays hand-curated in DERIVED_READONLY, where the intent
-- is recorded per column.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trigger_written_columns(p_object text)
RETURNS TABLE (column_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $fn$
  -- Columns assigned as NEW.<column> by any BEFORE INSERT/UPDATE trigger on the
  -- table. Matching the function source is the only way to see this: PostgreSQL
  -- records which trigger fires, never which columns it writes.
  --
  -- Intersected with the table's real columns, so a NEW.<something> that is not
  -- a column (a local variable, a record field of another type) cannot leak out.
  WITH trg AS (
    SELECT p.prosrc
    FROM pg_trigger t
    JOIN pg_class c     ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_proc p      ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal
      AND c.relname = p_object
      AND (t.tgtype & 2) <> 0                                  -- BEFORE
      AND ((t.tgtype & 4) <> 0 OR (t.tgtype & 16) <> 0)        -- INSERT or UPDATE
  ),
  assigned AS (
    SELECT DISTINCT
      lower((regexp_matches(prosrc, 'NEW\.([a-z_][a-z0-9_]*)\s*:?=', 'gi'))[1]) AS col
    FROM trg
  )
  SELECT a.col::text
  FROM assigned a
  JOIN information_schema.columns ic
    ON ic.table_schema = 'public'
   AND ic.table_name   = p_object
   AND ic.column_name  = a.col
  ORDER BY 1;
$fn$;

-- Schema metadata, exactly like describe_object_columns, which every create
-- form already calls. Nothing here reads a business row.
REVOKE ALL ON FUNCTION public.trigger_written_columns(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trigger_written_columns(text) TO authenticated;

-- ─── Assert it against what the hand-written map already knew ───────────────
-- The map was right about the tables it covered; it was simply incomplete. If
-- the detector cannot reproduce it, the detector is wrong and this must fail
-- rather than quietly changing which fields every create form demands.
DO $do$
DECLARE
  v_expected CONSTANT jsonb := jsonb_build_object(
    'contacts',                  jsonb_build_array('contact_name'),
    'opportunities',             jsonb_build_array('opportunity_name'),
    'buildings',                 jsonb_build_array('building_name'),
    'units',                     jsonb_build_array('unit_name'),
    'projects',                  jsonb_build_array('project_name'),
    'work_orders',               jsonb_build_array('work_order_name'),
    'enrollments',               jsonb_build_array('enrollment_name'),
    'opportunity_contact_roles', jsonb_build_array('ocr_name'),
    'opportunity_line_items',    jsonb_build_array('oli_name'),
    'incentive_applications',    jsonb_build_array('ia_name', 'ia_program_name')
  );
  r        record;
  v_missing text;
BEGIN
  FOR r IN SELECT key AS obj, value AS cols FROM jsonb_each(v_expected) LOOP
    SELECT string_agg(c.value #>> '{}', ', ') INTO v_missing
    FROM jsonb_array_elements(r.cols) c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.trigger_written_columns(r.obj) t
      WHERE t.column_name = c.value #>> '{}'
    );
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION
        'trigger_written_columns(%) does not report %, which the hand-written map knew was trigger-derived',
        r.obj, v_missing;
    END IF;
  END LOOP;

  -- And the one the map was missing, which is why this exists at all.
  IF NOT EXISTS (
    SELECT 1 FROM public.trigger_written_columns('service_appointments')
    WHERE column_name = 'sa_name'
  ) THEN
    RAISE EXCEPTION 'trigger_written_columns(service_appointments) does not report sa_name';
  END IF;

  -- A column no trigger touches must NOT be claimed, or the create form would
  -- stop asking for something a person genuinely has to supply. work_type_id
  -- and assigned_technician_id on a work order are chosen by a human and no
  -- BEFORE trigger writes either.
  --
  -- (properties.property_name is deliberately NOT the control here, though it
  -- looks like one: normalize_property_address really does compose it from
  -- street + city — "3002 West Darling Street - Appleton" — so the detector is
  -- right to report it and the create form is right to stop demanding it.)
  IF EXISTS (
    SELECT 1 FROM public.trigger_written_columns('work_orders')
    WHERE column_name IN ('work_type_id', 'assigned_technician_id')
  ) THEN
    RAISE EXCEPTION 'trigger_written_columns(work_orders) wrongly claims a column a person must supply';
  END IF;
END
$do$;

NOTIFY pgrst, 'reload schema';
