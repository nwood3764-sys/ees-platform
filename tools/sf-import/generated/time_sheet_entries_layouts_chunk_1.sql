-- --- TIME_SHEET_ENTRIES layouts from SF -------------
-- 4 SF layouts found for Anura_Time_Sheet_Entry__c

DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN

-- Soft-delete the previous Standard time_sheet_entries layout, if any
UPDATE public.page_layouts SET is_deleted = true, updated_at = now()
WHERE page_layout_object = 'time_sheet_entries' AND is_deleted = false;

-- Layout: Anura Time Sheet Entry Layout  →  RT picklist_value = (default fallback)
  rt_id := NULL;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Anura Time Sheet Entry Layout', 'time_sheet_entries',
    'record_detail', true,
    'Imported from SF Layout: Anura_Time_Sheet_Entry__c-Anura Time Sheet Entry Layout',
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
        jsonb_build_object('name', 'tse_time_sheet_date', 'label', 'Time Sheet Date'),
        jsonb_build_object('name', 'tse_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'tse_technician', 'label', 'Technician'),
        jsonb_build_object('name', 'tse_project', 'label', 'Project'),
        jsonb_build_object('name', 'tse_anura_time_sheet', 'label', 'Anura Time Sheet', 'required', true),
        jsonb_build_object('name', 'tse_check_in_screening_passed', 'label', 'Check In Screening Passed'),
        jsonb_build_object('name', 'tse_clock_in_time', 'label', 'Clock In Time'),
        jsonb_build_object('name', 'tse_clock_out_time', 'label', 'Clock Out Time'),
        jsonb_build_object('name', 'tse_duration_in_hours', 'label', 'Duration In Hours'),
        jsonb_build_object('name', 'tse_lunch_start', 'label', 'Lunch Start'),
        jsonb_build_object('name', 'tse_lunch_end', 'label', 'Lunch End'),
        jsonb_build_object('name', 'tse_lunch_duration_in_hours', 'label', 'Lunch Duration In Hours'),
        jsonb_build_object('name', 'tse_work_day_total_duration', 'label', 'Work Day Total Duration')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Daily Checklist', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Daily Checklist', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'tse_has_tools', 'label', 'Has Tools'),
        jsonb_build_object('name', 'tse_wearing_uniform', 'label', 'Wearing Uniform'),
        jsonb_build_object('name', 'tse_temperature_check_complete', 'label', 'Temperature Check Complete'),
        jsonb_build_object('name', 'tse_has_camel_bak', 'label', 'Has Camel Bak'),
        jsonb_build_object('name', 'tse_has_anura_id', 'label', 'Has Anura ID')
      )), false
  );

-- Layout: Hourly Time Sheet Entry Layout  →  RT picklist_value = Hourly_Time_Sheet_Entry
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'time_sheet_entries' AND picklist_field = 'record_type' AND picklist_value = 'Hourly_Time_Sheet_Entry' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Hourly Time Sheet Entry Layout', 'time_sheet_entries',
    'record_detail', true,
    'Imported from SF Layout: Anura_Time_Sheet_Entry__c-Hourly Time Sheet Entry Layout',
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
        jsonb_build_object('name', 'tse_time_sheet_date', 'label', 'Time Sheet Date'),
        jsonb_build_object('name', 'tse_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'tse_employee', 'label', 'Employee'),
        jsonb_build_object('name', 'tse_anura_time_sheet', 'label', 'Anura Time Sheet', 'required', true),
        jsonb_build_object('name', 'tse_check_in_screening_passed', 'label', 'Check In Screening Passed'),
        jsonb_build_object('name', 'tse_clock_in_time', 'label', 'Clock In Time'),
        jsonb_build_object('name', 'tse_clock_out_time', 'label', 'Clock Out Time'),
        jsonb_build_object('name', 'tse_duration_in_hours', 'label', 'Duration In Hours'),
        jsonb_build_object('name', 'tse_lunch_start', 'label', 'Lunch Start'),
        jsonb_build_object('name', 'tse_lunch_end', 'label', 'Lunch End'),
        jsonb_build_object('name', 'tse_lunch_duration_in_hours', 'label', 'Lunch Duration In Hours'),
        jsonb_build_object('name', 'tse_work_day_total_duration', 'label', 'Work Day Total Duration')
      )), false
  );

