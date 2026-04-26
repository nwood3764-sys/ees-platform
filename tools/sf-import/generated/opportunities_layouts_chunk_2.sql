DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN
-- Layout: MFES-2022  →  RT picklist_value = MFES_2022
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'opportunities' AND picklist_field = 'record_type' AND picklist_value = 'MFES_2022' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'MFES-2022', 'opportunities',
    'record_detail', true,
    'Imported from SF Layout: Opportunity-MFES-2022',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Opportunity Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Opportunity Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'opportunity_record_type', 'label', 'Record Type'),
        jsonb_build_object('name', 'opportunity_docu_sign_envelope_recipient', 'label', 'Docu Sign Envelope Recipient'),
        jsonb_build_object('name', 'opportunity_mfes_2023_hs_5_total_ee_project_cost', 'label', 'Mfes 2023 Hs 5 Total EE Project Cost'),
        jsonb_build_object('name', 'opportunity_ira_income_code', 'label', 'IRA Income Code'),
        jsonb_build_object('name', 'opportunity_stage', 'label', 'Stage', 'required', true),
        jsonb_build_object('name', 'opportunity_stage_notes_del', 'label', 'Stage Notes Del'),
        jsonb_build_object('name', 'opportunity_owner', 'label', 'Owner')
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
        jsonb_build_object('name', 'property_id', 'label', 'Property ID', 'required', true),
        jsonb_build_object('name', 'opportunity_property_aka', 'label', 'Property Aka'),
        jsonb_build_object('name', 'opportunity_property_site_contact', 'label', 'Property Site Contact'),
        jsonb_build_object('name', 'opportunity_account_id', 'label', 'Account ID'),
        jsonb_build_object('name', 'opportunity_property_management_company', 'label', 'Property Management Company')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Outreach Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Outreach Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_nurturing_1_date', 'label', 'Nurturing 1 Date'),
        jsonb_build_object('name', 'opportunity_nurturing_2_date', 'label', 'Nurturing 2 Date'),
        jsonb_build_object('name', 'opportunity_nurturing_3_date', 'label', 'Nurturing 3 Date')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Project Approval / Enrollment Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Approval / Enrollment Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_assessment_agreement_obtained_date', 'label', 'Assessment Agreement Obtained Date'),
        jsonb_build_object('name', 'opportunity_iq_assessment_scheduled_date', 'label', 'Iq Assessment Scheduled Date'),
        jsonb_build_object('name', 'opportunity_iq_assessment_completed_date', 'label', 'Iq Assessment Completed Date')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Qualification Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Qualification Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_project_utility_approval_requested_date', 'label', 'Project Utility Approval Requested Date'),
        jsonb_build_object('name', 'opportunity_project_utility_approval_obtained_date', 'label', 'Project Utility Approval Obtained Date'),
        jsonb_build_object('name', 'opportunity_project_utility_approval_processing_time', 'label', 'Project Utility Approval Processing Time')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'Opportunity Value', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Opportunity Value', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_date_submitted_for_payment', 'label', 'Date Submitted For Payment'),
        jsonb_build_object('name', 'opportunity_amount', 'label', 'Amount'),
        jsonb_build_object('name', 'opportunity_date_incentive_received', 'label', 'Date Incentive Received'),
        jsonb_build_object('name', 'opportunity_utility_program', 'label', 'Utility Program'),
        jsonb_build_object('name', 'opportunity_amount_of_projects', 'label', 'Amount Of Projects')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 7, 'Additional Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Additional Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_close_date', 'label', 'Close Date', 'required', true),
        jsonb_build_object('name', 'opportunity_probability', 'label', 'Probability')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 8, 'Description Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Description Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_image_test', 'label', 'Image Test')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 9, 'System Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_created_by', 'label', 'Created By'),
        jsonb_build_object('name', 'opportunity_updated_by', 'label', 'Updated By')
      )), false
  );

