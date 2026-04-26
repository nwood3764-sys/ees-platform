-- --- WORK_ORDERS layouts from SF -------------
-- 15 SF layouts found for WorkOrder

DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN

-- Soft-delete the previous Standard work_orders layout, if any
UPDATE public.page_layouts SET is_deleted = true, updated_at = now()
WHERE page_layout_object = 'work_orders' AND is_deleted = false;

-- Layout: ASHRAE Level 1  →  RT picklist_value = ASHRAE_Level_1
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'work_orders' AND picklist_field = 'record_type' AND picklist_value = 'ASHRAE_Level_1' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'ASHRAE Level 1', 'work_orders',
    'record_detail', true,
    'Imported from SF Layout: WorkOrder-ASHRAE Level 1',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Work Order Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Work Order Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_work_order_name', 'label', 'Work Order Name'),
        jsonb_build_object('name', 'work_type_id', 'label', 'Work Type ID'),
        jsonb_build_object('name', 'work_order_status', 'label', 'Status'),
        jsonb_build_object('name', 'work_order_work_plan_training_video', 'label', 'Work Plan Training Video'),
        jsonb_build_object('name', 'work_order_description', 'label', 'Description')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Work Order Detail Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Work Order Detail Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_scheduled_start_date', 'label', 'Scheduled Start Date'),
        jsonb_build_object('name', 'work_order_scheduled_start_time', 'label', 'Scheduled Start Time'),
        jsonb_build_object('name', 'work_order_tennant_work_orders_access_allowed', 'label', 'Tennant Work Orders Access Allowed'),
        jsonb_build_object('name', 'work_order_completed_by_tenant', 'label', 'Completed By Tenant'),
        jsonb_build_object('name', 'work_order_start_datetime', 'label', 'Start Datetime'),
        jsonb_build_object('name', 'work_order_end_datetime', 'label', 'End Datetime'),
        jsonb_build_object('name', 'work_order_time_to_complete_wo', 'label', 'Time To Complete Wo')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Project Team', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Team', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_project_co_ordinator', 'label', 'Project Co Ordinator'),
        jsonb_build_object('name', 'work_order_project_site_lead_user', 'label', 'Project Site Lead User'),
        jsonb_build_object('name', 'work_order_qaqc', 'label', 'Qaqc'),
        jsonb_build_object('name', 'work_order_assigned_technician', 'label', 'Assigned Technician')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Property Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Property Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_property', 'label', 'Property'),
        jsonb_build_object('name', 'work_order_opportunity', 'label', 'Opportunity'),
        jsonb_build_object('name', 'work_order_project', 'label', 'Project'),
        jsonb_build_object('name', 'work_order_building', 'label', 'Building'),
        jsonb_build_object('name', 'work_order_unit', 'label', 'Unit')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Not Able To Complete', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Not Able To Complete', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_incomplete_reason', 'label', 'Incomplete Reason'),
        jsonb_build_object('name', 'work_order_incomplete_description', 'label', 'Incomplete Description'),
        jsonb_build_object('name', 'work_order_approver_comment', 'label', 'Approver Comment')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'System Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_record_type', 'label', 'Record Type')
      )), false
  );

