-- A record type with no statuses selected shows NO statuses, not all of them.
--
-- Nicholas, on PROJ-00105 (record type MF-INS-AIR): the record page painted all
-- 36 project statuses as a 36-chevron path while Object Manager showed
-- "Selected Values - MF-INS-AIR: Empty". Two screens describing the same
-- configuration in opposite terms. His ruling: "If we don't have any statuses on
-- the selected values, it needs to just have none. You can't list everything...
-- The user needs to enter them." And: "really, any object with a status."
--
-- WHAT WAS ACTUALLY HAPPENING. Nothing was broken; this is the rule
-- 20260816164500 installed on purpose. Being strict everywhere had blanked every
-- picklist on every record (building_type went to zero values), because only 4
-- object/field pairs in the platform are scoped at all -- so the resolver was
-- made permissive: no selection means show everything. That fixed
-- building_type and, with it, told every record type that its lifecycle is
-- "all 36 statuses of three different objects".
--
-- Permissive is right for an ATTRIBUTE picklist and wrong for a LIFECYCLE. So
-- strictness becomes a declared property of the field rather than a property of
-- the resolver, and the two kinds stop sharing one answer.
--
-- WHICH FIELDS ARE LIFECYCLES IS READ FROM THE DATA, NEVER FROM THE NAME. A
-- name rule (/_status$/) would have swept in unit_occupancy_status
-- (Occupied/Vacant), heating_plant_co_status, stove_co_status and
-- water_heater_co_status (a combustion test result), combustion_ventilation_status,
-- provider_acceptance_status and the two approval-status fields -- 27 of the 33
-- fields whose name ends in _status or _stage are ordinary attributes, and
-- blanking those per record type would be a defect, not this ruling. The seed
-- below is the union of the two places LEAP already records what a lifecycle is:
-- the objects status_transitions governs, and the fields a status_path widget
-- renders. They agree on 6 object/field pairs and nothing else.
--
-- THE RECORD'S OWN VALUE IS NEVER HIDDEN. p_current_value is always returned
-- even when it is outside the selection (or when the selection is empty), so a
-- record that already carries a status keeps showing it, its path still marks
-- where it stands, and saving an unrelated field can never silently clear it.
-- A strict rule that could blank a stored value would be worse than the bug.

-- ---------------------------------------------------------------------------
-- 1. The registry
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.picklist_field_record_type_scoping_seq;

CREATE TABLE IF NOT EXISTS public.picklist_field_record_type_scoping (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pfrs_record_number     text NOT NULL DEFAULT '',
  pfrs_object            text NOT NULL,
  pfrs_field             text NOT NULL,
  pfrs_empty_selection   text NOT NULL DEFAULT 'show_all'
                           CHECK (pfrs_empty_selection IN ('show_none','show_all')),
  pfrs_notes             text,
  pfrs_is_active         boolean NOT NULL DEFAULT true,
  pfrs_owner             uuid REFERENCES public.users(id),
  pfrs_is_deleted        boolean NOT NULL DEFAULT false,
  pfrs_deleted_at        timestamptz,
  pfrs_deleted_by        uuid REFERENCES public.users(id),
  pfrs_deletion_reason   text,
  is_seed_data           boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE public.picklist_field_record_type_scoping IS
  'Declares, per picklist field, what an EMPTY per-record-type value selection means. show_none = a lifecycle: a record type with nothing selected offers no values and must be configured. show_all = an attribute picklist: nothing selected means every active value. Read by picklist_values_for_record_type; never inferred from the column name.';

CREATE UNIQUE INDEX IF NOT EXISTS picklist_field_record_type_scoping_unique_live
  ON public.picklist_field_record_type_scoping (pfrs_object, pfrs_field)
  WHERE pfrs_is_deleted IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.set_pfrs_record_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_catalog' AS $fn$
BEGIN
  IF NEW.pfrs_record_number IS NULL OR NEW.pfrs_record_number = '' THEN
    NEW.pfrs_record_number := public.generate_record_number(
      'PFRS-', 'picklist_field_record_type_scoping_seq');
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.set_pfrs_record_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pfrs_record_number ON public.picklist_field_record_type_scoping;
CREATE TRIGGER trg_pfrs_record_number BEFORE INSERT ON public.picklist_field_record_type_scoping
  FOR EACH ROW EXECUTE FUNCTION public.set_pfrs_record_number();

DROP TRIGGER IF EXISTS trg_pfrs_block_hard_delete ON public.picklist_field_record_type_scoping;
CREATE TRIGGER trg_pfrs_block_hard_delete BEFORE DELETE ON public.picklist_field_record_type_scoping
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

ALTER TABLE public.picklist_field_record_type_scoping ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_select_pfrs ON public.picklist_field_record_type_scoping;
CREATE POLICY app_select_pfrs ON public.picklist_field_record_type_scoping
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS app_insert_pfrs ON public.picklist_field_record_type_scoping;
CREATE POLICY app_insert_pfrs ON public.picklist_field_record_type_scoping
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.app_user_can('picklist_field_record_type_scoping','create')));
DROP POLICY IF EXISTS app_update_pfrs ON public.picklist_field_record_type_scoping;
CREATE POLICY app_update_pfrs ON public.picklist_field_record_type_scoping
  FOR UPDATE TO authenticated
  USING ((SELECT public.app_user_can('picklist_field_record_type_scoping','update')))
  WITH CHECK ((SELECT public.app_user_can('picklist_field_record_type_scoping','update')));

