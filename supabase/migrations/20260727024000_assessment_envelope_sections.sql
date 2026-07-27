-- Single-Family Energy Assessment (WPT b122ffcf): building-envelope capture for
-- the SnuggPro model. SnuggPro-native — observable ranges/types are the primary
-- fields (insulation thickness range, construction/finish, glazing/frame/gas
-- fill); exact R-value/U-value/SHGC are OPTIONAL, entered only from the NFRC /
-- EnergyGuide label. Adds sections 11-16 plus small adds to existing systems.

DO $$
DECLARE
  v_plan          uuid := 'b122ffcf-b0e5-4ac0-8d17-d1f063f12ac5';
  v_owner         uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_owner_role    uuid := '4a93279e-f88e-4f12-9db8-6bd4e0e80262';
  v_verifier_role uuid := '7495dd05-ec12-4dc0-ad07-db53daf78487';
  v_photo         uuid := '16130b3e-e416-4d92-bf23-ec0f8aeee3e1';
  v_heating       uuid := '884157ab-ada1-41c4-ba16-6265ff5c335b';
  v_cooling       uuid := '1cb52a8b-20b7-4555-91f8-889f55c32c84';
  v_dhw           uuid := '6e67c6be-41f8-442c-b73f-260eff541024';
  v_step          uuid;
  v_exists        boolean;
