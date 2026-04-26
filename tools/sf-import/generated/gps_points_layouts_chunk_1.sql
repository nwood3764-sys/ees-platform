-- --- GPS_POINTS layouts from SF -------------
-- 2 SF layouts found for GPS_Point__c

DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN

-- Soft-delete the previous Standard gps_points layout, if any
UPDATE public.page_layouts SET is_deleted = true, updated_at = now()
WHERE page_layout_object = 'gps_points' AND is_deleted = false;

-- Layout: GPS Point Layout  →  RT picklist_value = GPS_Point
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'gps_points' AND picklist_field = 'record_type' AND picklist_value = 'GPS_Point' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'GPS Point Layout', 'gps_points',
    'record_detail', true,
    'Imported from SF Layout: GPS_Point__c-GPS Point Layout',
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
        jsonb_build_object('name', 'gps_name', 'label', 'GPS Name', 'required', true),
        jsonb_build_object('name', 'gps_point_employee', 'label', 'Employee'),
        jsonb_build_object('name', 'gps_point_anura_time_sheet_entry', 'label', 'Anura Time Sheet Entry'),
        jsonb_build_object('name', 'gps_point_time_stamp', 'label', 'Time Stamp'),
        jsonb_build_object('name', 'gps_point_accuracy_in_meters', 'label', 'Accuracy In Meters'),
        jsonb_build_object('name', 'gps_point_geolocation', 'label', 'Geolocation'),
        jsonb_build_object('name', 'gps_point_map', 'label', 'Map'),
        jsonb_build_object('name', 'gps_owner', 'label', 'GPS Owner')
      )), false
  );

-- Layout: Technician GPS Point Layout  →  RT picklist_value = Technician_GPS_Point
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'gps_points' AND picklist_field = 'record_type' AND picklist_value = 'Technician_GPS_Point' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Technician GPS Point Layout', 'gps_points',
    'record_detail', true,
    'Imported from SF Layout: GPS_Point__c-Technician GPS Point Layout',
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
        jsonb_build_object('name', 'gps_name', 'label', 'GPS Name', 'required', true),
        jsonb_build_object('name', 'gps_point_technician', 'label', 'Technician'),
        jsonb_build_object('name', 'gps_point_anura_time_sheet_entry', 'label', 'Anura Time Sheet Entry'),
        jsonb_build_object('name', 'gps_point_time_stamp', 'label', 'Time Stamp'),
        jsonb_build_object('name', 'gps_point_accuracy_in_meters', 'label', 'Accuracy In Meters'),
        jsonb_build_object('name', 'gps_point_geolocation', 'label', 'Geolocation'),
        jsonb_build_object('name', 'gps_point_map', 'label', 'Map'),
        jsonb_build_object('name', 'gps_owner', 'label', 'GPS Owner')
      )), false
  );


END $$;
