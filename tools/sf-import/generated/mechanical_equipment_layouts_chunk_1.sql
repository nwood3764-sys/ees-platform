-- --- MECHANICAL_EQUIPMENT layouts from SF -------------
-- 8 SF layouts found for Mechanical_Equipment__c

DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN

-- Soft-delete the previous Standard mechanical_equipment layout, if any
UPDATE public.page_layouts SET is_deleted = true, updated_at = now()
WHERE page_layout_object = 'mechanical_equipment' AND is_deleted = false;

-- Layout: Cooking Equipment  →  RT picklist_value = Cooking_Equipment
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'mechanical_equipment' AND picklist_field = 'record_type' AND picklist_value = 'Cooking_Equipment' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Cooking Equipment', 'mechanical_equipment',
    'record_detail', true,
    'Imported from SF Layout: Mechanical_Equipment__c-Cooking Equipment',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Fields', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Fields', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'me_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'me_heating_system_type', 'label', 'Heating System Type'),
        jsonb_build_object('name', 'me_heating_fuel_type', 'label', 'Heating Fuel Type'),
        jsonb_build_object('name', 'me_equipment_capacity', 'label', 'Equipment Capacity'),
        jsonb_build_object('name', 'me_equipment_model_number', 'label', 'Equipment Model Number'),
        jsonb_build_object('name', 'me_equipment_serial_number', 'label', 'Equipment Serial Number'),
        jsonb_build_object('name', 'me_equipment_manufacture', 'label', 'Equipment Manufacture'),
        jsonb_build_object('name', 'me_equipment_year_of_manufacture', 'label', 'Equipment Year Of Manufacture'),
        jsonb_build_object('name', 'me_equipment_condition', 'label', 'Equipment Condition'),
        jsonb_build_object('name', 'me_fuel_type', 'label', 'Fuel Type'),
        jsonb_build_object('name', 'me_equipment_notes', 'label', 'Equipment Notes'),
        jsonb_build_object('name', 'me_system_condition', 'label', 'System Condition'),
        jsonb_build_object('name', 'me_system_number', 'label', 'System Number'),
        jsonb_build_object('name', 'me_input_capacity', 'label', 'Input Capacity'),
        jsonb_build_object('name', 'me_output_capacity', 'label', 'Output Capacity'),
        jsonb_build_object('name', 'me_hp_cooling_capacity_ton', 'label', 'Hp Cooling Capacity Ton')
      )), false
  );

-- Layout: Heat Pump Indoor Unit  →  RT picklist_value = Heat_Pump_Indoor_Unit
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'mechanical_equipment' AND picklist_field = 'record_type' AND picklist_value = 'Heat_Pump_Indoor_Unit' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Heat Pump Indoor Unit', 'mechanical_equipment',
    'record_detail', true,
    'Imported from SF Layout: Mechanical_Equipment__c-Heat Pump Indoor Unit',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Equipment Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Equipment Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'me_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'me_indoor_unit_model_number', 'label', 'Indoor Unit Model Number'),
        jsonb_build_object('name', 'me_equipment_manufacture', 'label', 'Equipment Manufacture'),
        jsonb_build_object('name', 'me_ahri_reference_number', 'label', 'AHRI Reference Number'),
        jsonb_build_object('name', 'me_neep_or_ahri_cold_climate_certified', 'label', 'Neep Or AHRI Cold Climate Certified'),
        jsonb_build_object('name', 'me_connectible_system', 'label', 'Connectible System')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Equipment Performance', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Equipment Performance', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'me_heating_capacity_47_f', 'label', 'Heating Capacity 47 F'),
        jsonb_build_object('name', 'me_heating_capacity_17_f', 'label', 'Heating Capacity 17 F'),
        jsonb_build_object('name', 'me_heating_capacity_5_f', 'label', 'Heating Capacity 5 F'),
        jsonb_build_object('name', 'me_cooling_capacity_95_f', 'label', 'Cooling Capacity 95 F'),
        jsonb_build_object('name', 'me_heat_pump_cooling_seer2', 'label', 'Heat Pump Cooling Seer2'),
        jsonb_build_object('name', 'me_heat_pump_cooling_eer2', 'label', 'Heat Pump Cooling Eer2'),
        jsonb_build_object('name', 'me_eer', 'label', 'Eer'),
        jsonb_build_object('name', 'me_heat_pump_cop_at_47_f', 'label', 'Heat Pump Cop At 47 F'),
        jsonb_build_object('name', 'me_heat_pump_cop_at_17_f', 'label', 'Heat Pump Cop At 17 F'),
        jsonb_build_object('name', 'me_heating_cop_5_f', 'label', 'Heating Cop 5 F'),
        jsonb_build_object('name', 'me_hp_hspf', 'label', 'Hp Hspf'),
        jsonb_build_object('name', 'me_ahri_certified_ratings_hspf2_region_i', 'label', 'AHRI Certified Ratings Hspf2 Region I')
      )), false
  );