-- Every base table must be classified for geographic record access
-- (record_state_scope_status() must report zero unregistered). This is
-- platform configuration: it names picklist fields, never a customer record.
INSERT INTO public.record_state_scope_sources
  (rsss_record_number, rsss_object_name, rsss_resolution_kind, rsss_path_order,
   rsss_is_active, rsss_notes)
SELECT '', 'picklist_field_record_type_scoping', 'platform_configuration', 1, true,
       'Picklist field scoping rules. Configuration, not customer data - visible to every internal user.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.record_state_scope_sources
   WHERE rsss_object_name = 'picklist_field_record_type_scoping'
     AND rsss_is_deleted IS NOT TRUE);

-- ---------------------------------------------------------------------------
-- 2. Seed — derived from what LEAP already records as a lifecycle
-- ---------------------------------------------------------------------------
INSERT INTO public.picklist_field_record_type_scoping
  (pfrs_record_number, pfrs_object, pfrs_field, pfrs_empty_selection, pfrs_notes, is_seed_data)
SELECT '', d.obj, d.fld, 'show_none',
       'Lifecycle field. Derived from '
         || string_agg(DISTINCT d.source, ' and ' ORDER BY d.source)
         || '. A record type with no selection offers no values and must be configured.',
       true
FROM (
  SELECT st_object AS obj, st_status_field AS fld,
         'status_transitions' AS source
    FROM public.status_transitions
   GROUP BY 1,2
  UNION
  SELECT pl.page_layout_object, w.widget_config->>'status_field',
         'a status_path widget'
    FROM public.page_layout_widgets w
    JOIN public.page_layouts pl ON pl.id = w.page_layout_id
   WHERE w.widget_type = 'status_path'
     AND w.is_deleted IS NOT TRUE AND pl.is_deleted IS NOT TRUE
     AND COALESCE(w.widget_config->>'status_field','') <> ''
   GROUP BY 1,2
) d
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_field_record_type_scoping f
   WHERE f.pfrs_object = d.obj AND f.pfrs_field = d.fld
     AND f.pfrs_is_deleted IS NOT TRUE)
GROUP BY d.obj, d.fld;

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.picklist_field_record_type_scoping
   WHERE pfrs_empty_selection = 'show_none' AND pfrs_is_deleted IS NOT TRUE;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'No lifecycle fields were derived; the strict rule would be inert.';
  END IF;
  RAISE NOTICE 'Lifecycle fields declared strict: %', v_n;
END $$;