-- Layout: Drywall Repair  →  RT picklist_value = Drywall_Repair
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'work_orders' AND picklist_field = 'record_type' AND picklist_value = 'Drywall_Repair' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Drywall Repair', 'work_orders',
    'record_detail', true,
    'Imported from SF Layout: WorkOrder-Drywall Repair',
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
        jsonb_build_object('name', 'work_order_work_order_name', 'label', 'Work Order Name'),
        jsonb_build_object('name', 'work_type_id', 'label', 'Work Type ID'),
        jsonb_build_object('name', 'work_order_work_plan_training_video', 'label', 'Work Plan Training Video'),
        jsonb_build_object('name', 'work_order_status', 'label', 'Status'),
        jsonb_build_object('name', 'work_order_completion_status', 'label', 'Completion Status')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Property Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Property Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_opportunity', 'label', 'Opportunity'),
        jsonb_build_object('name', 'work_order_project', 'label', 'Project'),
        jsonb_build_object('name', 'work_order_contact_mode', 'label', 'Contact Mode'),
        jsonb_build_object('name', 'work_order_enable_auto_scheduling', 'label', 'Enable Auto Scheduling'),
        jsonb_build_object('name', 'work_order_property', 'label', 'Property'),
        jsonb_build_object('name', 'work_order_building', 'label', 'Building'),
        jsonb_build_object('name', 'work_order_unit', 'label', 'Unit', 'required', true)
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Description', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Description', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_description', 'label', 'Description')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Project Team', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Team', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_project_co_ordinator', 'label', 'Project Co Ordinator'),
        jsonb_build_object('name', 'work_order_assigned_technician', 'label', 'Assigned Technician'),
        jsonb_build_object('name', 'work_order_scheduled_start_time', 'label', 'Scheduled Start Time'),
        jsonb_build_object('name', 'work_order_scheduled_start_date', 'label', 'Scheduled Start Date'),
        jsonb_build_object('name', 'work_order_start_date_only', 'label', 'Start Date Only'),
        jsonb_build_object('name', 'work_order_start_datetime', 'label', 'Start Datetime'),
        jsonb_build_object('name', 'work_order_end_datetime', 'label', 'End Datetime')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'System Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_sharin_pix_album', 'label', 'Sharin Pix Album'),
        jsonb_build_object('name', 'work_order_owner', 'label', 'Owner'),
        jsonb_build_object('name', 'work_order_record_type', 'label', 'Record Type'),
        jsonb_build_object('name', 'work_order_completed_by_tenant', 'label', 'Completed By Tenant')
      )), false
  );

-- Layout: EFR - Final Report  →  RT picklist_value = EFR_Final_Report
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'work_orders' AND picklist_field = 'record_type' AND picklist_value = 'EFR_Final_Report' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'EFR - Final Report', 'work_orders',
    'record_detail', true,
    'Imported from SF Layout: WorkOrder-EFR - Final Report',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Work Order Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Work Order Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_work_order_name', 'label', 'Work Order Name'),
        jsonb_build_object('name', 'work_type_id', 'label', 'Work Type ID'),
        jsonb_build_object('name', 'work_order_status', 'label', 'Status'),
        jsonb_build_object('name', 'work_order_work_plan_training_video', 'label', 'Work Plan Training Video'),
        jsonb_build_object('name', 'work_order_description', 'label', 'Description')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Work Order Detail Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Work Order Detail Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_scheduled_start_date', 'label', 'Scheduled Start Date'),
        jsonb_build_object('name', 'work_order_scheduled_start_time', 'label', 'Scheduled Start Time'),
        jsonb_build_object('name', 'work_order_tennant_work_orders_access_allowed', 'label', 'Tennant Work Orders Access Allowed'),
        jsonb_build_object('name', 'work_order_completed_by_tenant', 'label', 'Completed By Tenant'),
        jsonb_build_object('name', 'work_order_start_datetime', 'label', 'Start Datetime'),
        jsonb_build_object('name', 'work_order_end_datetime', 'label', 'End Datetime'),
        jsonb_build_object('name', 'work_order_time_to_complete_wo', 'label', 'Time To Complete Wo')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Project Team', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Team', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_project_co_ordinator', 'label', 'Project Co Ordinator'),
        jsonb_build_object('name', 'work_order_project_site_lead_user', 'label', 'Project Site Lead User'),
        jsonb_build_object('name', 'work_order_qaqc', 'label', 'Qaqc'),
        jsonb_build_object('name', 'work_order_assigned_technician', 'label', 'Assigned Technician')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Property Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Property Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_property', 'label', 'Property'),
        jsonb_build_object('name', 'work_order_opportunity', 'label', 'Opportunity'),
        jsonb_build_object('name', 'work_order_project', 'label', 'Project'),
        jsonb_build_object('name', 'work_order_building', 'label', 'Building'),
        jsonb_build_object('name', 'work_order_unit', 'label', 'Unit')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Not Able To Complete', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Not Able To Complete', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_incomplete_reason', 'label', 'Incomplete Reason'),
        jsonb_build_object('name', 'work_order_incomplete_description', 'label', 'Incomplete Description'),
        jsonb_build_object('name', 'work_order_approver_comment', 'label', 'Approver Comment')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'System Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_record_type', 'label', 'Record Type')
      )), false
  );

