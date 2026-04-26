DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN
-- Layout: Nicor IQ Assessment  →  RT picklist_value = Nicor_IQ_Assessment
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'assessments' AND picklist_field = 'record_type' AND picklist_value = 'Nicor_IQ_Assessment' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Nicor IQ Assessment', 'assessments',
    'record_detail', true,
    'Imported from SF Layout: Assessment__c-Nicor IQ Assessment',
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
        jsonb_build_object('name', 'assessment_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'assessment_opportunity', 'label', 'Opportunity', 'required', true),
        jsonb_build_object('name', 'property_id', 'label', 'Property ID'),
        jsonb_build_object('name', 'assessment_property_contact_for_iq_assessment', 'label', 'Property Contact For Iq Assessment'),
        jsonb_build_object('name', 'assessment_project', 'label', 'Project'),
        jsonb_build_object('name', 'assessment_sharin_pix_album', 'label', 'Sharin Pix Album'),
        jsonb_build_object('name', 'assessment_gas_fuel_provider', 'label', 'Gas Fuel Provider'),
        jsonb_build_object('name', 'assessment_matterport_url', 'label', 'Matterport Url'),
        jsonb_build_object('name', 'assessment_electric_replacement_option_description', 'label', 'Electric Replacement Option Description'),
        jsonb_build_object('name', 'assessment_estimated_changeover_temperature_f', 'label', 'Estimated Changeover Temperature F'),
        jsonb_build_object('name', 'assessment_electric_system_cost_permit', 'label', 'Electric System Cost Permit'),
        jsonb_build_object('name', 'assessment_electric_rate_structure', 'label', 'Electric Rate Structure'),
        jsonb_build_object('name', 'assessment_company_to_receive_equipment_rebate', 'label', 'Company To Receive Equipment Rebate'),
        jsonb_build_object('name', 'assessment_bldg_is_commercial_or_multifamily', 'label', 'Bldg Is Commercial Or Multifamily'),
        jsonb_build_object('name', 'assessment_date_of_iq_assessment', 'label', 'Date Of Iq Assessment', 'required', true),
        jsonb_build_object('name', 'assessment_start_time_of_iq_assessment', 'label', 'Start Time Of Iq Assessment'),
        jsonb_build_object('name', 'assessment_end_time_of_iq_assessment', 'label', 'End Time Of Iq Assessment'),
        jsonb_build_object('name', 'assessment_assessor_name', 'label', 'Assessor Name')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Occupancy', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Occupancy', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_building_sq_ft', 'label', 'Building Sq Ft'),
        jsonb_build_object('name', 'assessment_number_of_units', 'label', 'Number Of Units'),
        jsonb_build_object('name', 'assessment_units_at_attic_plane', 'label', 'Units At Attic Plane'),
        jsonb_build_object('name', 'assessment_number_of_bedrooms', 'label', 'Number Of Bedrooms'),
        jsonb_build_object('name', 'assessment_average_unit_occupancy', 'label', 'Average Unit Occupancy'),
        jsonb_build_object('name', 'assessment_building_occupancy_rate', 'label', 'Building Occupancy Rate')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Attic Insulation', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Attic Insulation', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_attic_sq_ft', 'label', 'Attic Sq Ft'),
        jsonb_build_object('name', 'assessment_attic_access_type', 'label', 'Attic Access Type'),
        jsonb_build_object('name', 'assessment_existing_attic_insulation_type', 'label', 'Existing Attic Insulation Type'),
        jsonb_build_object('name', 'assessment_existing_attic_insulation_depth', 'label', 'Existing Attic Insulation Depth'),
        jsonb_build_object('name', 'assessment_existing_attic_insulation_r_value', 'label', 'Existing Attic Insulation R Value')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Ventilation', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Ventilation', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_existing_exhaust_venting', 'label', 'Existing Exhaust Venting'),
        jsonb_build_object('name', 'assessment_existing_eve_baffles', 'label', 'Existing Eve Baffles'),
        jsonb_build_object('name', 'assessment_extend_exhaust_venting', 'label', 'Extend Exhaust Venting'),
        jsonb_build_object('name', 'assessment_extend_exhaust_venting_required', 'label', 'Extend Exhaust Venting Required'),
        jsonb_build_object('name', 'assessment_number_of_flues', 'label', 'Number Of Flues'),
        jsonb_build_object('name', 'assessment_diameter_of_flue', 'label', 'Diameter Of Flue')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Window Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Window Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_window_type', 'label', 'Window Type')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'HVAC Systems', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'HVAC Systems', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_heating_system_type', 'label', 'Heating System Type'),
        jsonb_build_object('name', 'assessment_heating_fuel_type', 'label', 'Heating Fuel Type'),
        jsonb_build_object('name', 'assessment_heating_system_efficiency', 'label', 'Heating System Efficiency'),
        jsonb_build_object('name', 'assessment_heating_fuel_provider', 'label', 'Heating Fuel Provider'),
        jsonb_build_object('name', 'assessment_cooling_system_type', 'label', 'Cooling System Type'),
        jsonb_build_object('name', 'assessment_cooling_system_efficiency', 'label', 'Cooling System Efficiency'),
        jsonb_build_object('name', 'assessment_electric_fuel_provider', 'label', 'Electric Fuel Provider'),
        jsonb_build_object('name', 'assessment_water_heating_system_type', 'label', 'Water Heating System Type'),
        jsonb_build_object('name', 'assessment_water_heating_fuel_type', 'label', 'Water Heating Fuel Type'),
        jsonb_build_object('name', 'assessment_water_heating_fuel_provider', 'label', 'Water Heating Fuel Provider'),
        jsonb_build_object('name', 'assessment_water_heating_system_efficiency', 'label', 'Water Heating System Efficiency'),
        jsonb_build_object('name', 'assessment_gas_meter_number', 'label', 'Gas Meter Number'),
        jsonb_build_object('name', 'assessment_electric_meter_number', 'label', 'Electric Meter Number')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 7, 'Water End Use', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Water End Use', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_number_of_kitchen_faucets', 'label', 'Number Of Kitchen Faucets'),
        jsonb_build_object('name', 'assessment_number_of_bath_faucets', 'label', 'Number Of Bath Faucets'),
        jsonb_build_object('name', 'assessment_shower_head_type', 'label', 'Shower Head Type'),
        jsonb_build_object('name', 'assessment_number_of_shower_heads', 'label', 'Number Of Shower Heads'),
        jsonb_build_object('name', 'assessment_shower_head_flow', 'label', 'Shower Head Flow')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 8, 'Lighting Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Lighting Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_edison_base_lamps', 'label', 'Edison Base Lamps')
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
        jsonb_build_object('name', 'assessment_record_type', 'label', 'Record Type')
      )), false
  );

