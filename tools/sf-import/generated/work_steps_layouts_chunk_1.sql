-- --- WORK_STEPS layouts from SF -------------
-- 3 SF layouts found for WorkStep

DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN

-- Soft-delete the previous Standard work_steps layout, if any
UPDATE public.page_layouts SET is_deleted = true, updated_at = now()
WHERE page_layout_object = 'work_steps' AND is_deleted = false;

-- Layout: Standard  →  RT picklist_value = Standard
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'work_steps' AND picklist_field = 'record_type' AND picklist_value = 'Standard' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Standard', 'work_steps',
    'record_detail', true,
    'Imported from SF Layout: WorkStep-Standard',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_step_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'work_order_id', 'label', 'Work Order ID'),
        jsonb_build_object('name', 'work_step_status', 'label', 'Status'),
        jsonb_build_object('name', 'work_step_completed_building', 'label', 'Completed Building'),
        jsonb_build_object('name', 'work_step_psl_approval_status', 'label', 'Psl Approval Status'),
        jsonb_build_object('name', 'work_step_pc_approval_status', 'label', 'Pc Approval Status'),
        jsonb_build_object('name', 'work_plan_id', 'label', 'Work Plan ID', 'required', true),
        jsonb_build_object('name', 'work_step_execution_order', 'label', 'Execution Order'),
        jsonb_build_object('name', 'work_step_psl_comment', 'label', 'Psl Comment'),
        jsonb_build_object('name', 'work_step_pc_comment', 'label', 'Pc Comment')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Description', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Description', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_step_description', 'label', 'Description')
      )), false
  );

-- Layout: Work Step Layout  →  RT picklist_value = Work_Step_Layout
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'work_steps' AND picklist_field = 'record_type' AND picklist_value = 'Work_Step_Layout' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Work Step Layout', 'work_steps',
    'record_detail', true,
    'Imported from SF Layout: WorkStep-Work Step Layout',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_step_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'work_order_id', 'label', 'Work Order ID'),
        jsonb_build_object('name', 'work_step_status', 'label', 'Status'),
        jsonb_build_object('name', 'work_step_psl_approval_status', 'label', 'Psl Approval Status'),
        jsonb_build_object('name', 'work_step_pc_approval_status', 'label', 'Pc Approval Status'),
        jsonb_build_object('name', 'work_plan_id', 'label', 'Work Plan ID', 'required', true),
        jsonb_build_object('name', 'work_step_execution_order', 'label', 'Execution Order'),
        jsonb_build_object('name', 'work_step_completed_building', 'label', 'Completed Building'),
        jsonb_build_object('name', 'work_step_psl_comment', 'label', 'Psl Comment'),
        jsonb_build_object('name', 'work_step_pc_comment', 'label', 'Pc Comment')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Description', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Description', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_step_description', 'label', 'Description')
      )), false
  );


END $$;