BEGIN
  ---------------------------------------------------------------- 11. Building Characteristics
  SELECT EXISTS (SELECT 1 FROM public.work_plan_template_entries e JOIN public.work_step_templates st ON st.id=e.work_step_template_id
    WHERE e.work_plan_template_id=v_plan AND e.wpte_is_deleted IS NOT TRUE AND st.wst_name='Building Characteristics') INTO v_exists;
  IF NOT v_exists THEN
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Building Characteristics',v_owner,v_owner,'Whole-home details that drive the energy model.',true,v_owner_role,v_verifier_role,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_owner,v_owner,v_step,'Conditioned Floor Area','bldg_conditioned_area','number',true,1,true,'sq ft','Living area that is heated/cooled.'),
      ('',v_owner,v_owner,v_step,'Number of Stories','bldg_stories','select',true,2,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'Year Built','bldg_year_built','number',true,3,true,NULL,'Drives the model''s default insulation values.'),
      ('',v_owner,v_owner,v_step,'Number of Bedrooms','bldg_bedrooms','number',true,4,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'% High-Efficiency Lighting','bldg_lighting_pct','select',false,5,true,NULL,'Share of bulbs that are LED or CFL.');
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Building Characteristics',v_owner,v_plan,v_step,11);
  END IF;

  ---------------------------------------------------------------- 12. Attic / Ceiling
  SELECT EXISTS (SELECT 1 FROM public.work_plan_template_entries e JOIN public.work_step_templates st ON st.id=e.work_step_template_id
    WHERE e.work_plan_template_id=v_plan AND e.wpte_is_deleted IS NOT TRUE AND st.wst_name='Attic / Ceiling') INTO v_exists;
  IF NOT v_exists THEN
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Attic / Ceiling',v_owner,v_owner,'Attic type and ceiling insulation.',true,v_owner_role,v_verifier_role,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_owner,v_owner,v_step,'Attic / Roof Type','attic_type','select',true,1,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'Attic Floor Area','attic_area','number',false,2,true,'sq ft','Leave blank to use the building footprint.'),
      ('',v_owner,v_owner,v_step,'Insulation Thickness','attic_insulation_thickness','select',true,3,true,NULL,'Best-matching depth range — the model derives the R-value.'),
      ('',v_owner,v_owner,v_step,'Insulation Type','attic_insulation_type','select',false,4,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'Attic Insulation','attic_photo','photo',true,5,true,NULL,'Photograph the attic floor insulation.');
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Attic / Ceiling',v_owner,v_plan,v_step,12);
  END IF;

  ---------------------------------------------------------------- 13. Walls
  SELECT EXISTS (SELECT 1 FROM public.work_plan_template_entries e JOIN public.work_step_templates st ON st.id=e.work_step_template_id
    WHERE e.work_plan_template_id=v_plan AND e.wpte_is_deleted IS NOT TRUE AND st.wst_name='Walls') INTO v_exists;
  IF NOT v_exists THEN
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Walls',v_owner,v_owner,'Exterior wall construction, finish, and insulation.',true,v_owner_role,v_verifier_role,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_owner,v_owner,v_step,'Wall Construction','wall_construction','select',true,1,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'Exterior Finish','wall_exterior_finish','select',true,2,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'Wall Insulation','wall_insulation','select',false,3,true,NULL,'Cavity = between studs; Continuous = rigid foam under siding.'),
      ('',v_owner,v_owner,v_step,'Insulation Thickness','wall_insulation_thickness','select',false,4,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'Exterior Wall','wall_photo','photo',true,5,true,NULL,'A representative exterior wall.');
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Walls',v_owner,v_plan,v_step,13);
  END IF;

  ---------------------------------------------------------------- 14. Foundation / Floor
  SELECT EXISTS (SELECT 1 FROM public.work_plan_template_entries e JOIN public.work_step_templates st ON st.id=e.work_step_template_id
    WHERE e.work_plan_template_id=v_plan AND e.wpte_is_deleted IS NOT TRUE AND st.wst_name='Foundation / Floor') INTO v_exists;
  IF NOT v_exists THEN
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Foundation / Floor',v_owner,v_owner,'Foundation type and floor/rim-joist insulation.',true,v_owner_role,v_verifier_role,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_owner,v_owner,v_step,'Foundation Type','foundation_type','select',true,1,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'Foundation Wall Insulation','foundation_wall_insulation','select',false,2,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'Floor / Rim Joist Insulation','floor_insulation_thickness','select',false,3,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'Foundation / Floor','foundation_photo','photo',true,4,true,NULL,'Basement, crawlspace, or slab edge.');
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Foundation / Floor',v_owner,v_plan,v_step,14);
  END IF;

  ---------------------------------------------------------------- 15. Windows & Doors
  SELECT EXISTS (SELECT 1 FROM public.work_plan_template_entries e JOIN public.work_step_templates st ON st.id=e.work_step_template_id
    WHERE e.work_plan_template_id=v_plan AND e.wpte_is_deleted IS NOT TRUE AND st.wst_name='Windows & Doors') INTO v_exists;
  IF NOT v_exists THEN
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Windows & Doors',v_owner,v_owner,'Window frame, glazing, and performance; primary door type.',true,v_owner_role,v_verifier_role,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_owner,v_owner,v_step,'Window Frame','window_frame_type','select',true,1,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'Glazing / Panes','window_glazing','select',true,2,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'Low-E Coating','window_low_e','select',false,3,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'Gas Fill','window_gas_fill','select',false,4,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'U-Value','window_u_value','number',false,5,true,NULL,'From the NFRC label, if present.'),
      ('',v_owner,v_owner,v_step,'SHGC','window_shgc','number',false,6,true,NULL,'From the NFRC label, if present.'),
      ('',v_owner,v_owner,v_step,'Approx. Number of Windows','window_count','number',false,7,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'Primary Door Type','door_type','select',false,8,true,NULL,NULL),
      ('',v_owner,v_owner,v_step,'Windows','window_photo','photo',true,9,true,NULL,'A representative window (and its NFRC label if present).');
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Windows & Doors',v_owner,v_plan,v_step,15);
  END IF;

  ---------------------------------------------------------------- 16. Air Leakage (Blower Door)
  SELECT EXISTS (SELECT 1 FROM public.work_plan_template_entries e JOIN public.work_step_templates st ON st.id=e.work_step_template_id
    WHERE e.work_plan_template_id=v_plan AND e.wpte_is_deleted IS NOT TRUE AND st.wst_name='Air Leakage (Blower Door)') INTO v_exists;
  IF NOT v_exists THEN
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Air Leakage (Blower Door)',v_owner,v_owner,'Blower-door air-leakage test. Optional — skip if no test is run.',true,v_owner_role,v_verifier_role,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_owner,v_owner,v_step,'Airflow (CFM50)','blower_door_cfm50','number',false,1,true,'CFM50','Reading at 50 Pa.'),
      ('',v_owner,v_owner,v_step,'Building Pressure','blower_door_building_pressure','number',false,2,true,'Pa','Only if you cannot reach 50 Pa.'),
      ('',v_owner,v_owner,v_step,'Airflow at that Pressure','blower_door_airflow_cfm','number',false,3,true,'CFM','The CFM reading at the pressure above.'),
      ('',v_owner,v_owner,v_step,'Blower Door Setup','blower_door_photo','photo',false,4,true,NULL,'The blower door installed in the doorway.');
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Air Leakage (Blower Door)',v_owner,v_plan,v_step,16);
  END IF;

  ---------------------------------------------------------------- small adds: DHW efficiency
  IF NOT EXISTS (SELECT 1 FROM public.work_step_template_fields WHERE work_step_template_id=v_dhw AND wstf_field_name='water_heating_ef_uef' AND wstf_is_deleted IS NOT TRUE) THEN
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_help_text)
    VALUES ('',v_owner,v_owner,v_dhw,'Efficiency (EF / UEF)','water_heating_ef_uef','number',false,14,true,'From the EnergyGuide / rating label, if available.');
  END IF;

  ---------------------------------------------------------------- small adds: duct location + insulation on heating & cooling
  IF NOT EXISTS (SELECT 1 FROM public.work_step_template_fields WHERE work_step_template_id=v_heating AND wstf_field_name='duct_location' AND wstf_is_deleted IS NOT TRUE) THEN
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_help_text) VALUES
      ('',v_owner,v_owner,v_heating,'Duct Location','duct_location','select',false,30,true,'Where most of the ductwork runs.'),
      ('',v_owner,v_owner,v_heating,'Duct Insulation','duct_insulation','select',false,31,true,NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_step_template_fields WHERE work_step_template_id=v_cooling AND wstf_field_name='duct_location' AND wstf_is_deleted IS NOT TRUE) THEN
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_help_text) VALUES
      ('',v_owner,v_owner,v_cooling,'Duct Location','duct_location','select',false,30,true,'Where most of the ductwork runs.'),
      ('',v_owner,v_owner,v_cooling,'Duct Insulation','duct_insulation','select',false,31,true,NULL);
  END IF;

  ---------------------------------------------------------------- picklists for all new select fields (idempotent)
  INSERT INTO public.picklist_values (id,picklist_object,picklist_field,picklist_value,picklist_label,picklist_is_active,picklist_sort_order,picklist_created_by)
  SELECT gen_random_uuid(),'work_step_fields',d.field,d.val,d.val,true,d.ord,v_owner
  FROM (VALUES
    ('bldg_stories','1',10),('bldg_stories','1.5',20),('bldg_stories','2',30),('bldg_stories','2.5',40),('bldg_stories','3',50),('bldg_stories','4 or more',60),
    ('bldg_lighting_pct','0–25%',10),('bldg_lighting_pct','26–50%',20),('bldg_lighting_pct','51–75%',30),('bldg_lighting_pct','76–100%',40),
    ('attic_type','Vented Attic',10),('attic_type','Unvented Attic',20),('attic_type','Cathedral / Vaulted Ceiling',30),('attic_type','Knee Wall',40),('attic_type','Flat Roof',50),
    ('attic_insulation_thickness','None (0")',10),('attic_insulation_thickness','1–3"',20),('attic_insulation_thickness','4–6"',30),('attic_insulation_thickness','7–10"',40),('attic_insulation_thickness','11–15"',50),('attic_insulation_thickness','More than 15"',60),('attic_insulation_thickness','Unknown',70),
    ('attic_insulation_type','Blown Fiberglass',10),('attic_insulation_type','Blown Cellulose',20),('attic_insulation_type','Fiberglass Batt',30),('attic_insulation_type','Spray Foam',40),('attic_insulation_type','Rock Wool',50),('attic_insulation_type','None',60),('attic_insulation_type','Unknown',70),
    ('wall_construction','Wood Frame',10),('wall_construction','Masonry / Brick',20),('wall_construction','Concrete Block (CMU)',30),('wall_construction','Steel Frame',40),('wall_construction','Log',50),('wall_construction','Other',60),
    ('wall_exterior_finish','Vinyl Siding',10),('wall_exterior_finish','Wood Siding',20),('wall_exterior_finish','Fiber Cement Siding',30),('wall_exterior_finish','Brick',40),('wall_exterior_finish','Stucco',50),('wall_exterior_finish','Stone',60),('wall_exterior_finish','Aluminum Siding',70),('wall_exterior_finish','Other',80),
    ('wall_insulation','None',10),('wall_insulation','Cavity',20),('wall_insulation','Continuous (Rigid Foam)',30),('wall_insulation','Cavity + Continuous',40),('wall_insulation','Unknown',50),
    ('wall_insulation_thickness','None (0")',10),('wall_insulation_thickness','1–3"',20),('wall_insulation_thickness','4–6"',30),('wall_insulation_thickness','7–10"',40),('wall_insulation_thickness','Unknown',50),
    ('foundation_type','Slab on Grade',10),('foundation_type','Vented Crawlspace',20),('foundation_type','Unvented Crawlspace',30),('foundation_type','Unconditioned Basement',40),('foundation_type','Conditioned Basement',50),('foundation_type','Pier & Beam',60),
    ('foundation_wall_insulation','None',10),('foundation_wall_insulation','Insulated',20),('foundation_wall_insulation','Unknown',30),('foundation_wall_insulation','N/A',40),
    ('floor_insulation_thickness','None (0")',10),('floor_insulation_thickness','1–3"',20),('floor_insulation_thickness','4–6"',30),('floor_insulation_thickness','7–10"',40),('floor_insulation_thickness','Unknown',50),
    ('window_frame_type','Wood',10),('window_frame_type','Vinyl',20),('window_frame_type','Aluminum',30),('window_frame_type','Aluminum w/ Thermal Break',40),('window_frame_type','Fiberglass',50),('window_frame_type','Composite',60),
    ('window_glazing','Single-Pane',10),('window_glazing','Double-Pane',20),('window_glazing','Triple-Pane',30),
    ('window_low_e','Yes',10),('window_low_e','No',20),('window_low_e','Unknown',30),
    ('window_gas_fill','Air',10),('window_gas_fill','Argon',20),('window_gas_fill','Krypton',30),('window_gas_fill','Unknown',40),
    ('door_type','Wood (Solid)',10),('door_type','Wood (Hollow Core)',20),('door_type','Steel / Insulated',30),('door_type','Fiberglass',40),('door_type','Sliding Glass',50),
    ('duct_location','Conditioned Space',10),('duct_location','Unconditioned Attic',20),('duct_location','Unconditioned Basement',30),('duct_location','Crawlspace',40),('duct_location','Garage',50),('duct_location','Ductless (No Ducts)',60),('duct_location','Unknown',70),
    ('duct_insulation','Insulated',10),('duct_insulation','Uninsulated',20),('duct_insulation','Unknown',30),('duct_insulation','N/A',40)
  ) AS d(field,val,ord)
  WHERE NOT EXISTS (SELECT 1 FROM public.picklist_values p2 WHERE p2.picklist_object='work_step_fields' AND p2.picklist_field=d.field AND p2.picklist_value=d.val);

  ---------------------------------------------------------------- illustration wiring for the new photo fields
  UPDATE public.work_step_template_fields f
  SET wstf_illustration_url = m.url, wstf_updated_at = now()
  FROM (VALUES
    ('attic_photo','/illustrations/assessment/attic-insulation.svg'),
    ('wall_photo','/illustrations/assessment/wall-construction.svg'),
    ('foundation_photo','/illustrations/assessment/foundation.svg'),
    ('window_photo','/illustrations/assessment/windows.svg'),
    ('blower_door_photo','/illustrations/assessment/blower-door.svg')
  ) AS m(field_name,url)
  WHERE f.wstf_field_name = m.field_name AND f.wstf_is_deleted IS NOT TRUE;
END $$;
