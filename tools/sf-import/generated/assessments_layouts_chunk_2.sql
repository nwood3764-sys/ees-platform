DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN
-- Layout: HES-Assessment  →  RT picklist_value = HES_Assessment
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'assessments' AND picklist_field = 'record_type' AND picklist_value = 'HES_Assessment' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'HES-Assessment', 'assessments',
    'record_detail', true,
    'Imported from SF Layout: Assessment__c-HES-Assessment',
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
        jsonb_build_object('name', 'assessment_assessor_name', 'label', 'Assessor Name'),
        jsonb_build_object('name', 'assessment_date_of_iq_assessment', 'label', 'Date Of Iq Assessment'),
        jsonb_build_object('name', 'assessment_start_time_of_iq_assessment', 'label', 'Start Time Of Iq Assessment'),
        jsonb_build_object('name', 'assessment_end_time_of_iq_assessment', 'label', 'End Time Of Iq Assessment')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Building Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Building Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_building_property_type', 'label', 'Building Property Type'),
        jsonb_build_object('name', 'assessment_year_built', 'label', 'Year Built'),
        jsonb_build_object('name', 'assessment_number_of_stories', 'label', 'Number Of Stories'),
        jsonb_build_object('name', 'assessment_building_sq_ft', 'label', 'Building Sq Ft'),
        jsonb_build_object('name', 'assessment_building_occupancy_rate', 'label', 'Building Occupancy Rate'),
        jsonb_build_object('name', 'assessment_number_of_bedrooms', 'label', 'Number Of Bedrooms'),
        jsonb_build_object('name', 'assessment_average_unit_occupancy', 'label', 'Average Unit Occupancy'),
        jsonb_build_object('name', 'assessment_gas_fuel_provider', 'label', 'Gas Fuel Provider'),
        jsonb_build_object('name', 'assessment_gas_meter_number', 'label', 'Gas Meter Number'),
        jsonb_build_object('name', 'assessment_electric_fuel_provider', 'label', 'Electric Fuel Provider'),
        jsonb_build_object('name', 'assessment_electric_meter_number', 'label', 'Electric Meter Number')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Exterior Inspection', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Exterior Inspection', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_gutter_existing', 'label', 'Gutter Existing'),
        jsonb_build_object('name', 'assessment_gutter_condition', 'label', 'Gutter Condition'),
        jsonb_build_object('name', 'assessment_downspouts_existing', 'label', 'Downspouts Existing'),
        jsonb_build_object('name', 'assessment_gutter_repair_needed', 'label', 'Gutter Repair Needed'),
        jsonb_build_object('name', 'assessment_gutter_repair_description', 'label', 'Gutter Repair Description'),
        jsonb_build_object('name', 'assessment_roof_condition', 'label', 'Roof Condition'),
        jsonb_build_object('name', 'assessment_roof_existing_shingle_type', 'label', 'Roof Existing Shingle Type'),
        jsonb_build_object('name', 'assessment_roof_year_since_replacement', 'label', 'Roof Year Since Replacement'),
        jsonb_build_object('name', 'assessment_roof_repair_needed', 'label', 'Roof Repair Needed'),
        jsonb_build_object('name', 'assessment_roof_repair_description', 'label', 'Roof Repair Description'),
        jsonb_build_object('name', 'assessment_roof_venting_present', 'label', 'Roof Venting Present'),
        jsonb_build_object('name', 'assessment_roof_venting_type', 'label', 'Roof Venting Type'),
        jsonb_build_object('name', 'assessment_roof_overhang_existing', 'label', 'Roof Overhang Existing'),
        jsonb_build_object('name', 'assessment_roof_overhang_existing_condition', 'label', 'Roof Overhang Existing Condition'),
        jsonb_build_object('name', 'assessment_roof_overhang_repair_description', 'label', 'Roof Overhang Repair Description'),
        jsonb_build_object('name', 'assessment_roof_overhang_repairs_needed', 'label', 'Roof Overhang Repairs Needed'),
        jsonb_build_object('name', 'assessment_chimney_existing', 'label', 'Chimney Existing'),
        jsonb_build_object('name', 'assessment_chimney_existing_type', 'label', 'Chimney Existing Type'),
        jsonb_build_object('name', 'assessment_chimney_flashing_repair_needed', 'label', 'Chimney Flashing Repair Needed'),
        jsonb_build_object('name', 'assessment_chimney_repair_description', 'label', 'Chimney Repair Description'),
        jsonb_build_object('name', 'assessment_exterior_inspection_notes', 'label', 'Exterior Inspection Notes'),
        jsonb_build_object('name', 'assessment_matterport_url', 'label', 'Matterport Url'),
        jsonb_build_object('name', 'assessment_electric_replacement_option_description', 'label', 'Electric Replacement Option Description'),
        jsonb_build_object('name', 'assessment_estimated_changeover_temperature_f', 'label', 'Estimated Changeover Temperature F'),
        jsonb_build_object('name', 'assessment_electric_system_cost_permit', 'label', 'Electric System Cost Permit'),
        jsonb_build_object('name', 'assessment_electric_rate_structure', 'label', 'Electric Rate Structure'),
        jsonb_build_object('name', 'assessment_company_to_receive_equipment_rebate', 'label', 'Company To Receive Equipment Rebate'),
        jsonb_build_object('name', 'assessment_bldg_is_commercial_or_multifamily', 'label', 'Bldg Is Commercial Or Multifamily')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Attic Insulation', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Attic Insulation', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_attic_sq_ft', 'label', 'Attic Sq Ft'),
        jsonb_build_object('name', 'assessment_existing_attic_insulation_type', 'label', 'Existing Attic Insulation Type'),
        jsonb_build_object('name', 'assessment_existing_attic_insulation_depth', 'label', 'Existing Attic Insulation Depth'),
        jsonb_build_object('name', 'assessment_existing_attic_insulation_r_value', 'label', 'Existing Attic Insulation R Value'),
        jsonb_build_object('name', 'assessment_attic_description', 'label', 'Attic Description'),
        jsonb_build_object('name', 'assessment_knee_wall_sq_ft', 'label', 'Knee Wall Sq Ft'),
        jsonb_build_object('name', 'assessment_knee_wall_existing_insulation_type', 'label', 'Knee Wall Existing Insulation Type'),
        jsonb_build_object('name', 'assessment_knee_wall_existing_insulation_thickness', 'label', 'Knee Wall Existing Insulation Thickness'),
        jsonb_build_object('name', 'assessment_knee_wall_insulation_r_value', 'label', 'Knee Wall Insulation R Value'),
        jsonb_build_object('name', 'assessment_knee_wall_description', 'label', 'Knee Wall Description'),
        jsonb_build_object('name', 'assessment_attic_ventilation_existing', 'label', 'Attic Ventilation Existing'),
        jsonb_build_object('name', 'assessment_attic_ventilation_existing_type', 'label', 'Attic Ventilation Existing Type'),
        jsonb_build_object('name', 'assessment_attic_ductwork_present', 'label', 'Attic Ductwork Present'),
        jsonb_build_object('name', 'assessment_attic_ductwork_insulated', 'label', 'Attic Ductwork Insulated'),
        jsonb_build_object('name', 'assessment_attic_ductwork_length_to_be_insulated_an', 'label', 'Attic Ductwork Length To Be Insulated An'),
        jsonb_build_object('name', 'assessment_attic_ductwork_description', 'label', 'Attic Ductwork Description')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Ventilation', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Ventilation', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_existing_eve_baffles', 'label', 'Existing Eve Baffles'),
        jsonb_build_object('name', 'assessment_existing_exhaust_venting', 'label', 'Existing Exhaust Venting'),
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
    layout_id, 6, 'Window Information', 2, 'Details',
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
    layout_id, 7, 'HVAC Systems', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'HVAC Systems', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_heating_system_type', 'label', 'Heating System Type'),
        jsonb_build_object('name', 'assessment_heating_fuel_type', 'label', 'Heating Fuel Type'),
        jsonb_build_object('name', 'assessment_heating_system_manufacturer', 'label', 'Heating System Manufacturer'),
        jsonb_build_object('name', 'assessment_heating_system_efficiency', 'label', 'Heating System Efficiency'),
        jsonb_build_object('name', 'assessment_heating_system_capacity', 'label', 'Heating System Capacity'),
        jsonb_build_object('name', 'assessment_heating_system_date_of_manufacture', 'label', 'Heating System Date Of Manufacture'),
        jsonb_build_object('name', 'assessment_heating_system_condition', 'label', 'Heating System Condition'),
        jsonb_build_object('name', 'assessment_flue_condition', 'label', 'Flue Condition'),
        jsonb_build_object('name', 'assessment_flue_repair_description', 'label', 'Flue Repair Description'),
        jsonb_build_object('name', 'assessment_filter_size', 'label', 'Filter Size'),
        jsonb_build_object('name', 'assessment_heating_system_description', 'label', 'Heating System Description'),
        jsonb_build_object('name', 'assessment_space_heater_present', 'label', 'Space Heater Present'),
        jsonb_build_object('name', 'assessment_space_heater_present_location', 'label', 'Space Heater Present Location'),
        jsonb_build_object('name', 'assessment_cooling_system_type', 'label', 'Cooling System Type'),
        jsonb_build_object('name', 'assessment_cooling_system_manufacturer', 'label', 'Cooling System Manufacturer'),
        jsonb_build_object('name', 'assessment_cooling_system_capacity', 'label', 'Cooling System Capacity'),
        jsonb_build_object('name', 'assessment_cooling_system_efficiency', 'label', 'Cooling System Efficiency'),
        jsonb_build_object('name', 'assessment_cooling_system_date_of_manufacture', 'label', 'Cooling System Date Of Manufacture'),
        jsonb_build_object('name', 'assessment_cooling_system_condition', 'label', 'Cooling System Condition'),
        jsonb_build_object('name', 'assessment_cooling_system_description', 'label', 'Cooling System Description'),
        jsonb_build_object('name', 'assessment_water_heating_system_type', 'label', 'Water Heating System Type'),
        jsonb_build_object('name', 'assessment_water_heating_fuel_type', 'label', 'Water Heating Fuel Type'),
        jsonb_build_object('name', 'assessment_water_heating_system_date_of_manufacture', 'label', 'Water Heating System Date Of Manufacture'),
        jsonb_build_object('name', 'assessment_water_heating_system_capacity_gallons', 'label', 'Water Heating System Capacity Gallons'),
        jsonb_build_object('name', 'assessment_water_heating_system_manufacturer', 'label', 'Water Heating System Manufacturer'),
        jsonb_build_object('name', 'assessment_water_heating_system_efficiency', 'label', 'Water Heating System Efficiency'),
        jsonb_build_object('name', 'assessment_water_heating_system_capacity_btu', 'label', 'Water Heating System Capacity BTU'),
        jsonb_build_object('name', 'assessment_water_heating_system_condition', 'label', 'Water Heating System Condition'),
        jsonb_build_object('name', 'assessment_water_heating_system_description', 'label', 'Water Heating System Description'),
        jsonb_build_object('name', 'assessment_water_heater_flue_type', 'label', 'Water Heater Flue Type'),
        jsonb_build_object('name', 'assessment_water_heater_flue_termination_type', 'label', 'Water Heater Flue Termination Type'),
        jsonb_build_object('name', 'assessment_water_heater_flue_repair_description', 'label', 'Water Heater Flue Repair Description'),
        jsonb_build_object('name', 'assessment_water_heater_pipes_insulated', 'label', 'Water Heater Pipes Insulated')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 8, 'Water End Use', 2, 'Details',
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
    layout_id, 9, 'Lighting Information', 2, 'Details',
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
    layout_id, 10, 'System Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_record_type', 'label', 'Record Type'),
        jsonb_build_object('name', 'assessment_sharin_pix_album', 'label', 'Sharin Pix Album')
      )), false
  );