-- ---------------------------------------------------------------------------
-- 3. An object whose every record type shares ONE lifecycle is configured
--    explicitly, rather than left to mean "all of them" implicitly.
--
--    work_orders (11 statuses), incentive_applications (9) and
--    project_payment_requests (9) each carry a single lifecycle that genuinely
--    applies to every one of their record types -- 76, 22 and 1 of them. Under
--    the new rule an empty selection means none, so leaving them empty would
--    blank the incentive application status path on all 24 layouts (the strip
--    made legible on 2026-09-01) and every work order's status. Writing the
--    selection out changes nothing anyone sees; it turns an assumption into
--    configuration a person can now edit per record type.
--
--    projects.project_status is deliberately NOT seeded: its 36 values mix
--    three objects' vocabularies ("Project ...", "Work Order ...",
--    "Incentive ..."), which is exactly the "you can't list everything" Nicholas
--    is pointing at. Those record types now offer nothing until their lifecycle
--    is authored. Same for the enrollment reservation types and WI-FOE-2026,
--    each already logged as an unbuilt stage set.
-- ---------------------------------------------------------------------------
INSERT INTO public.picklist_value_record_type_assignments
  (pvrta_record_type_id, pvrta_picklist_value_id, pvrta_sort_order, pvrta_is_deleted)
SELECT rt.id, v.id, v.picklist_sort_order, false
FROM (VALUES
  ('work_orders','work_order_status'),
  ('incentive_applications','ia_status'),
  ('project_payment_requests','ppr_status')
) AS shared(obj, fld)
JOIN public.picklist_values rt
  ON rt.picklist_object = shared.obj AND rt.picklist_field = 'record_type'
 AND rt.picklist_is_active
JOIN public.picklist_values v
  ON v.picklist_object = shared.obj AND v.picklist_field = shared.fld
 AND v.picklist_is_active
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_value_record_type_assignments a
   WHERE a.pvrta_record_type_id = rt.id
     AND a.pvrta_picklist_value_id = v.id
     AND a.pvrta_is_deleted = false);

-- ---------------------------------------------------------------------------
-- 4. The resolver
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.picklist_values_for_record_type(text, text, uuid);

