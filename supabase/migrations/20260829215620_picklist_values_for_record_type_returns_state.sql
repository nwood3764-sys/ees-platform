-- picklist_values_for_record_type() returns picklist_state.
--
-- A picklist value has been able to name a state since the baseline
-- (picklist_values.picklist_state), but only the record-type picker ever read
-- it. The building utility picklists seeded alongside this migration are the
-- first ordinary field whose values are state-specific: which utilities exist
-- is a fact about where the building is, and a Rocky Mount building has no
-- business being offered Madison Gas and Electric.
--
-- The client narrows the list; it can only do that if the resolver hands the
-- state back. Every record page with a record type goes through THIS function
-- rather than the plain picklist_values read, so leaving it out here would mean
-- the filter silently did nothing on exactly the pages that matter.
--
-- Adding a column to a RETURNS TABLE needs a DROP/CREATE, so the grants are
-- re-issued and PostgREST is told to reload (the 2026-07 rule).


DROP FUNCTION IF EXISTS public.picklist_values_for_record_type(text, text, uuid);

CREATE FUNCTION public.picklist_values_for_record_type(p_object text, p_field text, p_record_type uuid)
RETURNS TABLE(
  id uuid,
  picklist_value text,
  picklist_label text,
  picklist_sort_order integer,
  picklist_description text,
  picklist_state text,
  scope_mode text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    pv.id,
    pv.picklist_value,
    pv.picklist_label,
    COALESCE(a.pvrta_sort_order, pv.picklist_sort_order) AS picklist_sort_order,
    pv.picklist_description,
    pv.picklist_state,
    CASE WHEN EXISTS (
      SELECT 1 FROM public.picklist_value_record_type_assignments x
       WHERE x.pvrta_picklist_value_id = pv.id
         AND x.pvrta_is_deleted = false
    ) THEN 'scoped' ELSE 'universal' END AS scope_mode
  FROM public.picklist_values pv
  LEFT JOIN public.picklist_value_record_type_assignments a
    ON a.pvrta_picklist_value_id = pv.id
   AND a.pvrta_record_type_id    = p_record_type
   AND a.pvrta_is_deleted        = false
  WHERE pv.picklist_object = p_object
    AND pv.picklist_field  = p_field
    AND pv.picklist_is_active = true
    AND COALESCE(pv.picklist_show_in_path, true) = true
    AND (
      p_record_type IS NULL
      OR CASE
           WHEN EXISTS (
             SELECT 1 FROM public.picklist_value_record_type_assignments s
               JOIN public.picklist_values sv ON sv.id = s.pvrta_picklist_value_id
              WHERE s.pvrta_record_type_id = p_record_type
                AND s.pvrta_is_deleted = false
                AND sv.picklist_object = p_object
                AND sv.picklist_field  = p_field
           )
           THEN EXISTS (
             SELECT 1 FROM public.picklist_value_record_type_assignments x
              WHERE x.pvrta_picklist_value_id = pv.id
                AND x.pvrta_record_type_id    = p_record_type
                AND x.pvrta_is_deleted        = false
           )
           ELSE true
         END
    )
  ORDER BY COALESCE(a.pvrta_sort_order, pv.picklist_sort_order) NULLS LAST, pv.picklist_value;
$function$;

REVOKE ALL ON FUNCTION public.picklist_values_for_record_type(p_object text, p_field text, p_record_type uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.picklist_values_for_record_type(p_object text, p_field text, p_record_type uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.picklist_values_for_record_type(p_object text, p_field text, p_record_type uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.picklist_values_for_record_type(p_object text, p_field text, p_record_type uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.picklist_values_for_record_type(p_object text, p_field text, p_record_type uuid) TO service_role;

DO $$
DECLARE v_result text;
BEGIN
  SELECT pg_get_function_result(p.oid) INTO v_result
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'picklist_values_for_record_type';
  IF v_result IS NULL OR v_result NOT LIKE '%picklist_state text%' THEN
    RAISE EXCEPTION 'picklist_values_for_record_type does not return picklist_state: %', v_result;
  END IF;
END $$;


NOTIFY pgrst, 'reload schema';
