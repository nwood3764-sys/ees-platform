-- --- PROJECTS layouts from SF -------------
-- 22 SF layouts found for Project__c

DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN

-- Soft-delete the previous Standard projects layout, if any
UPDATE public.page_layouts SET is_deleted = true, updated_at = now()
WHERE page_layout_object = 'projects' AND is_deleted = false;

-- Layout: ASHRAE Level 1  →  RT picklist_value = ASHRAE_Level_1
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'projects' AND picklist_field = 'record_type' AND picklist_value = 'ASHRAE_Level_1' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'ASHRAE Level 1', 'projects',
    'record_detail', true,
    'Imported from SF Layout: Project__c-ASHRAE Level 1',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Project Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'project_opportunity', 'label', 'Opportunity', 'required', true),
        jsonb_build_object('name', 'property_id', 'label', 'Property ID'),
        jsonb_build_object('name', 'building_id', 'label', 'Building ID'),
        jsonb_build_object('name', 'project_record_type', 'label', 'Record Type'),
        jsonb_build_object('name', 'project_project_owner', 'label', 'Project Owner'),
        jsonb_build_object('name', 'project_project_status', 'label', 'Project Status'),
        jsonb_build_object('name', 'project_project_status_notes', 'label', 'Project Status Notes'),
        jsonb_build_object('name', 'project_project_co_ordinator', 'label', 'Project Co Ordinator'),
        jsonb_build_object('name', 'project_qaqc', 'label', 'Qaqc'),
        jsonb_build_object('name', 'project_project_site_lead_user', 'label', 'Project Site Lead User')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Project Details', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_project_scheduled', 'label', 'Project Scheduled'),
        jsonb_build_object('name', 'project_project_implementation_start_date', 'label', 'Project Implementation Start Date'),
        jsonb_build_object('name', 'project_project_implementation_end_date', 'label', 'Project Implementation End Date'),
        jsonb_build_object('name', 'project_project_identified_date', 'label', 'Project Identified Date'),
        jsonb_build_object('name', 'project_post_installation_inspection_date', 'label', 'Post Installation Inspection Date')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'System Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_created_by', 'label', 'Created By'),
        jsonb_build_object('name', 'project_updated_by', 'label', 'Updated By')
      )), false
  );

-- Layout: Assessment  →  RT picklist_value = Assessment
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'projects' AND picklist_field = 'record_type' AND picklist_value = 'Assessment' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Assessment', 'projects',
    'record_detail', true,
    'Imported from SF Layout: Project__c-Assessment',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Project Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'project_opportunity', 'label', 'Opportunity', 'required', true),
        jsonb_build_object('name', 'property_id', 'label', 'Property ID'),
        jsonb_build_object('name', 'building_id', 'label', 'Building ID'),
        jsonb_build_object('name', 'project_project_id_pp', 'label', 'Project ID PP'),
        jsonb_build_object('name', 'project_project_cost_pp', 'label', 'Project Cost PP'),
        jsonb_build_object('name', 'project_project_record_id_pp', 'label', 'Project Record ID PP'),
        jsonb_build_object('name', 'project_project_status_notes', 'label', 'Project Status Notes'),
        jsonb_build_object('name', 'project_project_scheduled_time', 'label', 'Project Scheduled Time'),
        jsonb_build_object('name', 'project_project_status_pp', 'label', 'Project Status PP'),
        jsonb_build_object('name', 'project_project_site_lead_user', 'label', 'Project Site Lead User'),
        jsonb_build_object('name', 'project_project_co_ordinator', 'label', 'Project Co Ordinator'),
        jsonb_build_object('name', 'project_record_type', 'label', 'Record Type'),
        jsonb_build_object('name', 'project_project_status', 'label', 'Project Status'),
        jsonb_build_object('name', 'project_utility_program', 'label', 'Utility Program', 'required', true),
        jsonb_build_object('name', 'project_project_owner', 'label', 'Project Owner'),
        jsonb_build_object('name', 'project_qaqc', 'label', 'Qaqc')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Project Details', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_project_scheduled', 'label', 'Project Scheduled'),
        jsonb_build_object('name', 'project_project_implementation_start_date', 'label', 'Project Implementation Start Date'),
        jsonb_build_object('name', 'project_project_implementation_end_date', 'label', 'Project Implementation End Date'),
        jsonb_build_object('name', 'project_project_identified_date', 'label', 'Project Identified Date'),
        jsonb_build_object('name', 'project_post_installation_inspection_date', 'label', 'Post Installation Inspection Date')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'System Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_created_by', 'label', 'Created By'),
        jsonb_build_object('name', 'project_updated_by', 'label', 'Updated By')
      )), false
  );

