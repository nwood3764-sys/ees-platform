-- =====================================================================
-- Add "Through-the-Wall Air Conditioner" to the Cooling System Type
-- option list (Nicholas, 2026-07-22). Admin-managed picklist under
-- picklist_object='work_step_fields', picklist_field='cooling_system_type'.
-- Guarded so it is safe to replay.
-- =====================================================================
INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
SELECT 'work_step_fields', 'cooling_system_type', 'Through-the-Wall Air Conditioner', 'Through-the-Wall Air Conditioner', true, 45, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values
   WHERE picklist_object='work_step_fields' AND picklist_field='cooling_system_type'
     AND picklist_value='Through-the-Wall Air Conditioner'
);

NOTIFY pgrst, 'reload schema';
