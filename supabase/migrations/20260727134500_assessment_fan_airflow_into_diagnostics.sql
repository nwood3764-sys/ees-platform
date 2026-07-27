-- Move the bathroom exhaust fan airflow measurement into Diagnostic Tests and
-- retire the standalone section — it's a diagnostic measurement like the others.

DO $$
DECLARE
  v_plan  uuid := 'b122ffcf-b0e5-4ac0-8d17-d1f063f12ac5';
  v_owner uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_diag  uuid;
  v_fan   uuid;
BEGIN
  SELECT st.id INTO v_diag FROM public.work_step_templates st
  JOIN public.work_plan_template_entries e ON e.work_step_template_id=st.id
  WHERE e.work_plan_template_id=v_plan AND e.wpte_is_deleted IS NOT TRUE AND st.wst_name='Diagnostic Tests' LIMIT 1;

  IF v_diag IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.work_step_template_fields WHERE work_step_template_id=v_diag AND wstf_field_name='bath_fan_cfm' AND wstf_is_deleted IS NOT TRUE) THEN
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_owner,v_owner,v_diag,'Bathroom Exhaust Fan — Measured Airflow','bath_fan_cfm','number',false,40,true,'CFM','Measured with a flow hood or flow bag.'),
      ('',v_owner,v_owner,v_diag,'Bathroom Exhaust Fan — Flow Measurement','bath_fan_flow_photo','photo',false,41,true,NULL,'Photo of the flow hood / meter reading on the fan.');
  END IF;

  -- Wire the fan-flow illustration to the diagnostics copy.
  UPDATE public.work_step_template_fields f
  SET wstf_illustration_url='/illustrations/assessment/fan-flow.svg', wstf_updated_at=now()
  WHERE f.wstf_field_name='bath_fan_flow_photo' AND f.work_step_template_id=v_diag AND f.wstf_is_deleted IS NOT TRUE;

  -- Retire the standalone Bathroom Exhaust Fan Airflow section.
  SELECT st.id INTO v_fan FROM public.work_step_templates st
  JOIN public.work_plan_template_entries e ON e.work_step_template_id=st.id
  WHERE e.work_plan_template_id=v_plan AND e.wpte_is_deleted IS NOT TRUE AND st.wst_name='Bathroom Exhaust Fan Airflow' LIMIT 1;
  IF v_fan IS NOT NULL THEN
    UPDATE public.work_plan_template_entries
    SET wpte_is_deleted=true, wpte_deleted_at=now(), wpte_deleted_by=v_owner, wpte_deletion_reason='Folded into Diagnostic Tests.'
    WHERE work_plan_template_id=v_plan AND work_step_template_id=v_fan AND wpte_is_deleted IS NOT TRUE;
    UPDATE public.work_step_template_fields
    SET wstf_is_deleted=true, wstf_deleted_at=now(), wstf_deleted_by=v_owner, wstf_deletion_reason='Moved to Diagnostic Tests.'
    WHERE work_step_template_id=v_fan AND wstf_is_deleted IS NOT TRUE;
    UPDATE public.work_step_templates
    SET wst_is_deleted=true, wst_is_active=false, wst_deleted_at=now(), wst_deleted_by=v_owner, wst_deletion_reason='Folded into Diagnostic Tests.'
    WHERE id=v_fan AND wst_is_deleted IS NOT TRUE;
  END IF;
END $$;
