-- Attic / Ceiling: expanded photo documentation, plus a separate Attic 360
-- Video step. Flues, exhaust-fan detail, soffit ventilation, air-sealing
-- opportunities, top plates, pipes & wires, bypasses, and a tape-measure depth
-- photo. Optional slots (additional exhaust fan, air-sealing 1-4, bypasses) so
-- documentation is never blocked; top plates and pipes & wires are two each.

DO $$
DECLARE
  v_plan   uuid := 'b122ffcf-b0e5-4ac0-8d17-d1f063f12ac5';
  v_owner  uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_orole  uuid := '4a93279e-f88e-4f12-9db8-6bd4e0e80262';
  v_vrole  uuid := '7495dd05-ec12-4dc0-ad07-db53daf78487';
  v_photo  uuid := '16130b3e-e416-4d92-bf23-ec0f8aeee3e1';
  v_video  uuid := 'd92d0e0e-1075-4b75-b8f5-d3f8cf9c8bf8';
  v_attic  uuid := '279d7cef-7c16-4353-94a5-51c6fa789d9f';
  v_step   uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.work_step_template_fields
                 WHERE work_step_template_id=v_attic AND wstf_field_name='hvac_flue_photo' AND wstf_is_deleted IS NOT TRUE) THEN
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_help_text) VALUES
      ('',v_owner,v_owner,v_attic,'Insulation Depth — Tape Measure','attic_insulation_depth_photo','photo',true,6,true,'A tape measure standing in the insulation showing depth from the attic floor.'),
      ('',v_owner,v_owner,v_attic,'HVAC Flue','hvac_flue_photo','photo',true,7,true,'The furnace/HVAC flue where it passes through the attic.'),
      ('',v_owner,v_owner,v_attic,'Water Heater Flue','water_heater_flue_photo','photo',true,8,true,'The water-heater flue where it passes through the attic.'),
      ('',v_owner,v_owner,v_attic,'Exhaust Fan — Ducting','exhaust_fan_ducting_photo','photo',true,9,true,'The exhaust-fan duct run in the attic.'),
      ('',v_owner,v_owner,v_attic,'Exhaust Fan — Termination','exhaust_fan_termination_photo','photo',true,10,true,'Where the exhaust fan terminates (roof/gable/soffit).'),
      ('',v_owner,v_owner,v_attic,'Exhaust Fan — Exposed','exhaust_fan_exposed_photo','photo',true,11,true,'The exhaust-fan housing exposed from the attic side.'),
      ('',v_owner,v_owner,v_attic,'Additional Exhaust Fan — Ducting','exhaust_fan2_ducting_photo','photo',false,12,true,'Only if there is a second exhaust fan — otherwise skip.'),
      ('',v_owner,v_owner,v_attic,'Additional Exhaust Fan — Termination','exhaust_fan2_termination_photo','photo',false,13,true,NULL),
      ('',v_owner,v_owner,v_attic,'Additional Exhaust Fan — Exposed','exhaust_fan2_exposed_photo','photo',false,14,true,NULL),
      ('',v_owner,v_owner,v_attic,'Attic Soffit Ventilation','soffit_ventilation_photo','photo',true,15,true,'Soffit / eave ventilation at the attic edge.'),
      ('',v_owner,v_owner,v_attic,'Air Sealing (1)','air_sealing_photo_1','photo',false,16,true,'Air-sealing opportunity — penetrations, gaps, bypasses to seal.'),
      ('',v_owner,v_owner,v_attic,'Air Sealing (2)','air_sealing_photo_2','photo',false,17,true,NULL),
      ('',v_owner,v_owner,v_attic,'Air Sealing (3)','air_sealing_photo_3','photo',false,18,true,NULL),
      ('',v_owner,v_owner,v_attic,'Air Sealing (4)','air_sealing_photo_4','photo',false,19,true,NULL),
      ('',v_owner,v_owner,v_attic,'Top Plates (1)','top_plates_photo_1','photo',true,20,true,'Exterior/interior wall top plates.'),
      ('',v_owner,v_owner,v_attic,'Top Plates (2)','top_plates_photo_2','photo',true,21,true,NULL),
      ('',v_owner,v_owner,v_attic,'Pipes & Wires (1)','pipes_wires_photo_1','photo',true,22,true,'Plumbing/electrical penetrations through the attic floor.'),
      ('',v_owner,v_owner,v_attic,'Pipes & Wires (2)','pipes_wires_photo_2','photo',true,23,true,NULL),
      ('',v_owner,v_owner,v_attic,'Bypasses','attic_bypasses_photo','photo',false,24,true,'Chases, dropped soffits, or other attic bypasses — optional.');
  END IF;

  -- Separate Attic 360 Video step (video evidence). Uses a free execution_order
  -- (soft-deleted entries still hold their slot under the unique constraint).
  IF NOT EXISTS (SELECT 1 FROM public.work_plan_template_entries e JOIN public.work_step_templates st ON st.id=e.work_step_template_id
                 WHERE e.work_plan_template_id=v_plan AND e.wpte_is_deleted IS NOT TRUE AND st.wst_name='Attic 360 Video') THEN
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Attic 360 Video',v_owner,v_owner,'A 360 panoramic video of the entire attic.',true,v_orole,v_vrole,v_video,0,false) RETURNING id INTO v_step;
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Attic 360 Video',v_owner,v_plan,v_step,19);
  END IF;
END $$;
