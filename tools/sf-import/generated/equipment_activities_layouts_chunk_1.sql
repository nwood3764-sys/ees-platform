-- --- EQUIPMENT_ACTIVITIES layouts from SF -------------
-- 7 SF layouts found for Equipment_Activity__c

DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN

-- Soft-delete the previous Standard equipment_activities layout, if any
UPDATE public.page_layouts SET is_deleted = true, updated_at = now()
WHERE page_layout_object = 'equipment_activities' AND is_deleted = false;

-- Layout: Equipment Checked In  →  RT picklist_value = Equipment_Checked_In
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'equipment_activities' AND picklist_field = 'record_type' AND picklist_value = 'Equipment_Checked_In' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Equipment Checked In', 'equipment_activities',
    'record_detail', true,
    'Imported from SF Layout: Equipment_Activity__c-Equipment Checked In',
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
        jsonb_build_object('name', 'ea_name', 'label', 'Name'),
        jsonb_build_object('name', 'ea_equipment_activity_related_equipment', 'label', 'Equipment Activity Related Equipment'),
        jsonb_build_object('name', 'ea_equipment_id', 'label', 'Equipment ID'),
        jsonb_build_object('name', 'ea_equipment_issue_frequency', 'label', 'Equipment Issue Frequency'),
        jsonb_build_object('name', 'ea_equipment_location', 'label', 'Equipment Location'),
        jsonb_build_object('name', 'ea_tech_name', 'label', 'Tech Name'),
        jsonb_build_object('name', 'ea_equipment_activity_check_in_date_time', 'label', 'Equipment Activity Check In Date Time')
      )), false
  );

-- Layout: Equipment Checked Out  →  RT picklist_value = Equipment_Checked_Out
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'equipment_activities' AND picklist_field = 'record_type' AND picklist_value = 'Equipment_Checked_Out' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Equipment Checked Out', 'equipment_activities',
    'record_detail', true,
    'Imported from SF Layout: Equipment_Activity__c-Equipment Checked Out',
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
        jsonb_build_object('name', 'ea_equipment_activity_related_equipment', 'label', 'Equipment Activity Related Equipment'),
        jsonb_build_object('name', 'ea_name', 'label', 'Name'),
        jsonb_build_object('name', 'ea_equipment_id', 'label', 'Equipment ID'),
        jsonb_build_object('name', 'ea_equipment_issue_frequency', 'label', 'Equipment Issue Frequency'),
        jsonb_build_object('name', 'ea_equipment_location', 'label', 'Equipment Location'),
        jsonb_build_object('name', 'ea_tech_name', 'label', 'Tech Name'),
        jsonb_build_object('name', 'ea_equipment_activity_check_out_date_time', 'label', 'Equipment Activity Check Out Date Time')
      )), false
  );

-- Layout: Equipment Damaged Beyond Repair  →  RT picklist_value = Equipment_Damaged_Beyond_Repair
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'equipment_activities' AND picklist_field = 'record_type' AND picklist_value = 'Equipment_Damaged_Beyond_Repair' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Equipment Damaged Beyond Repair', 'equipment_activities',
    'record_detail', true,
    'Imported from SF Layout: Equipment_Activity__c-Equipment Damaged Beyond Repair',
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
        jsonb_build_object('name', 'ea_name', 'label', 'Name'),
        jsonb_build_object('name', 'ea_equipment_activity_damage_notes', 'label', 'Equipment Activity Damage Notes'),
        jsonb_build_object('name', 'ea_equipment_id', 'label', 'Equipment ID'),
        jsonb_build_object('name', 'ea_equipment_location', 'label', 'Equipment Location'),
        jsonb_build_object('name', 'ea_tech_name', 'label', 'Tech Name'),
        jsonb_build_object('name', 'ea_technician', 'label', 'Technician'),
        jsonb_build_object('name', 'ea_equipment_activity_related_equipment', 'label', 'Equipment Activity Related Equipment')
      )), false
  );

