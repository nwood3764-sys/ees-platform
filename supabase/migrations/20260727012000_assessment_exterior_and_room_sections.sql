-- Single-Family Energy Assessment (WPT b122ffcf): add the exterior/site capture
-- and interior room sections, and reorder so the Front Door photo is first.
--
-- Order: Front Door (first) -> Exterior Photos (4 faces) -> Exterior 360 Video
-- -> Utility Meters -> Kitchen -> Thermostat -> Bathroom -> Heating -> Cooling
-- -> Water Heating. The three mechanical systems stay as their OWN sections
-- (no "mechanical room" grouping — very few units have one). New photo prompts
-- are screen-flow sections using the photo-field pattern; the evidence gate
-- enforces required photos/fields. Optional prompts (gas meter, appliance
-- nameplates, exhaust fan when absent) are skippable.

DO $$
DECLARE
  v_plan          uuid := 'b122ffcf-b0e5-4ac0-8d17-d1f063f12ac5';
  v_owner         uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_owner_role    uuid := '4a93279e-f88e-4f12-9db8-6bd4e0e80262';
  v_verifier_role uuid := '7495dd05-ec12-4dc0-ad07-db53daf78487';
  v_photo         uuid := '16130b3e-e416-4d92-bf23-ec0f8aeee3e1';
  v_video         uuid := 'd92d0e0e-1075-4b75-b8f5-d3f8cf9c8bf8';
  v_step          uuid;
  v_exists        boolean;