-- Layout: MFES-2023-Equipment  →  RT picklist_value = MFES_2023_Equipment
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'opportunities' AND picklist_field = 'record_type' AND picklist_value = 'MFES_2023_Equipment' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'MFES-2023-Equipment', 'opportunities',
    'record_detail', true,
    'Imported from SF Layout: Opportunity-MFES-2023-Equipment',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Opportunity Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Opportunity Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'opportunity_record_type', 'label', 'Record Type'),
        jsonb_build_object('name', 'opportunity_docu_sign_envelope_recipient', 'label', 'Docu Sign Envelope Recipient'),
        jsonb_build_object('name', 'opportunity_ira_income_code', 'label', 'IRA Income Code'),
        jsonb_build_object('name', 'opportunity_stage', 'label', 'Stage', 'required', true),
        jsonb_build_object('name', 'opportunity_stage_notes_del', 'label', 'Stage Notes Del'),
        jsonb_build_object('name', 'opportunity_owner', 'label', 'Owner')
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
        jsonb_build_object('name', 'property_id', 'label', 'Property ID', 'required', true),
        jsonb_build_object('name', 'opportunity_property_aka', 'label', 'Property Aka'),
        jsonb_build_object('name', 'opportunity_building', 'label', 'Building'),
        jsonb_build_object('name', 'opportunity_account_id', 'label', 'Account ID'),
        jsonb_build_object('name', 'opportunity_property_management_company', 'label', 'Property Management Company'),
        jsonb_build_object('name', 'opportunity_property_site_contact', 'label', 'Property Site Contact')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Outreach Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Outreach Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_nurturing_1_date', 'label', 'Nurturing 1 Date')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Qualification Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Qualification Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_equipment_survey_scheduled_start_date', 'label', 'Equipment Survey Scheduled Start Date'),
        jsonb_build_object('name', 'opportunity_equipment_survey_scheduled_end_date', 'label', 'Equipment Survey Scheduled End Date')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Project Approval', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Approval', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_project_utility_approval_requested_date', 'label', 'Project Utility Approval Requested Date'),
        jsonb_build_object('name', 'opportunity_project_utility_approval_obtained_date', 'label', 'Project Utility Approval Obtained Date'),
        jsonb_build_object('name', 'opportunity_project_utility_approval_processing_time', 'label', 'Project Utility Approval Processing Time')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'Additional Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Additional Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_close_date', 'label', 'Close Date', 'required', true),
        jsonb_build_object('name', 'opportunity_probability', 'label', 'Probability')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 7, 'System Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_created_by', 'label', 'Created By'),
        jsonb_build_object('name', 'opportunity_updated_by', 'label', 'Updated By')
      )), false
  );

