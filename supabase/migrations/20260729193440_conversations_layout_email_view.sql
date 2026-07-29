-- Show the actual email body on the conversation record page. Replace the
-- plain messages related-list (metadata columns only) with the
-- conversation_messages widget (renders each message email-style: direction,
-- date, subject, From/To, sanitized HTML body) and move it onto the Details tab
-- so it's visible on open.
DO $$
DECLARE
  v_layout uuid;
  v_section uuid;
BEGIN
  SELECT id INTO v_layout FROM page_layouts
  WHERE page_layout_object='conversations' AND page_layout_type='record_detail'
    AND page_layout_is_default=true AND is_deleted IS NOT TRUE
  LIMIT 1;
  IF v_layout IS NULL THEN
    RAISE NOTICE 'no conversations default layout; skipping';
    RETURN;
  END IF;

  SELECT s.id INTO v_section
  FROM page_layout_sections s
  JOIN page_layout_widgets w ON w.section_id = s.id AND w.is_deleted IS NOT TRUE
  WHERE s.page_layout_id = v_layout AND s.is_deleted IS NOT TRUE
    AND w.widget_type='related_list' AND (w.widget_config->>'table')='messages'
  LIMIT 1;

  IF v_section IS NOT NULL THEN
    UPDATE page_layout_sections
    SET section_tab='Details', section_label='Email', section_columns=1
    WHERE id = v_section;

    UPDATE page_layout_widgets
    SET widget_type='conversation_messages', widget_title='Email', widget_config='{}'::jsonb
    WHERE section_id = v_section AND widget_type='related_list' AND (widget_config->>'table')='messages';

    RAISE NOTICE 'conversations layout email view set on section %', v_section;
  END IF;
END $$;