-- Layout: Exhuast Fan Replacement  →  RT picklist_value = Exhaust_Fan_Replacement
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'work_orders' AND picklist_field = 'record_type' AND picklist_value = 'Exhaust_Fan_Replacement' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Exhuast Fan Replacement', 'work_orders',
    'record_detail', true,
    'Imported from SF Layout: WorkOrder-Exhuast Fan Replacement',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Work Order Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Work Order Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_work_order_name', 'label', 'Work Order Name'),
        jsonb_build_object('name', 'work_type_id', 'label', 'Work Type ID'),
        jsonb_build_object('name', 'work_order_status', 'label', 'Status'),
        jsonb_build_object('name', 'work_order_work_plan_training_video', 'label', 'Work Plan Training Video'),
        jsonb_build_object('name', 'work_order_description', 'label', 'Description')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Work Order Detail Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Work Order Detail Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_scheduled_start_date', 'label', 'Scheduled Start Date'),
        jsonb_build_object('name', 'work_order_scheduled_start_time', 'label', 'Scheduled Start Time'),
        jsonb_build_object('name', 'work_order_start_datetime', 'label', 'Start Datetime'),
        jsonb_build_object('name', 'work_order_end_datetime', 'label', 'End Datetime'),
        jsonb_build_object('name', 'work_order_time_to_complete_wo', 'label', 'Time To Complete Wo')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Project Team', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Team', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_project_co_ordinator', 'label', 'Project Co Ordinator'),
        jsonb_build_object('name', 'work_order_project_site_lead_user', 'label', 'Project Site Lead User'),
        jsonb_build_object('name', 'work_order_assigned_technician', 'label', 'Assigned Technician')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Property Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Property Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_property', 'label', 'Property'),
        jsonb_build_object('name', 'work_order_opportunity', 'label', 'Opportunity'),
        jsonb_build_object('name', 'work_order_project', 'label', 'Project'),
        jsonb_build_object('name', 'work_order_building', 'label', 'Building'),
        jsonb_build_object('name', 'work_order_unit', 'label', 'Unit', 'required', true)
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Not Able To Complete', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Not Able To Complete', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_incomplete_reason', 'label', 'Incomplete Reason'),
        jsonb_build_object('name', 'work_order_incomplete_description', 'label', 'Incomplete Description')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'System Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_record_type', 'label', 'Record Type'),
        jsonb_build_object('name', 'work_order_completed_by_tenant', 'label', 'Completed By Tenant')
      )), false
  );

-- Layout: HES - Assessment  →  RT picklist_value = HES_Assessment
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'work_orders' AND picklist_field = 'record_type' AND picklist_value = 'HES_Assessment' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'HES - Assessment', 'work_orders',
    'record_detail', true,
    'Imported from SF Layout: WorkOrder-HES - Assessment',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Description', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Description', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_work_order_name', 'label', 'Work Order Name'),
        jsonb_build_object('name', 'work_order_record_type', 'label', 'Record Type'),
        jsonb_build_object('name', 'work_type_id', 'label', 'Work Type ID'),
        jsonb_build_object('name', 'work_order_status', 'label', 'Status'),
        jsonb_build_object('name', 'work_order_hes_assessment', 'label', 'HES Assessment')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Work Order Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Work Order Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_customer_name', 'label', 'Customer Name'),
        jsonb_build_object('name', 'work_order_assigned_subcontractor', 'label', 'Assigned Subcontractor'),
        jsonb_build_object('name', 'work_order_assigned_to', 'label', 'Assigned To'),
        jsonb_build_object('name', 'work_order_subcontractor_assigned_date', 'label', 'Subcontractor Assigned Date'),
        jsonb_build_object('name', 'work_order_assigned_technician', 'label', 'Assigned Technician'),
        jsonb_build_object('name', 'work_order_scheduled_start_date', 'label', 'Scheduled Start Date'),
        jsonb_build_object('name', 'work_order_scheduled_start_time', 'label', 'Scheduled Start Time'),
        jsonb_build_object('name', 'work_order_start_datetime', 'label', 'Start Datetime'),
        jsonb_build_object('name', 'work_order_end_datetime', 'label', 'End Datetime'),
        jsonb_build_object('name', 'work_order_description', 'label', 'Description')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Project Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_opportunity', 'label', 'Opportunity', 'required', true),
        jsonb_build_object('name', 'work_order_project', 'label', 'Project'),
        jsonb_build_object('name', 'work_order_account_id', 'label', 'Account ID'),
        jsonb_build_object('name', 'work_order_property', 'label', 'Property'),
        jsonb_build_object('name', 'contact_id', 'label', 'Contact ID'),
        jsonb_build_object('name', 'work_order_contact_name', 'label', 'Contact Name'),
        jsonb_build_object('name', 'work_order_contact_phone', 'label', 'Contact Phone'),
        jsonb_build_object('name', 'work_order_special_instructions', 'label', 'Special Instructions'),
        jsonb_build_object('name', 'work_order_contact_mode', 'label', 'Contact Mode'),
        jsonb_build_object('name', 'work_order_enable_auto_scheduling', 'label', 'Enable Auto Scheduling')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'System Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_unit', 'label', 'Unit'),
        jsonb_build_object('name', 'work_order_work_plan_training_video', 'label', 'Work Plan Training Video'),
        jsonb_build_object('name', 'work_order_completed_by_tenant', 'label', 'Completed By Tenant')
      )), false
  );

