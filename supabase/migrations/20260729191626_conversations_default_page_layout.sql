-- ============================================================================
-- The `conversations` object had no page layout, so navigating to
-- /conversations/{id} errored ("default page layout for this object is
-- missing"). Conversations were only ever surfaced as embedded widgets on
-- parent records, never given a record-detail layout of their own.
--
-- Create the missing default record_detail layout: a field group of the
-- conversation's own fields + a related list of its messages. Guarded so it
-- is a no-op if a default already exists.
-- ============================================================================
DO $$
DECLARE
  v_owner uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';  -- Nicholas Wood (ees-wi)
  v_layout uuid;
  v_sec_details uuid;
  v_sec_messages uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM page_layouts
             WHERE page_layout_object='conversations' AND page_layout_type='record_detail'
               AND page_layout_is_default=true AND is_deleted IS NOT TRUE) THEN
    RAISE NOTICE 'conversations default layout already exists; skipping';
    RETURN;
  END IF;

  INSERT INTO page_layouts (page_layout_record_number, page_layout_name, page_layout_object,
                            page_layout_type, page_layout_is_default, record_type_id,
                            page_layout_owner, page_layout_created_by)
  VALUES ('', 'Conversation Layout', 'conversations', 'record_detail', true, NULL, v_owner, v_owner)
  RETURNING id INTO v_layout;

  INSERT INTO page_layout_sections (page_layout_id, section_order, section_label, section_columns,
                                    section_tab, section_placement, is_deleted)
  VALUES (v_layout, 0, 'Conversation Details', 2, 'Details', 'main', false)
  RETURNING id INTO v_sec_details;

  INSERT INTO page_layout_sections (page_layout_id, section_order, section_label, section_columns,
                                    section_tab, section_placement, is_deleted)
  VALUES (v_layout, 1, 'Messages', 1, 'Related', 'main', false)
  RETURNING id INTO v_sec_messages;

  INSERT INTO page_layout_widgets (page_layout_widget_record_number, page_layout_id, section_id,
                                   widget_type, widget_title, widget_column, widget_position, widget_config)
  VALUES ('', v_layout, v_sec_details, 'field_group', 'Conversation Details', 1, 0,
    jsonb_build_object('fields', jsonb_build_array(
      jsonb_build_object('name','conv_subject','type','text','label','Subject'),
      jsonb_build_object('name','conv_channel','type','text','label','Channel'),
      jsonb_build_object('name','conv_status','type','text','label','Status'),
      jsonb_build_object('name','conv_last_message_direction','type','text','label','Last Direction'),
      jsonb_build_object('name','conv_customer_address','type','text','label','Customer Address'),
      jsonb_build_object('name','conv_our_address','type','text','label','Our Address'),
      jsonb_build_object('name','conv_last_message_at','type','datetime','label','Last Activity'),
      jsonb_build_object('name','conv_record_number','type','text','label','Record Number')
    )));

  INSERT INTO page_layout_widgets (page_layout_widget_record_number, page_layout_id, section_id,
                                   widget_type, widget_title, widget_column, widget_position, widget_config)
  VALUES ('', v_layout, v_sec_messages, 'related_list', 'Messages', 1, 0,
    jsonb_build_object(
      'table','messages','fk','conversation_id',
      'columns', jsonb_build_array(
        jsonb_build_object('name','msg_record_number','type','text','label','Message'),
        jsonb_build_object('name','msg_direction','type','text','label','Direction'),
        jsonb_build_object('name','msg_subject','type','text','label','Subject'),
        jsonb_build_object('name','msg_status','type','text','label','Status'),
        jsonb_build_object('name','msg_created_at','type','datetime','label','Sent')
      ),
      'sort_field','msg_created_at','sort_dir','asc','is_deleted_col','msg_is_deleted'
    ));

  RAISE NOTICE 'Created conversations default layout %', v_layout;
END $$;
