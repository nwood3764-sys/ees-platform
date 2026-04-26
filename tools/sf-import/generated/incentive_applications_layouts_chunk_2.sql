DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN
-- Layout: WI-IRA-SF-HEAR  →  RT picklist_value = WI_IRA_SF_HEAR
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'incentive_applications' AND picklist_field = 'record_type' AND picklist_value = 'WI_IRA_SF_HEAR' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'WI-IRA-SF-HEAR', 'incentive_applications',
    'record_detail', true,
    'Imported from SF Layout: Incentive_Application__c-WI-IRA-SF-HEAR',
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
        jsonb_build_object('name', 'ia_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'ia_building_name', 'label', 'Building Name'),
        jsonb_build_object('name', 'ia_opportunity', 'label', 'Opportunity'),
        jsonb_build_object('name', 'ia_project_reservation_request_date', 'label', 'Project Reservation Request Date'),
        jsonb_build_object('name', 'ia_final_installation_payment_request_date', 'label', 'Final Installation Payment Request Date'),
        jsonb_build_object('name', 'ia_primary_contractor_business_name', 'label', 'Primary Contractor Business Name'),
        jsonb_build_object('name', 'ia_primary_contractor_contact_first_name', 'label', 'Primary Contractor Contact First Name'),
        jsonb_build_object('name', 'ia_primary_contractor_contact_last_name', 'label', 'Primary Contractor Contact Last Name'),
        jsonb_build_object('name', 'ia_primary_contractor_email', 'label', 'Primary Contractor Email'),
        jsonb_build_object('name', 'ia_primary_contractor_phone_number', 'label', 'Primary Contractor Phone Number'),
        jsonb_build_object('name', 'ia_primary_contractor_address_street', 'label', 'Primary Contractor Address Street'),
        jsonb_build_object('name', 'ia_primary_contractor_address_city', 'label', 'Primary Contractor Address City'),
        jsonb_build_object('name', 'ia_primary_contractor_address_state', 'label', 'Primary Contractor Address State'),
        jsonb_build_object('name', 'ia_primary_contractor_address_zip', 'label', 'Primary Contractor Address Zip'),
        jsonb_build_object('name', 'ia_business_entity_name', 'label', 'Business Entity Name'),
        jsonb_build_object('name', 'ia_business_entity_name_contact_name', 'label', 'Business Entity Name Contact Name'),
        jsonb_build_object('name', 'ia_business_entity_email', 'label', 'Business Entity Email'),
        jsonb_build_object('name', 'ia_building_owner_name_ira', 'label', 'Building Owner Name IRA'),
        jsonb_build_object('name', 'ia_installation_address_street', 'label', 'Installation Address Street'),
        jsonb_build_object('name', 'ia_installation_address_city', 'label', 'Installation Address City'),
        jsonb_build_object('name', 'ia_installation_address_state', 'label', 'Installation Address State'),
        jsonb_build_object('name', 'ia_installation_address_zip', 'label', 'Installation Address Zip'),
        jsonb_build_object('name', 'ia_total_number_of_units', 'label', 'Total Number Of Units'),
        jsonb_build_object('name', 'ia_total_number_of_occupied_units', 'label', 'Total Number Of Occupied Units'),
        jsonb_build_object('name', 'ia_total_building_square_footage', 'label', 'Total Building Square Footage'),
        jsonb_build_object('name', 'ia_total_floors_in_building', 'label', 'Total Floors In Building'),
        jsonb_build_object('name', 'ia_year_the_building_was_built', 'label', 'Year The Building Was Built'),
        jsonb_build_object('name', 'ia_income_qualified_confirmation_code', 'label', 'Income Qualified Confirmation Code'),
        jsonb_build_object('name', 'ia_total_project_cost', 'label', 'Total Project Cost'),
        jsonb_build_object('name', 'ia_electric_provider', 'label', 'Electric Provider'),
        jsonb_build_object('name', 'ia_electric_account_number', 'label', 'Electric Account Number'),
        jsonb_build_object('name', 'ia_how_is_this_building_heated', 'label', 'How Is This Building Heated'),
        jsonb_build_object('name', 'ia_natural_gas_provider', 'label', 'Natural Gas Provider'),
        jsonb_build_object('name', 'ia_natural_gas_account_number', 'label', 'Natural Gas Account Number'),
        jsonb_build_object('name', 'ia_other_heating_fuel_provider', 'label', 'Other Heating Fuel Provider'),
        jsonb_build_object('name', 'ia_other_account_number', 'label', 'Other Account Number'),
        jsonb_build_object('name', 'ia_total_ira_homes_rebate_requested', 'label', 'Total IRA Homes Rebate Requested'),
        jsonb_build_object('name', 'ia_total_ira_homes_cost', 'label', 'Total IRA Homes Cost'),
        jsonb_build_object('name', 'ia_modeled_savings_predicted', 'label', 'Modeled Savings Predicted'),
        jsonb_build_object('name', 'ia_estimated_completion_date', 'label', 'Estimated Completion Date'),
        jsonb_build_object('name', 'ia_tax_classification', 'label', 'Tax Classification'),
        jsonb_build_object('name', 'ia_tax_identification_fein', 'label', 'Tax Identification Fein'),
        jsonb_build_object('name', 'ia_project_reservation_received_date', 'label', 'Project Reservation Received Date'),
        jsonb_build_object('name', 'ia_project_reservation_processing_duration', 'label', 'Project Reservation Processing Duration'),
        jsonb_build_object('name', 'ia_total_project_payment_processing', 'label', 'Total Project Payment Processing'),
        jsonb_build_object('name', 'ia_total_project_program_duration', 'label', 'Total Project Program Duration'),
        jsonb_build_object('name', 'ia_stage', 'label', 'Stage')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Incentive Tracking', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Incentive Tracking', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_rebate_submitted_date', 'label', 'Rebate Submitted Date'),
        jsonb_build_object('name', 'ia_requested_amount', 'label', 'Requested Amount'),
        jsonb_build_object('name', 'ia_rebate_pre_approved_date', 'label', 'Rebate Pre Approved Date'),
        jsonb_build_object('name', 'ia_pre_approval_amount', 'label', 'Pre Approval Amount'),
        jsonb_build_object('name', 'ia_rebate_paid_date', 'label', 'Rebate Paid Date')
      )), false
  );

