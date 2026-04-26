-- --- INCENTIVE_APPLICATIONS layouts from SF -------------
-- 9 SF layouts found for Incentive_Application__c

DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN

-- Soft-delete the previous Standard incentive_applications layout, if any
UPDATE public.page_layouts SET is_deleted = true, updated_at = now()
WHERE page_layout_object = 'incentive_applications' AND is_deleted = false;

-- Layout: Electrify Denver  →  RT picklist_value = Electrify_Denver
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'incentive_applications' AND picklist_field = 'record_type' AND picklist_value = 'Electrify_Denver' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Electrify Denver', 'incentive_applications',
    'record_detail', true,
    'Imported from SF Layout: Incentive_Application__c-Electrify Denver',
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
        jsonb_build_object('name', 'ia_opportunity', 'label', 'Opportunity'),
        jsonb_build_object('name', 'ia_assessment', 'label', 'Assessment'),
        jsonb_build_object('name', 'ia_stage', 'label', 'Stage'),
        jsonb_build_object('name', 'ia_owner', 'label', 'Owner')
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
        jsonb_build_object('name', 'ia_quick_base_record_id', 'label', 'Quick Base Record ID')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Application - Building Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Application - Building Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_building_name', 'label', 'Building Name'),
        jsonb_build_object('name', 'ia_was_an_efr_completed', 'label', 'Was An EFR Completed'),
        jsonb_build_object('name', 'ia_this_building_is', 'label', 'This Building Is'),
        jsonb_build_object('name', 'ia_building_use_type', 'label', 'Building Use Type'),
        jsonb_build_object('name', 'ia_multifamily_of_units_in_building', 'label', 'Multifamily Of Units In Building'),
        jsonb_build_object('name', 'ia_what_type_of_multifamily_building_is_thi', 'label', 'What Type Of Multifamily Building Is Thi'),
        jsonb_build_object('name', 'ia_what_area_does_the_equipment_you_are_loo', 'label', 'What Area Does The Equipment You Are Loo'),
        jsonb_build_object('name', 'ia_are_you_the_owner_and_occupant', 'label', 'Are You The Owner And Occupant'),
        jsonb_build_object('name', 'ia_building_square_footage', 'label', 'Building Square Footage'),
        jsonb_build_object('name', 'ia_does_the_building_currently_have_some_fo', 'label', 'Does The Building Currently Have Some Fo'),
        jsonb_build_object('name', 'ia_is_thr_primary_heating_gas_or_ele', 'label', 'Is Thr Primary Heating Gas Or Ele'),
        jsonb_build_object('name', 'ia_equipment_rebate_application_form', 'label', 'Equipment Rebate Application Form')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Applicant Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Applicant Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_building_owner_name', 'label', 'Building Owner Name'),
        jsonb_build_object('name', 'ia_building_owner_office_phone', 'label', 'Building Owner Office Phone'),
        jsonb_build_object('name', 'ia_building_owner_mobile_phone', 'label', 'Building Owner Mobile Phone'),
        jsonb_build_object('name', 'ia_building_owner_email_address', 'label', 'Building Owner Email Address'),
        jsonb_build_object('name', 'ia_is_the_applicant_someone_other_than_the', 'label', 'Is The Applicant Someone Other Than The'),
        jsonb_build_object('name', 'ia_applicant_name', 'label', 'Applicant Name'),
        jsonb_build_object('name', 'ia_applicant_building_owner_office_phone', 'label', 'Applicant Building Owner Office Phone'),
        jsonb_build_object('name', 'ia_applicant_building_owner_email', 'label', 'Applicant Building Owner Email'),
        jsonb_build_object('name', 'ia_how_do_you_applicant_prefer_to_be_cont', 'label', 'How Do You Applicant Prefer To Be Cont'),
        jsonb_build_object('name', 'ia_in_what_language_do_you_prefer_to_be_con', 'label', 'In What Language Do You Prefer To Be Con')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Equity Priority Building', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Equity Priority Building', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_this_building_may_qualify_as_the_followi', 'label', 'This Building May Qualify As The Followi')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'Affordable Apartment Buildings', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Affordable Apartment Buildings', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_rent_roll_attached', 'label', 'Rent Roll Attached')
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
        jsonb_build_object('name', 'ia_existing_equipment_fuel_source', 'label', 'Existing Equipment Fuel Source'),
        jsonb_build_object('name', 'ia_select_all_that_apply', 'label', 'Select All That Apply'),
        jsonb_build_object('name', 'ia_heating_systems_to_be_replaced', 'label', 'Heating Systems To Be Replaced'),
        jsonb_build_object('name', 'ia_approximate_age_of_existing_equipment', 'label', 'Approximate Age Of Existing Equipment'),
        jsonb_build_object('name', 'ia_type_of_new_equipment', 'label', 'Type Of New Equipment'),
        jsonb_build_object('name', 'ia_mini_split_efficiency_category', 'label', 'Mini Split Efficiency Category'),
        jsonb_build_object('name', 'ia_how_many_new_non_ducted_mini_multi_spl', 'label', 'How Many New Non Ducted Mini Multi Spl'),
        jsonb_build_object('name', 'ia_provide_additional_detail', 'label', 'Provide Additional Detail'),
        jsonb_build_object('name', 'ia_how_soon_would_you_like_to_replace_this', 'label', 'How Soon Would You Like To Replace This'),
        jsonb_build_object('name', 'ia_equipment_spec_sheets_attached', 'label', 'Equipment Spec Sheets Attached'),
        jsonb_build_object('name', 'ia_bid_document_attached', 'label', 'Bid Document Attached'),
        jsonb_build_object('name', 'ia_ahri_and_neep_certification_attached', 'label', 'AHRI And Neep Certification Attached'),
        jsonb_build_object('name', 'ia_product', 'label', 'Product'),
        jsonb_build_object('name', 'ia_water_heating_systems_to_be_replaced', 'label', 'Water Heating Systems To Be Replaced'),
        jsonb_build_object('name', 'ia_is_the_water_heater_location_cooled', 'label', 'Is The Water Heater Location Cooled'),
        jsonb_build_object('name', 'ia_is_the_area_where_the_water_heater_is_lo', 'label', 'Is The Area Where The Water Heater Is Lo')
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
        jsonb_build_object('name', 'ia_who_is_the_recipient_of_the_rebate', 'label', 'Who Is The Recipient Of The Rebate'),
        jsonb_build_object('name', 'ia_company_to_receive_equipment_rebate', 'label', 'Company To Receive Equipment Rebate'),
        jsonb_build_object('name', 'ia_mailing_address_for_rebates', 'label', 'Mailing Address For Rebates')
      )), false
  );

