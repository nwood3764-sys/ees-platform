-- Documents related list on the reservation, placed in the right sidebar.
-- Documents attach polymorphically (related_id + related_object), so the list
-- uses fk=related_id + match={related_object:'enrollments'}. Rows open the file
-- (row_href_field=file_url); no New button (documents are uploaded, not formed).
DO $$
DECLARE
  v_layout uuid := '94af9c5b-bd66-43e4-b348-f4781efce547';
  s_docs_rail uuid := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM page_layouts WHERE id=v_layout AND NOT is_deleted) THEN
    RAISE EXCEPTION 'layout % not found', v_layout;
  END IF;
  -- Idempotent: drop any prior right-rail Documents section on this layout.
  UPDATE page_layout_widgets w SET is_deleted=true, updated_at=now()
   WHERE w.is_deleted IS NOT TRUE
     AND w.section_id IN (SELECT id FROM page_layout_sections
                          WHERE page_layout_id=v_layout AND section_placement='right'
                            AND section_label='Documents' AND is_deleted IS NOT TRUE);
  UPDATE page_layout_sections SET is_deleted=true, updated_at=now()
   WHERE page_layout_id=v_layout AND section_placement='right'
     AND section_label='Documents' AND is_deleted IS NOT TRUE;

  INSERT INTO page_layout_sections (id, page_layout_id, section_order, section_label, section_columns, section_tab, section_placement, is_deleted)
  VALUES (s_docs_rail, v_layout, 20, 'Documents', 1, 'Details', 'right', false);

  INSERT INTO page_layout_widgets (page_layout_widget_record_number, page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_config)
  VALUES ('', v_layout, s_docs_rail, 'related_list', 'Documents', 1, 1,
    '{"table":"documents","fk":"related_id","match":{"related_object":"enrollments"},
      "is_deleted_col":"is_deleted","allow_new":false,"row_href_field":"file_url",
      "sort_field":"created_at","sort_dir":"desc",
      "columns":[
        {"name":"name","type":"text","label":"Document"},
        {"name":"document_type","type":"text","label":"Type"},
        {"name":"signature_status","type":"text","label":"Signature"},
        {"name":"created_at","type":"datetime","label":"Uploaded"}
      ]}'::jsonb);
END $$;

NOTIFY pgrst, 'reload schema';