-- Layout: Nicor Rebuilding Together Assessment  →  RT picklist_value = Nicor_Rebuilding_Together
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'assessments' AND picklist_field = 'record_type' AND picklist_value = 'Nicor_Rebuilding_Together' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Nicor Rebuilding Together Assessment', 'assessments',
    'record_detail', true,
    'Imported from SF Layout: Assessment__c-Nicor Rebuilding Together Assessment',
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
        jsonb_build_object('name', 'assessment_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'assessment_opportunity', 'label', 'Opportunity', 'required', true),
        jsonb_build_object('name', 'property_id', 'label', 'Property ID'),
        jsonb_build_object('name', 'assessment_property_contact_for_iq_assessment', 'label', 'Property Contact For Iq Assessment'),
        jsonb_build_object('name', 'assessment_gas_fuel_provider', 'label', 'Gas Fuel Provider'),
        jsonb_build_object('name', 'assessment_matterport_url', 'label', 'Matterport Url'),
        jsonb_build_object('name', 'assessment_electric_replacement_option_description', 'label', 'Electric Replacement Option Description'),
        jsonb_build_object('name', 'assessment_estimated_changeover_temperature_f', 'label', 'Estimated Changeover Temperature F'),
        jsonb_build_object('name', 'assessment_electric_system_cost_permit', 'label', 'Electric System Cost Permit'),
        jsonb_build_object('name', 'assessment_electric_rate_structure', 'label', 'Electric Rate Structure'),
        jsonb_build_object('name', 'assessment_company_to_receive_equipment_rebate', 'label', 'Company To Receive Equipment Rebate'),
        jsonb_build_object('name', 'assessment_bldg_is_commercial_or_multifamily', 'label', 'Bldg Is Commercial Or Multifamily'),
        jsonb_build_object('name', 'assessment_date_of_iq_assessment', 'label', 'Date Of Iq Assessment', 'required', true),
        jsonb_build_object('name', 'assessment_start_time_of_iq_assessment', 'label', 'Start Time Of Iq Assessment'),
        jsonb_build_object('name', 'assessment_end_time_of_iq_assessment', 'label', 'End Time Of Iq Assessment'),
        jsonb_build_object('name', 'assessment_assessor_name', 'label', 'Assessor Name')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Occupancy', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Occupancy', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_building_sq_ft', 'label', 'Building Sq Ft'),
        jsonb_build_object('name', 'assessment_number_of_units', 'label', 'Number Of Units'),
        jsonb_build_object('name', 'assessment_units_at_attic_plane', 'label', 'Units At Attic Plane'),
        jsonb_build_object('name', 'assessment_number_of_bedrooms', 'label', 'Number Of Bedrooms'),
        jsonb_build_object('name', 'assessment_average_unit_occupancy', 'label', 'Average Unit Occupancy'),
        jsonb_build_object('name', 'assessment_building_occupancy_rate', 'label', 'Building Occupancy Rate')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Attic Insulation', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Attic Insulation', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_attic_sq_ft', 'label', 'Attic Sq Ft'),
        jsonb_build_object('name', 'assessment_attic_access_type', 'label', 'Attic Access Type'),
        jsonb_build_object('name', 'assessment_existing_attic_insulation_type', 'label', 'Existing Attic Insulation Type'),
        jsonb_build_object('name', 'assessment_existing_attic_insulation_depth', 'label', 'Existing Attic Insulation Depth'),
        jsonb_build_object('name', 'assessment_existing_attic_insulation_r_value', 'label', 'Existing Attic Insulation R Value')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Ventilation', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Ventilation', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_existing_exhaust_venting', 'label', 'Existing Exhaust Venting'),
        jsonb_build_object('name', 'assessment_existing_eve_baffles', 'label', 'Existing Eve Baffles'),
        jsonb_build_object('name', 'assessment_extend_exhaust_venting', 'label', 'Extend Exhaust Venting'),
        jsonb_build_object('name', 'assessment_extend_exhaust_venting_required', 'label', 'Extend Exhaust Venting Required'),
        jsonb_build_object('name', 'assessment_number_of_flues', 'label', 'Number Of Flues'),
        jsonb_build_object('name', 'assessment_diameter_of_flue', 'label', 'Diameter Of Flue')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Window Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Window Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_window_type', 'label', 'Window Type')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'HVAC Systems', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'HVAC Systems', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_heating_system_type', 'label', 'Heating System Type'),
        jsonb_build_object('name', 'assessment_heating_fuel_type', 'label', 'Heating Fuel Type'),
        jsonb_build_object('name', 'assessment_heating_system_efficiency', 'label', 'Heating System Efficiency'),
        jsonb_build_object('name', 'assessment_heating_fuel_provider', 'label', 'Heating Fuel Provider'),
        jsonb_build_object('name', 'assessment_cooling_system_type', 'label', 'Cooling System Type'),
        jsonb_build_object('name', 'assessment_cooling_system_efficiency', 'label', 'Cooling System Efficiency'),
        jsonb_build_object('name', 'assessment_electric_fuel_provider', 'label', 'Electric Fuel Provider'),
        jsonb_build_object('name', 'assessment_water_heating_system_type', 'label', 'Water Heating System Type'),
        jsonb_build_object('name', 'assessment_water_heating_fuel_type', 'label', 'Water Heating Fuel Type'),
        jsonb_build_object('name', 'assessment_water_heating_fuel_provider', 'label', 'Water Heating Fuel Provider'),
        jsonb_build_object('name', 'assessment_water_heating_system_efficiency', 'label', 'Water Heating System Efficiency'),
        jsonb_build_object('name', 'assessment_gas_meter_number', 'label', 'Gas Meter Number'),
        jsonb_build_object('name', 'assessment_electric_meter_number', 'label', 'Electric Meter Number')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 7, 'Water End Use', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Water End Use', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_number_of_kitchen_faucets', 'label', 'Number Of Kitchen Faucets'),
        jsonb_build_object('name', 'assessment_number_of_bath_faucets', 'label', 'Number Of Bath Faucets'),
        jsonb_build_object('name', 'assessment_shower_head_type', 'label', 'Shower Head Type'),
        jsonb_build_object('name', 'assessment_number_of_shower_heads', 'label', 'Number Of Shower Heads'),
        jsonb_build_object('name', 'assessment_shower_head_flow', 'label', 'Shower Head Flow')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 8, 'Lighting Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Lighting Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_edison_base_lamps', 'label', 'Edison Base Lamps')
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
        jsonb_build_object('name', 'assessment_record_type', 'label', 'Record Type')
      )), false
  );