-- Layout: Incentive Application Layout  →  RT picklist_value = (default fallback)
  rt_id := NULL;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Incentive Application Layout', 'incentive_applications',
    'record_detail', true,
    'Imported from SF Layout: Incentive_Application__c-Incentive Application Layout',
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
        jsonb_build_object('name', 'ia_final_installation_payment_request_date', 'label', 'Final Installation Payment Request Date'),
        jsonb_build_object('name', 'ia_stage', 'label', 'Stage'),
        jsonb_build_object('name', 'ia_owner', 'label', 'Owner')
      )), false
  );

-- Layout: WI-FOE  →  RT picklist_value = WI_FOE
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'incentive_applications' AND picklist_field = 'record_type' AND picklist_value = 'WI_FOE' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'WI-FOE', 'incentive_applications',
    'record_detail', true,
    'Imported from SF Layout: Incentive_Application__c-WI-FOE',
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
        jsonb_build_object('name', 'ia_primary_contractor_business_name', 'label', 'Primary Contractor Business Name'),
        jsonb_build_object('name', 'ia_primary_contractor_contact_first_name', 'label', 'Primary Contractor Contact First Name'),
        jsonb_build_object('name', 'ia_primary_contractor_contact_last_name', 'label', 'Primary Contractor Contact Last Name'),
        jsonb_build_object('name', 'ia_primary_contractor_email', 'label', 'Primary Contractor Email'),
        jsonb_build_object('name', 'ia_stage', 'label', 'Stage'),
        jsonb_build_object('name', 'ia_owner', 'label', 'Owner')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Project Reservation', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Reservation', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_project_reservation_request_date', 'label', 'Project Reservation Request Date'),
        jsonb_build_object('name', 'ia_project_reservation_received_date', 'label', 'Project Reservation Received Date'),
        jsonb_build_object('name', 'ia_requested_amount', 'label', 'Requested Amount'),
        jsonb_build_object('name', 'ia_pre_approval_amount', 'label', 'Pre Approval Amount'),
        jsonb_build_object('name', 'ia_project_reservation_processing_duration', 'label', 'Project Reservation Processing Duration')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Incentive Tracking', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Incentive Tracking', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_final_installation_payment_request_date', 'label', 'Final Installation Payment Request Date'),
        jsonb_build_object('name', 'ia_rebate_paid_date', 'label', 'Rebate Paid Date'),
        jsonb_build_object('name', 'ia_rebate_amount', 'label', 'Rebate Amount'),
        jsonb_build_object('name', 'ia_total_project_payment_processing', 'label', 'Total Project Payment Processing'),
        jsonb_build_object('name', 'ia_total_project_program_duration', 'label', 'Total Project Program Duration')
      )), false
  );

