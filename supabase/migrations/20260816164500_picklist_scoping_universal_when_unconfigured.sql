-- Record-type picklist scoping: universal fallback when a record type has no
-- selection at all for a field.
--
-- 20260813133656 made scoping strict: a record type shows ONLY the values
-- selected for it, and a record type with NO selection shows zero. The strict
-- half is correct and stays — it is what stops WI-HOMES-Audit stages leaking
-- into every opportunity ladder, and what keeps each opportunity record type on
-- its own stage picklist.
--
-- The "shows zero" half is what broke ordinary fields. Only four object/field
-- combinations in the whole platform have ever been scoped
-- (accounts.tax_classification, enrollments.enrollment_status,
-- opportunities.opportunity_stage, projects.project_status) — every other
-- picklist has zero assignments, so once a record carries a record type its
-- dropdown came back empty. Creating a Building, for example, offered no Type at
-- all even though nine active values exist.
--
-- New rule, per record type (not per field):
--   • the record type HAS a selection for this field  -> show only those values
--     (unchanged: strict, no leakage)
--   • the record type has NO selection for this field -> show every active value
--     (Salesforce default: an unconfigured record type inherits the full list)
--   • p_record_type IS NULL                           -> show every active value
--
-- Record types that ARE configured are completely unaffected, so nothing that
-- 20260813133656 fixed regresses.
CREATE OR REPLACE FUNCTION public.picklist_values_for_record_type(p_object text, p_field text, p_record_type uuid)
 RETURNS TABLE(id uuid, picklist_value text, picklist_label text, picklist_sort_order integer, picklist_description text, scope_mode text)
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
      p_record_type IS NULL   -- no record-type context: show all active values
      OR CASE
           WHEN EXISTS (   -- does this record type have an explicit selection for this field?
             SELECT 1 FROM public.picklist_value_record_type_assignments s
               JOIN public.picklist_values sv ON sv.id = s.pvrta_picklist_value_id
              WHERE s.pvrta_record_type_id = p_record_type
                AND s.pvrta_is_deleted = false
                AND sv.picklist_object = p_object
                AND sv.picklist_field  = p_field
           )
           THEN EXISTS (   -- yes: show ONLY the values it selected
             SELECT 1 FROM public.picklist_value_record_type_assignments x
              WHERE x.pvrta_picklist_value_id = pv.id
                AND x.pvrta_record_type_id    = p_record_type
                AND x.pvrta_is_deleted        = false
           )
           ELSE true       -- no selection for this record type: show every active value
         END
    )
  ORDER BY COALESCE(a.pvrta_sort_order, pv.picklist_sort_order) NULLS LAST, pv.picklist_value;
$function$;

REVOKE ALL ON FUNCTION public.picklist_values_for_record_type(p_object text, p_field text, p_record_type uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.picklist_values_for_record_type(p_object text, p_field text, p_record_type uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.picklist_values_for_record_type(p_object text, p_field text, p_record_type uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.picklist_values_for_record_type(p_object text, p_field text, p_record_type uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.picklist_values_for_record_type(p_object text, p_field text, p_record_type uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