-- Layout: MF-AIR  →  RT picklist_value = MF_AIR
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'projects' AND picklist_field = 'record_type' AND picklist_value = 'MF_AIR' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'MF-AIR', 'projects',
    'record_detail', true,
    'Imported from SF Layout: Project__c-MF-AIR',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Project Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'project_opportunity', 'label', 'Opportunity', 'required', true),
        jsonb_build_object('name', 'property_id', 'label', 'Property ID'),
        jsonb_build_object('name', 'building_id', 'label', 'Building ID'),
        jsonb_build_object('name', 'project_external_id', 'label', 'External ID'),
        jsonb_build_object('name', 'project_record_type', 'label', 'Record Type'),
        jsonb_build_object('name', 'project_utility_program', 'label', 'Utility Program', 'required', true),
        jsonb_build_object('name', 'project_project_owner', 'label', 'Project Owner'),
        jsonb_build_object('name', 'project_qaqc', 'label', 'Qaqc')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Project Details', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_project_scheduled_time', 'label', 'Project Scheduled Time'),
        jsonb_build_object('name', 'project_project_scheduled', 'label', 'Project Scheduled'),
        jsonb_build_object('name', 'project_project_site_lead', 'label', 'Project Site Lead'),
        jsonb_build_object('name', 'project_project_co_ordinator', 'label', 'Project Co Ordinator'),
        jsonb_build_object('name', 'project_project_status', 'label', 'Project Status'),
        jsonb_build_object('name', 'project_project_status_notes', 'label', 'Project Status Notes'),
        jsonb_build_object('name', 'project_project_implementation_start_date', 'label', 'Project Implementation Start Date'),
        jsonb_build_object('name', 'project_project_implementation_end_date', 'label', 'Project Implementation End Date'),
        jsonb_build_object('name', 'project_projects_work_days_to_complete_project', 'label', 'Projects Work Days To Complete Project'),
        jsonb_build_object('name', 'project_total_project_running_time', 'label', 'Total Project Running Time')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Incentive Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Incentive Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_incentive_amount', 'label', 'Incentive Amount'),
        jsonb_build_object('name', 'project_incentive_amount_ee', 'label', 'Incentive Amount EE'),
        jsonb_build_object('name', 'project_incentive_issue_date', 'label', 'Incentive Issue Date'),
        jsonb_build_object('name', 'project_incentive_processing_time', 'label', 'Incentive Processing Time'),
        jsonb_build_object('name', 'project_incentive_received_date', 'label', 'Incentive Received Date'),
        jsonb_build_object('name', 'project_incentive_submitted_date', 'label', 'Incentive Submitted Date')
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
        jsonb_build_object('name', 'project_created_by', 'label', 'Created By'),
        jsonb_build_object('name', 'project_updated_by', 'label', 'Updated By')
      )), false
  );

