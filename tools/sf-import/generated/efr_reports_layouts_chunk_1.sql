-- --- EFR_REPORTS layouts from SF -------------
-- 2 SF layouts found for Electrification_Feasibility_Report__c

DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN

-- Soft-delete the previous Standard efr_reports layout, if any
UPDATE public.page_layouts SET is_deleted = true, updated_at = now()
WHERE page_layout_object = 'efr_reports' AND is_deleted = false;

-- Layout: Electrification Feasibility Report Application  →  RT picklist_value = EFR_Application
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'efr_reports' AND picklist_field = 'record_type' AND picklist_value = 'EFR_Application' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Electrification Feasibility Report Application', 'efr_reports',
    'record_detail', true,
    'Imported from SF Layout: Electrification_Feasibility_Report__c-Electrification Feasibility Report Application',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'EFR Application Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'EFR Application Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'efr_opportunity', 'label', 'Opportunity', 'required', true),
        jsonb_build_object('name', 'efr_building', 'label', 'Building', 'required', true),
        jsonb_build_object('name', 'efr_assessment', 'label', 'Assessment'),
        jsonb_build_object('name', 'efr_efr_application_id', 'label', 'EFR Application ID'),
        jsonb_build_object('name', 'efr_next_step_notes', 'label', 'Next Step Notes'),
        jsonb_build_object('name', 'efr_status', 'label', 'Status'),
        jsonb_build_object('name', 'efr_efr_status_owner', 'label', 'EFR Status Owner')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'EFR Application Tracking', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'EFR Application Tracking', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_assessment_date', 'label', 'Assessment Date'),
        jsonb_build_object('name', 'efr_date_utility_usage_requested', 'label', 'Date Utility Usage Requested'),
        jsonb_build_object('name', 'efr_date_utility_usage_received', 'label', 'Date Utility Usage Received'),
        jsonb_build_object('name', 'efr_efr_appliction_submitted_date', 'label', 'EFR Appliction Submitted Date'),
        jsonb_build_object('name', 'efr_efr_change_or_question_submitted_date', 'label', 'EFR Change Or Question Submitted Date'),
        jsonb_build_object('name', 'efr_efr_application_pre_approval_date', 'label', 'EFR Application Pre Approval Date')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Application - Program Eligibility', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Application - Program Eligibility', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_building_in_the_city_county_of_denver', 'label', 'Building In The City County Of Denver'),
        jsonb_build_object('name', 'efr_building_is_not_owned_by_city_of_denver', 'label', 'Building Is Not Owned By City Of Denver'),
        jsonb_build_object('name', 'efr_building_owners_or_tenants_applying_are', 'label', 'Building Owners Or Tenants Applying Are'),
        jsonb_build_object('name', 'efr_building_is_an_existing_commercial_build', 'label', 'Building Is An Existing Commercial Build'),
        jsonb_build_object('name', 'efr_building_regulated_by_denver_bld_codes', 'label', 'Building Regulated By Denver Bld Codes'),
        jsonb_build_object('name', 'efr_equipment_not_part_of_a_major_rehab', 'label', 'Equipment Not Part Of A Major Rehab'),
        jsonb_build_object('name', 'efr_building_has_existing_gas_hvac', 'label', 'Building Has Existing Gas Hvac'),
        jsonb_build_object('name', 'efr_participant_commits_to_program_processes', 'label', 'Participant Commits To Program Processes'),
        jsonb_build_object('name', 'efr_how_did_you_hear_about_this_program', 'label', 'How Did You Hear About This Program')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Application - Building Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Application - Building Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_building_name_if_applicable', 'label', 'Building Name If Applicable'),
        jsonb_build_object('name', 'efr_building_address', 'label', 'Building Address'),
        jsonb_build_object('name', 'efr_this_building_is', 'label', 'This Building Is'),
        jsonb_build_object('name', 'efr_building_use_type', 'label', 'Building Use Type'),
        jsonb_build_object('name', 'efr_multifamily_of_units_in_building', 'label', 'Multifamily Of Units In Building'),
        jsonb_build_object('name', 'efr_what_type_of_multifamily_building', 'label', 'What Type Of Multifamily Building'),
        jsonb_build_object('name', 'efr_what_area_are_you_looking_to_replace', 'label', 'What Area Are You Looking To Replace'),
        jsonb_build_object('name', 'efr_building_square_footage_if_known', 'label', 'Building Square Footage If Known'),
        jsonb_build_object('name', 'efr_does_the_building_currently_have_ac', 'label', 'Does The Building Currently Have Ac'),
        jsonb_build_object('name', 'efr_primary_heating_fuel', 'label', 'Primary Heating Fuel')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Applicant Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Applicant Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_building_owner_name', 'label', 'Building Owner Name'),
        jsonb_build_object('name', 'efr_building_owner_office_phone', 'label', 'Building Owner Office Phone'),
        jsonb_build_object('name', 'efr_building_owner_email_address', 'label', 'Building Owner Email Address'),
        jsonb_build_object('name', 'efr_is_the_applicant_not_the_building_owner', 'label', 'Is The Applicant Not The Building Owner'),
        jsonb_build_object('name', 'efr_permission_to_apply_on_behalf_of_owner', 'label', 'Permission To Apply On Behalf Of Owner'),
        jsonb_build_object('name', 'efr_applicant_name', 'label', 'Applicant Name'),
        jsonb_build_object('name', 'efr_applicant_building_owner_office_phone', 'label', 'Applicant Building Owner Office Phone'),
        jsonb_build_object('name', 'efr_applicant_building_owner_email', 'label', 'Applicant Building Owner Email'),
        jsonb_build_object('name', 'efr_your_applicant_preference_for_contact', 'label', 'Your Applicant Preference For Contact'),
        jsonb_build_object('name', 'efr_language_prefered_for_contact', 'label', 'Language Prefered For Contact')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'Equity Priority Building', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Equity Priority Building', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_this_building_may_qualify_as', 'label', 'This Building May Qualify As'),
        jsonb_build_object('name', 'efr_is_the_rent_roll_attached', 'label', 'Is The Rent Roll Attached')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 7, 'Equipment Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Equipment Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_looking_to_replace_hvac_or_water_heating', 'label', 'Looking To Replace Hvac Or Water Heating'),
        jsonb_build_object('name', 'efr_equipment_to_be_replaced', 'label', 'Equipment To Be Replaced'),
        jsonb_build_object('name', 'efr_number_of_equipment_type_to_be_replacedc', 'label', 'Number Of Equipment Type To Be Replacedc'),
        jsonb_build_object('name', 'efr_year_of_exising_equipment_install', 'label', 'Year Of Exising Equipment Install'),
        jsonb_build_object('name', 'efr_details_on_equip_to_be_installed', 'label', 'Details On Equip To Be Installed'),
        jsonb_build_object('name', 'efr_dont_yet_know_what_to_install', 'label', 'Dont Yet Know What To Install'),
        jsonb_build_object('name', 'efr_how_soon_would_you_like_to_replace_equi', 'label', 'How Soon Would You Like To Replace Equi'),
        jsonb_build_object('name', 'efr_i_would_be_interested_in_assisting', 'label', 'I Would Be Interested In Assisting')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 8, 'Rebate Recipient Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Rebate Recipient Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_company_to_receive_equipment_rebate', 'label', 'Company To Receive Equipment Rebate'),
        jsonb_build_object('name', 'efr_contact_to_receive_equipment_rebate', 'label', 'Contact To Receive Equipment Rebate'),
        jsonb_build_object('name', 'efr_mailing_address_for_rebates', 'label', 'Mailing Address For Rebates'),
        jsonb_build_object('name', 'efr_mailing_address_attn_to_if_needed', 'label', 'Mailing Address Attn To If Needed')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 9, 'Program Terms & Conditions', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Program Terms & Conditions', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_applicant_title', 'label', 'Applicant Title'),
        jsonb_build_object('name', 'efr_applicant_signature', 'label', 'Applicant Signature')
      )), false
  );

