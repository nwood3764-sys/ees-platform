-- --- TIME_SHEETS layouts from SF -------------
-- 3 SF layouts found for Anura_Time_Sheet__c

DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN

-- Soft-delete the previous Standard time_sheets layout, if any
UPDATE public.page_layouts SET is_deleted = true, updated_at = now()
WHERE page_layout_object = 'time_sheets' AND is_deleted = false;

-- Layout: Hourly Time Sheet Layout  →  RT picklist_value = Hourly_Time_Sheet
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'time_sheets' AND picklist_field = 'record_type' AND picklist_value = 'Hourly_Time_Sheet' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Hourly Time Sheet Layout', 'time_sheets',
    'record_detail', true,
    'Imported from SF Layout: Anura_Time_Sheet__c-Hourly Time Sheet Layout',
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
        jsonb_build_object('name', 'ts_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'ts_time_sheet_start_date', 'label', 'Time Sheet Start Date'),
        jsonb_build_object('name', 'ts_status', 'label', 'Status'),
        jsonb_build_object('name', 'ts_time_sheet_entries', 'label', 'Time Sheet Entries'),
        jsonb_build_object('name', 'ts_time_sheet_end_date', 'label', 'Time Sheet End Date'),
        jsonb_build_object('name', 'ts_employee', 'label', 'Employee')
      )), false
  );

-- Layout: Salaried Time Sheet Layout  →  RT picklist_value = Salaried_Time_Sheet
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'time_sheets' AND picklist_field = 'record_type' AND picklist_value = 'Salaried_Time_Sheet' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Salaried Time Sheet Layout', 'time_sheets',
    'record_detail', true,
    'Imported from SF Layout: Anura_Time_Sheet__c-Salaried Time Sheet Layout',
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
        jsonb_build_object('name', 'ts_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'ts_time_sheet_start_date', 'label', 'Time Sheet Start Date'),
        jsonb_build_object('name', 'ts_status', 'label', 'Status'),
        jsonb_build_object('name', 'ts_time_sheet_entries', 'label', 'Time Sheet Entries'),
        jsonb_build_object('name', 'ts_time_sheet_end_date', 'label', 'Time Sheet End Date'),
        jsonb_build_object('name', 'ts_employee', 'label', 'Employee')
      )), false
  );

-- Layout: Technician Time Sheet Layout  →  RT picklist_value = Technician_Time_Sheet
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'time_sheets' AND picklist_field = 'record_type' AND picklist_value = 'Technician_Time_Sheet' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Technician Time Sheet Layout', 'time_sheets',
    'record_detail', true,
    'Imported from SF Layout: Anura_Time_Sheet__c-Technician Time Sheet Layout',
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
        jsonb_build_object('name', 'ts_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'ts_time_sheet_start_date', 'label', 'Time Sheet Start Date'),
        jsonb_build_object('name', 'ts_status', 'label', 'Status'),
        jsonb_build_object('name', 'ts_time_sheet_entries', 'label', 'Time Sheet Entries'),
        jsonb_build_object('name', 'ts_time_sheet_end_date', 'label', 'Time Sheet End Date'),
        jsonb_build_object('name', 'ts_technician', 'label', 'Technician', 'required', true)
      )), false
  );


END $$;
