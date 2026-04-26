-- --- DIAGNOSTIC_TESTS layouts from SF -------------
-- 5 SF layouts found for Diagnostic_Test__c

DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN

-- Soft-delete the previous Standard diagnostic_tests layout, if any
UPDATE public.page_layouts SET is_deleted = true, updated_at = now()
WHERE page_layout_object = 'diagnostic_tests' AND is_deleted = false;

-- Layout: Blower Door Test-In  →  RT picklist_value = Blower_Door_Test_In
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'diagnostic_tests' AND picklist_field = 'record_type' AND picklist_value = 'Blower_Door_Test_In' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Blower Door Test-In', 'diagnostic_tests',
    'record_detail', true,
    'Imported from SF Layout: Diagnostic_Test__c-Blower Door Test-In',
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
        jsonb_build_object('name', 'diagnostic_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'diagnostic_unit', 'label', 'Unit'),
        jsonb_build_object('name', 'diagnostic_building', 'label', 'Building'),
        jsonb_build_object('name', 'diagnostic_opportunity', 'label', 'Opportunity'),
        jsonb_build_object('name', 'diagnostic_property', 'label', 'Property'),
        jsonb_build_object('name', 'diagnostic_project', 'label', 'Project'),
        jsonb_build_object('name', 'diagnostic_assessment', 'label', 'Assessment'),
        jsonb_build_object('name', 'diagnostic_ee_measure', 'label', 'EE Measure', 'required', true),
        jsonb_build_object('name', 'diagnostic_technician', 'label', 'Technician'),
        jsonb_build_object('name', 'diagnostic_status', 'label', 'Status'),
        jsonb_build_object('name', 'diagnostic_date_of_diagnostic_test', 'label', 'Date Of Diagnostic Test'),
        jsonb_build_object('name', 'diagnostic_owner', 'label', 'Owner')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Building Characteristics', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Building Characteristics', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'diagnostic_stories_of_building', 'label', 'Stories Of Building'),
        jsonb_build_object('name', 'diagnostic_building_sq_ft', 'label', 'Building Sq Ft')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Blower Door Test', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Blower Door Test', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'diagnostic_location_of_blower_door', 'label', 'Location Of Blower Door'),
        jsonb_build_object('name', 'diagnostic_blower_door_test_type', 'label', 'Blower Door Test Type'),
        jsonb_build_object('name', 'diagnostic_square_feet_tested', 'label', 'Square Feet Tested'),
        jsonb_build_object('name', 'diagnostic_volume_tested', 'label', 'Volume Tested'),
        jsonb_build_object('name', 'diagnostic_pre_blower_door_cfm', 'label', 'Pre Blower Door CFM'),
        jsonb_build_object('name', 'diagnostic_pre_ach50', 'label', 'Pre Ach50')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Test Details', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Test Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'diagnostic_test_notes', 'label', 'Test Notes')
      )), false
  );

-- Layout: Blower Door Test-Out  →  RT picklist_value = Blower_Door_Test_Out
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'diagnostic_tests' AND picklist_field = 'record_type' AND picklist_value = 'Blower_Door_Test_Out' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Blower Door Test-Out', 'diagnostic_tests',
    'record_detail', true,
    'Imported from SF Layout: Diagnostic_Test__c-Blower Door Test-Out',
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
        jsonb_build_object('name', 'diagnostic_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'diagnostic_unit', 'label', 'Unit'),
        jsonb_build_object('name', 'diagnostic_building', 'label', 'Building'),
        jsonb_build_object('name', 'diagnostic_opportunity', 'label', 'Opportunity'),
        jsonb_build_object('name', 'diagnostic_property', 'label', 'Property'),
        jsonb_build_object('name', 'diagnostic_square_feet_tested', 'label', 'Square Feet Tested'),
        jsonb_build_object('name', 'diagnostic_volume_tested', 'label', 'Volume Tested'),
        jsonb_build_object('name', 'diagnostic_project', 'label', 'Project'),
        jsonb_build_object('name', 'diagnostic_assessment', 'label', 'Assessment'),
        jsonb_build_object('name', 'diagnostic_ee_measure', 'label', 'EE Measure', 'required', true),
        jsonb_build_object('name', 'diagnostic_technician', 'label', 'Technician'),
        jsonb_build_object('name', 'diagnostic_status', 'label', 'Status'),
        jsonb_build_object('name', 'diagnostic_date_of_diagnostic_test', 'label', 'Date Of Diagnostic Test'),
        jsonb_build_object('name', 'diagnostic_owner', 'label', 'Owner')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Building Characteristics', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Building Characteristics', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'diagnostic_stories_of_building', 'label', 'Stories Of Building'),
        jsonb_build_object('name', 'diagnostic_building_sq_ft', 'label', 'Building Sq Ft')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Blower Door Test', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Blower Door Test', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'diagnostic_location_of_blower_door', 'label', 'Location Of Blower Door'),
        jsonb_build_object('name', 'diagnostic_blower_door_test_type', 'label', 'Blower Door Test Type'),
        jsonb_build_object('name', 'diagnostic_post_blower_door_cfm', 'label', 'Post Blower Door CFM'),
        jsonb_build_object('name', 'diagnostic_post_ach50', 'label', 'Post Ach50')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Test Details', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Test Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'diagnostic_test_notes', 'label', 'Test Notes')
      )), false
  );

