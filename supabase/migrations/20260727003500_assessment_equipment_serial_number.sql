-- Equipment Serial Number capture on the three assessment systems.
--
-- The manufacture date of HVAC / water-heating equipment is decoded from the
-- SERIAL number, not the model number — every manufacturer encodes the date
-- differently (week+year, year-first, embedded month/year, etc.). The auditor
-- already captures a Model Number and a nameplate photo; add an optional Serial
-- Number beside it so the age can be looked up (OCR off the nameplate at the
-- verification stage, if the auditor didn't enter it on-site). Optional, so it
-- never blocks documentation during the site visit.

DO $$
DECLARE
  v_owner uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'; -- creator of the sibling fields
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('884157ab-ada1-41c4-ba16-6265ff5c335b'::uuid, 'heating_system_serial_number'),
      ('1cb52a8b-20b7-4555-91f8-889f55c32c84'::uuid, 'cooling_system_serial_number'),
      ('6e67c6be-41f8-442c-b73f-260eff541024'::uuid, 'water_heating_system_serial_number')
    ) AS t(template_id, field_name)
  LOOP
    -- Skip if already present (idempotent).
    IF EXISTS (
      SELECT 1 FROM public.work_step_template_fields
      WHERE work_step_template_id = r.template_id
        AND wstf_field_name = r.field_name
        AND wstf_is_deleted IS NOT TRUE
    ) THEN
      CONTINUE;
    END IF;

    -- Make room at sort_order 7 (right after Model Number at 6).
    UPDATE public.work_step_template_fields
    SET wstf_sort_order = wstf_sort_order + 1,
        wstf_updated_at = now(), wstf_updated_by = v_owner
    WHERE work_step_template_id = r.template_id
      AND wstf_is_deleted IS NOT TRUE
      AND wstf_sort_order >= 7;

    INSERT INTO public.work_step_template_fields
      (wstf_record_number, wstf_owner, wstf_created_by, work_step_template_id,
       wstf_field_label, wstf_field_name, wstf_field_type, wstf_is_required,
       wstf_sort_order, wstf_is_active, wstf_help_text)
    VALUES
      ('', v_owner, v_owner, r.template_id,
       'Serial Number', r.field_name, 'text', false,
       7, true,
       'On the same nameplate as the model number. Optional — it can be looked up later, and it''s what dates the equipment.');
  END LOOP;
END $$;
