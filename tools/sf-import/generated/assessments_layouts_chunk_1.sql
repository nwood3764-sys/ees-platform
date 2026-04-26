-- --- ASSESSMENTS layouts from SF -------------
-- 15 SF layouts found for Assessment__c

DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN

-- Soft-delete the previous Standard assessments layout, if any
UPDATE public.page_layouts SET is_deleted = true, updated_at = now()
WHERE page_layout_object = 'assessments' AND is_deleted = false;

-- Layout: ASHRAE Level 1  →  RT picklist_value = ASHRAE_Level_1
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'assessments' AND picklist_field = 'record_type' AND picklist_value = 'ASHRAE_Level_1' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'ASHRAE Level 1', 'assessments',
    'record_detail', true,
    'Imported from SF Layout: Assessment__c-ASHRAE Level 1',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Assessment Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Assessment Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'assessment_opportunity', 'label', 'Opportunity', 'required', true),
        jsonb_build_object('name', 'property_id', 'label', 'Property ID'),
        jsonb_build_object('name', 'assessment_building_del', 'label', 'Building Del'),
        jsonb_build_object('name', 'assessment_status', 'label', 'Status')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Assessment Scheduling Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Assessment Scheduling Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_assessor_name', 'label', 'Assessor Name'),
        jsonb_build_object('name', 'assessment_property_contact_for_iq_assessment', 'label', 'Property Contact For Iq Assessment'),
        jsonb_build_object('name', 'assessment_date_of_assessment', 'label', 'Date Of Assessment'),
        jsonb_build_object('name', 'assessment_date_of_iq_assessment', 'label', 'Date Of Iq Assessment'),
        jsonb_build_object('name', 'assessment_scheduled_start_time', 'label', 'Scheduled Start Time'),
        jsonb_build_object('name', 'assessment_start_time_of_iq_assessment', 'label', 'Start Time Of Iq Assessment'),
        jsonb_build_object('name', 'assessment_end_time_of_iq_assessment', 'label', 'End Time Of Iq Assessment')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Assessment Files', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Assessment Files', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_matterport_url', 'label', 'Matterport Url'),
        jsonb_build_object('name', 'assessment_drone_footage_link', 'label', 'Drone Footage Link'),
        jsonb_build_object('name', 'assessment_exterior_of_building_video_url', 'label', 'Exterior Of Building Video Url')
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
    layout_id, 5, 'Occupancy', 2, 'Details',
    true, true, false
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
    layout_id, 6, 'Attic Insulation', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Attic Insulation', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_attic_sq_ft', 'label', 'Attic Sq Ft'),
        jsonb_build_object('name', 'assessment_roof_type', 'label', 'Roof Type'),
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
        jsonb_build_object('name', 'assessment_heating_system_efficiency', 'label', 'Heating System Efficiency'),
        jsonb_build_object('name', 'assessment_heating_fuel_provider', 'label', 'Heating Fuel Provider'),
        jsonb_build_object('name', 'assessment_heating_system_notes', 'label', 'Heating System Notes'),
        jsonb_build_object('name', 'assessment_cooling_system_type', 'label', 'Cooling System Type'),
        jsonb_build_object('name', 'assessment_cooling_system_efficiency', 'label', 'Cooling System Efficiency'),
        jsonb_build_object('name', 'assessment_cooling_equipment_notes', 'label', 'Cooling Equipment Notes'),
        jsonb_build_object('name', 'assessment_water_heating_system_type', 'label', 'Water Heating System Type'),
        jsonb_build_object('name', 'assessment_water_heating_fuel_type', 'label', 'Water Heating Fuel Type'),
        jsonb_build_object('name', 'assessment_water_heating_fuel_provider', 'label', 'Water Heating Fuel Provider'),
        jsonb_build_object('name', 'assessment_water_heating_system_efficiency', 'label', 'Water Heating System Efficiency'),
        jsonb_build_object('name', 'assessment_water_heating_system_notes', 'label', 'Water Heating System Notes')
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
        jsonb_build_object('name', 'assessment_mass_edit', 'label', 'Mass Edit')
      )), false
  );

-- Layout: ASHRAE Level 2  →  RT picklist_value = ASHRAE_Level_2
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'assessments' AND picklist_field = 'record_type' AND picklist_value = 'ASHRAE_Level_2' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'ASHRAE Level 2', 'assessments',
    'record_detail', true,
    'Imported from SF Layout: Assessment__c-ASHRAE Level 2',
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
        jsonb_build_object('name', 'assessment_matterport_url', 'label', 'Matterport Url'),
        jsonb_build_object('name', 'assessment_drone_footage_link', 'label', 'Drone Footage Link'),
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