-- Layout: Salaried Time Sheet Layout  →  RT picklist_value = Salaried_Time_Sheet_Entry
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'time_sheet_entries' AND picklist_field = 'record_type' AND picklist_value = 'Salaried_Time_Sheet_Entry' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Salaried Time Sheet Layout', 'time_sheet_entries',
    'record_detail', true,
    'Imported from SF Layout: Anura_Time_Sheet_Entry__c-Salaried Time Sheet Layout',
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
        jsonb_build_object('name', 'tse_time_sheet_date', 'label', 'Time Sheet Date'),
        jsonb_build_object('name', 'tse_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'tse_employee', 'label', 'Employee'),
        jsonb_build_object('name', 'tse_anura_time_sheet', 'label', 'Anura Time Sheet', 'required', true),
        jsonb_build_object('name', 'tse_check_in_screening_passed', 'label', 'Check In Screening Passed'),
        jsonb_build_object('name', 'tse_clock_in_time', 'label', 'Clock In Time'),
        jsonb_build_object('name', 'tse_clock_out_time', 'label', 'Clock Out Time'),
        jsonb_build_object('name', 'tse_duration_in_hours', 'label', 'Duration In Hours'),
        jsonb_build_object('name', 'tse_work_day_total_duration', 'label', 'Work Day Total Duration')
      )), false
  );

-- Layout: Technician Time Sheet Entry Layout  →  RT picklist_value = Technician_Time_Sheet_Entry
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'time_sheet_entries' AND picklist_field = 'record_type' AND picklist_value = 'Technician_Time_Sheet_Entry' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Technician Time Sheet Entry Layout', 'time_sheet_entries',
    'record_detail', true,
    'Imported from SF Layout: Anura_Time_Sheet_Entry__c-Technician Time Sheet Entry Layout',
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
        jsonb_build_object('name', 'tse_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'tse_time_sheet_date', 'label', 'Time Sheet Date'),
        jsonb_build_object('name', 'tse_technician', 'label', 'Technician'),
        jsonb_build_object('name', 'tse_project', 'label', 'Project'),
        jsonb_build_object('name', 'tse_anura_time_sheet', 'label', 'Anura Time Sheet', 'required', true),
        jsonb_build_object('name', 'tse_duration_in_hours', 'label', 'Duration In Hours'),
        jsonb_build_object('name', 'tse_notes', 'label', 'Notes')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Time Sheet Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Time Sheet Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'tse_clock_in_time', 'label', 'Clock In Time'),
        jsonb_build_object('name', 'tse_clock_out_time', 'label', 'Clock Out Time'),
        jsonb_build_object('name', 'tse_work_day_total_duration', 'label', 'Work Day Total Duration'),
        jsonb_build_object('name', 'tse_crew_vehicle', 'label', 'Crew Vehicle')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Screening Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Screening Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'tse_check_in_screening_passed', 'label', 'Check In Screening Passed'),
        jsonb_build_object('name', 'tse_temperature_check_complete', 'label', 'Temperature Check Complete'),
        jsonb_build_object('name', 'tse_has_ppe', 'label', 'Has Ppe'),
        jsonb_build_object('name', 'tse_sent_home_by_supervisor', 'label', 'Sent Home By Supervisor'),
        jsonb_build_object('name', 'tse_check_out_screening_passed', 'label', 'Check Out Screening Passed'),
        jsonb_build_object('name', 'tse_exposed_to_other_crews', 'label', 'Exposed To Other Crews'),
        jsonb_build_object('name', 'tse_crew_exposure', 'label', 'Crew Exposure')
      )), false
  );


END $$;