-- Layout: IQ Assessment Layout  →  RT picklist_value = (default fallback)
  rt_id := NULL;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'IQ Assessment Layout', 'assessments',
    'record_detail', true,
    'Imported from SF Layout: Assessment__c-IQ Assessment Layout',
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

-- Layout: MEC - MF - AIR - Pilot  →  RT picklist_value = MEC_MF_AIR_Pilot
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'assessments' AND picklist_field = 'record_type' AND picklist_value = 'MEC_MF_AIR_Pilot' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'MEC - MF - AIR - Pilot', 'assessments',
    'record_detail', true,
    'Imported from SF Layout: Assessment__c-MEC - MF - AIR - Pilot',
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
        jsonb_build_object('name', 'assessment_gas_fuel_provider', 'label', 'Gas Fuel Provider'),
        jsonb_build_object('name', 'assessment_matterport_url', 'label', 'Matterport Url'),
        jsonb_build_object('name', 'assessment_electric_replacement_option_description', 'label', 'Electric Replacement Option Description'),
        jsonb_build_object('name', 'assessment_estimated_changeover_temperature_f', 'label', 'Estimated Changeover Temperature F'),
        jsonb_build_object('name', 'assessment_electric_system_cost_permit', 'label', 'Electric System Cost Permit'),
        jsonb_build_object('name', 'assessment_electric_rate_structure', 'label', 'Electric Rate Structure'),
        jsonb_build_object('name', 'assessment_company_to_receive_equipment_rebate', 'label', 'Company To Receive Equipment Rebate'),
        jsonb_build_object('name', 'assessment_bldg_is_commercial_or_multifamily', 'label', 'Bldg Is Commercial Or Multifamily'),
        jsonb_build_object('name', 'assessment_record_type', 'label', 'Record Type')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'IQ Assessment Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'IQ Assessment Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_date_of_iq_assessment', 'label', 'Date Of Iq Assessment', 'required', true),
        jsonb_build_object('name', 'assessment_property_contact_for_iq_assessment', 'label', 'Property Contact For Iq Assessment'),
        jsonb_build_object('name', 'assessment_start_time_of_iq_assessment', 'label', 'Start Time Of Iq Assessment'),
        jsonb_build_object('name', 'assessment_end_time_of_iq_assessment', 'label', 'End Time Of Iq Assessment'),
        jsonb_build_object('name', 'assessment_assessor_name', 'label', 'Assessor Name')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Building Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Building Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_building_del', 'label', 'Building Del', 'required', true),
        jsonb_build_object('name', 'property_id', 'label', 'Property ID'),
        jsonb_build_object('name', 'assessment_building_sq_ft', 'label', 'Building Sq Ft'),
        jsonb_build_object('name', 'assessment_number_of_units', 'label', 'Number Of Units'),
        jsonb_build_object('name', 'assessment_units_at_attic_plane', 'label', 'Units At Attic Plane')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Occupancy', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Occupancy', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_number_of_bedrooms', 'label', 'Number Of Bedrooms'),
        jsonb_build_object('name', 'assessment_average_unit_occupancy', 'label', 'Average Unit Occupancy')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Attic Insulation', 2, 'Details',
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
    layout_id, 6, 'Attic Other', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Attic Other', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_diameter_of_flue', 'label', 'Diameter Of Flue'),
        jsonb_build_object('name', 'assessment_number_of_flues', 'label', 'Number Of Flues')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 7, 'Ventilation', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Ventilation', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_existing_exhaust_venting', 'label', 'Existing Exhaust Venting'),
        jsonb_build_object('name', 'assessment_extend_exhaust_venting', 'label', 'Extend Exhaust Venting'),
        jsonb_build_object('name', 'assessment_extend_exhaust_venting_required', 'label', 'Extend Exhaust Venting Required'),
        jsonb_build_object('name', 'assessment_existing_eve_baffles', 'label', 'Existing Eve Baffles')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 8, 'Window Information', 2, 'Details',
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
    layout_id, 9, 'HVAC Systems', 2, 'Details',
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
        jsonb_build_object('name', 'assessment_water_heating_system_efficiency', 'label', 'Water Heating System Efficiency'),
        jsonb_build_object('name', 'assessment_water_heating_fuel_provider', 'label', 'Water Heating Fuel Provider'),
        jsonb_build_object('name', 'assessment_gas_meter_number', 'label', 'Gas Meter Number'),
        jsonb_build_object('name', 'assessment_electric_meter_number', 'label', 'Electric Meter Number')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 10, 'Water End Use', 2, 'Details',
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