-- Layout: MF-EXH  →  RT picklist_value = Mf_EXH
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'projects' AND picklist_field = 'record_type' AND picklist_value = 'Mf_EXH' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'MF-EXH', 'projects',
    'record_detail', true,
    'Imported from SF Layout: Project__c-MF-EXH',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Project Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'project_opportunity', 'label', 'Opportunity', 'required', true),
        jsonb_build_object('name', 'property_id', 'label', 'Property ID'),
        jsonb_build_object('name', 'building_id', 'label', 'Building ID'),
        jsonb_build_object('name', 'project_external_id', 'label', 'External ID'),
        jsonb_build_object('name', 'project_record_type', 'label', 'Record Type'),
        jsonb_build_object('name', 'project_utility_program', 'label', 'Utility Program', 'required', true),
        jsonb_build_object('name', 'project_project_owner', 'label', 'Project Owner')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Project Details', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_project_scheduled', 'label', 'Project Scheduled'),
        jsonb_build_object('name', 'project_project_scheduled_time', 'label', 'Project Scheduled Time'),
        jsonb_build_object('name', 'project_project_co_ordinator', 'label', 'Project Co Ordinator'),
        jsonb_build_object('name', 'project_qaqc', 'label', 'Qaqc'),
        jsonb_build_object('name', 'project_project_site_lead', 'label', 'Project Site Lead'),
        jsonb_build_object('name', 'project_project_status', 'label', 'Project Status'),
        jsonb_build_object('name', 'project_project_status_notes', 'label', 'Project Status Notes'),
        jsonb_build_object('name', 'project_project_implementation_start_date', 'label', 'Project Implementation Start Date'),
        jsonb_build_object('name', 'project_project_implementation_end_date', 'label', 'Project Implementation End Date'),
        jsonb_build_object('name', 'project_projects_work_days_to_complete_project', 'label', 'Projects Work Days To Complete Project'),
        jsonb_build_object('name', 'project_total_project_running_time', 'label', 'Total Project Running Time')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Incentive Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Incentive Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_incentive_amount', 'label', 'Incentive Amount')
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
        jsonb_build_object('name', 'project_created_by', 'label', 'Created By'),
        jsonb_build_object('name', 'project_updated_by', 'label', 'Updated By')
      )), false
  );

-- Layout: MF-INS-AIR  →  RT picklist_value = MF_INS_AIR
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'projects' AND picklist_field = 'record_type' AND picklist_value = 'MF_INS_AIR' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'MF-INS-AIR', 'projects',
    'record_detail', true,
    'Imported from SF Layout: Project__c-MF-INS-AIR',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Project Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'project_opportunity', 'label', 'Opportunity', 'required', true),
        jsonb_build_object('name', 'property_id', 'label', 'Property ID'),
        jsonb_build_object('name', 'building_id', 'label', 'Building ID'),
        jsonb_build_object('name', 'project_external_id', 'label', 'External ID'),
        jsonb_build_object('name', 'project_record_type', 'label', 'Record Type'),
        jsonb_build_object('name', 'project_project_status', 'label', 'Project Status'),
        jsonb_build_object('name', 'project_project_status_notes', 'label', 'Project Status Notes'),
        jsonb_build_object('name', 'project_utility_program', 'label', 'Utility Program', 'required', true),
        jsonb_build_object('name', 'project_qaqc', 'label', 'Qaqc')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Project Details', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_project_scheduled', 'label', 'Project Scheduled'),
        jsonb_build_object('name', 'project_project_implementation_start_date', 'label', 'Project Implementation Start Date'),
        jsonb_build_object('name', 'project_project_scheduled_time', 'label', 'Project Scheduled Time'),
        jsonb_build_object('name', 'project_project_implementation_end_date', 'label', 'Project Implementation End Date'),
        jsonb_build_object('name', 'project_projects_work_days_to_complete_project', 'label', 'Projects Work Days To Complete Project'),
        jsonb_build_object('name', 'project_total_project_running_time', 'label', 'Total Project Running Time')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Project Managment Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Managment Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_project_owner', 'label', 'Project Owner'),
        jsonb_build_object('name', 'project_project_site_lead', 'label', 'Project Site Lead'),
        jsonb_build_object('name', 'project_project_co_ordinator', 'label', 'Project Co Ordinator')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Incentive Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Incentive Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_incentive_amount', 'label', 'Incentive Amount')
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
        jsonb_build_object('name', 'project_created_by', 'label', 'Created By'),
        jsonb_build_object('name', 'project_updated_by', 'label', 'Updated By')
      )), false
  );