-- Layout: WI-IRA-SF-HOMES-AUDIT  →  RT picklist_value = WI_IRA_SF_HOMES_AUDIT
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'incentive_applications' AND picklist_field = 'record_type' AND picklist_value = 'WI_IRA_SF_HOMES_AUDIT' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'WI-IRA-SF-HOMES-AUDIT', 'incentive_applications',
    'record_detail', true,
    'Imported from SF Layout: Incentive_Application__c-WI-IRA-SF-HOMES-AUDIT',
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
        jsonb_build_object('name', 'ia_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'ia_building_name', 'label', 'Building Name'),
        jsonb_build_object('name', 'ia_opportunity', 'label', 'Opportunity'),
        jsonb_build_object('name', 'ia_assessment', 'label', 'Assessment'),
        jsonb_build_object('name', 'ia_final_installation_payment_request_date', 'label', 'Final Installation Payment Request Date'),
        jsonb_build_object('name', 'ia_primary_contractor_business_name', 'label', 'Primary Contractor Business Name'),
        jsonb_build_object('name', 'ia_primary_contractor_contact_first_name', 'label', 'Primary Contractor Contact First Name'),
        jsonb_build_object('name', 'ia_primary_contractor_contact_last_name', 'label', 'Primary Contractor Contact Last Name'),
        jsonb_build_object('name', 'ia_primary_contractor_email', 'label', 'Primary Contractor Email'),
        jsonb_build_object('name', 'ia_primary_contractor_phone_number', 'label', 'Primary Contractor Phone Number'),
        jsonb_build_object('name', 'ia_primary_contractor_address_street', 'label', 'Primary Contractor Address Street'),
        jsonb_build_object('name', 'ia_primary_contractor_address_city', 'label', 'Primary Contractor Address City'),
        jsonb_build_object('name', 'ia_primary_contractor_address_state', 'label', 'Primary Contractor Address State'),
        jsonb_build_object('name', 'ia_primary_contractor_address_zip', 'label', 'Primary Contractor Address Zip'),
        jsonb_build_object('name', 'ia_business_entity_name', 'label', 'Business Entity Name'),
        jsonb_build_object('name', 'ia_business_entity_name_contact_name', 'label', 'Business Entity Name Contact Name'),
        jsonb_build_object('name', 'ia_business_entity_email', 'label', 'Business Entity Email'),
        jsonb_build_object('name', 'ia_building_owner_name_ira', 'label', 'Building Owner Name IRA'),
        jsonb_build_object('name', 'ia_installation_address_street', 'label', 'Installation Address Street'),
        jsonb_build_object('name', 'ia_installation_address_city', 'label', 'Installation Address City'),
        jsonb_build_object('name', 'ia_installation_address_state', 'label', 'Installation Address State'),
        jsonb_build_object('name', 'ia_installation_address_zip', 'label', 'Installation Address Zip'),
        jsonb_build_object('name', 'ia_total_number_of_units', 'label', 'Total Number Of Units'),
        jsonb_build_object('name', 'ia_total_number_of_occupied_units', 'label', 'Total Number Of Occupied Units'),
        jsonb_build_object('name', 'ia_total_building_square_footage', 'label', 'Total Building Square Footage'),
        jsonb_build_object('name', 'ia_total_floors_in_building', 'label', 'Total Floors In Building'),
        jsonb_build_object('name', 'ia_year_the_building_was_built', 'label', 'Year The Building Was Built'),
        jsonb_build_object('name', 'ia_income_qualified_confirmation_code', 'label', 'Income Qualified Confirmation Code'),
        jsonb_build_object('name', 'ia_total_project_cost', 'label', 'Total Project Cost'),
        jsonb_build_object('name', 'ia_electric_provider', 'label', 'Electric Provider'),
        jsonb_build_object('name', 'ia_electric_account_number', 'label', 'Electric Account Number'),
        jsonb_build_object('name', 'ia_how_is_this_building_heated', 'label', 'How Is This Building Heated'),
        jsonb_build_object('name', 'ia_natural_gas_provider', 'label', 'Natural Gas Provider'),
        jsonb_build_object('name', 'ia_natural_gas_account_number', 'label', 'Natural Gas Account Number'),
        jsonb_build_object('name', 'ia_other_heating_fuel_provider', 'label', 'Other Heating Fuel Provider'),
        jsonb_build_object('name', 'ia_other_account_number', 'label', 'Other Account Number'),
        jsonb_build_object('name', 'ia_total_ira_homes_rebate_requested', 'label', 'Total IRA Homes Rebate Requested'),
        jsonb_build_object('name', 'ia_total_ira_homes_cost', 'label', 'Total IRA Homes Cost'),
        jsonb_build_object('name', 'ia_modeled_savings_predicted', 'label', 'Modeled Savings Predicted'),
        jsonb_build_object('name', 'ia_estimated_completion_date', 'label', 'Estimated Completion Date'),
        jsonb_build_object('name', 'ia_tax_classification', 'label', 'Tax Classification'),
        jsonb_build_object('name', 'ia_tax_identification_fein', 'label', 'Tax Identification Fein'),
        jsonb_build_object('name', 'ia_project_reservation_received_date', 'label', 'Project Reservation Received Date'),
        jsonb_build_object('name', 'ia_project_reservation_processing_duration', 'label', 'Project Reservation Processing Duration'),
        jsonb_build_object('name', 'ia_total_project_payment_processing', 'label', 'Total Project Payment Processing'),
        jsonb_build_object('name', 'ia_total_project_program_duration', 'label', 'Total Project Program Duration'),
        jsonb_build_object('name', 'ia_stage', 'label', 'Stage')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Incentive Tracking', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Incentive Tracking', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_rebate_pre_approved_date', 'label', 'Rebate Pre Approved Date'),
        jsonb_build_object('name', 'ia_pre_approval_amount', 'label', 'Pre Approval Amount'),
        jsonb_build_object('name', 'ia_rebate_submitted_date', 'label', 'Rebate Submitted Date'),
        jsonb_build_object('name', 'ia_requested_amount', 'label', 'Requested Amount'),
        jsonb_build_object('name', 'ia_rebate_paid_date', 'label', 'Rebate Paid Date')
      )), false
  );