-- Layout: MFES-2023  →  RT picklist_value = MFES_2023
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'opportunities' AND picklist_field = 'record_type' AND picklist_value = 'MFES_2023' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'MFES-2023', 'opportunities',
    'record_detail', true,
    'Imported from SF Layout: Opportunity-MFES-2023',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Opportunity Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Opportunity Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'opportunity_record_type', 'label', 'Record Type'),
        jsonb_build_object('name', 'opportunity_docu_sign_envelope_recipient', 'label', 'Docu Sign Envelope Recipient'),
        jsonb_build_object('name', 'opportunity_ira_income_code', 'label', 'IRA Income Code'),
        jsonb_build_object('name', 'opportunity_stage', 'label', 'Stage', 'required', true),
        jsonb_build_object('name', 'opportunity_stage_notes_del', 'label', 'Stage Notes Del'),
        jsonb_build_object('name', 'opportunity_owner', 'label', 'Owner')
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
        jsonb_build_object('name', 'property_id', 'label', 'Property ID', 'required', true),
        jsonb_build_object('name', 'opportunity_property_aka', 'label', 'Property Aka'),
        jsonb_build_object('name', 'opportunity_building', 'label', 'Building'),
        jsonb_build_object('name', 'opportunity_account_id', 'label', 'Account ID'),
        jsonb_build_object('name', 'opportunity_property_management_company', 'label', 'Property Management Company'),
        jsonb_build_object('name', 'opportunity_property_site_contact', 'label', 'Property Site Contact')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Outreach Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Outreach Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_nurturing_1_date', 'label', 'Nurturing 1 Date'),
        jsonb_build_object('name', 'opportunity_nurturing_2_date', 'label', 'Nurturing 2 Date'),
        jsonb_build_object('name', 'opportunity_nurturing_3_date', 'label', 'Nurturing 3 Date')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Assesment Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Assesment Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_assessment_agreement_obtained_date', 'label', 'Assessment Agreement Obtained Date'),
        jsonb_build_object('name', 'opportunity_iq_assessment_scheduled', 'label', 'Iq Assessment Scheduled'),
        jsonb_build_object('name', 'opportunity_iq_assessment_completed_date', 'label', 'Iq Assessment Completed Date')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Project Approval', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Approval', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_project_utility_approval_requested_date', 'label', 'Project Utility Approval Requested Date'),
        jsonb_build_object('name', 'opportunity_project_utility_approval_sent_to_pc', 'label', 'Project Utility Approval Sent To Pc'),
        jsonb_build_object('name', 'opportunity_project_utility_approval_obtained_date', 'label', 'Project Utility Approval Obtained Date'),
        jsonb_build_object('name', 'opportunity_project_utility_approval_processing_time', 'label', 'Project Utility Approval Processing Time')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'Project Planning Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Planning Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_project_agreement_sent_date', 'label', 'Project Agreement Sent Date'),
        jsonb_build_object('name', 'opportunity_project_agreement_obtained_date', 'label', 'Project Agreement Obtained Date'),
        jsonb_build_object('name', 'opportunity_project_planning_meeting_scheduled_date', 'label', 'Project Planning Meeting Scheduled Date'),
        jsonb_build_object('name', 'opportunity_project_planning_meeting_date', 'label', 'Project Planning Meeting Date')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 7, 'Project Implementation', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Implementation', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_converted_to_project_date', 'label', 'Converted To Project Date'),
        jsonb_build_object('name', 'opportunity_project_scheduled_date', 'label', 'Project Scheduled Date'),
        jsonb_build_object('name', 'opportunity_number_of_projects', 'label', 'Number Of Projects')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 8, 'Accounting Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Accounting Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_amount', 'label', 'Amount'),
        jsonb_build_object('name', 'opportunity_date_submitted_for_payment', 'label', 'Date Submitted For Payment'),
        jsonb_build_object('name', 'opportunity_date_incentive_received', 'label', 'Date Incentive Received'),
        jsonb_build_object('name', 'opportunity_incentive_processing_time', 'label', 'Incentive Processing Time'),
        jsonb_build_object('name', 'opportunity_utility_program', 'label', 'Utility Program'),
        jsonb_build_object('name', 'opportunity_external_reference_number', 'label', 'External Reference Number')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 9, 'FLOW TESTING', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'FLOW TESTING', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_mfes_2023_wx_3_subtotal_p3', 'label', 'Mfes 2023 Wx 3 Subtotal P3'),
        jsonb_build_object('name', 'opportunity_mfes_2023_wx_4_subtotal_p4', 'label', 'Mfes 2023 Wx 4 Subtotal P4'),
        jsonb_build_object('name', 'opportunity_mfes_2023_wx_4_total_wx_cost', 'label', 'Mfes 2023 Wx 4 Total Wx Cost'),
        jsonb_build_object('name', 'opportunity_mfes_2023_hs_2_subtotal_p2', 'label', 'Mfes 2023 Hs 2 Subtotal P2'),
        jsonb_build_object('name', 'opportunity_mfes_2023_hs_3_subtotal_p3', 'label', 'Mfes 2023 Hs 3 Subtotal P3'),
        jsonb_build_object('name', 'opportunity_mfes_2023_hs_4_subtotal_p4', 'label', 'Mfes 2023 Hs 4 Subtotal P4'),
        jsonb_build_object('name', 'opportunity_mfes_2023_hs_5_subtotal_p5', 'label', 'Mfes 2023 Hs 5 Subtotal P5'),
        jsonb_build_object('name', 'opportunity_mfes_2023_hs_5_total_hs_cost', 'label', 'Mfes 2023 Hs 5 Total Hs Cost'),
        jsonb_build_object('name', 'opportunity_mfes_2023_hs_5_total_ee_project_cost', 'label', 'Mfes 2023 Hs 5 Total EE Project Cost'),
        jsonb_build_object('name', 'opportunity_h_s_to_ee_cost_ratio', 'label', 'H S To EE Cost Ratio'),
        jsonb_build_object('name', 'opportunity_mfes_2023_gas_3_subtotal_p3', 'label', 'Mfes 2023 Gas 3 Subtotal P3'),
        jsonb_build_object('name', 'opportunity_mfes_2023_gas_4_subtotal_p4', 'label', 'Mfes 2023 Gas 4 Subtotal P4'),
        jsonb_build_object('name', 'opportunity_mfes_2023_gas_5_subtotal_p5', 'label', 'Mfes 2023 Gas 5 Subtotal P5'),
        jsonb_build_object('name', 'opportunity_mfes_2023_gas_6_subtotal_p6', 'label', 'Mfes 2023 Gas 6 Subtotal P6'),
        jsonb_build_object('name', 'opportunity_mfes_2023_gas_7_subtotal_p7', 'label', 'Mfes 2023 Gas 7 Subtotal P7'),
        jsonb_build_object('name', 'opportunity_mfes_2023_gas_8_subtotal_p8', 'label', 'Mfes 2023 Gas 8 Subtotal P8'),
        jsonb_build_object('name', 'opportunity_mfes_2023_gas_9_subtotal_p9', 'label', 'Mfes 2023 Gas 9 Subtotal P9'),
        jsonb_build_object('name', 'opportunity_mfes_2023_gas_9_total_gas_cost', 'label', 'Mfes 2023 Gas 9 Total Gas Cost'),
        jsonb_build_object('name', 'opportunity_mfes_2023_ele_5_subtotal_p5', 'label', 'Mfes 2023 Ele 5 Subtotal P5'),
        jsonb_build_object('name', 'opportunity_mfes_2023_ele_6_subtotal_p6', 'label', 'Mfes 2023 Ele 6 Subtotal P6'),
        jsonb_build_object('name', 'opportunity_mfes_2023_ele_7_subtotal_p7', 'label', 'Mfes 2023 Ele 7 Subtotal P7'),
        jsonb_build_object('name', 'opportunity_mfes_2023_ele_8_subtotal_p8', 'label', 'Mfes 2023 Ele 8 Subtotal P8'),
        jsonb_build_object('name', 'opportunity_mfes_2023_ele_9_subtotal_p9', 'label', 'Mfes 2023 Ele 9 Subtotal P9'),
        jsonb_build_object('name', 'opportunity_mfes_2023_ele_10_subtotal_p10', 'label', 'Mfes 2023 Ele 10 Subtotal P10'),
        jsonb_build_object('name', 'opportunity_mfes_2023_ele_11_total_ele_cost', 'label', 'Mfes 2023 Ele 11 Total Ele Cost')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 10, 'Additional Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Additional Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_close_date', 'label', 'Close Date', 'required', true),
        jsonb_build_object('name', 'opportunity_probability', 'label', 'Probability')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 11, 'System Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_created_by', 'label', 'Created By'),
        jsonb_build_object('name', 'opportunity_updated_by', 'label', 'Updated By')
      )), false
  );