-- Layout: CAZ Test-In  →  RT picklist_value = CAZTI
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'diagnostic_tests' AND picklist_field = 'record_type' AND picklist_value = 'CAZTI' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'CAZ Test-In', 'diagnostic_tests',
    'record_detail', true,
    'Imported from SF Layout: Diagnostic_Test__c-CAZ Test-In',
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
        jsonb_build_object('name', 'diagnostic_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'diagnostic_unit', 'label', 'Unit'),
        jsonb_build_object('name', 'diagnostic_building', 'label', 'Building'),
        jsonb_build_object('name', 'diagnostic_opportunity', 'label', 'Opportunity'),
        jsonb_build_object('name', 'diagnostic_property', 'label', 'Property'),
        jsonb_build_object('name', 'diagnostic_project', 'label', 'Project'),
        jsonb_build_object('name', 'diagnostic_assessment', 'label', 'Assessment'),
        jsonb_build_object('name', 'diagnostic_ee_measure', 'label', 'EE Measure', 'required', true),
        jsonb_build_object('name', 'diagnostic_technician', 'label', 'Technician'),
        jsonb_build_object('name', 'diagnostic_date_of_diagnostic_test', 'label', 'Date Of Diagnostic Test'),
        jsonb_build_object('name', 'diagnostic_status', 'label', 'Status')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Appliance Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Appliance Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'diagnostic_appliance_tested', 'label', 'Appliance Tested'),
        jsonb_build_object('name', 'diagnostic_manufacture', 'label', 'Manufacture'),
        jsonb_build_object('name', 'diagnostic_model_number', 'label', 'Model Number'),
        jsonb_build_object('name', 'diagnostic_capacity', 'label', 'Capacity'),
        jsonb_build_object('name', 'diagnostic_rated_efficiency', 'label', 'Rated Efficiency'),
        jsonb_build_object('name', 'diagnostic_condition_of_appliance', 'label', 'Condition Of Appliance'),
        jsonb_build_object('name', 'diagnostic_efficiency_estimated', 'label', 'Efficiency Estimated'),
        jsonb_build_object('name', 'diagnostic_image_of_appliance_nameplate', 'label', 'Image Of Appliance Nameplate')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Combustion Analyzation (CAZ)', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Combustion Analyzation (CAZ)', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'diagnostic_pre_combustion_analysis_co', 'label', 'Pre Combustion Analysis Co'),
        jsonb_build_object('name', 'diagnostic_pre_combustion_efficiency', 'label', 'Pre Combustion Efficiency'),
        jsonb_build_object('name', 'diagnostic_image_of_appliance_combustion_analysis', 'label', 'Image Of Appliance Combustion Analysis')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Observations', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Observations', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'diagnostic_test_notes', 'label', 'Test Notes')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'System Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'diagnostic_owner', 'label', 'Owner')
      )), false
  );

