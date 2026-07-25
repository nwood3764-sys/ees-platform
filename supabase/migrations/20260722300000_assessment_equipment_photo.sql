-- =====================================================================
-- Restore a general "Equipment Photo" as the first prompt on the three
-- mechanical assessment sections (Nicholas, 2026-07-22) — a full shot of
-- the unit, ahead of the nameplate close-up. 'photo' field type, required.
-- Idempotent.
-- =====================================================================
DO $$
DECLARE
  v_nick uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_tpl  uuid;
BEGIN
  FOR v_tpl IN
    SELECT id FROM public.work_step_templates
    WHERE wst_name IN ('Heating System','Cooling System','Water Heating System')
      AND wst_is_deleted IS NOT TRUE
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.work_step_template_fields
      WHERE work_step_template_id = v_tpl AND wstf_field_name = 'equipment_photo' AND wstf_is_deleted IS NOT TRUE
    ) THEN
      INSERT INTO public.work_step_template_fields (wstf_record_number, work_step_template_id, wstf_field_label, wstf_field_name, wstf_field_type, wstf_is_required, wstf_unit, wstf_sort_order, wstf_owner, wstf_created_by)
      VALUES ('', v_tpl, 'Equipment Photo', 'equipment_photo', 'photo', true, NULL, 1, v_nick, v_nick);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
