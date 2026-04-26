-- --- VEHICLE_ACTIVITIES layouts from SF -------------
-- 6 SF layouts found for Vehicle_Activity__c

DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN

-- Soft-delete the previous Standard vehicle_activities layout, if any
UPDATE public.page_layouts SET is_deleted = true, updated_at = now()
WHERE page_layout_object = 'vehicle_activities' AND is_deleted = false;

-- Layout: Vehicle Activity Layout  →  RT picklist_value = (default fallback)
  rt_id := NULL;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Vehicle Activity Layout', 'vehicle_activities',
    'record_detail', true,
    'Imported from SF Layout: Vehicle_Activity__c-Vehicle Activity Layout',
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
        jsonb_build_object('name', 'va_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'va_vehicle', 'label', 'Vehicle', 'required', true),
        jsonb_build_object('name', 'va_name_of_driver', 'label', 'Name Of Driver'),
        jsonb_build_object('name', 'va_vehicle_odometer_reading', 'label', 'Vehicle Odometer Reading'),
        jsonb_build_object('name', 'va_vehicle_activity_date_time', 'label', 'Vehicle Activity Date Time'),
        jsonb_build_object('name', 'va_vehicle_activity_location', 'label', 'Vehicle Activity Location'),
        jsonb_build_object('name', 'va_vehicle_activity_cost', 'label', 'Vehicle Activity Cost'),
        jsonb_build_object('name', 'va_vehicle_activity_notes', 'label', 'Vehicle Activity Notes'),
        jsonb_build_object('name', 'va_geo_location', 'label', 'Geo Location'),
        jsonb_build_object('name', 'va_vehicle_activity_status', 'label', 'Vehicle Activity Status'),
        jsonb_build_object('name', 'va_fuel_price_per_gallon', 'label', 'Fuel Price Per Gallon'),
        jsonb_build_object('name', 'va_fuel_number_of_gallons', 'label', 'Fuel Number Of Gallons'),
        jsonb_build_object('name', 'va_type_of_fuel', 'label', 'Type Of Fuel'),
        jsonb_build_object('name', 'va_vehicle_condition_of_tires', 'label', 'Vehicle Condition Of Tires'),
        jsonb_build_object('name', 'va_vehicle_activity_follow_up_required', 'label', 'Vehicle Activity Follow Up Required'),
        jsonb_build_object('name', 'va_insurance_involvement_required', 'label', 'Insurance Involvement Required'),
        jsonb_build_object('name', 'va_insurance_claim_number', 'label', 'Insurance Claim Number'),
        jsonb_build_object('name', 'va_incidental_property_damage', 'label', 'Incidental Property Damage'),
        jsonb_build_object('name', 'va_estimated_cost', 'label', 'Estimated Cost'),
        jsonb_build_object('name', 'va_estimated_time', 'label', 'Estimated Time')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'System Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'va_locked', 'label', 'Locked')
      )), false
  );

-- Layout: Vehicle Check Out  →  RT picklist_value = Vehicle_Check_Out
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'vehicle_activities' AND picklist_field = 'record_type' AND picklist_value = 'Vehicle_Check_Out' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Vehicle Check Out', 'vehicle_activities',
    'record_detail', true,
    'Imported from SF Layout: Vehicle_Activity__c-Vehicle Check Out',
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
        jsonb_build_object('name', 'va_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'va_vehicle', 'label', 'Vehicle', 'required', true),
        jsonb_build_object('name', 'va_driver', 'label', 'Driver'),
        jsonb_build_object('name', 'va_vehicle_odometer_reading', 'label', 'Vehicle Odometer Reading'),
        jsonb_build_object('name', 'va_vehicle_activity_status', 'label', 'Vehicle Activity Status'),
        jsonb_build_object('name', 'va_time_of_check_out', 'label', 'Time Of Check Out'),
        jsonb_build_object('name', 'va_time_of_check_in', 'label', 'Time Of Check In'),
        jsonb_build_object('name', 'va_vehicle_activity_location', 'label', 'Vehicle Activity Location'),
        jsonb_build_object('name', 'va_vehicle_activity_notes', 'label', 'Vehicle Activity Notes')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'System Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'va_locked', 'label', 'Locked')
      )), false
  );

