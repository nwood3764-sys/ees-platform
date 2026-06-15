-- Enrollment page layouts: base (record-type-agnostic) record_detail layout
-- with 11 field-grouped sections + a Documents related list, then one cloned
-- layout per record type. Applied via MCP 2026-06-15. The base layout's
-- sections/widgets and the per-record-type clone routine are reproduced below.
DO $$
DECLARE
  v_admin uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_layout uuid; v_sec uuid; v_base uuid;
  rt RECORD; v_new_layout uuid; sec RECORD; v_new_sec uuid;
BEGIN
  INSERT INTO public.page_layouts
    (page_layout_name, page_layout_object, page_layout_type, page_layout_is_default,
     record_type_id, page_layout_owner, page_layout_created_by)
  VALUES ('Enrollment Layout','enrollments','record_detail',true,NULL,v_admin,v_admin)
  RETURNING id INTO v_layout;

  INSERT INTO public.page_layout_sections (page_layout_id, section_order, section_label, section_columns, section_tab, section_placement)
  VALUES (v_layout, 1, 'Information', 2, 'Details', 'main') RETURNING id INTO v_sec;
  INSERT INTO public.page_layout_widgets (page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config) VALUES
    (v_layout, v_sec, 'status_path', 'Status Path', 1, 0, 'full', '{"status_field":"enrollment_status","show_guidance":true,"show_completed_count":true}'::jsonb),
    (v_layout, v_sec, 'field_group', 'Information', 1, 1, 'medium', '{"fields":[{"name":"enrollment_name","type":"text","label":"Name","required":true},{"name":"enrollment_record_type","type":"picklist","label":"Record Type"},{"name":"enrollment_status","type":"picklist","label":"Status"},{"name":"property_id","type":"lookup","label":"Property","lookup_table":"properties","lookup_field":"property_name","required":true},{"name":"opportunity_id","type":"lookup","label":"Opportunity","lookup_table":"opportunities","lookup_field":"opportunity_name"},{"name":"enrollment_owner","type":"lookup","label":"Owner","lookup_table":"users","lookup_field":"user_name"}]}'::jsonb);

  INSERT INTO public.page_layout_sections (page_layout_id, section_order, section_label, section_columns, section_tab, section_placement)
  VALUES (v_layout, 2, 'HUD Property & Site', 2, 'Details', 'main') RETURNING id INTO v_sec;
  INSERT INTO public.page_layout_widgets (page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config) VALUES
    (v_layout, v_sec, 'field_group', 'HUD Property & Site', 1, 1, 'full', '{"fields":[{"name":"enrollment_hud_property_id","type":"text","label":"HUD Property ID"},{"name":"enrollment_property_name","type":"text","label":"Property Name"},{"name":"enrollment_site_address","type":"text","label":"Site Address"},{"name":"enrollment_city","type":"text","label":"City"},{"name":"enrollment_state","type":"text","label":"State"},{"name":"enrollment_zip","type":"text","label":"ZIP"},{"name":"enrollment_county","type":"text","label":"County"}]}'::jsonb);

  INSERT INTO public.page_layout_sections (page_layout_id, section_order, section_label, section_columns, section_tab, section_placement)
  VALUES (v_layout, 3, 'Units & Category', 2, 'Details', 'main') RETURNING id INTO v_sec;
  INSERT INTO public.page_layout_widgets (page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config) VALUES
    (v_layout, v_sec, 'field_group', 'Units & Category', 1, 1, 'full', '{"fields":[{"name":"enrollment_total_units","type":"number","label":"Total Units"},{"name":"enrollment_assisted_units","type":"number","label":"Assisted / Subsidized Units"},{"name":"enrollment_subsidized_share_pct","type":"percent","label":"Subsidized Share %"},{"name":"enrollment_property_category","type":"text","label":"Property Category"},{"name":"enrollment_is_202_811","type":"boolean","label":"202/811"},{"name":"enrollment_is_opportunity_zone","type":"boolean","label":"Opportunity Zone"}]}'::jsonb);

  INSERT INTO public.page_layout_sections (page_layout_id, section_order, section_label, section_columns, section_tab, section_placement)
  VALUES (v_layout, 4, 'Owner Entity', 2, 'Details', 'main') RETURNING id INTO v_sec;
  INSERT INTO public.page_layout_widgets (page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config) VALUES
    (v_layout, v_sec, 'field_group', 'Owner Entity', 1, 1, 'full', '{"fields":[{"name":"enrollment_owner_organization","type":"text","label":"Owner Organization"},{"name":"enrollment_owner_type","type":"text","label":"Owner Type"},{"name":"enrollment_owner_address","type":"text","label":"Owner Address"},{"name":"enrollment_owner_phone","type":"phone","label":"Owner Phone"},{"name":"enrollment_owner_email","type":"email","label":"Owner Email"},{"name":"enrollment_owner_fein","type":"text","label":"FEIN"}]}'::jsonb);

  INSERT INTO public.page_layout_sections (page_layout_id, section_order, section_label, section_columns, section_tab, section_placement)
  VALUES (v_layout, 5, 'Management Agent', 2, 'Details', 'main') RETURNING id INTO v_sec;
  INSERT INTO public.page_layout_widgets (page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config) VALUES
    (v_layout, v_sec, 'field_group', 'Management Agent', 1, 1, 'full', '{"fields":[{"name":"enrollment_management_agent","type":"text","label":"Management Agent"},{"name":"enrollment_management_phone","type":"phone","label":"Mgmt Phone"},{"name":"enrollment_management_email","type":"email","label":"Mgmt Email"}]}'::jsonb);

  INSERT INTO public.page_layout_sections (page_layout_id, section_order, section_label, section_columns, section_tab, section_placement)
  VALUES (v_layout, 6, 'Application Contact', 2, 'Details', 'main') RETURNING id INTO v_sec;
  INSERT INTO public.page_layout_widgets (page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config) VALUES
    (v_layout, v_sec, 'field_group', 'Application Contact', 1, 1, 'full', '{"fields":[{"name":"enrollment_contact_name","type":"text","label":"Contact Name"},{"name":"enrollment_contact_title","type":"text","label":"Contact Title"},{"name":"enrollment_contact_phone","type":"phone","label":"Contact Phone"},{"name":"enrollment_contact_email","type":"email","label":"Contact Email"}]}'::jsonb);

  INSERT INTO public.page_layout_sections (page_layout_id, section_order, section_label, section_columns, section_tab, section_placement)
  VALUES (v_layout, 7, 'Occupancy & Buildings', 2, 'Details', 'main') RETURNING id INTO v_sec;
  INSERT INTO public.page_layout_widgets (page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config) VALUES
    (v_layout, v_sec, 'field_group', 'Occupancy & Buildings', 1, 1, 'full', '{"fields":[{"name":"enrollment_occupied_units","type":"number","label":"Number of Occupied Units"},{"name":"enrollment_unoccupied_units","type":"number","label":"Number of Unoccupied Units"},{"name":"enrollment_number_of_buildings","type":"number","label":"Number of Buildings"},{"name":"enrollment_unit_numbering_scheme","type":"text","label":"Unit Numbering Scheme"},{"name":"enrollment_fifty_pct_lmi_declaration","type":"boolean","label":"50% LMI Declaration"}]}'::jsonb);

  INSERT INTO public.page_layout_sections (page_layout_id, section_order, section_label, section_columns, section_tab, section_placement)
  VALUES (v_layout, 8, 'HUD Assistance Contract', 2, 'Details', 'main') RETURNING id INTO v_sec;
  INSERT INTO public.page_layout_widgets (page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config) VALUES
    (v_layout, v_sec, 'field_group', 'HUD Assistance Contract', 1, 1, 'full', '{"fields":[{"name":"enrollment_hud_contract_number","type":"text","label":"Contract Number"},{"name":"enrollment_hud_program","type":"text","label":"Program"},{"name":"enrollment_hud_tracs_status","type":"text","label":"TRACS Status"},{"name":"enrollment_hud_contract_expiration","type":"date","label":"Contract Expiration"}]}'::jsonb);

  INSERT INTO public.page_layout_sections (page_layout_id, section_order, section_label, section_columns, section_tab, section_placement)
  VALUES (v_layout, 9, 'Assisted-Unit Bedroom Breakdown', 2, 'Details', 'main') RETURNING id INTO v_sec;
  INSERT INTO public.page_layout_widgets (page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config) VALUES
    (v_layout, v_sec, 'field_group', 'Assisted-Unit Bedroom Breakdown', 1, 1, 'full', '{"fields":[{"name":"enrollment_br_studio","type":"number","label":"Studio"},{"name":"enrollment_br_1","type":"number","label":"1BR"},{"name":"enrollment_br_2","type":"number","label":"2BR"},{"name":"enrollment_br_3","type":"number","label":"3BR"},{"name":"enrollment_br_4","type":"number","label":"4BR"},{"name":"enrollment_br_5plus","type":"number","label":"5BR+"}]}'::jsonb);

  INSERT INTO public.page_layout_sections (page_layout_id, section_order, section_label, section_columns, section_tab, section_placement)
  VALUES (v_layout, 10, 'Categorical Determination', 2, 'Details', 'main') RETURNING id INTO v_sec;
  INSERT INTO public.page_layout_widgets (page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config) VALUES
    (v_layout, v_sec, 'field_group', 'Categorical Determination', 1, 1, 'full', '{"fields":[{"name":"enrollment_qualifying_mode","type":"text","label":"Qualifying Mode"},{"name":"enrollment_eligibility_pathways","type":"text","label":"Eligibility Pathways"},{"name":"enrollment_required_proof","type":"text","label":"Required Proof"},{"name":"enrollment_categorical_eligibility","type":"text","label":"Categorical Eligibility"},{"name":"enrollment_determination_date","type":"date","label":"Determination Date"}]}'::jsonb);

  INSERT INTO public.page_layout_sections (page_layout_id, section_order, section_label, section_columns, section_tab, section_placement)
  VALUES (v_layout, 100, 'Documents', 1, 'Related', 'main') RETURNING id INTO v_sec;
  INSERT INTO public.page_layout_widgets (page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config) VALUES
    (v_layout, v_sec, 'file_gallery', 'Documents', 1, 1, 'full', '{"target":"documents","document_type":"attachment"}'::jsonb);

  -- Clone the base layout per record type.
  v_base := v_layout;
  FOR rt IN SELECT id, picklist_label FROM public.picklist_values
            WHERE picklist_object='enrollments' AND picklist_field='record_type' AND picklist_is_active=true
  LOOP
    INSERT INTO public.page_layouts
      (page_layout_name, page_layout_object, page_layout_type, page_layout_is_default, record_type_id, page_layout_owner, page_layout_created_by)
    VALUES (rt.picklist_label, 'enrollments', 'record_detail', true, rt.id, v_admin, v_admin)
    RETURNING id INTO v_new_layout;
    FOR sec IN SELECT * FROM public.page_layout_sections WHERE page_layout_id=v_base AND is_deleted=false ORDER BY section_order
    LOOP
      INSERT INTO public.page_layout_sections (page_layout_id, section_order, section_label, section_columns, section_tab, section_placement)
      VALUES (v_new_layout, sec.section_order, sec.section_label, sec.section_columns, sec.section_tab, sec.section_placement)
      RETURNING id INTO v_new_sec;
      INSERT INTO public.page_layout_widgets (page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, widget_is_user_customizable, widget_is_required)
      SELECT v_new_layout, v_new_sec, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, widget_is_user_customizable, widget_is_required
      FROM public.page_layout_widgets WHERE section_id=sec.id AND is_deleted=false;
    END LOOP;
  END LOOP;
END $$;
