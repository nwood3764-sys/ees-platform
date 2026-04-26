DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN
-- Layout: WI-IRA-MF-HOMES - Project Reservation  →  RT picklist_value = WI_IRA_MF_HOMES_Project_Reservation
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'work_orders' AND picklist_field = 'record_type' AND picklist_value = 'WI_IRA_MF_HOMES_Project_Reservation' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'WI-IRA-MF-HOMES - Project Reservation', 'work_orders',
    'record_detail', true,
    'Imported from SF Layout: WorkOrder-WI-IRA-MF-HOMES - Project Reservation',
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
        jsonb_build_object('name', 'work_order_assigned_to', 'label', 'Assigned To'),
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

-- Layout: Work Order Layout  →  RT picklist_value = (default fallback)
  rt_id := NULL;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Work Order Layout', 'work_orders',
    'record_detail', true,
    'Imported from SF Layout: WorkOrder-Work Order Layout',
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
    layout_id, 4, 'System Information', 2, 'Details',
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


END $$;