-- Layout: Vehicle Fuel Log  →  RT picklist_value = Vehicle_Fuel_Log
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'vehicle_activities' AND picklist_field = 'record_type' AND picklist_value = 'Vehicle_Fuel_Log' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Vehicle Fuel Log', 'vehicle_activities',
    'record_detail', true,
    'Imported from SF Layout: Vehicle_Activity__c-Vehicle Fuel Log',
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
        jsonb_build_object('name', 'va_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'va_vehicle', 'label', 'Vehicle', 'required', true),
        jsonb_build_object('name', 'va_driver', 'label', 'Driver'),
        jsonb_build_object('name', 'va_vehicle_odometer_reading', 'label', 'Vehicle Odometer Reading'),
        jsonb_build_object('name', 'va_vehicle_activity_date_time', 'label', 'Vehicle Activity Date Time'),
        jsonb_build_object('name', 'va_vehicle_activity_status', 'label', 'Vehicle Activity Status'),
        jsonb_build_object('name', 'va_type_of_fuel', 'label', 'Type Of Fuel'),
        jsonb_build_object('name', 'va_fuel_price_per_gallon', 'label', 'Fuel Price Per Gallon'),
        jsonb_build_object('name', 'va_geo_location', 'label', 'Geo Location'),
        jsonb_build_object('name', 'va_fuel_number_of_gallons', 'label', 'Fuel Number Of Gallons'),
        jsonb_build_object('name', 'va_vehicle_activity_cost', 'label', 'Vehicle Activity Cost'),
        jsonb_build_object('name', 'va_vehicle_activity_notes', 'label', 'Vehicle Activity Notes')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'System Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'va_locked', 'label', 'Locked')
      )), false
  );

-- Layout: Vehicle Oil Filter Service  →  RT picklist_value = Vehicle_Oil_Filter_Service
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'vehicle_activities' AND picklist_field = 'record_type' AND picklist_value = 'Vehicle_Oil_Filter_Service' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Vehicle Oil Filter Service', 'vehicle_activities',
    'record_detail', true,
    'Imported from SF Layout: Vehicle_Activity__c-Vehicle Oil Filter Service',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Vehicle Activity Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Vehicle Activity Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'va_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'va_vehicle', 'label', 'Vehicle', 'required', true),
        jsonb_build_object('name', 'va_driver', 'label', 'Driver'),
        jsonb_build_object('name', 'va_vehicle_odometer_reading', 'label', 'Vehicle Odometer Reading'),
        jsonb_build_object('name', 'va_vehicle_activity_date_time', 'label', 'Vehicle Activity Date Time'),
        jsonb_build_object('name', 'va_vehicle_activity_status', 'label', 'Vehicle Activity Status'),
        jsonb_build_object('name', 'va_vehicle_activity_location', 'label', 'Vehicle Activity Location'),
        jsonb_build_object('name', 'va_geo_location', 'label', 'Geo Location'),
        jsonb_build_object('name', 'va_vehicle_activity_cost', 'label', 'Vehicle Activity Cost'),
        jsonb_build_object('name', 'va_vehicle_activity_follow_up_required', 'label', 'Vehicle Activity Follow Up Required'),
        jsonb_build_object('name', 'va_vehicle_activity_notes', 'label', 'Vehicle Activity Notes')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'System Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'va_locked', 'label', 'Locked')
      )), false
  );

-- Layout: Vehicle Tire Service  →  RT picklist_value = Vehicle_Tire_Service
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'vehicle_activities' AND picklist_field = 'record_type' AND picklist_value = 'Vehicle_Tire_Service' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Vehicle Tire Service', 'vehicle_activities',
    'record_detail', true,
    'Imported from SF Layout: Vehicle_Activity__c-Vehicle Tire Service',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Vehicle Activity Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Vehicle Activity Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'va_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'va_vehicle', 'label', 'Vehicle', 'required', true),
        jsonb_build_object('name', 'va_driver', 'label', 'Driver'),
        jsonb_build_object('name', 'va_vehicle_odometer_reading', 'label', 'Vehicle Odometer Reading'),
        jsonb_build_object('name', 'va_vehicle_activity_date_time', 'label', 'Vehicle Activity Date Time'),
        jsonb_build_object('name', 'va_vehicle_activity_status', 'label', 'Vehicle Activity Status'),
        jsonb_build_object('name', 'va_vehicle_activity_location', 'label', 'Vehicle Activity Location'),
        jsonb_build_object('name', 'va_geo_location', 'label', 'Geo Location'),
        jsonb_build_object('name', 'va_vehicle_condition_of_tires', 'label', 'Vehicle Condition Of Tires'),
        jsonb_build_object('name', 'va_vehicle_activity_cost', 'label', 'Vehicle Activity Cost'),
        jsonb_build_object('name', 'va_vehicle_activity_follow_up_required', 'label', 'Vehicle Activity Follow Up Required'),
        jsonb_build_object('name', 'va_vehicle_activity_notes', 'label', 'Vehicle Activity Notes')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'System Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'va_locked', 'label', 'Locked')
      )), false
  );


END $$;
