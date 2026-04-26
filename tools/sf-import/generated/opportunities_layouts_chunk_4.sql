DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN
-- Layout: Opportunity Layout  →  RT picklist_value = (default fallback)
  rt_id := NULL;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Opportunity Layout', 'opportunities',
    'record_detail', true,
    'Imported from SF Layout: Opportunity-Opportunity Layout',
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
        jsonb_build_object('name', 'opportunity_owner', 'label', 'Owner'),
        jsonb_build_object('name', 'opportunity_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'opportunity_account_id', 'label', 'Account ID', 'required', true),
        jsonb_build_object('name', 'opportunity_building', 'label', 'Building'),
        jsonb_build_object('name', 'opportunity_solutions_advisor', 'label', 'Solutions Advisor'),
        jsonb_build_object('name', 'opportunity_number_of_projects', 'label', 'Number Of Projects'),
        jsonb_build_object('name', 'property_id', 'label', 'Property ID', 'required', true),
        jsonb_build_object('name', 'opportunity_project_scheduled_date', 'label', 'Project Scheduled Date'),
        jsonb_build_object('name', 'opportunity_mfes_2023_hs_5_total_ee_project_cost', 'label', 'Mfes 2023 Hs 5 Total EE Project Cost'),
        jsonb_build_object('name', 'opportunity_ira_income_code', 'label', 'IRA Income Code'),
        jsonb_build_object('name', 'opportunity_record_type', 'label', 'Record Type'),
        jsonb_build_object('name', 'opportunity_close_date', 'label', 'Close Date', 'required', true),
        jsonb_build_object('name', 'opportunity_stage', 'label', 'Stage', 'required', true),
        jsonb_build_object('name', 'opportunity_probability', 'label', 'Probability'),
        jsonb_build_object('name', 'opportunity_amount', 'label', 'Amount')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Additional Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Additional Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_next_step', 'label', 'Next Step')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Description Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Description Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_description', 'label', 'Description')
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
        jsonb_build_object('name', 'opportunity_created_by', 'label', 'Created By'),
        jsonb_build_object('name', 'opportunity_updated_by', 'label', 'Updated By')
      )), false
  );

-- Layout: PACE-CO  →  RT picklist_value = PACE_CO
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'opportunities' AND picklist_field = 'record_type' AND picklist_value = 'PACE_CO' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'PACE-CO', 'opportunities',
    'record_detail', true,
    'Imported from SF Layout: Opportunity-PACE-CO',
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
        jsonb_build_object('name', 'opportunity_property_site_contact', 'label', 'Property Site Contact'),
        jsonb_build_object('name', 'opportunity_assessed_property_value', 'label', 'Assessed Property Value'),
        jsonb_build_object('name', 'opportunity_market_value_of_property', 'label', 'Market Value Of Property')
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
    layout_id, 9, 'Additional Information', 2, 'Details',
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
    layout_id, 10, 'System Information', 2, 'Details',
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

-- Layout: PACE-IL  →  RT picklist_value = PACE_IL
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'opportunities' AND picklist_field = 'record_type' AND picklist_value = 'PACE_IL' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'PACE-IL', 'opportunities',
    'record_detail', true,
    'Imported from SF Layout: Opportunity-PACE-IL',
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
        jsonb_build_object('name', 'opportunity_property_site_contact', 'label', 'Property Site Contact'),
        jsonb_build_object('name', 'opportunity_assessed_property_value', 'label', 'Assessed Property Value'),
        jsonb_build_object('name', 'opportunity_market_value_of_property', 'label', 'Market Value Of Property')
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
    layout_id, 9, 'System Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_close_date', 'label', 'Close Date', 'required', true),
        jsonb_build_object('name', 'opportunity_probability', 'label', 'Probability'),
        jsonb_build_object('name', 'opportunity_created_by', 'label', 'Created By'),
        jsonb_build_object('name', 'opportunity_updated_by', 'label', 'Updated By')
      )), false
  );

-- Layout: PACE-WI  →  RT picklist_value = PACE_WI
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'opportunities' AND picklist_field = 'record_type' AND picklist_value = 'PACE_WI' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'PACE-WI', 'opportunities',
    'record_detail', true,
    'Imported from SF Layout: Opportunity-PACE-WI',
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
        jsonb_build_object('name', 'opportunity_property_site_contact', 'label', 'Property Site Contact'),
        jsonb_build_object('name', 'opportunity_assessed_property_value', 'label', 'Assessed Property Value'),
        jsonb_build_object('name', 'opportunity_market_value_of_property', 'label', 'Market Value Of Property')
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
    layout_id, 9, 'Additional Information', 2, 'Details',
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
    layout_id, 10, 'System Information', 2, 'Details',
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

-- Layout: TAX-CREDIT-179D  →  RT picklist_value = TAX_CREDIT_179D
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'opportunities' AND picklist_field = 'record_type' AND picklist_value = 'TAX_CREDIT_179D' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'TAX-CREDIT-179D', 'opportunities',
    'record_detail', true,
    'Imported from SF Layout: Opportunity-TAX-CREDIT-179D',
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
        jsonb_build_object('name', 'opportunity_efr_assessment_agreement_sent_date', 'label', 'EFR Assessment Agreement Sent Date'),
        jsonb_build_object('name', 'opportunity_efr_assessment_agreement_received_date', 'label', 'EFR Assessment Agreement Received Date'),
        jsonb_build_object('name', 'opportunity_erf_assessment_scheduled_date', 'label', 'Erf Assessment Scheduled Date')
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
        jsonb_build_object('name', 'opportunity_efr_appliction_submitted_date', 'label', 'EFR Appliction Submitted Date'),
        jsonb_build_object('name', 'opportunity_efr_approved_date', 'label', 'EFR Approved Date')
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
        jsonb_build_object('name', 'opportunity_close_date', 'label', 'Close Date', 'required', true),
        jsonb_build_object('name', 'opportunity_probability', 'label', 'Probability'),
        jsonb_build_object('name', 'opportunity_created_by', 'label', 'Created By'),
        jsonb_build_object('name', 'opportunity_updated_by', 'label', 'Updated By')
      )), false
  );

-- Layout: TruTeam Illinois  →  RT picklist_value = TruTeam_Illinois
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'opportunities' AND picklist_field = 'record_type' AND picklist_value = 'TruTeam_Illinois' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'TruTeam Illinois', 'opportunities',
    'record_detail', true,
    'Imported from SF Layout: Opportunity-TruTeam Illinois',
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
        jsonb_build_object('name', 'opportunity_subdivision_name', 'label', 'Subdivision Name'),
        jsonb_build_object('name', 'opportunity_utility_program', 'label', 'Utility Program'),
        jsonb_build_object('name', 'opportunity_mfes_2023_hs_5_total_ee_project_cost', 'label', 'Mfes 2023 Hs 5 Total EE Project Cost'),
        jsonb_build_object('name', 'opportunity_ira_income_code', 'label', 'IRA Income Code'),
        jsonb_build_object('name', 'opportunity_record_type', 'label', 'Record Type'),
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
        jsonb_build_object('name', 'opportunity_account_id', 'label', 'Account ID')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Additional Information', 2, 'Details',
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
    layout_id, 4, 'System Information', 2, 'Details',
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