-- Layout: Heat Pump Outdoor Unit  →  RT picklist_value = Heat_Pump_Outdoor_Unit
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'mechanical_equipment' AND picklist_field = 'record_type' AND picklist_value = 'Heat_Pump_Outdoor_Unit' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Heat Pump Outdoor Unit', 'mechanical_equipment',
    'record_detail', true,
    'Imported from SF Layout: Mechanical_Equipment__c-Heat Pump Outdoor Unit',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Equipment Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Equipment Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'me_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'me_outdoor_unit_model_number', 'label', 'Outdoor Unit Model Number'),
        jsonb_build_object('name', 'me_equipment_manufacture', 'label', 'Equipment Manufacture'),
        jsonb_build_object('name', 'me_ahri_reference_number', 'label', 'AHRI Reference Number'),
        jsonb_build_object('name', 'me_neep_or_ahri_cold_climate_certified', 'label', 'Neep Or AHRI Cold Climate Certified'),
        jsonb_build_object('name', 'me_connectible_system', 'label', 'Connectible System')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Equipment Performance', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Equipment Performance', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'me_heating_capacity_47_f', 'label', 'Heating Capacity 47 F'),
        jsonb_build_object('name', 'me_heating_capacity_17_f', 'label', 'Heating Capacity 17 F'),
        jsonb_build_object('name', 'me_heating_capacity_5_f', 'label', 'Heating Capacity 5 F'),
        jsonb_build_object('name', 'me_cooling_capacity_95_f', 'label', 'Cooling Capacity 95 F'),
        jsonb_build_object('name', 'me_heat_pump_cooling_seer2', 'label', 'Heat Pump Cooling Seer2'),
        jsonb_build_object('name', 'me_heat_pump_cooling_eer2', 'label', 'Heat Pump Cooling Eer2'),
        jsonb_build_object('name', 'me_heat_pump_cop_at_47_f', 'label', 'Heat Pump Cop At 47 F'),
        jsonb_build_object('name', 'me_heat_pump_cop_at_17_f', 'label', 'Heat Pump Cop At 17 F'),
        jsonb_build_object('name', 'me_heating_cop_5_f', 'label', 'Heating Cop 5 F'),
        jsonb_build_object('name', 'me_hp_hspf', 'label', 'Hp Hspf'),
        jsonb_build_object('name', 'me_ahri_certified_ratings_hspf2_region_i', 'label', 'AHRI Certified Ratings Hspf2 Region I')
      )), false
  );

-- Layout: Mechanical Equipment Layout  →  RT picklist_value = (default fallback)
  rt_id := NULL;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Mechanical Equipment Layout', 'mechanical_equipment',
    'record_detail', true,
    'Imported from SF Layout: Mechanical_Equipment__c-Mechanical Equipment Layout',
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
        jsonb_build_object('name', 'me_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'me_heating_system_type', 'label', 'Heating System Type'),
        jsonb_build_object('name', 'me_heating_fuel_type', 'label', 'Heating Fuel Type'),
        jsonb_build_object('name', 'me_equipment_capacity', 'label', 'Equipment Capacity'),
        jsonb_build_object('name', 'me_equipment_model_number', 'label', 'Equipment Model Number'),
        jsonb_build_object('name', 'me_equipment_serial_number', 'label', 'Equipment Serial Number'),
        jsonb_build_object('name', 'me_equipment_manufacture', 'label', 'Equipment Manufacture'),
        jsonb_build_object('name', 'me_equipment_year_of_manufacture', 'label', 'Equipment Year Of Manufacture'),
        jsonb_build_object('name', 'me_equipment_condition', 'label', 'Equipment Condition'),
        jsonb_build_object('name', 'me_fuel_type', 'label', 'Fuel Type'),
        jsonb_build_object('name', 'me_cooling_system_type', 'label', 'Cooling System Type'),
        jsonb_build_object('name', 'me_equipment_notes', 'label', 'Equipment Notes'),
        jsonb_build_object('name', 'me_system_condition', 'label', 'System Condition'),
        jsonb_build_object('name', 'me_system_number', 'label', 'System Number'),
        jsonb_build_object('name', 'me_input_capacity', 'label', 'Input Capacity'),
        jsonb_build_object('name', 'me_output_capacity', 'label', 'Output Capacity'),
        jsonb_build_object('name', 'me_hp_cooling_capacity_ton', 'label', 'Hp Cooling Capacity Ton'),
        jsonb_build_object('name', 'me_owner', 'label', 'Owner')
      )), false
  );

