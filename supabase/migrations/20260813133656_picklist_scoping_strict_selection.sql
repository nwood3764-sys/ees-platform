-- Strict record-type picklist scoping.
--
-- A record type now shows ONLY the values selected for it (via
-- picklist_value_record_type_assignments). A record type with no selection shows
-- zero. This replaces the prior "show a value unless it's assigned to some record
-- type" rule, under which every UNASSIGNED value leaked into every record type —
-- e.g. all 36 project statuses showed under MF-Exhaust Fan Replacement despite
-- only 13 being selected, and 7 WI-HOMES-Audit stages leaked into every
-- opportunity ladder. p_record_type IS NULL (no record-type context) still returns
-- all active values.
--
-- Client counterpart (same change set): fetchPicklistOptions() and the record
-- edit form now route picklist dropdowns through this resolver with the record's
-- record type, so edit-mode dropdowns match the status path.
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
           ELSE false      -- no selection for this record type: show zero
         END
    )
  ORDER BY COALESCE(a.pvrta_sort_order, pv.picklist_sort_order) NULLS LAST, pv.picklist_value;
$function$;

NOTIFY pgrst, 'reload schema';