-- Layout: CAZ Test-Out  →  RT picklist_value = CAZTO
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'diagnostic_tests' AND picklist_field = 'record_type' AND picklist_value = 'CAZTO' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'CAZ Test-Out', 'diagnostic_tests',
    'record_detail', true,
    'Imported from SF Layout: Diagnostic_Test__c-CAZ Test-Out',
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
        jsonb_build_object('name', 'diagnostic_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'diagnostic_unit', 'label', 'Unit'),
        jsonb_build_object('name', 'diagnostic_building', 'label', 'Building'),
        jsonb_build_object('name', 'diagnostic_opportunity', 'label', 'Opportunity'),
        jsonb_build_object('name', 'diagnostic_property', 'label', 'Property'),
        jsonb_build_object('name', 'diagnostic_project', 'label', 'Project'),
        jsonb_build_object('name', 'diagnostic_assessment', 'label', 'Assessment'),
        jsonb_build_object('name', 'diagnostic_image_of_appliance_nameplate', 'label', 'Image Of Appliance Nameplate'),
        jsonb_build_object('name', 'diagnostic_image_of_appliance_combustion_analysis', 'label', 'Image Of Appliance Combustion Analysis'),
        jsonb_build_object('name', 'diagnostic_afue_estimate', 'label', 'Afue Estimate'),
        jsonb_build_object('name', 'diagnostic_model_number', 'label', 'Model Number'),
        jsonb_build_object('name', 'diagnostic_rated_afue', 'label', 'Rated Afue'),
        jsonb_build_object('name', 'diagnostic_capacity', 'label', 'Capacity'),
        jsonb_build_object('name', 'diagnostic_post_combustion_efficiency', 'label', 'Post Combustion Efficiency'),
        jsonb_build_object('name', 'diagnostic_efficiency_estimated', 'label', 'Efficiency Estimated'),
        jsonb_build_object('name', 'diagnostic_rated_efficiency', 'label', 'Rated Efficiency'),
        jsonb_build_object('name', 'diagnostic_manufacture', 'label', 'Manufacture'),
        jsonb_build_object('name', 'diagnostic_ee_measure', 'label', 'EE Measure', 'required', true),
        jsonb_build_object('name', 'diagnostic_technician', 'label', 'Technician'),
        jsonb_build_object('name', 'diagnostic_date_of_diagnostic_test', 'label', 'Date Of Diagnostic Test'),
        jsonb_build_object('name', 'diagnostic_status', 'label', 'Status')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Combustion Analyzation (CAZ)', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Combustion Analyzation (CAZ)', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'diagnostic_appliance_tested', 'label', 'Appliance Tested'),
        jsonb_build_object('name', 'diagnostic_post_combustion_analysis_co', 'label', 'Post Combustion Analysis Co')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Observations', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Observations', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'diagnostic_condition_of_appliance', 'label', 'Condition Of Appliance'),
        jsonb_build_object('name', 'diagnostic_test_notes', 'label', 'Test Notes')
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
        jsonb_build_object('name', 'diagnostic_owner', 'label', 'Owner')
      )), false
  );

-- Layout: EXH Test  →  RT picklist_value = EXH_Test
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'diagnostic_tests' AND picklist_field = 'record_type' AND picklist_value = 'EXH_Test' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'EXH Test', 'diagnostic_tests',
    'record_detail', true,
    'Imported from SF Layout: Diagnostic_Test__c-EXH Test',
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
        jsonb_build_object('name', 'diagnostic_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'diagnostic_project', 'label', 'Project'),
        jsonb_build_object('name', 'diagnostic_property', 'label', 'Property'),
        jsonb_build_object('name', 'diagnostic_building', 'label', 'Building'),
        jsonb_build_object('name', 'diagnostic_unit', 'label', 'Unit'),
        jsonb_build_object('name', 'diagnostic_status', 'label', 'Status'),
        jsonb_build_object('name', 'diagnostic_location_of_exhaust_fan', 'label', 'Location Of Exhaust Fan'),
        jsonb_build_object('name', 'diagnostic_ee_measure', 'label', 'EE Measure', 'required', true),
        jsonb_build_object('name', 'diagnostic_date_of_diagnostic_test', 'label', 'Date Of Diagnostic Test'),
        jsonb_build_object('name', 'diagnostic_technician', 'label', 'Technician')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Appliance Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Appliance Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'diagnostic_appliance_tested', 'label', 'Appliance Tested'),
        jsonb_build_object('name', 'diagnostic_cfm_existing', 'label', 'CFM Existing'),
        jsonb_build_object('name', 'diagnostic_cfm_new', 'label', 'CFM New'),
        jsonb_build_object('name', 'diagnostic_existing_pressure_pa', 'label', 'Existing Pressure Pa'),
        jsonb_build_object('name', 'diagnostic_new_pressure_pa', 'label', 'New Pressure Pa')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Observations', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Observations', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'diagnostic_test_notes', 'label', 'Test Notes')
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
        jsonb_build_object('name', 'diagnostic_owner', 'label', 'Owner')
      )), false
  );


END $$;
