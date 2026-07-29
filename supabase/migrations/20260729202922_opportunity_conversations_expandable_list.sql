-- Make the opportunity Conversations card the friendly, expandable inbox list
-- (conversation_list) consistently across every opportunity record type. Each
-- row shows subject + preview + direction + date; a chevron expands it in place
-- to read the full email inline. Accounts/assessments keep their
-- conversation_panel (unchanged).
--
-- 1. Convert each opportunity layout's conversation_panel -> conversation_list.
-- 2. Soft-delete the redundant plain related_list of conversations.
-- 3. For any opportunity layout left with no active conversation_list,
--    re-activate exactly ONE soft-deleted related_list as conversation_list.
-- 4. Dedupe: keep exactly one active conversation_list per layout.

-- 1.
UPDATE page_layout_widgets w
SET widget_type = 'conversation_list',
    widget_title = 'Conversations',
    widget_config = jsonb_build_object('fk', w.widget_config->>'fk',
                                        'channel_filter', (w.widget_config->>'channel_filter'))
FROM page_layouts pl
WHERE w.page_layout_id = pl.id
  AND pl.page_layout_object = 'opportunities' AND pl.is_deleted IS NOT TRUE
  AND w.is_deleted IS NOT TRUE
  AND w.widget_type = 'conversation_panel'
  AND (w.widget_config->>'table') = 'conversations';

-- 2.
UPDATE page_layout_widgets w
SET is_deleted = true
FROM page_layouts pl
WHERE w.page_layout_id = pl.id
  AND pl.page_layout_object = 'opportunities' AND pl.is_deleted IS NOT TRUE
  AND w.is_deleted IS NOT TRUE
  AND w.widget_type = 'related_list'
  AND (w.widget_config->>'table') = 'conversations';

-- 3. (distinct on -> at most one re-activation per layout)
UPDATE page_layout_widgets
SET is_deleted = false, widget_type = 'conversation_list', widget_title = 'Conversations',
    widget_config = jsonb_build_object('fk', widget_config->>'fk', 'channel_filter', NULL)
WHERE id IN (
  SELECT DISTINCT ON (w.page_layout_id) w.id
  FROM page_layout_widgets w
  JOIN page_layouts pl ON pl.id = w.page_layout_id
  WHERE pl.page_layout_object = 'opportunities' AND pl.is_deleted IS NOT TRUE
    AND w.widget_type = 'related_list' AND (w.widget_config->>'table') = 'conversations'
    AND w.is_deleted = true
    AND NOT EXISTS (
      SELECT 1 FROM page_layout_widgets w2
      WHERE w2.page_layout_id = w.page_layout_id AND w2.is_deleted IS NOT TRUE
        AND w2.widget_type = 'conversation_list'
    )
  ORDER BY w.page_layout_id, w.created_at
);

-- 4.
WITH ranked AS (
  SELECT w.id, row_number() OVER (PARTITION BY w.page_layout_id ORDER BY w.created_at, w.id) AS rn
  FROM page_layout_widgets w
  JOIN page_layouts pl ON pl.id = w.page_layout_id
  WHERE pl.page_layout_object = 'opportunities' AND pl.is_deleted IS NOT TRUE
    AND w.is_deleted IS NOT TRUE AND w.widget_type = 'conversation_list'
)
UPDATE page_layout_widgets
SET is_deleted = true
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
