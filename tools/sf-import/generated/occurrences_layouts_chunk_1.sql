-- --- OCCURRENCES layouts from SF -------------
-- 2 SF layouts found for Occurrence__c

DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN

-- Soft-delete the previous Standard occurrences layout, if any
UPDATE public.page_layouts SET is_deleted = true, updated_at = now()
WHERE page_layout_object = 'occurrences' AND is_deleted = false;

-- Layout: Absence  →  RT picklist_value = Absence
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'occurrences' AND picklist_field = 'record_type' AND picklist_value = 'Absence' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Absence', 'occurrences',
    'record_detail', true,
    'Imported from SF Layout: Occurrence__c-Absence',
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
        jsonb_build_object('name', 'occurrence_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'occurrence_employee', 'label', 'Employee', 'required', true),
        jsonb_build_object('name', 'occurrence_date_and_time', 'label', 'Date And Time'),
        jsonb_build_object('name', 'occurrence_status', 'label', 'Status'),
        jsonb_build_object('name', 'occurrence_incident_type', 'label', 'Incident Type'),
        jsonb_build_object('name', 'occurrence_owner', 'label', 'Owner'),
        jsonb_build_object('name', 'occurrence_reporting_employee', 'label', 'Reporting Employee'),
        jsonb_build_object('name', 'occurrence_absence_reason', 'label', 'Absence Reason'),
        jsonb_build_object('name', 'occurrence_absence_type', 'label', 'Absence Type')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Absence Details', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Absence Details', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'occurrence_details', 'label', 'Details')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Values in Question', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Values in Question', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'occurrence_integrity', 'label', 'Integrity'),
        jsonb_build_object('name', 'occurrence_trust', 'label', 'Trust'),
        jsonb_build_object('name', 'occurrence_teachable', 'label', 'Teachable'),
        jsonb_build_object('name', 'occurrence_reliable', 'label', 'Reliable'),
        jsonb_build_object('name', 'occurrence_committed', 'label', 'Committed')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Pre-Follow Up', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Pre-Follow Up', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'occurrence_designated_follow_up_employee', 'label', 'Designated Follow Up Employee'),
        jsonb_build_object('name', 'occurrence_planned_follow_up_details', 'label', 'Planned Follow Up Details')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 5, 'Post-Follow Up', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Post-Follow Up', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'occurrence_follow_up_employee', 'label', 'Follow Up Employee'),
        jsonb_build_object('name', 'occurrence_date_and_time_of_follow_up', 'label', 'Date And Time Of Follow Up'),
        jsonb_build_object('name', 'occurrence_follow_up_details', 'label', 'Follow Up Details')
      )), false
  );

-- Layout: Occurrence Layout  →  RT picklist_value = (default fallback)
  rt_id := NULL;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Occurrence Layout', 'occurrences',
    'record_detail', true,
    'Imported from SF Layout: Occurrence__c-Occurrence Layout',
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
        jsonb_build_object('name', 'occurrence_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'occurrence_employee', 'label', 'Employee', 'required', true),
        jsonb_build_object('name', 'occurrence_incident_type', 'label', 'Incident Type'),
        jsonb_build_object('name', 'occurrence_date_and_time', 'label', 'Date And Time'),
        jsonb_build_object('name', 'occurrence_location', 'label', 'Location'),
        jsonb_build_object('name', 'occurrence_owner', 'label', 'Owner'),
        jsonb_build_object('name', 'occurrence_reporting_employee', 'label', 'Reporting Employee'),
        jsonb_build_object('name', 'occurrence_status', 'label', 'Status'),
        jsonb_build_object('name', 'occurrence_details', 'label', 'Details')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Values in Question', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Values in Question', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'occurrence_integrity', 'label', 'Integrity'),
        jsonb_build_object('name', 'occurrence_trust', 'label', 'Trust'),
        jsonb_build_object('name', 'occurrence_teachable', 'label', 'Teachable'),
        jsonb_build_object('name', 'occurrence_reliable', 'label', 'Reliable'),
        jsonb_build_object('name', 'occurrence_committed', 'label', 'Committed')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Pre-Follow Up', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Pre-Follow Up', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'occurrence_designated_follow_up_employee', 'label', 'Designated Follow Up Employee'),
        jsonb_build_object('name', 'occurrence_planned_follow_up_details', 'label', 'Planned Follow Up Details')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 4, 'Post-Follow Up', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Post-Follow Up', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'occurrence_follow_up_employee', 'label', 'Follow Up Employee'),
        jsonb_build_object('name', 'occurrence_date_and_time_of_follow_up', 'label', 'Date And Time Of Follow Up'),
        jsonb_build_object('name', 'occurrence_follow_up_details', 'label', 'Follow Up Details')
      )), false
  );


END $$;
