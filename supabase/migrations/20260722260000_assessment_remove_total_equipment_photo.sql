-- =====================================================================
-- Remove the "Total Equipment Photo" prompt from the assessment sections
-- (Nicholas, 2026-07-22 — the label was a voice-to-text artifact and
-- carries no meaning). The Equipment Nameplate Photo remains. Idempotent.
-- =====================================================================
UPDATE public.work_step_template_fields
   SET wstf_is_deleted = true, wstf_is_active = false, wstf_deleted_at = now(),
       wstf_deleted_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
 WHERE wstf_field_name = 'total_equipment_photo'
   AND wstf_is_deleted IS NOT TRUE;

NOTIFY pgrst, 'reload schema';