-- Layout: PACE-WI  →  RT picklist_value = PACE_WI
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'assessments' AND picklist_field = 'record_type' AND picklist_value = 'PACE_WI' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'PACE-WI', 'assessments',
    'record_detail', true,
    'Imported from SF Layout: Assessment__c-PACE-WI',
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
        jsonb_build_object('name', 'assessment_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'assessment_opportunity', 'label', 'Opportunity', 'required', true),
        jsonb_build_object('name', 'assessment_building_del', 'label', 'Building Del'),
        jsonb_build_object('name', 'property_id', 'label', 'Property ID'),
        jsonb_build_object('name', 'assessment_property_contact_for_iq_assessment', 'label', 'Property Contact For Iq Assessment'),
        jsonb_build_object('name', 'assessment_sharin_pix_album', 'label', 'Sharin Pix Album'),
        jsonb_build_object('name', 'assessment_gas_fuel_provider', 'label', 'Gas Fuel Provider'),
        jsonb_build_object('name', 'assessment_matterport_url', 'label', 'Matterport Url'),
        jsonb_build_object('name', 'assessment_company_to_receive_equipment_rebate', 'label', 'Company To Receive Equipment Rebate'),
        jsonb_build_object('name', 'assessment_bldg_is_commercial_or_multifamily', 'label', 'Bldg Is Commercial Or Multifamily'),
        jsonb_build_object('name', 'assessment_date_of_iq_assessment', 'label', 'Date Of Iq Assessment', 'required', true),
        jsonb_build_object('name', 'assessment_start_time_of_iq_assessment', 'label', 'Start Time Of Iq Assessment'),
        jsonb_build_object('name', 'assessment_end_time_of_iq_assessment', 'label', 'End Time Of Iq Assessment'),
        jsonb_build_object('name', 'assessment_assessor_name', 'label', 'Assessor Name')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Occupancy', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Occupancy', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_building_sq_ft', 'label', 'Building Sq Ft'),
        jsonb_build_object('name', 'assessment_number_of_units', 'label', 'Number Of Units'),
        jsonb_build_object('name', 'assessment_units_at_attic_plane', 'label', 'Units At Attic Plane'),
        jsonb_build_object('name', 'assessment_number_of_bedrooms', 'label', 'Number Of Bedrooms'),
        jsonb_build_object('name', 'assessment_average_unit_occupancy', 'label', 'Average Unit Occupancy'),
        jsonb_build_object('name', 'assessment_building_occupancy_rate', 'label', 'Building Occupancy Rate')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Attic Insulation', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Attic Insulation', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_attic_sq_ft', 'label', 'Attic Sq Ft'),
        jsonb_build_object('name', 'assessment_attic_access_type', 'label', 'Attic Access Type'),
        jsonb_build_object('name', 'assessment_existing_attic_insulation_type', 'label', 'Existing Attic Insulation Type'),
        jsonb_build_object('name', 'assessment_existing_attic_insulation_depth', 'label', 'Existing Attic Insulation Depth'),
        jsonb_build_object('name', 'assessment_existing_attic_insulation_r_value', 'label', 'Existing Attic Insulation R Value')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Ventilation', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Ventilation', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_existing_exhaust_venting', 'label', 'Existing Exhaust Venting'),
        jsonb_build_object('name', 'assessment_existing_eve_baffles', 'label', 'Existing Eve Baffles'),
        jsonb_build_object('name', 'assessment_extend_exhaust_venting', 'label', 'Extend Exhaust Venting'),
        jsonb_build_object('name', 'assessment_extend_exhaust_venting_required', 'label', 'Extend Exhaust Venting Required'),
        jsonb_build_object('name', 'assessment_number_of_flues', 'label', 'Number Of Flues'),
        jsonb_build_object('name', 'assessment_diameter_of_flue', 'label', 'Diameter Of Flue')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Window Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Window Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_window_type', 'label', 'Window Type')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'HVAC Systems', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'HVAC Systems', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_heating_system_type', 'label', 'Heating System Type'),
        jsonb_build_object('name', 'assessment_heating_fuel_type', 'label', 'Heating Fuel Type'),
        jsonb_build_object('name', 'assessment_heating_system_efficiency', 'label', 'Heating System Efficiency'),
        jsonb_build_object('name', 'assessment_heating_fuel_provider', 'label', 'Heating Fuel Provider'),
        jsonb_build_object('name', 'assessment_heating_system_notes', 'label', 'Heating System Notes'),
        jsonb_build_object('name', 'assessment_cooling_system_type', 'label', 'Cooling System Type'),
        jsonb_build_object('name', 'assessment_cooling_system_efficiency', 'label', 'Cooling System Efficiency'),
        jsonb_build_object('name', 'assessment_electric_fuel_provider', 'label', 'Electric Fuel Provider'),
        jsonb_build_object('name', 'assessment_cooling_equipment_notes', 'label', 'Cooling Equipment Notes'),
        jsonb_build_object('name', 'assessment_water_heating_system_type', 'label', 'Water Heating System Type'),
        jsonb_build_object('name', 'assessment_water_heating_fuel_type', 'label', 'Water Heating Fuel Type'),
        jsonb_build_object('name', 'assessment_water_heating_fuel_provider', 'label', 'Water Heating Fuel Provider'),
        jsonb_build_object('name', 'assessment_water_heating_system_efficiency', 'label', 'Water Heating System Efficiency'),
        jsonb_build_object('name', 'assessment_gas_meter_number', 'label', 'Gas Meter Number'),
        jsonb_build_object('name', 'assessment_electric_meter_number', 'label', 'Electric Meter Number')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 7, 'Water End Use', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Water End Use', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_number_of_kitchen_faucets', 'label', 'Number Of Kitchen Faucets'),
        jsonb_build_object('name', 'assessment_number_of_bath_faucets', 'label', 'Number Of Bath Faucets'),
        jsonb_build_object('name', 'assessment_shower_head_type', 'label', 'Shower Head Type'),
        jsonb_build_object('name', 'assessment_number_of_shower_heads', 'label', 'Number Of Shower Heads'),
        jsonb_build_object('name', 'assessment_shower_head_flow', 'label', 'Shower Head Flow')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 8, 'Lighting Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Lighting Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_edison_base_lamps', 'label', 'Edison Base Lamps')
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
        jsonb_build_object('name', 'assessment_record_type', 'label', 'Record Type')
      )), false
  );