-- Layout: WI-IRA-SF-HOMES  →  RT picklist_value = WI_IRA_SF_HOMES
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'incentive_applications' AND picklist_field = 'record_type' AND picklist_value = 'WI_IRA_SF_HOMES' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'WI-IRA-SF-HOMES', 'incentive_applications',
    'record_detail', true,
    'Imported from SF Layout: Incentive_Application__c-WI-IRA-SF-HOMES',
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
        jsonb_build_object('name', 'ia_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'ia_building_name', 'label', 'Building Name'),
        jsonb_build_object('name', 'ia_opportunity', 'label', 'Opportunity'),
        jsonb_build_object('name', 'ia_project_reservation_request_date', 'label', 'Project Reservation Request Date'),
        jsonb_build_object('name', 'ia_final_installation_payment_request_date', 'label', 'Final Installation Payment Request Date'),
        jsonb_build_object('name', 'ia_primary_contractor_business_name', 'label', 'Primary Contractor Business Name'),
        jsonb_build_object('name', 'ia_primary_contractor_contact_first_name', 'label', 'Primary Contractor Contact First Name'),
        jsonb_build_object('name', 'ia_primary_contractor_contact_last_name', 'label', 'Primary Contractor Contact Last Name'),
        jsonb_build_object('name', 'ia_primary_contractor_email', 'label', 'Primary Contractor Email'),
        jsonb_build_object('name', 'ia_primary_contractor_phone_number', 'label', 'Primary Contractor Phone Number'),
        jsonb_build_object('name', 'ia_primary_contractor_address_street', 'label', 'Primary Contractor Address Street'),
        jsonb_build_object('name', 'ia_primary_contractor_address_city', 'label', 'Primary Contractor Address City'),
        jsonb_build_object('name', 'ia_primary_contractor_address_state', 'label', 'Primary Contractor Address State'),
        jsonb_build_object('name', 'ia_primary_contractor_address_zip', 'label', 'Primary Contractor Address Zip'),
        jsonb_build_object('name', 'ia_business_entity_name', 'label', 'Business Entity Name'),
        jsonb_build_object('name', 'ia_business_entity_name_contact_name', 'label', 'Business Entity Name Contact Name'),
        jsonb_build_object('name', 'ia_business_entity_email', 'label', 'Business Entity Email'),
        jsonb_build_object('name', 'ia_building_owner_name_ira', 'label', 'Building Owner Name IRA'),
        jsonb_build_object('name', 'ia_installation_address_street', 'label', 'Installation Address Street'),
        jsonb_build_object('name', 'ia_installation_address_city', 'label', 'Installation Address City'),
        jsonb_build_object('name', 'ia_installation_address_state', 'label', 'Installation Address State'),
        jsonb_build_object('name', 'ia_installation_address_zip', 'label', 'Installation Address Zip'),
        jsonb_build_object('name', 'ia_total_number_of_units', 'label', 'Total Number Of Units'),
        jsonb_build_object('name', 'ia_total_number_of_occupied_units', 'label', 'Total Number Of Occupied Units'),
        jsonb_build_object('name', 'ia_total_building_square_footage', 'label', 'Total Building Square Footage'),
        jsonb_build_object('name', 'ia_total_floors_in_building', 'label', 'Total Floors In Building'),
        jsonb_build_object('name', 'ia_year_the_building_was_built', 'label', 'Year The Building Was Built'),
        jsonb_build_object('name', 'ia_income_qualified_confirmation_code', 'label', 'Income Qualified Confirmation Code'),
        jsonb_build_object('name', 'ia_total_project_cost', 'label', 'Total Project Cost'),
        jsonb_build_object('name', 'ia_electric_provider', 'label', 'Electric Provider'),
        jsonb_build_object('name', 'ia_electric_account_number', 'label', 'Electric Account Number'),
        jsonb_build_object('name', 'ia_how_is_this_building_heated', 'label', 'How Is This Building Heated'),
        jsonb_build_object('name', 'ia_natural_gas_provider', 'label', 'Natural Gas Provider'),
        jsonb_build_object('name', 'ia_natural_gas_account_number', 'label', 'Natural Gas Account Number'),
        jsonb_build_object('name', 'ia_other_heating_fuel_provider', 'label', 'Other Heating Fuel Provider'),
        jsonb_build_object('name', 'ia_other_account_number', 'label', 'Other Account Number'),
        jsonb_build_object('name', 'ia_total_ira_homes_rebate_requested', 'label', 'Total IRA Homes Rebate Requested'),
        jsonb_build_object('name', 'ia_total_ira_homes_cost', 'label', 'Total IRA Homes Cost'),
        jsonb_build_object('name', 'ia_modeled_savings_predicted', 'label', 'Modeled Savings Predicted'),
        jsonb_build_object('name', 'ia_estimated_completion_date', 'label', 'Estimated Completion Date'),
        jsonb_build_object('name', 'ia_tax_classification', 'label', 'Tax Classification'),
        jsonb_build_object('name', 'ia_tax_identification_fein', 'label', 'Tax Identification Fein'),
        jsonb_build_object('name', 'ia_project_reservation_received_date', 'label', 'Project Reservation Received Date'),
        jsonb_build_object('name', 'ia_project_reservation_processing_duration', 'label', 'Project Reservation Processing Duration'),
        jsonb_build_object('name', 'ia_total_project_payment_processing', 'label', 'Total Project Payment Processing'),
        jsonb_build_object('name', 'ia_total_project_program_duration', 'label', 'Total Project Program Duration'),
        jsonb_build_object('name', 'ia_stage', 'label', 'Stage')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Incentive Tracking', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Incentive Tracking', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_rebate_submitted_date', 'label', 'Rebate Submitted Date'),
        jsonb_build_object('name', 'ia_requested_amount', 'label', 'Requested Amount'),
        jsonb_build_object('name', 'ia_rebate_pre_approved_date', 'label', 'Rebate Pre Approved Date'),
        jsonb_build_object('name', 'ia_pre_approval_amount', 'label', 'Pre Approval Amount'),
        jsonb_build_object('name', 'ia_quick_base_record_id', 'label', 'Quick Base Record ID'),
        jsonb_build_object('name', 'ia_rebate_paid_date', 'label', 'Rebate Paid Date')
      )), false
  );


END $$;
