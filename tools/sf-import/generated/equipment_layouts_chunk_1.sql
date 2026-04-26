-- --- EQUIPMENT layouts from SF -------------
-- 5 SF layouts found for Equipment__c

DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN

-- Soft-delete the previous Standard equipment layout, if any
UPDATE public.page_layouts SET is_deleted = true, updated_at = now()
WHERE page_layout_object = 'equipment' AND is_deleted = false;

-- Layout: Equipment Layout  →  RT picklist_value = (default fallback)
  rt_id := NULL;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Equipment Layout', 'equipment',
    'record_detail', true,
    'Imported from SF Layout: Equipment__c-Equipment Layout',
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
        jsonb_build_object('name', 'equipment_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'equipment_equipment_name_or_number', 'label', 'Equipment Name Or Number'),
        jsonb_build_object('name', 'equipment_equipment_type', 'label', 'Equipment Type'),
        jsonb_build_object('name', 'equipment_equipment_description', 'label', 'Equipment Description'),
        jsonb_build_object('name', 'equipment_equipment_manufacturer', 'label', 'Equipment Manufacturer'),
        jsonb_build_object('name', 'equipment_equipment_model', 'label', 'Equipment Model'),
        jsonb_build_object('name', 'equipment_equipment_serial_number', 'label', 'Equipment Serial Number'),
        jsonb_build_object('name', 'equipment_equipment_image', 'label', 'Equipment Image')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Equipment Status Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Equipment Status Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'equipment_equipment_status', 'label', 'Equipment Status'),
        jsonb_build_object('name', 'equipment_issue_frequency', 'label', 'Issue Frequency'),
        jsonb_build_object('name', 'equipment_assigned_to', 'label', 'Assigned To'),
        jsonb_build_object('name', 'equipment_date_equipment_placed_into_service', 'label', 'Date Equipment Placed Into Service'),
        jsonb_build_object('name', 'equipment_date_of_last_inventory', 'label', 'Date Of Last Inventory'),
        jsonb_build_object('name', 'equipment_equipment_date_of_last_service', 'label', 'Equipment Date Of Last Service')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Equipment Location', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Equipment Location', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'equipment_location', 'label', 'Location', 'required', true),
        jsonb_build_object('name', 'equipment_equipment_container', 'label', 'Equipment Container', 'required', true),
        jsonb_build_object('name', 'equipment_equipment_vehicle', 'label', 'Equipment Vehicle')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Record Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Record Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'equipment_equipment_record_id', 'label', 'Equipment Record ID')
      )), false
  );

-- Layout: Mechanical Equipment  →  RT picklist_value = Mechanical_Equipment
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'equipment' AND picklist_field = 'record_type' AND picklist_value = 'Mechanical_Equipment' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Mechanical Equipment', 'equipment',
    'record_detail', true,
    'Imported from SF Layout: Equipment__c-Mechanical Equipment',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Mechanical Equipment Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Mechanical Equipment Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'equipment_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'equipment_equipment_name_or_number', 'label', 'Equipment Name Or Number')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Manufacture Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Manufacture Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'equipment_equipment_manufacturer', 'label', 'Equipment Manufacturer'),
        jsonb_build_object('name', 'equipment_equipment_model', 'label', 'Equipment Model')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Fields', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Fields', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'equipment_equipment_container', 'label', 'Equipment Container', 'required', true),
        jsonb_build_object('name', 'equipment_location', 'label', 'Location', 'required', true)
      )), false
  );

-- Layout: Phone - Cellular  →  RT picklist_value = Phone_Cellular
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'equipment' AND picklist_field = 'record_type' AND picklist_value = 'Phone_Cellular' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Phone - Cellular', 'equipment',
    'record_detail', true,
    'Imported from SF Layout: Equipment__c-Phone - Cellular',
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
        jsonb_build_object('name', 'equipment_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'equipment_equipment_name_or_number', 'label', 'Equipment Name Or Number'),
        jsonb_build_object('name', 'equipment_equipment_type', 'label', 'Equipment Type'),
        jsonb_build_object('name', 'equipment_equipment_description', 'label', 'Equipment Description'),
        jsonb_build_object('name', 'equipment_equipment_manufacturer', 'label', 'Equipment Manufacturer'),
        jsonb_build_object('name', 'equipment_equipment_model', 'label', 'Equipment Model'),
        jsonb_build_object('name', 'equipment_equipment_serial_number', 'label', 'Equipment Serial Number'),
        jsonb_build_object('name', 'equipment_imei', 'label', 'Imei'),
        jsonb_build_object('name', 'equipment_imei_2', 'label', 'Imei 2')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Equipment System Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Equipment System Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'equipment_phone_number', 'label', 'Phone Number'),
        jsonb_build_object('name', 'equipment_screen_lock_code', 'label', 'Screen Lock Code'),
        jsonb_build_object('name', 'equipment_registered_email', 'label', 'Registered Email'),
        jsonb_build_object('name', 'equipment_registered_email_password', 'label', 'Registered Email Password')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Equipment Status Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Equipment Status Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'equipment_equipment_status', 'label', 'Equipment Status'),
        jsonb_build_object('name', 'equipment_issue_frequency', 'label', 'Issue Frequency'),
        jsonb_build_object('name', 'equipment_assigned_to', 'label', 'Assigned To'),
        jsonb_build_object('name', 'equipment_date_equipment_placed_into_service', 'label', 'Date Equipment Placed Into Service'),
        jsonb_build_object('name', 'equipment_date_of_last_inventory', 'label', 'Date Of Last Inventory'),
        jsonb_build_object('name', 'equipment_equipment_date_of_last_service', 'label', 'Equipment Date Of Last Service')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Equipment Location', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Equipment Location', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'equipment_location', 'label', 'Location', 'required', true),
        jsonb_build_object('name', 'equipment_equipment_container', 'label', 'Equipment Container', 'required', true),
        jsonb_build_object('name', 'equipment_equipment_vehicle', 'label', 'Equipment Vehicle')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Record Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Record Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'equipment_equipment_record_id', 'label', 'Equipment Record ID')
      )), false
  );


END $$;