-- Layout: Electrification Feasibility Report  →  RT picklist_value = EFR_Report
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'efr_reports' AND picklist_field = 'record_type' AND picklist_value = 'EFR_Report' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Electrification Feasibility Report', 'efr_reports',
    'record_detail', true,
    'Imported from SF Layout: Electrification_Feasibility_Report__c-Electrification Feasibility Report',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'EFR - Report Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'EFR - Report Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'efr_opportunity', 'label', 'Opportunity', 'required', true),
        jsonb_build_object('name', 'efr_building', 'label', 'Building', 'required', true),
        jsonb_build_object('name', 'efr_assessment', 'label', 'Assessment'),
        jsonb_build_object('name', 'efr_status', 'label', 'Status'),
        jsonb_build_object('name', 'efr_next_step_notes', 'label', 'Next Step Notes'),
        jsonb_build_object('name', 'efr_efr_status_owner', 'label', 'EFR Status Owner'),
        jsonb_build_object('name', 'efr_efr_application_id', 'label', 'EFR Application ID'),
        jsonb_build_object('name', 'efr_efr_report_id', 'label', 'EFR Report ID')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'EFR Report Tracking', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'EFR Report Tracking', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_assessment_date', 'label', 'Assessment Date'),
        jsonb_build_object('name', 'efr_efr_appliction_submitted_date', 'label', 'EFR Appliction Submitted Date'),
        jsonb_build_object('name', 'efr_date_utility_usage_requested', 'label', 'Date Utility Usage Requested'),
        jsonb_build_object('name', 'efr_date_utility_usage_received', 'label', 'Date Utility Usage Received'),
        jsonb_build_object('name', 'efr_efr_application_pre_approval_date', 'label', 'EFR Application Pre Approval Date'),
        jsonb_build_object('name', 'efr_efr_change_or_question_submitted_date', 'label', 'EFR Change Or Question Submitted Date'),
        jsonb_build_object('name', 'efr_efr_report_submitted_date', 'label', 'EFR Report Submitted Date'),
        jsonb_build_object('name', 'efr_efr_approved_date', 'label', 'EFR Approved Date'),
        jsonb_build_object('name', 'efr_efr_customer_report_delivery_date', 'label', 'EFR Customer Report Delivery Date'),
        jsonb_build_object('name', 'efr_efr_invoice_submitted_date', 'label', 'EFR Invoice Submitted Date'),
        jsonb_build_object('name', 'efr_efr_invoice_payment_received_date', 'label', 'EFR Invoice Payment Received Date'),
        jsonb_build_object('name', 'efr_days_since_efr_application_submittal', 'label', 'Days Since EFR Application Submittal'),
        jsonb_build_object('name', 'efr_days_from_submittal_to_pre_approval', 'label', 'Days From Submittal To Pre Approval'),
        jsonb_build_object('name', 'efr_days_since_efr_report_submittal', 'label', 'Days Since EFR Report Submittal')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Equipment to Replace (Existing Equip.)', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Equipment to Replace (Existing Equip.)', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_looking_to_replace_hvac_or_water_heating', 'label', 'Looking To Replace Hvac Or Water Heating'),
        jsonb_build_object('name', 'efr_equipment_to_be_replacd_formula', 'label', 'Equipment To Be Replacd Formula'),
        jsonb_build_object('name', 'efr_loads_served_by_boiler', 'label', 'Loads Served By Boiler'),
        jsonb_build_object('name', 'efr_does_the_boiler_have_hot_water_reset', 'label', 'Does The Boiler Have Hot Water Reset'),
        jsonb_build_object('name', 'efr_average_hot_water_temp', 'label', 'Average Hot Water Temp'),
        jsonb_build_object('name', 'efr_heating_fuel_cooling_only_equip', 'label', 'Heating Fuel Cooling Only Equip'),
        jsonb_build_object('name', 'efr_exisitng_equipment_afue', 'label', 'Exisitng Equipment Afue'),
        jsonb_build_object('name', 'efr_output_rated_heating_capacity_btuh', 'label', 'Output Rated Heating Capacity Btuh'),
        jsonb_build_object('name', 'efr_what_is_the_cooling_equipment', 'label', 'What Is The Cooling Equipment'),
        jsonb_build_object('name', 'efr_current_equipment_cooling_capacity_ton', 'label', 'Current Equipment Cooling Capacity Ton'),
        jsonb_build_object('name', 'efr_will_this_unit_be_replaced_w_multiple_hp', 'label', 'Will This Unit Be Replaced W Multiple Hp'),
        jsonb_build_object('name', 'efr_full_or_partial_electrification', 'label', 'Full Or Partial Electrification'),
        jsonb_build_object('name', 'efr_zone_served_name_of_existing_equip', 'label', 'Zone Served Name Of Existing Equip'),
        jsonb_build_object('name', 'efr_area_served_by_equipment_sq_ft', 'label', 'Area Served By Equipment Sq Ft'),
        jsonb_build_object('name', 'efr_existing_equio', 'label', 'Existing Equio')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Gas HVAC Replacement Details', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Gas HVAC Replacement Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_natural_gas_replacement_option_descript', 'label', 'Natural Gas Replacement Option Descript'),
        jsonb_build_object('name', 'efr_gas_system_model', 'label', 'Gas System Model'),
        jsonb_build_object('name', 'efr_gas_system_replacement_heating_capacity', 'label', 'Gas System Replacement Heating Capacity'),
        jsonb_build_object('name', 'efr_gas_system_replacement_heating_efficiency', 'label', 'Gas System Replacement Heating Efficiency'),
        jsonb_build_object('name', 'efr_gas_system_replacement_cooling_capacity', 'label', 'Gas System Replacement Cooling Capacity'),
        jsonb_build_object('name', 'efr_gas_system_replacement_cooling_efficiency', 'label', 'Gas System Replacement Cooling Efficiency'),
        jsonb_build_object('name', 'efr_gas_replacement_heating_input_capacity', 'label', 'Gas Replacement Heating Input Capacity')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Gas Replacement System Costs', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Gas Replacement System Costs', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_gas_system_cost_design', 'label', 'Gas System Cost Design'),
        jsonb_build_object('name', 'efr_gas_system_cost_permit', 'label', 'Gas System Cost Permit'),
        jsonb_build_object('name', 'efr_gas_system_cost_equipment', 'label', 'Gas System Cost Equipment'),
        jsonb_build_object('name', 'efr_gas_system_cost_install', 'label', 'Gas System Cost Install'),
        jsonb_build_object('name', 'efr_gas_system_cost_commissioning', 'label', 'Gas System Cost Commissioning'),
        jsonb_build_object('name', 'efr_gas_system_cost', 'label', 'Gas System Cost'),
        jsonb_build_object('name', 'efr_baseline_cost_heating_cooling_equip', 'label', 'Baseline Cost Heating Cooling Equip'),
        jsonb_build_object('name', 'efr_what_is_included_in_the_baseline_costs', 'label', 'What Is Included In The Baseline Costs'),
        jsonb_build_object('name', 'efr_gas_equipment_cost_input', 'label', 'Gas Equipment Cost Input')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'Heat Pump General Feasibility', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Heat Pump General Feasibility', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_is_electric_hp_option_with_ness_capacity', 'label', 'Is Electric Hp Option With Ness Capacity'),
        jsonb_build_object('name', 'efr_does_hp_option_fit_in_same_location', 'label', 'Does Hp Option Fit In Same Location'),
        jsonb_build_object('name', 'efr_possible_to_connect_the_existing_dw', 'label', 'Possible To Connect The Existing Dw'),
        jsonb_build_object('name', 'efr_necessary_electrical_infa_in_place', 'label', 'Necessary Electrical Infa In Place')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 7, 'Electric Equipment', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Electric Equipment', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_quantity_of_new_equipment', 'label', 'Quantity Of New Equipment'),
        jsonb_build_object('name', 'efr_proposed_electric_system', 'label', 'Proposed Electric System'),
        jsonb_build_object('name', 'efr_area_served_by_equipment_sqft_per_unit', 'label', 'Area Served By Equipment SqFt Per Unit')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 8, 'ASHP', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'ASHP', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_electric_replacement_option_description', 'label', 'Electric Replacement Option Description'),
        jsonb_build_object('name', 'efr_hp_ahri', 'label', 'Hp AHRI'),
        jsonb_build_object('name', 'efr_neep_or_ahri_cold_climate_certified', 'label', 'Neep Or AHRI Cold Climate Certified'),
        jsonb_build_object('name', 'efr_energy_star_label', 'label', 'Energy Star Label'),
        jsonb_build_object('name', 'efr_ducted_or_ductless_minisplit', 'label', 'Ducted Or Ductless Minisplit'),
        jsonb_build_object('name', 'efr_hp_heating_capacity_btuh', 'label', 'Hp Heating Capacity Btuh'),
        jsonb_build_object('name', 'efr_hp_heating_capacity_at_17_f_if_available', 'label', 'Hp Heating Capacity At 17 F If Available'),
        jsonb_build_object('name', 'efr_hp_cop', 'label', 'Hp Cop'),
        jsonb_build_object('name', 'efr_backup_heat_type', 'label', 'Backup Heat Type'),
        jsonb_build_object('name', 'efr_hp_backup_heating_capacity_btuh', 'label', 'Hp Backup Heating Capacity Btuh'),
        jsonb_build_object('name', 'efr_hp_hspf2', 'label', 'Hp Hspf2'),
        jsonb_build_object('name', 'efr_heat_pump_cop_at_47_f', 'label', 'Heat Pump Cop At 47 F'),
        jsonb_build_object('name', 'efr_hp_cop_at_17_f_if_available', 'label', 'Hp Cop At 17 F If Available'),
        jsonb_build_object('name', 'efr_hp_hspf', 'label', 'Hp Hspf'),
        jsonb_build_object('name', 'efr_hp_cooling_capacity_ton', 'label', 'Hp Cooling Capacity Ton'),
        jsonb_build_object('name', 'efr_hp_cooling_eer', 'label', 'Hp Cooling Eer'),
        jsonb_build_object('name', 'efr_heat_pump_cooling_eer2', 'label', 'Heat Pump Cooling Eer2'),
        jsonb_build_object('name', 'efr_hp_cooling_seer_ieer', 'label', 'Hp Cooling Seer Ieer'),
        jsonb_build_object('name', 'efr_heat_pump_cooling_seer2', 'label', 'Heat Pump Cooling Seer2'),
        jsonb_build_object('name', 'efr_estimated_changeover_temperature_f', 'label', 'Estimated Changeover Temperature F')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 9, 'Cost Info  - Per Peice of Equipment', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Cost Info  - Per Peice of Equipment', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_per_unit_design_cost', 'label', 'Per Unit Design Cost'),
        jsonb_build_object('name', 'efr_per_unit_permit_cost', 'label', 'Per Unit Permit Cost'),
        jsonb_build_object('name', 'efr_per_unit_equipment_cost', 'label', 'Per Unit Equipment Cost'),
        jsonb_build_object('name', 'efr_per_unit_install_cost', 'label', 'Per Unit Install Cost'),
        jsonb_build_object('name', 'efr_per_unit_commissioning_cost', 'label', 'Per Unit Commissioning Cost'),
        jsonb_build_object('name', 'efr_per_unit_infrastructure_upgrade_cost', 'label', 'Per Unit Infrastructure Upgrade Cost'),
        jsonb_build_object('name', 'efr_per_unit_ele_upgrade_cost_tier_1', 'label', 'Per Unit Ele Upgrade Cost Tier 1'),
        jsonb_build_object('name', 'efr_total_per_unit_cost', 'label', 'Total Per Unit Cost')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 10, 'Electric Replacement System Costs', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Electric Replacement System Costs', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_electric_system_cost_design', 'label', 'Electric System Cost Design'),
        jsonb_build_object('name', 'efr_electric_system_cost_permit', 'label', 'Electric System Cost Permit'),
        jsonb_build_object('name', 'efr_electric_system_cost_equipment', 'label', 'Electric System Cost Equipment'),
        jsonb_build_object('name', 'efr_electric_system_cost_install', 'label', 'Electric System Cost Install'),
        jsonb_build_object('name', 'efr_electric_system_cost_commissioning', 'label', 'Electric System Cost Commissioning'),
        jsonb_build_object('name', 'efr_infrastructure_electrical_upgrade_costs', 'label', 'Infrastructure Electrical Upgrade Costs'),
        jsonb_build_object('name', 'efr_ele_sys_cost_electrical_tier_1', 'label', 'Ele Sys Cost Electrical Tier 1'),
        jsonb_build_object('name', 'efr_ele_sys_cost_electrical_upgrade_tier', 'label', 'Ele Sys Cost Electrical Upgrade Tier'),
        jsonb_build_object('name', 'efr_ele_cost_electrical_upgrade_tier_3', 'label', 'Ele Cost Electrical Upgrade Tier 3'),
        jsonb_build_object('name', 'efr_electrical_upgrade_cost_other', 'label', 'Electrical Upgrade Cost Other'),
        jsonb_build_object('name', 'efr_total_electric_system_cost', 'label', 'Total Electric System Cost'),
        jsonb_build_object('name', 'efr_ncluded_heating', 'label', 'Ncluded Heating'),
        jsonb_build_object('name', 'efr_what_is_included_in_electrification_cost', 'label', 'What Is Included In Electrification Cost'),
        jsonb_build_object('name', 'efr_cost_of_new_electric_equipment', 'label', 'Cost Of New Electric Equipment')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 11, 'Utility Billing Details', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Utility Billing Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_gas_rate_structure', 'label', 'Gas Rate Structure'),
        jsonb_build_object('name', 'efr_electric_rate_structure', 'label', 'Electric Rate Structure')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 12, 'Contractors notes', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Contractors notes', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'efr_contractors_notes', 'label', 'Contractors Notes')
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
        jsonb_build_object('name', 'efr_overide_gas_equipment_cost_flow', 'label', 'Overide Gas Equipment Cost Flow'),
        jsonb_build_object('name', 'efr_override_ele_equipment_cost_flow', 'label', 'Override Ele Equipment Cost Flow')
      )), false
  );


END $$;