BEGIN
  ----------------------------------------------------------------------------
  -- 0. Push the existing mechanical sections to 8/9/10 FIRST, freeing 1-7 for
  --    the new exterior/room sections (execution_order is uniquely constrained).
  ----------------------------------------------------------------------------
  UPDATE public.work_plan_template_entries e
  SET wpte_execution_order = m.new_order, wpte_updated_at = now(), wpte_updated_by = v_owner
  FROM (VALUES
    ('884157ab-ada1-41c4-ba16-6265ff5c335b'::uuid, 8),
    ('1cb52a8b-20b7-4555-91f8-889f55c32c84'::uuid, 9),
    ('6e67c6be-41f8-442c-b73f-260eff541024'::uuid, 10)
  ) AS m(step_id, new_order)
  WHERE e.work_plan_template_id = v_plan AND e.work_step_template_id = m.step_id
    AND e.wpte_is_deleted IS NOT TRUE;

  ----------------------------------------------------------------------------
  -- 1. Front Door Photo — the mandatory first photo of every assessment.
  ----------------------------------------------------------------------------
  SELECT EXISTS (SELECT 1 FROM public.work_plan_template_entries e
                 JOIN public.work_step_templates st ON st.id = e.work_step_template_id
                 WHERE e.work_plan_template_id = v_plan AND e.wpte_is_deleted IS NOT TRUE
                   AND st.wst_name = 'Front Door Photo') INTO v_exists;
  IF NOT v_exists THEN
    INSERT INTO public.work_step_templates
      (wst_record_number, wst_name, wst_owner, wst_created_by, wst_description, wst_is_active,
       wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
       wst_photos_required_count, wst_is_screen_flow)
    VALUES ('', 'Front Door Photo', v_owner, v_owner,
            'Arrival photo of the front door. This is always the first photo of the assessment.',
            true, v_owner_role, v_verifier_role, v_photo, 1, false)
    RETURNING id INTO v_step;
    INSERT INTO public.work_plan_template_entries
      (wpte_record_number, wpte_name, wpte_created_by, work_plan_template_id, work_step_template_id, wpte_execution_order)
    VALUES ('', 'Front Door Photo', v_owner, v_plan, v_step, 1);
  END IF;

  ----------------------------------------------------------------------------
  -- 2. Exterior Photos — one photo per building face.
  ----------------------------------------------------------------------------
  SELECT EXISTS (SELECT 1 FROM public.work_plan_template_entries e
                 JOIN public.work_step_templates st ON st.id = e.work_step_template_id
                 WHERE e.work_plan_template_id = v_plan AND e.wpte_is_deleted IS NOT TRUE
                   AND st.wst_name = 'Exterior Photos') INTO v_exists;
  IF NOT v_exists THEN
    INSERT INTO public.work_step_templates
      (wst_record_number, wst_name, wst_owner, wst_created_by, wst_description, wst_is_active,
       wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
       wst_photos_required_count, wst_is_screen_flow)
    VALUES ('', 'Exterior Photos', v_owner, v_owner,
            'One exterior photo of each face of the building.',
            true, v_owner_role, v_verifier_role, v_photo, 0, true)
    RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields
      (wstf_record_number, wstf_owner, wstf_created_by, work_step_template_id,
       wstf_field_label, wstf_field_name, wstf_field_type, wstf_is_required, wstf_sort_order, wstf_is_active, wstf_help_text)
    VALUES
      ('', v_owner, v_owner, v_step, 'North Face', 'exterior_face_north', 'photo', true, 1, true, 'The north-facing side of the building.'),
      ('', v_owner, v_owner, v_step, 'East Face',  'exterior_face_east',  'photo', true, 2, true, 'The east-facing side of the building.'),
      ('', v_owner, v_owner, v_step, 'South Face', 'exterior_face_south', 'photo', true, 3, true, 'The south-facing side of the building.'),
      ('', v_owner, v_owner, v_step, 'West Face',  'exterior_face_west',  'photo', true, 4, true, 'The west-facing side of the building.');
    INSERT INTO public.work_plan_template_entries
      (wpte_record_number, wpte_name, wpte_created_by, work_plan_template_id, work_step_template_id, wpte_execution_order)
    VALUES ('', 'Exterior Photos', v_owner, v_plan, v_step, 2);
  END IF;

  ----------------------------------------------------------------------------
  -- 3. Exterior 360 Video — full walk-around of the building exterior.
  ----------------------------------------------------------------------------
  SELECT EXISTS (SELECT 1 FROM public.work_plan_template_entries e
                 JOIN public.work_step_templates st ON st.id = e.work_step_template_id
                 WHERE e.work_plan_template_id = v_plan AND e.wpte_is_deleted IS NOT TRUE
                   AND st.wst_name = 'Exterior 360 Video') INTO v_exists;
  IF NOT v_exists THEN
    INSERT INTO public.work_step_templates
      (wst_record_number, wst_name, wst_owner, wst_created_by, wst_description, wst_is_active,
       wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
       wst_photos_required_count, wst_is_screen_flow)
    VALUES ('', 'Exterior 360 Video', v_owner, v_owner,
            'Record a slow walk-around video capturing the entire exterior of the building.',
            true, v_owner_role, v_verifier_role, v_video, 0, false)
    RETURNING id INTO v_step;
    INSERT INTO public.work_plan_template_entries
      (wpte_record_number, wpte_name, wpte_created_by, work_plan_template_id, work_step_template_id, wpte_execution_order)
    VALUES ('', 'Exterior 360 Video', v_owner, v_plan, v_step, 3);
  END IF;

  ----------------------------------------------------------------------------
  -- 4. Utility Meters — electric (required) and gas (skip if all-electric).
  ----------------------------------------------------------------------------
  SELECT EXISTS (SELECT 1 FROM public.work_plan_template_entries e
                 JOIN public.work_step_templates st ON st.id = e.work_step_template_id
                 WHERE e.work_plan_template_id = v_plan AND e.wpte_is_deleted IS NOT TRUE
                   AND st.wst_name = 'Utility Meters') INTO v_exists;
  IF NOT v_exists THEN
    INSERT INTO public.work_step_templates
      (wst_record_number, wst_name, wst_owner, wst_created_by, wst_description, wst_is_active,
       wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
       wst_photos_required_count, wst_is_screen_flow)
    VALUES ('', 'Utility Meters', v_owner, v_owner,
            'Photograph the electric meter and the gas meter.',
            true, v_owner_role, v_verifier_role, v_photo, 0, true)
    RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields
      (wstf_record_number, wstf_owner, wstf_created_by, work_step_template_id,
       wstf_field_label, wstf_field_name, wstf_field_type, wstf_is_required, wstf_sort_order, wstf_is_active, wstf_help_text)
    VALUES
      ('', v_owner, v_owner, v_step, 'Electric Meter', 'utility_electric_meter_photo', 'photo', true, 1, true, 'The electric meter, with the meter number legible.'),
      ('', v_owner, v_owner, v_step, 'Gas Meter', 'utility_gas_meter_photo', 'photo', false, 2, true, 'The gas meter. Skip if the home has no gas service.');
    INSERT INTO public.work_plan_template_entries
      (wpte_record_number, wpte_name, wpte_created_by, work_plan_template_id, work_step_template_id, wpte_execution_order)
    VALUES ('', 'Utility Meters', v_owner, v_plan, v_step, 4);
  END IF;

  ----------------------------------------------------------------------------
  -- 5. Kitchen.
  ----------------------------------------------------------------------------
  SELECT EXISTS (SELECT 1 FROM public.work_plan_template_entries e
                 JOIN public.work_step_templates st ON st.id = e.work_step_template_id
                 WHERE e.work_plan_template_id = v_plan AND e.wpte_is_deleted IS NOT TRUE
                   AND st.wst_name = 'Kitchen') INTO v_exists;
  IF NOT v_exists THEN
    INSERT INTO public.work_step_templates
      (wst_record_number, wst_name, wst_owner, wst_created_by, wst_description, wst_is_active,
       wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
       wst_photos_required_count, wst_is_screen_flow)
    VALUES ('', 'Kitchen', v_owner, v_owner,
            'Kitchen appliances and ventilation.',
            true, v_owner_role, v_verifier_role, v_photo, 0, true)
    RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields
      (wstf_record_number, wstf_owner, wstf_created_by, work_step_template_id,
       wstf_field_label, wstf_field_name, wstf_field_type, wstf_is_required, wstf_sort_order, wstf_is_active, wstf_help_text)
    VALUES
      ('', v_owner, v_owner, v_step, 'Kitchen — Overall', 'kitchen_overall_photo', 'photo', true, 1, true, 'A wide shot of the whole kitchen.'),
      ('', v_owner, v_owner, v_step, 'Range / Stove', 'kitchen_range_photo', 'photo', true, 2, true, 'The cooking range / stove.'),
      ('', v_owner, v_owner, v_step, 'Range Vent / Hood', 'kitchen_range_vent_photo', 'photo', true, 3, true, 'The range hood or over-the-range vent.'),
      ('', v_owner, v_owner, v_step, 'Range Vent Type', 'kitchen_range_vent_type', 'select', true, 4, true, 'Is the range vent ducted outdoors or does it recirculate back into the room?'),
      ('', v_owner, v_owner, v_step, 'Refrigerator', 'kitchen_refrigerator_photo', 'photo', true, 5, true, 'The refrigerator.'),
      ('', v_owner, v_owner, v_step, 'Refrigerator Nameplate', 'kitchen_refrigerator_nameplate_photo', 'photo', false, 6, true, 'The refrigerator''s data/model label. Usually inside the door or behind the kick plate.'),
      ('', v_owner, v_owner, v_step, 'Dishwasher', 'kitchen_dishwasher_present', 'select', true, 7, true, 'Does the unit have a dishwasher?'),
      ('', v_owner, v_owner, v_step, 'Dishwasher Nameplate', 'kitchen_dishwasher_nameplate_photo', 'photo', false, 8, true, 'The dishwasher''s data/model label. Skip if the unit has no dishwasher.');
    INSERT INTO public.work_plan_template_entries
      (wpte_record_number, wpte_name, wpte_created_by, work_plan_template_id, work_step_template_id, wpte_execution_order)
    VALUES ('', 'Kitchen', v_owner, v_plan, v_step, 5);
  END IF;

  ----------------------------------------------------------------------------
  -- 6. Thermostat — its own section (usually in the living area).
  ----------------------------------------------------------------------------
  SELECT EXISTS (SELECT 1 FROM public.work_plan_template_entries e
                 JOIN public.work_step_templates st ON st.id = e.work_step_template_id
                 WHERE e.work_plan_template_id = v_plan AND e.wpte_is_deleted IS NOT TRUE
                   AND st.wst_name = 'Thermostat') INTO v_exists;
  IF NOT v_exists THEN
    INSERT INTO public.work_step_templates
      (wst_record_number, wst_name, wst_owner, wst_created_by, wst_description, wst_is_active,
       wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
       wst_photos_required_count, wst_is_screen_flow)
    VALUES ('', 'Thermostat', v_owner, v_owner,
            'Photo of the thermostat.',
            true, v_owner_role, v_verifier_role, v_photo, 1, false)
    RETURNING id INTO v_step;
    INSERT INTO public.work_plan_template_entries
      (wpte_record_number, wpte_name, wpte_created_by, work_plan_template_id, work_step_template_id, wpte_execution_order)
    VALUES ('', 'Thermostat', v_owner, v_plan, v_step, 6);
  END IF;

  ----------------------------------------------------------------------------
  -- 7. Bathroom.
  ----------------------------------------------------------------------------
  SELECT EXISTS (SELECT 1 FROM public.work_plan_template_entries e
                 JOIN public.work_step_templates st ON st.id = e.work_step_template_id
                 WHERE e.work_plan_template_id = v_plan AND e.wpte_is_deleted IS NOT TRUE
                   AND st.wst_name = 'Bathroom') INTO v_exists;
  IF NOT v_exists THEN
    INSERT INTO public.work_step_templates
      (wst_record_number, wst_name, wst_owner, wst_created_by, wst_description, wst_is_active,
       wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
       wst_photos_required_count, wst_is_screen_flow)
    VALUES ('', 'Bathroom', v_owner, v_owner,
            'Bathroom fixtures and ventilation.',
            true, v_owner_role, v_verifier_role, v_photo, 0, true)
    RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields
      (wstf_record_number, wstf_owner, wstf_created_by, work_step_template_id,
       wstf_field_label, wstf_field_name, wstf_field_type, wstf_is_required, wstf_sort_order, wstf_is_active, wstf_unit, wstf_help_text)
    VALUES
      ('', v_owner, v_owner, v_step, 'Bathroom — Overall', 'bathroom_overall_photo', 'photo', true, 1, true, NULL, 'A wide shot of the whole bathroom.'),
      ('', v_owner, v_owner, v_step, 'Exhaust Fan', 'bathroom_exhaust_fan_present', 'select', true, 2, true, NULL, 'Is there a bathroom exhaust fan?'),
      ('', v_owner, v_owner, v_step, 'Exhaust Fan', 'bathroom_exhaust_fan_photo', 'photo', false, 3, true, NULL, 'The exhaust fan. Skip if none is present.'),
      ('', v_owner, v_owner, v_step, 'Sink', 'bathroom_sink_photo', 'photo', true, 4, true, NULL, 'The bathroom sink.'),
      ('', v_owner, v_owner, v_step, 'Sink Faucet Aerator', 'bathroom_faucet_aerator_photo', 'photo', true, 5, true, NULL, 'Close-up of the sink faucet aerator (the tip of the faucet).'),
      ('', v_owner, v_owner, v_step, 'Shower Head', 'bathroom_shower_head_photo', 'photo', true, 6, true, NULL, 'The shower head.'),
      ('', v_owner, v_owner, v_step, 'Toilet', 'bathroom_toilet_photo', 'photo', true, 7, true, NULL, 'The toilet.'),
      ('', v_owner, v_owner, v_step, 'Toilet Gallons Per Flush', 'bathroom_toilet_gpf', 'number', false, 8, true, 'GPF', 'Gallons per flush — usually stamped inside the tank lid or near the seat hinge.');
    INSERT INTO public.work_plan_template_entries
      (wpte_record_number, wpte_name, wpte_created_by, work_plan_template_id, work_step_template_id, wpte_execution_order)
    VALUES ('', 'Bathroom', v_owner, v_plan, v_step, 7);
  END IF;

  ----------------------------------------------------------------------------
  -- Select-field picklists (idempotent).
  ----------------------------------------------------------------------------
  INSERT INTO public.picklist_values
    (id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
  SELECT gen_random_uuid(), 'work_step_fields', d.field, d.val, d.val, true, d.ord, v_owner
  FROM (VALUES
    ('kitchen_range_vent_type', 'Vented to Exterior', 10),
    ('kitchen_range_vent_type', 'Recirculating (Interior)', 20),
    ('kitchen_dishwasher_present', 'Present', 10),
    ('kitchen_dishwasher_present', 'Not Present — Unit Has No Dishwasher', 20),
    ('bathroom_exhaust_fan_present', 'Present', 10),
    ('bathroom_exhaust_fan_present', 'Not Present', 20)
  ) AS d(field, val, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.picklist_values p2
    WHERE p2.picklist_object = 'work_step_fields' AND p2.picklist_field = d.field AND p2.picklist_value = d.val
  );
END $$;