-- Layout: WI-IRA-MF-HOMES-AUDIT  →  RT picklist_value = WI_IRA_MF_HOMES_AUDIT
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'assessments' AND picklist_field = 'record_type' AND picklist_value = 'WI_IRA_MF_HOMES_AUDIT' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'WI-IRA-MF-HOMES-AUDIT', 'assessments',
    'record_detail', true,
    'Imported from SF Layout: Assessment__c-WI-IRA-MF-HOMES-AUDIT',
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
        jsonb_build_object('name', 'assessment_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'assessment_opportunity', 'label', 'Opportunity', 'required', true),
        jsonb_build_object('name', 'assessment_building_del', 'label', 'Building Del'),
        jsonb_build_object('name', 'property_id', 'label', 'Property ID'),
        jsonb_build_object('name', 'assessment_property_contact_for_iq_assessment', 'label', 'Property Contact For Iq Assessment'),
        jsonb_build_object('name', 'assessment_sharin_pix_album', 'label', 'Sharin Pix Album'),
        jsonb_build_object('name', 'assessment_gas_fuel_provider', 'label', 'Gas Fuel Provider'),
        jsonb_build_object('name', 'assessment_matterport_url', 'label', 'Matterport Url'),
        jsonb_build_object('name', 'assessment_company_to_receive_equipment_rebate', 'label', 'Company To Receive Equipment Rebate'),
        jsonb_build_object('name', 'assessment_bldg_is_commercial_or_multifamily', 'label', 'Bldg Is Commercial Or Multifamily'),
        jsonb_build_object('name', 'assessment_date_of_iq_assessment', 'label', 'Date Of Iq Assessment', 'required', true),
        jsonb_build_object('name', 'assessment_start_time_of_iq_assessment', 'label', 'Start Time Of Iq Assessment'),
        jsonb_build_object('name', 'assessment_end_time_of_iq_assessment', 'label', 'End Time Of Iq Assessment'),
        jsonb_build_object('name', 'assessment_assessor_name', 'label', 'Assessor Name')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Occupancy', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Occupancy', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_building_sq_ft', 'label', 'Building Sq Ft'),
        jsonb_build_object('name', 'assessment_number_of_units', 'label', 'Number Of Units'),
        jsonb_build_object('name', 'assessment_units_at_attic_plane', 'label', 'Units At Attic Plane'),
        jsonb_build_object('name', 'assessment_number_of_bedrooms', 'label', 'Number Of Bedrooms'),
        jsonb_build_object('name', 'assessment_average_unit_occupancy', 'label', 'Average Unit Occupancy'),
        jsonb_build_object('name', 'assessment_building_occupancy_rate', 'label', 'Building Occupancy Rate')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Attic Insulation', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Attic Insulation', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_attic_sq_ft', 'label', 'Attic Sq Ft'),
        jsonb_build_object('name', 'assessment_attic_access_type', 'label', 'Attic Access Type'),
        jsonb_build_object('name', 'assessment_existing_attic_insulation_type', 'label', 'Existing Attic Insulation Type'),
        jsonb_build_object('name', 'assessment_existing_attic_insulation_depth', 'label', 'Existing Attic Insulation Depth'),
        jsonb_build_object('name', 'assessment_existing_attic_insulation_r_value', 'label', 'Existing Attic Insulation R Value')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Ventilation', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Ventilation', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_existing_exhaust_venting', 'label', 'Existing Exhaust Venting'),
        jsonb_build_object('name', 'assessment_existing_eve_baffles', 'label', 'Existing Eve Baffles'),
        jsonb_build_object('name', 'assessment_extend_exhaust_venting', 'label', 'Extend Exhaust Venting'),
        jsonb_build_object('name', 'assessment_extend_exhaust_venting_required', 'label', 'Extend Exhaust Venting Required'),
        jsonb_build_object('name', 'assessment_number_of_flues', 'label', 'Number Of Flues'),
        jsonb_build_object('name', 'assessment_diameter_of_flue', 'label', 'Diameter Of Flue')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Window Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Window Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_window_type', 'label', 'Window Type')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 6, 'HVAC Systems', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'HVAC Systems', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_heating_system_type', 'label', 'Heating System Type'),
        jsonb_build_object('name', 'assessment_heating_fuel_type', 'label', 'Heating Fuel Type'),
        jsonb_build_object('name', 'assessment_heating_system_efficiency', 'label', 'Heating System Efficiency'),
        jsonb_build_object('name', 'assessment_heating_fuel_provider', 'label', 'Heating Fuel Provider'),
        jsonb_build_object('name', 'assessment_heating_system_notes', 'label', 'Heating System Notes'),
        jsonb_build_object('name', 'assessment_cooling_system_type', 'label', 'Cooling System Type'),
        jsonb_build_object('name', 'assessment_cooling_system_efficiency', 'label', 'Cooling System Efficiency'),
        jsonb_build_object('name', 'assessment_electric_fuel_provider', 'label', 'Electric Fuel Provider'),
        jsonb_build_object('name', 'assessment_cooling_equipment_notes', 'label', 'Cooling Equipment Notes'),
        jsonb_build_object('name', 'assessment_water_heating_system_type', 'label', 'Water Heating System Type'),
        jsonb_build_object('name', 'assessment_water_heating_fuel_type', 'label', 'Water Heating Fuel Type'),
        jsonb_build_object('name', 'assessment_water_heating_fuel_provider', 'label', 'Water Heating Fuel Provider'),
        jsonb_build_object('name', 'assessment_water_heating_system_efficiency', 'label', 'Water Heating System Efficiency'),
        jsonb_build_object('name', 'assessment_gas_meter_number', 'label', 'Gas Meter Number'),
        jsonb_build_object('name', 'assessment_electric_meter_number', 'label', 'Electric Meter Number')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 7, 'Water End Use', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Water End Use', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_number_of_kitchen_faucets', 'label', 'Number Of Kitchen Faucets'),
        jsonb_build_object('name', 'assessment_number_of_bath_faucets', 'label', 'Number Of Bath Faucets'),
        jsonb_build_object('name', 'assessment_shower_head_type', 'label', 'Shower Head Type'),
        jsonb_build_object('name', 'assessment_number_of_shower_heads', 'label', 'Number Of Shower Heads'),
        jsonb_build_object('name', 'assessment_shower_head_flow', 'label', 'Shower Head Flow')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 8, 'Lighting Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Lighting Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_edison_base_lamps', 'label', 'Edison Base Lamps')
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
        jsonb_build_object('name', 'assessment_record_type', 'label', 'Record Type')
      )), false
  );


END $$;