-- Layout: MFES-2024-Equipment  →  RT picklist_value = MFES_2024_Equipment
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'opportunities' AND picklist_field = 'record_type' AND picklist_value = 'MFES_2024_Equipment' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'MFES-2024-Equipment', 'opportunities',
    'record_detail', true,
    'Imported from SF Layout: Opportunity-MFES-2024-Equipment',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Opportunity Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Opportunity Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'opportunity_record_type', 'label', 'Record Type'),
        jsonb_build_object('name', 'opportunity_docu_sign_envelope_recipient', 'label', 'Docu Sign Envelope Recipient'),
        jsonb_build_object('name', 'opportunity_ira_income_code', 'label', 'IRA Income Code'),
        jsonb_build_object('name', 'opportunity_stage', 'label', 'Stage', 'required', true),
        jsonb_build_object('name', 'opportunity_stage_notes_del', 'label', 'Stage Notes Del'),
        jsonb_build_object('name', 'opportunity_owner', 'label', 'Owner')
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
        jsonb_build_object('name', 'property_id', 'label', 'Property ID', 'required', true),
        jsonb_build_object('name', 'opportunity_property_aka', 'label', 'Property Aka'),
        jsonb_build_object('name', 'opportunity_property_management_company', 'label', 'Property Management Company'),
        jsonb_build_object('name', 'opportunity_account_id', 'label', 'Account ID'),
        jsonb_build_object('name', 'opportunity_property_site_contact', 'label', 'Property Site Contact'),
        jsonb_build_object('name', 'opportunity_number_of_buildings', 'label', 'Number Of Buildings'),
        jsonb_build_object('name', 'opportunity_stories_of_building', 'label', 'Stories Of Building'),
        jsonb_build_object('name', 'opportunity_total_indoor_sq_ft', 'label', 'Total Indoor Sq Ft'),
        jsonb_build_object('name', 'opportunity_total_units', 'label', 'Total Units')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Utility Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Utility Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_gas_account_holders_first_name', 'label', 'Gas Account Holders First Name'),
        jsonb_build_object('name', 'opportunity_gas_account_holders_last_name', 'label', 'Gas Account Holders Last Name'),
        jsonb_build_object('name', 'opportunity_gas_account_number', 'label', 'Gas Account Number'),
        jsonb_build_object('name', 'opportunity_electric_account_holders_full_name', 'label', 'Electric Account Holders Full Name'),
        jsonb_build_object('name', 'opportunity_electric_account_number', 'label', 'Electric Account Number')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Qualification Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Qualification Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_equipment_survey_scheduled_start_date', 'label', 'Equipment Survey Scheduled Start Date'),
        jsonb_build_object('name', 'opportunity_equipment_survey_scheduled_end_date', 'label', 'Equipment Survey Scheduled End Date')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Outreach Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Outreach Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_nurturing_1_date', 'label', 'Nurturing 1 Date')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'Project Approval', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Approval', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_project_utility_approval_requested_date', 'label', 'Project Utility Approval Requested Date'),
        jsonb_build_object('name', 'opportunity_project_utility_approval_obtained_date', 'label', 'Project Utility Approval Obtained Date'),
        jsonb_build_object('name', 'opportunity_project_utility_approval_processing_time', 'label', 'Project Utility Approval Processing Time')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 7, 'Additional Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Additional Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_close_date', 'label', 'Close Date', 'required', true),
        jsonb_build_object('name', 'opportunity_probability', 'label', 'Probability')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 8, 'System Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_created_by', 'label', 'Created By'),
        jsonb_build_object('name', 'opportunity_updated_by', 'label', 'Updated By')
      )), false
  );


END $$;