-- Layout: Lighting Survey  →  RT picklist_value = Lighting_Survey
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'work_orders' AND picklist_field = 'record_type' AND picklist_value = 'Lighting_Survey' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Lighting Survey', 'work_orders',
    'record_detail', true,
    'Imported from SF Layout: WorkOrder-Lighting Survey',
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
        jsonb_build_object('name', 'work_order_opportunity', 'label', 'Opportunity'),
        jsonb_build_object('name', 'work_order_project', 'label', 'Project'),
        jsonb_build_object('name', 'work_order_assigned_to', 'label', 'Assigned To'),
        jsonb_build_object('name', 'work_order_assigned_subcontractor', 'label', 'Assigned Subcontractor'),
        jsonb_build_object('name', 'work_order_subcontractor_assigned_date', 'label', 'Subcontractor Assigned Date'),
        jsonb_build_object('name', 'work_order_service_appointment', 'label', 'Service Appointment'),
        jsonb_build_object('name', 'work_order_assigned_technician', 'label', 'Assigned Technician'),
        jsonb_build_object('name', 'work_order_work_order_name', 'label', 'Work Order Name'),
        jsonb_build_object('name', 'work_order_scheduled_start_time', 'label', 'Scheduled Start Time'),
        jsonb_build_object('name', 'work_order_scheduled_start_date', 'label', 'Scheduled Start Date'),
        jsonb_build_object('name', 'work_order_unit', 'label', 'Unit'),
        jsonb_build_object('name', 'work_order_work_plan_training_video', 'label', 'Work Plan Training Video'),
        jsonb_build_object('name', 'work_order_equipment_type', 'label', 'Equipment Type'),
        jsonb_build_object('name', 'work_order_status', 'label', 'Status'),
        jsonb_build_object('name', 'work_order_priority', 'label', 'Priority'),
        jsonb_build_object('name', 'work_order_owner', 'label', 'Owner')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Property Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Property Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_account_id', 'label', 'Account ID'),
        jsonb_build_object('name', 'work_order_building_address', 'label', 'Building Address'),
        jsonb_build_object('name', 'contact_id', 'label', 'Contact ID'),
        jsonb_build_object('name', 'work_order_contact_mode', 'label', 'Contact Mode'),
        jsonb_build_object('name', 'work_order_enable_auto_scheduling', 'label', 'Enable Auto Scheduling')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Description', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Description', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_subject', 'label', 'Subject'),
        jsonb_build_object('name', 'work_order_description', 'label', 'Description'),
        jsonb_build_object('name', 'work_order_special_instructions', 'label', 'Special Instructions')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Lighting Survey Totals', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Lighting Survey Totals', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_total_number_of_lighting_fixtures', 'label', 'Total Number Of Lighting Fixtures'),
        jsonb_build_object('name', 'work_order_total_number_of_led_lighting_fixtures', 'label', 'Total Number Of LED Lighting Fixtures'),
        jsonb_build_object('name', 'work_order_percentage_of_led_fixtures', 'label', 'Percentage Of LED Fixtures'),
        jsonb_build_object('name', 'work_order_is_the_building_led_compliant', 'label', 'Is The Building LED Compliant')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'System Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_record_type', 'label', 'Record Type'),
        jsonb_build_object('name', 'work_type_id', 'label', 'Work Type ID'),
        jsonb_build_object('name', 'work_order_completed_by_tenant', 'label', 'Completed By Tenant')
      )), false
  );