-- Layout: Equipment Inventory Inspection  →  RT picklist_value = Equipment_Inventory_Inspection
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'equipment_activities' AND picklist_field = 'record_type' AND picklist_value = 'Equipment_Inventory_Inspection' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Equipment Inventory Inspection', 'equipment_activities',
    'record_detail', true,
    'Imported from SF Layout: Equipment_Activity__c-Equipment Inventory Inspection',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Equipment Inspection Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Equipment Inspection Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ea_name', 'label', 'Name')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Fields', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Fields', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ea_equipment_id', 'label', 'Equipment ID'),
        jsonb_build_object('name', 'ea_equipment_location', 'label', 'Equipment Location'),
        jsonb_build_object('name', 'ea_inventory_inspection_notes', 'label', 'Inventory Inspection Notes')
      )), false
  );

-- Layout: Equipment Out For Repair  →  RT picklist_value = Equipment_Out_For_Repair
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'equipment_activities' AND picklist_field = 'record_type' AND picklist_value = 'Equipment_Out_For_Repair' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Equipment Out For Repair', 'equipment_activities',
    'record_detail', true,
    'Imported from SF Layout: Equipment_Activity__c-Equipment Out For Repair',
    rt_id, fb, fb, false
  ) RETURNING id INTO layout_id;

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 1, 'Equipment Activity Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Equipment Activity Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ea_name', 'label', 'Name'),
        jsonb_build_object('name', 'ea_equipment_activity_related_equipment', 'label', 'Equipment Activity Related Equipment'),
        jsonb_build_object('name', 'ea_equipment_id', 'label', 'Equipment ID')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Equipment Repair Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Equipment Repair Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'ea_equipment_activity_damage_notes', 'label', 'Equipment Activity Damage Notes'),
        jsonb_build_object('name', 'ea_equipment_activity_estimated_cost', 'label', 'Equipment Activity Estimated Cost'),
        jsonb_build_object('name', 'ea_equipment_location', 'label', 'Equipment Location'),
        jsonb_build_object('name', 'ea_technician', 'label', 'Technician'),
        jsonb_build_object('name', 'ea_tech_name', 'label', 'Tech Name')
      )), false
  );

-- Layout: Equipment Placed Into Service  →  RT picklist_value = Equipment_Placed_Into_Service
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'equipment_activities' AND picklist_field = 'record_type' AND picklist_value = 'Equipment_Placed_Into_Service' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Equipment Placed Into Service', 'equipment_activities',
    'record_detail', true,
    'Imported from SF Layout: Equipment_Activity__c-Equipment Placed Into Service',
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
        jsonb_build_object('name', 'ea_name', 'label', 'Name'),
        jsonb_build_object('name', 'ea_equipment_id', 'label', 'Equipment ID'),
        jsonb_build_object('name', 'ea_equipment_location', 'label', 'Equipment Location'),
        jsonb_build_object('name', 'ea_tech_name', 'label', 'Tech Name'),
        jsonb_build_object('name', 'ea_technician', 'label', 'Technician')
      )), false
  );

-- Layout: Equipment Repair Pending  →  RT picklist_value = Equipment_Repair_Pending
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'equipment_activities' AND picklist_field = 'record_type' AND picklist_value = 'Equipment_Repair_Pending' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Equipment Repair Pending', 'equipment_activities',
    'record_detail', true,
    'Imported from SF Layout: Equipment_Activity__c-Equipment Repair Pending',
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
        jsonb_build_object('name', 'ea_name', 'label', 'Name'),
        jsonb_build_object('name', 'ea_equipment_activity_estimated_cost', 'label', 'Equipment Activity Estimated Cost'),
        jsonb_build_object('name', 'ea_equipment_activity_damage_notes', 'label', 'Equipment Activity Damage Notes'),
        jsonb_build_object('name', 'ea_equipment_id', 'label', 'Equipment ID'),
        jsonb_build_object('name', 'ea_equipment_location', 'label', 'Equipment Location'),
        jsonb_build_object('name', 'ea_tech_name', 'label', 'Tech Name'),
        jsonb_build_object('name', 'ea_technician', 'label', 'Technician'),
        jsonb_build_object('name', 'ea_equipment_activity_related_equipment', 'label', 'Equipment Activity Related Equipment')
      )), false
  );


END $$;