-- Layout: MFES-2023  →  RT picklist_value = MFES_2023
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'assessments' AND picklist_field = 'record_type' AND picklist_value = 'MFES_2023' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'MFES-2023', 'assessments',
    'record_detail', true,
    'Imported from SF Layout: Assessment__c-MFES-2023',
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
        jsonb_build_object('name', 'assessment_matterport_url', 'label', 'Matterport Url'),
        jsonb_build_object('name', 'assessment_company_to_receive_equipment_rebate', 'label', 'Company To Receive Equipment Rebate'),
        jsonb_build_object('name', 'assessment_bldg_is_commercial_or_multifamily', 'label', 'Bldg Is Commercial Or Multifamily'),
        jsonb_build_object('name', 'assessment_record_type', 'label', 'Record Type')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'IQ Assessment Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'IQ Assessment Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_date_of_iq_assessment', 'label', 'Date Of Iq Assessment', 'required', true),
        jsonb_build_object('name', 'assessment_property_contact_for_iq_assessment', 'label', 'Property Contact For Iq Assessment'),
        jsonb_build_object('name', 'assessment_start_time_of_iq_assessment', 'label', 'Start Time Of Iq Assessment'),
        jsonb_build_object('name', 'assessment_end_time_of_iq_assessment', 'label', 'End Time Of Iq Assessment'),
        jsonb_build_object('name', 'assessment_assessor_name', 'label', 'Assessor Name')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Utility', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Utility', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_gas_fuel_provider', 'label', 'Gas Fuel Provider'),
        jsonb_build_object('name', 'assessment_electric_fuel_provider', 'label', 'Electric Fuel Provider')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Building Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Building Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_opportunity', 'label', 'Opportunity', 'required', true),
        jsonb_build_object('name', 'property_id', 'label', 'Property ID'),
        jsonb_build_object('name', 'assessment_building_del', 'label', 'Building Del', 'required', true),
        jsonb_build_object('name', 'assessment_year_built', 'label', 'Year Built'),
        jsonb_build_object('name', 'assessment_number_of_bedrooms', 'label', 'Number Of Bedrooms'),
        jsonb_build_object('name', 'assessment_average_unit_occupancy', 'label', 'Average Unit Occupancy'),
        jsonb_build_object('name', 'assessment_total_building_sq_ft', 'label', 'Total Building Sq Ft'),
        jsonb_build_object('name', 'assessment_total_number_of_units', 'label', 'Total Number Of Units')
      )), false
  );


END $$;