-- Layout: Refrigeration Equipment  →  RT picklist_value = Refrigeration_Equipment
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'mechanical_equipment' AND picklist_field = 'record_type' AND picklist_value = 'Refrigeration_Equipment' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Refrigeration Equipment', 'mechanical_equipment',
    'record_detail', true,
    'Imported from SF Layout: Mechanical_Equipment__c-Refrigeration Equipment',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Fields', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Fields', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'me_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'me_heating_system_type', 'label', 'Heating System Type'),
        jsonb_build_object('name', 'me_equipment_capacity', 'label', 'Equipment Capacity'),
        jsonb_build_object('name', 'me_equipment_model_number', 'label', 'Equipment Model Number'),
        jsonb_build_object('name', 'me_equipment_serial_number', 'label', 'Equipment Serial Number'),
        jsonb_build_object('name', 'me_equipment_manufacture', 'label', 'Equipment Manufacture'),
        jsonb_build_object('name', 'me_equipment_year_of_manufacture', 'label', 'Equipment Year Of Manufacture'),
        jsonb_build_object('name', 'me_equipment_condition', 'label', 'Equipment Condition'),
        jsonb_build_object('name', 'me_fuel_type', 'label', 'Fuel Type'),
        jsonb_build_object('name', 'me_equipment_notes', 'label', 'Equipment Notes'),
        jsonb_build_object('name', 'me_system_condition', 'label', 'System Condition'),
        jsonb_build_object('name', 'me_system_number', 'label', 'System Number'),
        jsonb_build_object('name', 'me_input_capacity', 'label', 'Input Capacity'),
        jsonb_build_object('name', 'me_output_capacity', 'label', 'Output Capacity'),
        jsonb_build_object('name', 'me_hp_cooling_capacity_ton', 'label', 'Hp Cooling Capacity Ton')
      )), false
  );

-- Layout: Space Cooling Equipment  →  RT picklist_value = Space_Cooling_Equipment
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'mechanical_equipment' AND picklist_field = 'record_type' AND picklist_value = 'Space_Cooling_Equipment' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Space Cooling Equipment', 'mechanical_equipment',
    'record_detail', true,
    'Imported from SF Layout: Mechanical_Equipment__c-Space Cooling Equipment',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Cooling System Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Cooling System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'me_name', 'label', 'Name', 'required', true)
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Cooling Equipment', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Cooling Equipment', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'me_fuel_type', 'label', 'Fuel Type'),
        jsonb_build_object('name', 'me_cooling_system_type', 'label', 'Cooling System Type'),
        jsonb_build_object('name', 'me_equipment_manufacture', 'label', 'Equipment Manufacture'),
        jsonb_build_object('name', 'me_equipment_model_number', 'label', 'Equipment Model Number'),
        jsonb_build_object('name', 'me_cooling_equipment_efficiency', 'label', 'Cooling Equipment Efficiency'),
        jsonb_build_object('name', 'me_seer', 'label', 'Seer'),
        jsonb_build_object('name', 'me_ceer', 'label', 'Ceer'),
        jsonb_build_object('name', 'me_eer', 'label', 'Eer'),
        jsonb_build_object('name', 'me_input_capacity', 'label', 'Input Capacity'),
        jsonb_build_object('name', 'me_output_capacity', 'label', 'Output Capacity'),
        jsonb_build_object('name', 'me_equipment_serial_number', 'label', 'Equipment Serial Number'),
        jsonb_build_object('name', 'me_equipment_year_of_manufacture', 'label', 'Equipment Year Of Manufacture'),
        jsonb_build_object('name', 'me_equipment_condition', 'label', 'Equipment Condition'),
        jsonb_build_object('name', 'me_equipment_notes', 'label', 'Equipment Notes')
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
        jsonb_build_object('name', 'me_system_number', 'label', 'System Number'),
        jsonb_build_object('name', 'me_hp_cooling_capacity_ton', 'label', 'Hp Cooling Capacity Ton')
      )), false
  );