-- Layout: WI-IRA-MF-HEAR  →  RT picklist_value = WI_IRA_MF_HEAR
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'incentive_applications' AND picklist_field = 'record_type' AND picklist_value = 'WI_IRA_MF_HEAR' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'WI-IRA-MF-HEAR', 'incentive_applications',
    'record_detail', true,
    'Imported from SF Layout: Incentive_Application__c-WI-IRA-MF-HEAR',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Primary Contractor Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Primary Contractor Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_total_project_payment_processing', 'label', 'Total Project Payment Processing'),
        jsonb_build_object('name', 'ia_total_project_program_duration', 'label', 'Total Project Program Duration')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Information', 2, 'Details',
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
        jsonb_build_object('name', 'ia_stage', 'label', 'Stage'),
        jsonb_build_object('name', 'ia_stage_notes', 'label', 'Stage Notes')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Installation Building Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Installation Building Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_primary_contractor_business_name', 'label', 'Primary Contractor Business Name'),
        jsonb_build_object('name', 'ia_primary_contractor_contact_first_name', 'label', 'Primary Contractor Contact First Name'),
        jsonb_build_object('name', 'ia_primary_contractor_contact_last_name', 'label', 'Primary Contractor Contact Last Name'),
        jsonb_build_object('name', 'ia_primary_contractor_email', 'label', 'Primary Contractor Email'),
        jsonb_build_object('name', 'ia_primary_contractor_phone_number', 'label', 'Primary Contractor Phone Number'),
        jsonb_build_object('name', 'ia_primary_contractor_address_street', 'label', 'Primary Contractor Address Street'),
        jsonb_build_object('name', 'ia_primary_contractor_address_city', 'label', 'Primary Contractor Address City'),
        jsonb_build_object('name', 'ia_primary_contractor_address_state', 'label', 'Primary Contractor Address State'),
        jsonb_build_object('name', 'ia_primary_contractor_address_zip', 'label', 'Primary Contractor Address Zip')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Installation Building Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Installation Building Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_business_entity_name', 'label', 'Business Entity Name'),
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
        jsonb_build_object('name', 'ia_business_entity_name_contact_name', 'label', 'Business Entity Name Contact Name'),
        jsonb_build_object('name', 'ia_business_entity_phone_number', 'label', 'Business Entity Phone Number')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Utility Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Utility Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_electric_provider', 'label', 'Electric Provider'),
        jsonb_build_object('name', 'ia_how_is_this_building_heated', 'label', 'How Is This Building Heated'),
        jsonb_build_object('name', 'ia_natural_gas_provider', 'label', 'Natural Gas Provider'),
        jsonb_build_object('name', 'ia_other_heating_fuel_provider', 'label', 'Other Heating Fuel Provider'),
        jsonb_build_object('name', 'ia_electric_account_number', 'label', 'Electric Account Number'),
        jsonb_build_object('name', 'ia_natural_gas_account_number', 'label', 'Natural Gas Account Number'),
        jsonb_build_object('name', 'ia_other_account_number', 'label', 'Other Account Number')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'Building Improvements', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Building Improvements', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_total_project_cost', 'label', 'Total Project Cost'),
        jsonb_build_object('name', 'ia_estimated_completion_date', 'label', 'Estimated Completion Date')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 7, 'Payment Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Payment Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_tax_classification', 'label', 'Tax Classification'),
        jsonb_build_object('name', 'ia_tax_identification_fein', 'label', 'Tax Identification Fein')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 8, 'Project Reservation Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Reservation Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_project_reservation_request_date', 'label', 'Project Reservation Request Date'),
        jsonb_build_object('name', 'ia_requested_amount', 'label', 'Requested Amount'),
        jsonb_build_object('name', 'ia_project_reservation_received_date', 'label', 'Project Reservation Received Date'),
        jsonb_build_object('name', 'ia_project_reservation_processing_duration', 'label', 'Project Reservation Processing Duration')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 9, 'Incentive Processing', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Incentive Processing', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_final_installation_payment_request_date', 'label', 'Final Installation Payment Request Date'),
        jsonb_build_object('name', 'ia_rebate_paid_date', 'label', 'Rebate Paid Date'),
        jsonb_build_object('name', 'ia_rebate_amount', 'label', 'Rebate Amount')
      )), false
  );

-- Layout: WI-IRA-MF-HOMES-AUDIT  →  RT picklist_value = WI_IRA_MF_HOMES_AUDIT
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'incentive_applications' AND picklist_field = 'record_type' AND picklist_value = 'WI_IRA_MF_HOMES_AUDIT' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'WI-IRA-MF-HOMES-AUDIT', 'incentive_applications',
    'record_detail', true,
    'Imported from SF Layout: Incentive_Application__c-WI-IRA-MF-HOMES-AUDIT',
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
        jsonb_build_object('name', 'ia_assessment', 'label', 'Assessment'),
        jsonb_build_object('name', 'ia_building_name', 'label', 'Building Name'),
        jsonb_build_object('name', 'ia_opportunity', 'label', 'Opportunity'),
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

