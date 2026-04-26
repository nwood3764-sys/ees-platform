-- --- INCENTIVES layouts from SF -------------
-- 3 SF layouts found for Incentive__c

DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN

-- Soft-delete the previous Standard incentives layout, if any
UPDATE public.page_layouts SET is_deleted = true, updated_at = now()
WHERE page_layout_object = 'incentives' AND is_deleted = false;

-- Layout: Incentive Layout  →  RT picklist_value = (default fallback)
  rt_id := NULL;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Incentive Layout', 'incentives',
    'record_detail', true,
    'Imported from SF Layout: Incentive__c-Incentive Layout',
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
        jsonb_build_object('name', 'incentive_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'incentive_incentive_amount', 'label', 'Incentive Amount'),
        jsonb_build_object('name', 'incentive_account', 'label', 'Account'),
        jsonb_build_object('name', 'incentive_project', 'label', 'Project', 'required', true)
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Incentive Detail', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Incentive Detail', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'incentive_incentive_submitted_date', 'label', 'Incentive Submitted Date'),
        jsonb_build_object('name', 'incentive_incentive_issue_date', 'label', 'Incentive Issue Date'),
        jsonb_build_object('name', 'incentive_projected_incentive_receive_date', 'label', 'Projected Incentive Receive Date'),
        jsonb_build_object('name', 'incentive_incentive_received_date', 'label', 'Incentive Received Date'),
        jsonb_build_object('name', 'incentive_incentive_cycle', 'label', 'Incentive Cycle'),
        jsonb_build_object('name', 'incentive_incentive_processing_time', 'label', 'Incentive Processing Time')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Commission Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Commission Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'incentive_solutions_advisor', 'label', 'Solutions Advisor'),
        jsonb_build_object('name', 'incentive_commission_amount', 'label', 'Commission Amount'),
        jsonb_build_object('name', 'incentive_date_commission_paid', 'label', 'Date Commission Paid')
      )), false
  );

-- Layout: MFES-2023 - Program Incentive  →  RT picklist_value = MFES_2023_Program_Incentive
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'incentives' AND picklist_field = 'record_type' AND picklist_value = 'MFES_2023_Program_Incentive' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'MFES-2023 - Program Incentive', 'incentives',
    'record_detail', true,
    'Imported from SF Layout: Incentive__c-MFES-2023 - Program Incentive',
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
        jsonb_build_object('name', 'incentive_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'incentive_project', 'label', 'Project', 'required', true),
        jsonb_build_object('name', 'incentive_opportunity', 'label', 'Opportunity')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Incentive Information', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Incentive Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'incentive_status', 'label', 'Status'),
        jsonb_build_object('name', 'incentive_projected_incentive_receive_date', 'label', 'Projected Incentive Receive Date'),
        jsonb_build_object('name', 'incentive_incentive_processing_time', 'label', 'Incentive Processing Time'),
        jsonb_build_object('name', 'incentive_franklin_work_order_number', 'label', 'Franklin Work Order Number'),
        jsonb_build_object('name', 'incentive_incentive_submitted_date', 'label', 'Incentive Submitted Date'),
        jsonb_build_object('name', 'incentive_incentive_amount', 'label', 'Incentive Amount'),
        jsonb_build_object('name', 'incentive_incentive_received_date', 'label', 'Incentive Received Date')
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 3, 'Commission Information', 2, 'Details',
    true, true, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Commission Information', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'incentive_solutions_advisor', 'label', 'Solutions Advisor'),
        jsonb_build_object('name', 'incentive_commission_amount', 'label', 'Commission Amount'),
        jsonb_build_object('name', 'incentive_date_commission_paid', 'label', 'Date Commission Paid')
      )), false
  );

-- Layout: Subcontractor Incentive Layout  →  RT picklist_value = Subcontractor_Incentive
  SELECT id INTO rt_id FROM public.picklist_values WHERE picklist_object = 'incentives' AND picklist_field = 'record_type' AND picklist_value = 'Subcontractor_Incentive' LIMIT 1;

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, page_layout_description,
    record_type_id, page_layout_owner, page_layout_created_by, is_deleted
  ) VALUES (
    '', 'Subcontractor Incentive Layout', 'incentives',
    'record_detail', true,
    'Imported from SF Layout: Incentive__c-Subcontractor Incentive Layout',
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
        jsonb_build_object('name', 'incentive_name', 'label', 'Name', 'required', true),
        jsonb_build_object('name', 'incentive_status', 'label', 'Status'),
        jsonb_build_object('name', 'incentive_account', 'label', 'Account'),
        jsonb_build_object('name', 'incentive_project', 'label', 'Project', 'required', true)
      )), false
  );

  INSERT INTO public.page_layout_sections (
    page_layout_id, section_order, section_label, section_columns, section_tab,
    section_is_collapsible, section_is_collapsed_by_default, is_deleted
  ) VALUES (
    layout_id, 2, 'Incentive Detail', 2, 'Details',
    true, false, false
  ) RETURNING id INTO sec_id;

  INSERT INTO public.page_layout_widgets (
    page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, is_deleted
  ) VALUES (
    layout_id, sec_id, 'field_group', 'Incentive Detail', 1, 1, 'medium',
    jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'incentive_incentive_amount', 'label', 'Incentive Amount'),
        jsonb_build_object('name', 'incentive_ee_measure', 'label', 'EE Measure'),
        jsonb_build_object('name', 'incentive_incentive_submitted_date', 'label', 'Incentive Submitted Date'),
        jsonb_build_object('name', 'incentive_subcontractor_paid_date', 'label', 'Subcontractor Paid Date')
      )), false
  );


END $$;