-- Layout: Property Research  →  RT picklist_value = Property_Research
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'work_orders' AND picklist_field = 'record_type' AND picklist_value = 'Property_Research' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Property Research', 'work_orders',
    'record_detail', true,
    'Imported from SF Layout: WorkOrder-Property Research',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Work Order Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Work Order Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_property_name', 'label', 'Property Name'),
        jsonb_build_object('name', 'work_order_property', 'label', 'Property'),
        jsonb_build_object('name', 'work_type_id', 'label', 'Work Type ID'),
        jsonb_build_object('name', 'work_order_owner', 'label', 'Owner'),
        jsonb_build_object('name', 'work_order_status', 'label', 'Status'),
        jsonb_build_object('name', 'work_order_approval_status', 'label', 'Approval Status'),
        jsonb_build_object('name', 'work_order_completion_status', 'label', 'Completion Status'),
        jsonb_build_object('name', 'work_order_approver_comment', 'label', 'Approver Comment')
      )), false
  );

-- Layout: WI-IRA-MF-HOMES - Energy Assessment Incentive Payment Application  →  RT picklist_value = WI_IRAMF_HOMES_Energy_Assessment_Incentive_Payment_Application
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'work_orders' AND picklist_field = 'record_type' AND picklist_value = 'WI_IRAMF_HOMES_Energy_Assessment_Incentive_Payment_Application' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'WI-IRA-MF-HOMES - Energy Assessment Incentive Payment Application', 'work_orders',
    'record_detail', true,
    'Imported from SF Layout: WorkOrder-WI-IRA-MF-HOMES - Energy Assessment Incentive Payment Application',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Work Order Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Work Order Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_work_order_name', 'label', 'Work Order Name'),
        jsonb_build_object('name', 'work_type_id', 'label', 'Work Type ID'),
        jsonb_build_object('name', 'work_order_status', 'label', 'Status'),
        jsonb_build_object('name', 'work_order_work_plan_training_video', 'label', 'Work Plan Training Video'),
        jsonb_build_object('name', 'work_order_description', 'label', 'Description')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Work Order Detail Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Work Order Detail Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_scheduled_start_date', 'label', 'Scheduled Start Date'),
        jsonb_build_object('name', 'work_order_scheduled_start_time', 'label', 'Scheduled Start Time'),
        jsonb_build_object('name', 'work_order_tennant_work_orders_access_allowed', 'label', 'Tennant Work Orders Access Allowed'),
        jsonb_build_object('name', 'work_order_completed_by_tenant', 'label', 'Completed By Tenant'),
        jsonb_build_object('name', 'work_order_start_datetime', 'label', 'Start Datetime'),
        jsonb_build_object('name', 'work_order_end_datetime', 'label', 'End Datetime'),
        jsonb_build_object('name', 'work_order_time_to_complete_wo', 'label', 'Time To Complete Wo')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Project Team', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Team', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_project_co_ordinator', 'label', 'Project Co Ordinator'),
        jsonb_build_object('name', 'work_order_qaqc', 'label', 'Qaqc')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Property Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Property Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_property', 'label', 'Property'),
        jsonb_build_object('name', 'work_order_opportunity', 'label', 'Opportunity'),
        jsonb_build_object('name', 'work_order_project', 'label', 'Project'),
        jsonb_build_object('name', 'work_order_building', 'label', 'Building'),
        jsonb_build_object('name', 'work_order_unit', 'label', 'Unit')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Not Able To Complete', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Not Able To Complete', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_incomplete_reason', 'label', 'Incomplete Reason'),
        jsonb_build_object('name', 'work_order_incomplete_description', 'label', 'Incomplete Description'),
        jsonb_build_object('name', 'work_order_approver_comment', 'label', 'Approver Comment')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'System Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'work_order_record_type', 'label', 'Record Type')
      )), false
  );


END $$;