-- Layout: WI-IRA-MF-HOMES  →  RT picklist_value = WI_IRA_MF_HOMES
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'incentive_applications' AND picklist_field = 'record_type' AND picklist_value = 'WI_IRA_MF_HOMES' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'WI-IRA-MF-HOMES', 'incentive_applications',
    'record_detail', true,
    'Imported from SF Layout: Incentive_Application__c-WI-IRA-MF-HOMES',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Incentive Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Incentive Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'ia_building_name', 'label', 'Building Name'),
        jsonb_build_object('name', 'ia_opportunity', 'label', 'Opportunity'),
        jsonb_build_object('name', 'ia_stage', 'label', 'Stage')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Primary Contractor Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Primary Contractor Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_primary_contractor_business_name', 'label', 'Primary Contractor Business Name'),
        jsonb_build_object('name', 'ia_primary_contractor_email', 'label', 'Primary Contractor Email'),
        jsonb_build_object('name', 'ia_primary_contractor_address_street', 'label', 'Primary Contractor Address Street'),
        jsonb_build_object('name', 'ia_primary_contractor_address_city', 'label', 'Primary Contractor Address City'),
        jsonb_build_object('name', 'ia_primary_contractor_address_zip', 'label', 'Primary Contractor Address Zip'),
        jsonb_build_object('name', 'ia_primary_contractor_contact_first_name', 'label', 'Primary Contractor Contact First Name'),
        jsonb_build_object('name', 'ia_primary_contractor_contact_last_name', 'label', 'Primary Contractor Contact Last Name'),
        jsonb_build_object('name', 'ia_primary_contractor_phone_number', 'label', 'Primary Contractor Phone Number'),
        jsonb_build_object('name', 'ia_primary_contractor_address_state', 'label', 'Primary Contractor Address State')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Installation Building Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Installation Building Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_business_entity_name', 'label', 'Business Entity Name'),
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
        jsonb_build_object('name', 'ia_business_entity_name_contact_name', 'label', 'Business Entity Name Contact Name'),
        jsonb_build_object('name', 'ia_business_entity_phone_number', 'label', 'Business Entity Phone Number')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Utility Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Utility Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_electric_provider', 'label', 'Electric Provider'),
        jsonb_build_object('name', 'ia_how_is_this_building_heated', 'label', 'How Is This Building Heated'),
        jsonb_build_object('name', 'ia_natural_gas_provider', 'label', 'Natural Gas Provider'),
        jsonb_build_object('name', 'ia_other_heating_fuel_provider', 'label', 'Other Heating Fuel Provider'),
        jsonb_build_object('name', 'ia_electric_account_number', 'label', 'Electric Account Number'),
        jsonb_build_object('name', 'ia_natural_gas_account_number', 'label', 'Natural Gas Account Number'),
        jsonb_build_object('name', 'ia_other_account_number', 'label', 'Other Account Number')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Building Improvements', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Building Improvements', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_total_ira_homes_rebate_requested', 'label', 'Total IRA Homes Rebate Requested'),
        jsonb_build_object('name', 'ia_modeled_savings_predicted', 'label', 'Modeled Savings Predicted'),
        jsonb_build_object('name', 'ia_total_project_cost', 'label', 'Total Project Cost'),
        jsonb_build_object('name', 'ia_total_ira_homes_cost', 'label', 'Total IRA Homes Cost'),
        jsonb_build_object('name', 'ia_estimated_completion_date', 'label', 'Estimated Completion Date')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'Payment Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Payment Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_tax_classification', 'label', 'Tax Classification'),
        jsonb_build_object('name', 'ia_tax_identification_fein', 'label', 'Tax Identification Fein')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 7, 'Project Reservation Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Project Reservation Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_project_reservation_request_date', 'label', 'Project Reservation Request Date'),
        jsonb_build_object('name', 'ia_requested_amount', 'label', 'Requested Amount'),
        jsonb_build_object('name', 'ia_project_reservation_received_date', 'label', 'Project Reservation Received Date'),
        jsonb_build_object('name', 'ia_project_reservation_processing_duration', 'label', 'Project Reservation Processing Duration')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 8, 'Incentive Processing', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Incentive Processing', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_final_installation_payment_request_date', 'label', 'Final Installation Payment Request Date'),
        jsonb_build_object('name', 'ia_rebate_amount', 'label', 'Rebate Amount'),
        jsonb_build_object('name', 'ia_rebate_paid_date', 'label', 'Rebate Paid Date'),
        jsonb_build_object('name', 'ia_total_project_payment_processing', 'label', 'Total Project Payment Processing')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 9, 'IRA Program Processing Duration', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'IRA Program Processing Duration', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ia_total_project_program_duration', 'label', 'Total Project Program Duration')
      )), false
  );


END $$;
