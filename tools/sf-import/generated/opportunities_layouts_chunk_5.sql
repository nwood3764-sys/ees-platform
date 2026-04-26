DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN
-- Layout: WI-IRA-FOE-SF-HOMES  →  RT picklist_value = WI_IRA_FOE_SF_HOMES
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'opportunities' AND picklist_field = 'record_type' AND picklist_value = 'WI_IRA_FOE_SF_HOMES' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'WI-IRA-FOE-SF-HOMES', 'opportunities',
    'record_detail', true,
    'Imported from SF Layout: Opportunity-WI-IRA-FOE-SF-HOMES',
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
        jsonb_build_object('name', 'opportunity_income_qualified_confirmation_code', 'label', 'Income Qualified Confirmation Code'),
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
    layout_id, 5, 'Utility Usage', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Utility Usage', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_utility_usage_authorization_received', 'label', 'Utility Usage Authorization Received'),
        jsonb_build_object('name', 'opportunity_date_utility_usage_requested', 'label', 'Date Utility Usage Requested'),
        jsonb_build_object('name', 'opportunity_date_utility_usage_received', 'label', 'Date Utility Usage Received')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'Income Qualification', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Income Qualification', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_income_qualification_submitted', 'label', 'Income Qualification Submitted'),
        jsonb_build_object('name', 'opportunity_income_qualification_approved', 'label', 'Income Qualification Approved'),
        jsonb_build_object('name', 'opportunity_ira_income_code', 'label', 'IRA Income Code')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 7, 'Project Qualification', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Qualification', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_homes_application_submitted', 'label', 'Homes Application Submitted'),
        jsonb_build_object('name', 'opportunity_homes_application_approved', 'label', 'Homes Application Approved')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 8, 'Project Approval', 2, 'Details',
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
    layout_id, 9, 'Project Planning', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Planning', 1, 1, 'medium',
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
    layout_id, 10, 'Project Implementation', 2, 'Details',
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
    layout_id, 11, 'Accounting Information', 2, 'Details',
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
        jsonb_build_object('name', 'opportunity_utility_program', 'label', 'Utility Program'),
        jsonb_build_object('name', 'opportunity_external_reference_number', 'label', 'External Reference Number'),
        jsonb_build_object('name', 'opportunity_incentive_processing_time', 'label', 'Incentive Processing Time')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 12, 'Additional Information', 2, 'Details',
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
    layout_id, 13, 'System Information', 2, 'Details',
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

-- Layout: WI-IRA-HEAR  →  RT picklist_value = WI_IRA_HEAR
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'opportunities' AND picklist_field = 'record_type' AND picklist_value = 'WI_IRA_HEAR' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'WI-IRA-HEAR', 'opportunities',
    'record_detail', true,
    'Imported from SF Layout: Opportunity-WI-IRA-HEAR',
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
        jsonb_build_object('name', 'opportunity_docu_sign_envelope_recipient', 'label', 'Docu Sign Envelope Recipient'),
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
    layout_id, 5, 'Qualification Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Qualification Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_income_qualification_submitted', 'label', 'Income Qualification Submitted'),
        jsonb_build_object('name', 'opportunity_income_qualification_approved', 'label', 'Income Qualification Approved'),
        jsonb_build_object('name', 'opportunity_homes_application_submitted', 'label', 'Homes Application Submitted'),
        jsonb_build_object('name', 'opportunity_homes_application_approved', 'label', 'Homes Application Approved')
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
        jsonb_build_object('name', 'opportunity_project_utility_approval_sent_to_pc', 'label', 'Project Utility Approval Sent To Pc'),
        jsonb_build_object('name', 'opportunity_project_utility_approval_obtained_date', 'label', 'Project Utility Approval Obtained Date'),
        jsonb_build_object('name', 'opportunity_project_utility_approval_processing_time', 'label', 'Project Utility Approval Processing Time')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 7, 'Project Planning Information', 2, 'Details',
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
    layout_id, 8, 'Project Implementation', 2, 'Details',
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
    layout_id, 9, 'Accounting Information', 2, 'Details',
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

-- Layout: WI-IRA-HOMES  →  RT picklist_value = WI_IRA_HOMES
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'opportunities' AND picklist_field = 'record_type' AND picklist_value = 'WI_IRA_HOMES' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'WI-IRA-HOMES', 'opportunities',
    'record_detail', true,
    'Imported from SF Layout: Opportunity-WI-IRA-HOMES',
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
    layout_id, 5, 'Utility Usage', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Utility Usage', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_utility_usage_authorization_received', 'label', 'Utility Usage Authorization Received'),
        jsonb_build_object('name', 'opportunity_date_utility_usage_requested', 'label', 'Date Utility Usage Requested'),
        jsonb_build_object('name', 'opportunity_date_utility_usage_received', 'label', 'Date Utility Usage Received')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'Income Qualification', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Income Qualification', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_income_qualification_submitted', 'label', 'Income Qualification Submitted'),
        jsonb_build_object('name', 'opportunity_income_qualification_approved', 'label', 'Income Qualification Approved'),
        jsonb_build_object('name', 'opportunity_ira_income_code', 'label', 'IRA Income Code')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 7, 'Project Qualification', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Qualification', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'opportunity_homes_application_submitted', 'label', 'Homes Application Submitted'),
        jsonb_build_object('name', 'opportunity_homes_application_approved', 'label', 'Homes Application Approved')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 8, 'Project Planning', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Planning', 1, 1, 'medium',
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
    layout_id, 9, 'Project Approval', 2, 'Details',
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
    layout_id, 10, 'Project Implementation', 2, 'Details',
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
    layout_id, 11, 'Accounting Information', 2, 'Details',
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
        jsonb_build_object('name', 'opportunity_utility_program', 'label', 'Utility Program'),
        jsonb_build_object('name', 'opportunity_external_reference_number', 'label', 'External Reference Number'),
        jsonb_build_object('name', 'opportunity_incentive_processing_time', 'label', 'Incentive Processing Time')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 12, 'Additional Information', 2, 'Details',
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
    layout_id, 13, 'System Information', 2, 'Details',
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