-- Layout: TruTeam Illinois INS  →  RT picklist_value = TruTeam_Illinois_INS
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'projects' AND picklist_field = 'record_type' AND picklist_value = 'TruTeam_Illinois_INS' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'TruTeam Illinois INS', 'projects',
    'record_detail', true,
    'Imported from SF Layout: Project__c-TruTeam Illinois INS',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Project Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'project_opportunity', 'label', 'Opportunity', 'required', true),
        jsonb_build_object('name', 'property_id', 'label', 'Property ID'),
        jsonb_build_object('name', 'building_id', 'label', 'Building ID'),
        jsonb_build_object('name', 'project_project_status_notes', 'label', 'Project Status Notes'),
        jsonb_build_object('name', 'project_project_scheduled_time', 'label', 'Project Scheduled Time'),
        jsonb_build_object('name', 'project_project_site_lead_user', 'label', 'Project Site Lead User'),
        jsonb_build_object('name', 'project_project_co_ordinator', 'label', 'Project Co Ordinator'),
        jsonb_build_object('name', 'project_record_type', 'label', 'Record Type'),
        jsonb_build_object('name', 'project_project_status', 'label', 'Project Status'),
        jsonb_build_object('name', 'project_utility_program', 'label', 'Utility Program'),
        jsonb_build_object('name', 'project_project_owner', 'label', 'Project Owner'),
        jsonb_build_object('name', 'project_qaqc', 'label', 'Qaqc')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Project Details', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_sq_ft_attic_plane', 'label', 'Sq Ft Attic Plane'),
        jsonb_build_object('name', 'project_estimated_number_of_bales', 'label', 'Estimated Number Of Bales'),
        jsonb_build_object('name', 'project_installed_number_of_bales', 'label', 'Installed Number Of Bales'),
        jsonb_build_object('name', 'project_project_scheduled', 'label', 'Project Scheduled'),
        jsonb_build_object('name', 'project_project_implementation_start_date', 'label', 'Project Implementation Start Date'),
        jsonb_build_object('name', 'project_project_implementation_end_date', 'label', 'Project Implementation End Date'),
        jsonb_build_object('name', 'project_projects_work_days_to_complete_project', 'label', 'Projects Work Days To Complete Project'),
        jsonb_build_object('name', 'project_total_project_running_time', 'label', 'Total Project Running Time'),
        jsonb_build_object('name', 'project_work_order_issued', 'label', 'Work Order Issued'),
        jsonb_build_object('name', 'project_work_order_completed', 'label', 'Work Order Completed'),
        jsonb_build_object('name', 'project_installation_completion_date', 'label', 'Installation Completion Date')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'System Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_created_by', 'label', 'Created By'),
        jsonb_build_object('name', 'project_updated_by', 'label', 'Updated By')
      )), false
  );

-- Layout: WI-IRA-MF-HOMES - Audit Level 2  →  RT picklist_value = WI_IRA_MF_HOMES_AUDIT_LEVEL_2
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'projects' AND picklist_field = 'record_type' AND picklist_value = 'WI_IRA_MF_HOMES_AUDIT_LEVEL_2' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'WI-IRA-MF-HOMES - Audit Level 2', 'projects',
    'record_detail', true,
    'Imported from SF Layout: Project__c-WI-IRA-MF-HOMES - Audit Level 2',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Project Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'project_opportunity', 'label', 'Opportunity', 'required', true),
        jsonb_build_object('name', 'property_id', 'label', 'Property ID'),
        jsonb_build_object('name', 'building_id', 'label', 'Building ID'),
        jsonb_build_object('name', 'project_record_type', 'label', 'Record Type'),
        jsonb_build_object('name', 'project_project_owner', 'label', 'Project Owner'),
        jsonb_build_object('name', 'project_project_status', 'label', 'Project Status'),
        jsonb_build_object('name', 'project_project_status_notes', 'label', 'Project Status Notes'),
        jsonb_build_object('name', 'project_project_co_ordinator', 'label', 'Project Co Ordinator'),
        jsonb_build_object('name', 'project_qaqc', 'label', 'Qaqc'),
        jsonb_build_object('name', 'project_project_site_lead_user', 'label', 'Project Site Lead User')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Project Details', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_project_scheduled', 'label', 'Project Scheduled'),
        jsonb_build_object('name', 'project_project_implementation_start_date', 'label', 'Project Implementation Start Date'),
        jsonb_build_object('name', 'project_project_implementation_end_date', 'label', 'Project Implementation End Date'),
        jsonb_build_object('name', 'project_project_identified_date', 'label', 'Project Identified Date'),
        jsonb_build_object('name', 'project_post_installation_inspection_date', 'label', 'Post Installation Inspection Date')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'System Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'project_created_by', 'label', 'Created By'),
        jsonb_build_object('name', 'project_updated_by', 'label', 'Updated By')
      )), false
  );


END $$;