-- Layout: Denver-EFR Application  →  RT picklist_value = Denver_EFR_Application
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'assessments' AND picklist_field = 'record_type' AND picklist_value = 'Denver_EFR_Application' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Denver-EFR Application', 'assessments',
    'record_detail', true,
    'Imported from SF Layout: Assessment__c-Denver-EFR Application',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'ERF Application Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'ERF Application Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'assessment_opportunity', 'label', 'Opportunity', 'required', true),
        jsonb_build_object('name', 'assessment_building_owner', 'label', 'Building Owner'),
        jsonb_build_object('name', 'assessment_building_del', 'label', 'Building Del'),
        jsonb_build_object('name', 'assessment_stage', 'label', 'Stage')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'EFR Stage Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'EFR Stage Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_pre_site_visit_meeting', 'label', 'Pre Site Visit Meeting'),
        jsonb_build_object('name', 'assessment_date_of_assessment', 'label', 'Date Of Assessment'),
        jsonb_build_object('name', 'assessment_efr_application_submitted_date', 'label', 'EFR Application Submitted Date'),
        jsonb_build_object('name', 'assessment_efr_pre_approval_date', 'label', 'EFR Pre Approval Date'),
        jsonb_build_object('name', 'assessment_efr_approved_date', 'label', 'EFR Approved Date'),
        jsonb_build_object('name', 'assessment_efr_invoice_submitted_date', 'label', 'EFR Invoice Submitted Date'),
        jsonb_build_object('name', 'assessment_efr_incentive_received_date', 'label', 'EFR Incentive Received Date')
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
        jsonb_build_object('name', 'assessment_building_in_the_city_county_of_denver', 'label', 'Building In The City County Of Denver'),
        jsonb_build_object('name', 'assessment_bldg_is_not_owned_by_city_of_denver', 'label', 'Bldg Is Not Owned By City Of Denver'),
        jsonb_build_object('name', 'assessment_bldg_is_responsible_for_hvac_wh', 'label', 'Bldg Is Responsible For Hvac Wh'),
        jsonb_build_object('name', 'assessment_bldg_is_commercial_or_multifamily', 'label', 'Bldg Is Commercial Or Multifamily'),
        jsonb_build_object('name', 'assessment_bldg_is_regulated_by_denver_bldg_code', 'label', 'Bldg Is Regulated By Denver Bldg Code'),
        jsonb_build_object('name', 'assessment_bldg_is_not_undergoing_major_rehab', 'label', 'Bldg Is Not Undergoing Major Rehab'),
        jsonb_build_object('name', 'assessment_exisitng_gas_hvac_or_water_heating', 'label', 'Exisitng Gas Hvac Or Water Heating'),
        jsonb_build_object('name', 'assessment_agreement_to_terms_and_conditions', 'label', 'Agreement To Terms And Conditions')
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
        jsonb_build_object('name', 'assessment_building_name_if_applicable', 'label', 'Building Name If Applicable'),
        jsonb_build_object('name', 'assessment_building_address_formula', 'label', 'Building Address Formula'),
        jsonb_build_object('name', 'assessment_this_building_is', 'label', 'This Building Is'),
        jsonb_build_object('name', 'assessment_building_use_type', 'label', 'Building Use Type'),
        jsonb_build_object('name', 'assessment_multifamily_of_units_in_building', 'label', 'Multifamily Of Units In Building'),
        jsonb_build_object('name', 'assessment_what_type_of_multifamily_building', 'label', 'What Type Of Multifamily Building'),
        jsonb_build_object('name', 'assessment_what_area_does_the_equipment_you_are_loo', 'label', 'What Area Does The Equipment You Are Loo'),
        jsonb_build_object('name', 'assessment_building_square_footage_if_known', 'label', 'Building Square Footage If Known'),
        jsonb_build_object('name', 'assessment_does_the_building_currently_have_ac', 'label', 'Does The Building Currently Have Ac'),
        jsonb_build_object('name', 'assessment_primary_heating_fuel', 'label', 'Primary Heating Fuel')
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
        jsonb_build_object('name', 'assessment_building_owner_name', 'label', 'Building Owner Name'),
        jsonb_build_object('name', 'assessment_building_owner_office_phone', 'label', 'Building Owner Office Phone'),
        jsonb_build_object('name', 'assessment_building_owner_email_address', 'label', 'Building Owner Email Address'),
        jsonb_build_object('name', 'assessment_is_the_applicant_the_building_owner', 'label', 'Is The Applicant The Building Owner'),
        jsonb_build_object('name', 'assessment_permission_to_apply_on_behalf_of_owner', 'label', 'Permission To Apply On Behalf Of Owner'),
        jsonb_build_object('name', 'assessment_applicant_name', 'label', 'Applicant Name'),
        jsonb_build_object('name', 'assessment_applicant_building_owner_office_phone', 'label', 'Applicant Building Owner Office Phone'),
        jsonb_build_object('name', 'assessment_applicant_building_owner_email', 'label', 'Applicant Building Owner Email'),
        jsonb_build_object('name', 'assessment_your_applicant_preference_for_contact', 'label', 'Your Applicant Preference For Contact'),
        jsonb_build_object('name', 'assessment_language_prefered_to_be_contac', 'label', 'Language Prefered To Be Contac'),
        jsonb_build_object('name', 'assessment_how_did_you_hear_about_this_program', 'label', 'How Did You Hear About This Program'),
        jsonb_build_object('name', 'assessment_who_told_you_about_this_program', 'label', 'Who Told You About This Program')
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
        jsonb_build_object('name', 'assessment_is_the_building_deed_restricted_multifam', 'label', 'Is The Building Deed Restricted Multifam'),
        jsonb_build_object('name', 'assessment_is_the_regulatory_agreement_attached', 'label', 'Is The Regulatory Agreement Attached'),
        jsonb_build_object('name', 'assessment_is_the_building_naturally_occurring_affo', 'label', 'Is The Building Naturally Occurring Affo'),
        jsonb_build_object('name', 'assessment_is_the_rent_roll_attached', 'label', 'Is The Rent Roll Attached'),
        jsonb_build_object('name', 'assessment_is_the_applicant_a_human_service_provide', 'label', 'Is The Applicant A Human Service Provide'),
        jsonb_build_object('name', 'assessment_which_type_of_human_service_provider', 'label', 'Which Type Of Human Service Provider'),
        jsonb_build_object('name', 'assessment_please_describe_the_critical_services', 'label', 'Please Describe The Critical Services')
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
        jsonb_build_object('name', 'assessment_are_you_looking_to_replace_your_space_he', 'label', 'Are You Looking To Replace Your Space He'),
        jsonb_build_object('name', 'assessment_equipment_to_be_replaced', 'label', 'Equipment To Be Replaced'),
        jsonb_build_object('name', 'assessment_number_of_equipment_type_to_be_replacedc', 'label', 'Number Of Equipment Type To Be Replacedc'),
        jsonb_build_object('name', 'assessment_year_of_exising_equipment_install', 'label', 'Year Of Exising Equipment Install'),
        jsonb_build_object('name', 'assessment_details_on_equip_to_be_installed', 'label', 'Details On Equip To Be Installed'),
        jsonb_build_object('name', 'assessment_dont_yet_know_what_to_install', 'label', 'Dont Yet Know What To Install'),
        jsonb_build_object('name', 'assessment_how_soon_would_you_like_to_replace_equip', 'label', 'How Soon Would You Like To Replace Equip'),
        jsonb_build_object('name', 'assessment_i_would_be_interested_in_assisting', 'label', 'I Would Be Interested In Assisting')
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
        jsonb_build_object('name', 'assessment_company_to_receive_equipment_rebate', 'label', 'Company To Receive Equipment Rebate'),
        jsonb_build_object('name', 'assessment_contact_to_receive_equipment_rebate', 'label', 'Contact To Receive Equipment Rebate'),
        jsonb_build_object('name', 'assessment_mailing_address_for_rebates', 'label', 'Mailing Address For Rebates'),
        jsonb_build_object('name', 'assessment_mailing_address_attn_to_if_needed', 'label', 'Mailing Address Attn To If Needed')
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
        jsonb_build_object('name', 'assessment_applicant_title', 'label', 'Applicant Title'),
        jsonb_build_object('name', 'assessment_applicant_signature', 'label', 'Applicant Signature')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 10, 'System Detaills', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Detaills', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'assessment_record_type', 'label', 'Record Type'),
        jsonb_build_object('name', 'assessment_mass_edit', 'label', 'Mass Edit')
      )), false
  );


END $$;