-- Layout: Space Heating Equipment  →  RT picklist_value = Space_Heating_Equipment
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'mechanical_equipment' AND picklist_field = 'record_type' AND picklist_value = 'Space_Heating_Equipment' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Space Heating Equipment', 'mechanical_equipment',
    'record_detail', true,
    'Imported from SF Layout: Mechanical_Equipment__c-Space Heating Equipment',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Heating System Equipment Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Heating System Equipment Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'me_name', 'label', 'Name', 'required', true)
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Heating Equipment', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Heating Equipment', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'me_fuel_type', 'label', 'Fuel Type'),
        jsonb_build_object('name', 'me_heating_system_type', 'label', 'Heating System Type'),
        jsonb_build_object('name', 'me_equipment_manufacture', 'label', 'Equipment Manufacture'),
        jsonb_build_object('name', 'me_equipment_model_number', 'label', 'Equipment Model Number'),
        jsonb_build_object('name', 'me_input_capacity', 'label', 'Input Capacity'),
        jsonb_build_object('name', 'me_output_capacity', 'label', 'Output Capacity'),
        jsonb_build_object('name', 'me_heating_system_efficiency', 'label', 'Heating System Efficiency'),
        jsonb_build_object('name', 'me_equipment_serial_number', 'label', 'Equipment Serial Number'),
        jsonb_build_object('name', 'me_equipment_year_of_manufacture', 'label', 'Equipment Year Of Manufacture'),
        jsonb_build_object('name', 'me_equipment_condition', 'label', 'Equipment Condition'),
        jsonb_build_object('name', 'me_system_number', 'label', 'System Number'),
        jsonb_build_object('name', 'me_equipment_notes', 'label', 'Equipment Notes')
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
        jsonb_build_object('name', 'me_system_condition', 'label', 'System Condition'),
        jsonb_build_object('name', 'me_hp_cooling_capacity_ton', 'label', 'Hp Cooling Capacity Ton')
      )), false
  );

-- Layout: Water Heating Equipment  →  RT picklist_value = Water_Heating_Equipment
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'mechanical_equipment' AND picklist_field = 'record_type' AND picklist_value = 'Water_Heating_Equipment' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Water Heating Equipment', 'mechanical_equipment',
    'record_detail', true,
    'Imported from SF Layout: Mechanical_Equipment__c-Water Heating Equipment',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Water Heating System Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Water Heating System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'me_name', 'label', 'Name', 'required', true)
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Water Heating System Condition', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Water Heating System Condition', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'me_fuel_type', 'label', 'Fuel Type'),
        jsonb_build_object('name', 'me_heating_system_type', 'label', 'Heating System Type'),
        jsonb_build_object('name', 'me_equipment_manufacture', 'label', 'Equipment Manufacture'),
        jsonb_build_object('name', 'me_equipment_model_number', 'label', 'Equipment Model Number'),
        jsonb_build_object('name', 'me_equipment_capacity', 'label', 'Equipment Capacity'),
        jsonb_build_object('name', 'me_input_capacity', 'label', 'Input Capacity'),
        jsonb_build_object('name', 'me_output_capacity', 'label', 'Output Capacity'),
        jsonb_build_object('name', 'me_equipment_serial_number', 'label', 'Equipment Serial Number'),
        jsonb_build_object('name', 'me_equipment_year_of_manufacture', 'label', 'Equipment Year Of Manufacture'),
        jsonb_build_object('name', 'me_system_number', 'label', 'System Number'),
        jsonb_build_object('name', 'me_equipment_condition', 'label', 'Equipment Condition'),
        jsonb_build_object('name', 'me_equipment_notes', 'label', 'Equipment Notes')
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
        jsonb_build_object('name', 'me_hp_cooling_capacity_ton', 'label', 'Hp Cooling Capacity Ton')
      )), false
  );


END $$;
