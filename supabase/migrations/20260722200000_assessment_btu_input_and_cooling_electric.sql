-- =====================================================================
-- Assessment tweaks (Nicholas, 2026-07-22, after live LEAP Pad testing):
--   1. Rename the BTU field to "BTU Input" on all three mechanical
--      sections (it's the input rating).
--   2. Cooling systems are always electric — remove the Fuel Type prompt
--      from the Cooling System section (soft delete; the flow only shows
--      non-deleted fields).
-- Idempotent: guarded so a replay after the field-creation migration is a
-- no-op the second time.
-- =====================================================================

UPDATE public.work_step_template_fields
   SET wstf_field_label = 'BTU Input',
       wstf_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af', wstf_updated_at = now()
 WHERE wstf_field_name IN ('heating_system_btu','cooling_system_btu','water_heating_system_btu')
   AND wstf_field_label IS DISTINCT FROM 'BTU Input'
   AND wstf_is_deleted IS NOT TRUE;

UPDATE public.work_step_template_fields
   SET wstf_is_deleted = true, wstf_is_active = false, wstf_deleted_at = now(),
       wstf_deleted_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
 WHERE wstf_field_name = 'cooling_system_fuel_type'
   AND wstf_is_deleted IS NOT TRUE;

NOTIFY pgrst, 'reload schema';
