-- Assessment additions: Diagnostic Tests section, Bathroom Exhaust Fan Airflow
-- section, and the option to capture a second window system + additional door
-- type on Windows & Doors (SnuggPro supports up to two window systems).

DO $$
DECLARE
  v_plan          uuid := 'b122ffcf-b0e5-4ac0-8d17-d1f063f12ac5';
  v_owner         uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_owner_role    uuid := '4a93279e-f88e-4f12-9db8-6bd4e0e80262';
  v_verifier_role uuid := '7495dd05-ec12-4dc0-ad07-db53daf78487';
  v_photo         uuid := '16130b3e-e416-4d92-bf23-ec0f8aeee3e1';
  v_windows       uuid;
  v_step          uuid;
  v_exists        boolean;
BEGIN
  ------------------------------------------------ 17. Diagnostic Tests
  SELECT EXISTS (SELECT 1 FROM public.work_plan_template_entries e JOIN public.work_step_templates st ON st.id=e.work_step_template_id
    WHERE e.work_plan_template_id=v_plan AND e.wpte_is_deleted IS NOT TRUE AND st.wst_name='Diagnostic Tests') INTO v_exists;
  IF NOT v_exists THEN
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Diagnostic Tests',v_owner,v_owner,'Combustion safety and gas-leak diagnostics. Optional — record whatever was tested.',true,v_owner_role,v_verifier_role,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_owner,v_owner,v_step,'Ambient CO','diag_ambient_co','number',false,1,true,'ppm','Carbon monoxide in the room air.'),
      ('',v_owner,v_owner,v_step,'Gas Leak Detected','diag_gas_leak','select',false,2,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'Water Heater Flue CO','diag_water_heater_co','number',false,3,true,'ppm',NULL),
      ('',v_owner,v_owner,v_step,'Water Heater Draft / Spillage','diag_water_heater_draft','select',false,4,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'Furnace / Boiler Flue CO','diag_furnace_co','number',false,5,true,'ppm',NULL),
      ('',v_owner,v_owner,v_step,'Furnace / Boiler Draft / Spillage','diag_furnace_draft','select',false,6,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'Worst-Case Depressurization','diag_worst_case_depress','number',false,7,true,'Pa',NULL),
      ('',v_owner,v_owner,v_step,'Combustion Analyzer Reading','diag_analyzer_photo','photo',false,8,true,NULL,'Photo of the analyzer / meter reading.');
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Diagnostic Tests',v_owner,v_plan,v_step,17);
  END IF;

  ------------------------------------------------ 18. Bathroom Exhaust Fan Airflow
  SELECT EXISTS (SELECT 1 FROM public.work_plan_template_entries e JOIN public.work_step_templates st ON st.id=e.work_step_template_id
    WHERE e.work_plan_template_id=v_plan AND e.wpte_is_deleted IS NOT TRUE AND st.wst_name='Bathroom Exhaust Fan Airflow') INTO v_exists;
  IF NOT v_exists THEN
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Bathroom Exhaust Fan Airflow',v_owner,v_owner,'Measured airflow (CFM) of the bathroom exhaust fan.',true,v_owner_role,v_verifier_role,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_owner,v_owner,v_step,'Measured Airflow','bath_fan_cfm','number',false,1,true,'CFM','Measured with a flow hood or flow bag.'),
      ('',v_owner,v_owner,v_step,'Flow Measurement','bath_fan_flow_photo','photo',false,2,true,NULL,'Photo of the flow hood / meter reading on the fan.');
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Bathroom Exhaust Fan Airflow',v_owner,v_plan,v_step,18);
  END IF;

  ------------------------------------------------ Windows & Doors: 2nd window system + extra door
  SELECT st.id INTO v_windows FROM public.work_step_templates st
  JOIN public.work_plan_template_entries e ON e.work_step_template_id=st.id
  WHERE e.work_plan_template_id=v_plan AND e.wpte_is_deleted IS NOT TRUE AND st.wst_name='Windows & Doors' LIMIT 1;

  IF v_windows IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.work_step_template_fields WHERE work_step_template_id=v_windows AND wstf_field_name='window2_frame_type' AND wstf_is_deleted IS NOT TRUE) THEN
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_help_text) VALUES
      ('',v_owner,v_owner,v_windows,'Window System 2 — Frame','window2_frame_type','select',false,20,true,'Only if some windows are a different type — otherwise skip.'),
      ('',v_owner,v_owner,v_windows,'Window System 2 — Glazing / Panes','window2_glazing','select',false,21,true,NULL),
      ('',v_owner,v_owner,v_windows,'Window System 2 — Low-E','window2_low_e','select',false,22,true,NULL),
      ('',v_owner,v_owner,v_windows,'Window System 2 — Gas Fill','window2_gas_fill','select',false,23,true,NULL),
      ('',v_owner,v_owner,v_windows,'Window System 2 — U-Value','window2_u_value','number',false,24,true,'From the NFRC label, if present.'),
      ('',v_owner,v_owner,v_windows,'Window System 2 — SHGC','window2_shgc','number',false,25,true,'From the NFRC label, if present.'),
      ('',v_owner,v_owner,v_windows,'Window System 2 — Approx. Count','window2_count','number',false,26,true,NULL),
      ('',v_owner,v_owner,v_windows,'Additional Door Type','door2_type','select',false,27,true,'For a second, different door — otherwise skip.');
  END IF;

  ------------------------------------------------ picklists (idempotent)
  INSERT INTO public.picklist_values (id,picklist_object,picklist_field,picklist_value,picklist_label,picklist_is_active,picklist_sort_order,picklist_created_by)
  SELECT gen_random_uuid(),'work_step_fields',d.field,d.val,d.val,true,d.ord,v_owner
  FROM (VALUES
    ('diag_gas_leak','Yes',10),('diag_gas_leak','No',20),('diag_gas_leak','Not Tested',30),
    ('diag_water_heater_draft','Pass',10),('diag_water_heater_draft','Fail',20),('diag_water_heater_draft','N/A',30),
    ('diag_furnace_draft','Pass',10),('diag_furnace_draft','Fail',20),('diag_furnace_draft','N/A',30),
    ('window2_frame_type','Wood',10),('window2_frame_type','Vinyl',20),('window2_frame_type','Aluminum',30),('window2_frame_type','Aluminum w/ Thermal Break',40),('window2_frame_type','Fiberglass',50),('window2_frame_type','Composite',60),
    ('window2_glazing','Single-Pane',10),('window2_glazing','Double-Pane',20),('window2_glazing','Triple-Pane',30),
    ('window2_low_e','Yes',10),('window2_low_e','No',20),('window2_low_e','Unknown',30),
    ('window2_gas_fill','Air',10),('window2_gas_fill','Argon',20),('window2_gas_fill','Krypton',30),('window2_gas_fill','Unknown',40),
    ('door2_type','Wood (Solid)',10),('door2_type','Wood (Hollow Core)',20),('door2_type','Steel / Insulated',30),('door2_type','Fiberglass',40),('door2_type','Sliding Glass',50)
  ) AS d(field,val,ord)
  WHERE NOT EXISTS (SELECT 1 FROM public.picklist_values p2 WHERE p2.picklist_object='work_step_fields' AND p2.picklist_field=d.field AND p2.picklist_value=d.val);

  ------------------------------------------------ illustration wiring
  UPDATE public.work_step_template_fields f
  SET wstf_illustration_url = m.url, wstf_updated_at = now()
  FROM (VALUES
    ('diag_analyzer_photo','/illustrations/assessment/combustion-analyzer.svg'),
    ('bath_fan_flow_photo','/illustrations/assessment/fan-flow.svg')
  ) AS m(field_name,url)
  WHERE f.wstf_field_name = m.field_name AND f.wstf_is_deleted IS NOT TRUE;
END $$;
