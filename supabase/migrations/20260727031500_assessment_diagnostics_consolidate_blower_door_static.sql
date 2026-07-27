-- Consolidate diagnostics: blower door belongs under Diagnostic Tests (not its
-- own section), and add the static-pressure test for ducted HVAC. The draft /
-- spillage tests for natural-draft gas appliances are already present. Retire
-- the standalone "Air Leakage (Blower Door)" section so blower door lives in one
-- place. All optional — record whatever was tested.

DO $$
DECLARE
  v_plan  uuid := 'b122ffcf-b0e5-4ac0-8d17-d1f063f12ac5';
  v_owner uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_diag  uuid;
  v_air   uuid;
BEGIN
  SELECT st.id INTO v_diag FROM public.work_step_templates st
  JOIN public.work_plan_template_entries e ON e.work_step_template_id=st.id
  WHERE e.work_plan_template_id=v_plan AND e.wpte_is_deleted IS NOT TRUE AND st.wst_name='Diagnostic Tests' LIMIT 1;

  IF v_diag IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.work_step_template_fields WHERE work_step_template_id=v_diag AND wstf_field_name='blower_door_cfm50' AND wstf_is_deleted IS NOT TRUE) THEN
    -- make room: push the existing diagnostic fields down.
    UPDATE public.work_step_template_fields SET wstf_sort_order = wstf_sort_order + 10, wstf_updated_at = now()
    WHERE work_step_template_id = v_diag AND wstf_is_deleted IS NOT TRUE;

    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_owner,v_owner,v_diag,'Blower Door — Airflow (CFM50)','blower_door_cfm50','number',false,1,true,'CFM50','Reading at 50 Pa.'),
      ('',v_owner,v_owner,v_diag,'Blower Door — Building Pressure','blower_door_building_pressure','number',false,2,true,'Pa','Only if you cannot reach 50 Pa.'),
      ('',v_owner,v_owner,v_diag,'Blower Door — Airflow at that Pressure','blower_door_airflow_cfm','number',false,3,true,'CFM','The CFM reading at the pressure above.'),
      ('',v_owner,v_owner,v_diag,'Total External Static Pressure (Ducted HVAC)','diag_tesp','number',false,30,true,'in. w.c.','Static-pressure test on ducted systems — total external static.'),
      ('',v_owner,v_owner,v_diag,'Supply Static Pressure','diag_supply_static','number',false,31,true,'in. w.c.',NULL),
      ('',v_owner,v_owner,v_diag,'Return Static Pressure','diag_return_static','number',false,32,true,'in. w.c.',NULL),
      ('',v_owner,v_owner,v_diag,'Blower Door Setup','blower_door_photo','photo',false,33,true,NULL,'The blower door installed in the doorway.');
  END IF;

  -- Retire the standalone Air Leakage (Blower Door) section.
  SELECT st.id INTO v_air FROM public.work_step_templates st
  JOIN public.work_plan_template_entries e ON e.work_step_template_id=st.id
  WHERE e.work_plan_template_id=v_plan AND e.wpte_is_deleted IS NOT TRUE AND st.wst_name='Air Leakage (Blower Door)' LIMIT 1;
  IF v_air IS NOT NULL THEN
    UPDATE public.work_plan_template_entries
    SET wpte_is_deleted=true, wpte_deleted_at=now(), wpte_deleted_by=v_owner, wpte_deletion_reason='Blower door folded into Diagnostic Tests.'
    WHERE work_plan_template_id=v_plan AND work_step_template_id=v_air AND wpte_is_deleted IS NOT TRUE;
    UPDATE public.work_step_template_fields
    SET wstf_is_deleted=true, wstf_deleted_at=now(), wstf_deleted_by=v_owner, wstf_deletion_reason='Moved to Diagnostic Tests.'
    WHERE work_step_template_id=v_air AND wstf_is_deleted IS NOT TRUE;
    UPDATE public.work_step_templates
    SET wst_is_deleted=true, wst_is_active=false, wst_deleted_at=now(), wst_deleted_by=v_owner, wst_deletion_reason='Blower door folded into Diagnostic Tests.'
    WHERE id=v_air AND wst_is_deleted IS NOT TRUE;
  END IF;

  -- Wire the blower-door illustration to the diagnostics photo field.
  UPDATE public.work_step_template_fields f
  SET wstf_illustration_url='/illustrations/assessment/blower-door.svg', wstf_updated_at=now()
  WHERE f.wstf_field_name='blower_door_photo' AND f.work_step_template_id=v_diag AND f.wstf_is_deleted IS NOT TRUE;
END $$;