CREATE OR REPLACE FUNCTION public.picklist_values_for_record_type(
  p_object        text,
  p_field         text,
  p_record_type   uuid,
  p_current_value uuid DEFAULT NULL
)
RETURNS TABLE(id uuid, picklist_value text, picklist_label text,
              picklist_sort_order integer, picklist_description text,
              picklist_state text, scope_mode text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_catalog'
AS $fn$
  WITH selection AS (
    SELECT a.pvrta_picklist_value_id AS value_id, a.pvrta_sort_order
      FROM public.picklist_value_record_type_assignments a
      JOIN public.picklist_values sv ON sv.id = a.pvrta_picklist_value_id
     WHERE a.pvrta_record_type_id = p_record_type
       AND a.pvrta_is_deleted = false
       AND sv.picklist_object = p_object
       AND sv.picklist_field  = p_field
  ),
  rule AS (
    SELECT EXISTS (
      SELECT 1 FROM public.picklist_field_record_type_scoping f
       WHERE f.pfrs_object = p_object
         AND f.pfrs_field  = p_field
         AND f.pfrs_is_active
         AND f.pfrs_is_deleted IS NOT TRUE
         AND f.pfrs_empty_selection = 'show_none'
    ) AS empty_means_none
  )
  SELECT pv.id,
         pv.picklist_value,
         pv.picklist_label,
         COALESCE(s.pvrta_sort_order, pv.picklist_sort_order) AS picklist_sort_order,
         pv.picklist_description,
         pv.picklist_state,
         CASE WHEN s.value_id IS NOT NULL          THEN 'scoped'
              WHEN pv.id = p_current_value         THEN 'current_value'
              ELSE 'universal' END AS scope_mode
    FROM public.picklist_values pv
    LEFT JOIN selection s ON s.value_id = pv.id
   WHERE pv.picklist_object = p_object
     AND pv.picklist_field  = p_field
     AND pv.picklist_is_active = true
     AND COALESCE(pv.picklist_show_in_path, true) = true
     AND (
       p_record_type IS NULL
       -- selected for this record type
       OR s.value_id IS NOT NULL
       -- the record's own value is never hidden, whatever the selection says
       OR pv.id = p_current_value
       -- nothing selected: an attribute picklist still shows everything, a
       -- lifecycle shows nothing until it is configured
       OR (NOT EXISTS (SELECT 1 FROM selection)
           AND NOT (SELECT empty_means_none FROM rule))
     )
   ORDER BY COALESCE(s.pvrta_sort_order, pv.picklist_sort_order) NULLS LAST,
            pv.picklist_value;
$fn$;

REVOKE ALL ON FUNCTION public.picklist_values_for_record_type(text,text,uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.picklist_values_for_record_type(text,text,uuid,uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. The gap, named. A record type whose lifecycle nobody has authored is now
--    a thing you can list, rather than something a user discovers as an empty
--    dropdown.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_types_missing_status_configuration()
RETURNS TABLE(object_name text, status_field text, record_type_label text,
              record_type_value text, record_type_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_catalog'
AS $fn$
  SELECT f.pfrs_object, f.pfrs_field, rt.picklist_label, rt.picklist_value, rt.id
    FROM public.picklist_field_record_type_scoping f
    JOIN public.picklist_values rt
      ON rt.picklist_object = f.pfrs_object
     AND rt.picklist_field  = 'record_type'
     AND rt.picklist_is_active
   WHERE f.pfrs_empty_selection = 'show_none'
     AND f.pfrs_is_active
     AND f.pfrs_is_deleted IS NOT TRUE
     AND NOT EXISTS (
       SELECT 1 FROM public.picklist_value_record_type_assignments a
        JOIN public.picklist_values sv ON sv.id = a.pvrta_picklist_value_id
       WHERE a.pvrta_record_type_id = rt.id
         AND a.pvrta_is_deleted = false
         AND sv.picklist_object = f.pfrs_object
         AND sv.picklist_field  = f.pfrs_field)
   ORDER BY f.pfrs_object, f.pfrs_field, rt.picklist_label;
$fn$;
REVOKE ALL ON FUNCTION public.record_types_missing_status_configuration() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_types_missing_status_configuration() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 6. Assertions — the rule is proved here, not assumed
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_project_rt uuid;
  v_wo_rt      uuid;
  v_attr_rt    uuid;
  v_n          int;
  v_expected   int;
  v_status     uuid;
BEGIN
  -- A lifecycle with no selection: none.
  SELECT id INTO v_project_rt FROM public.picklist_values
   WHERE picklist_object='projects' AND picklist_field='record_type'
     AND picklist_value='MF-INS-AIR';
  SELECT count(*) INTO v_n
    FROM public.picklist_values_for_record_type('projects','project_status',v_project_rt);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'MF-INS-AIR still offers % project statuses; expected 0.', v_n;
  END IF;

  -- ...but the record's own value is still returned.
  SELECT id INTO v_status FROM public.picklist_values
   WHERE picklist_object='projects' AND picklist_field='project_status'
     AND picklist_is_active ORDER BY picklist_sort_order NULLS LAST LIMIT 1;
  SELECT count(*) INTO v_n
    FROM public.picklist_values_for_record_type('projects','project_status',v_project_rt,v_status);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'A project holding a status must still see it; got % rows.', v_n;
  END IF;

  -- An object whose one lifecycle was written out sees exactly what it saw
  -- before: every value the resolver was already willing to return. Counted,
  -- not hard-coded -- one work order status (Unable to Complete) carries
  -- picklist_show_in_path = false and the resolver has always withheld it,
  -- which is a separate defect and deliberately not changed here.
  SELECT id INTO v_wo_rt FROM public.picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='record_type'
     AND picklist_is_active ORDER BY picklist_label LIMIT 1;
  SELECT count(*) INTO v_expected FROM public.picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='work_order_status'
     AND picklist_is_active AND COALESCE(picklist_show_in_path,true);
  SELECT count(*) INTO v_n
    FROM public.picklist_values_for_record_type('work_orders','work_order_status',v_wo_rt);
  IF v_n <> v_expected THEN
    RAISE EXCEPTION 'Work order statuses should still be % for every record type; got %.',
      v_expected, v_n;
  END IF;

  -- An ATTRIBUTE picklist is untouched: no selection still means every value.
  SELECT id INTO v_attr_rt FROM public.picklist_values
   WHERE picklist_object='buildings' AND picklist_field='record_type'
     AND picklist_is_active ORDER BY picklist_label LIMIT 1;
  SELECT count(*) INTO v_n
    FROM public.picklist_values_for_record_type('buildings','building_type',v_attr_rt);
  IF v_n < 2 THEN
    RAISE EXCEPTION 'building_type is an attribute picklist and must still show every value; got %.', v_n;
  END IF;

  RAISE NOTICE 'Strict lifecycle scoping verified.';
END $$;
