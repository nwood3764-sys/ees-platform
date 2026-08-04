-- The enrollment_status lifecycle values are record-type scoped via
-- picklist_value_record_type_assignments. They were assigned to the other
-- enrollment record types but NOT to WI-IRA-MF-HOMES-Assessment-Preapproval,
-- so picklist_values_for_record_type returned nothing for that record type and
-- the Status Path chevron bar rendered empty (hidden) on those enrollments.
-- Assign the full 8-status lifecycle to the assessment record type.
INSERT INTO public.picklist_value_record_type_assignments
  (pvrta_record_number, pvrta_picklist_value_id, pvrta_record_type_id, pvrta_sort_order)
SELECT '', pv.id, rt.id, pv.picklist_sort_order
FROM public.picklist_values pv
CROSS JOIN LATERAL (
  SELECT id FROM public.picklist_values
  WHERE picklist_object='enrollments' AND picklist_field='record_type'
    AND picklist_value='WI-IRA-MF-HOMES-Assessment-Preapproval'
  LIMIT 1
) rt
WHERE pv.picklist_object='enrollments' AND pv.picklist_field='enrollment_status'
  AND NOT EXISTS (
    SELECT 1 FROM public.picklist_value_record_type_assignments a
    WHERE a.pvrta_picklist_value_id = pv.id
      AND a.pvrta_record_type_id = rt.id
      AND a.pvrta_is_deleted IS NOT TRUE
  );
