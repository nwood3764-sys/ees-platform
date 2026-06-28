-- Demo right-rail section on the Multifamily Property layout. Sits in the
-- always-visible right column with a Conversation panel — the messaging
-- thread widget that's already powering the Related tab's Conversations
-- card. Lets the admin verify the right-rail placement is working end to
-- end and gives the user something to look at on the demo Property.
WITH target_layout AS (
  SELECT id FROM public.page_layouts
   WHERE id = '947206ec-f831-4ce6-bebb-8eb1d6cc638f'
),
new_section AS (
  INSERT INTO public.page_layout_sections
    (page_layout_id, section_label, section_order, section_columns, section_is_collapsible, section_placement, is_deleted)
  SELECT
    id,
    'Communications',
    coalesce((SELECT max(section_order) + 1 FROM page_layout_sections s
              WHERE s.page_layout_id = target_layout.id AND NOT s.is_deleted), 1),
    1,
    false,
    'right',
    false
  FROM target_layout
  RETURNING id AS section_id, page_layout_id
)
INSERT INTO public.page_layout_widgets
  (page_layout_id, section_id, widget_type, widget_title, widget_position, widget_config, is_deleted)
SELECT
  ns.page_layout_id,
  ns.section_id,
  'conversation_panel',
  'Conversations',
  1,
  '{
    "title": "Conversations",
    "compact": true
  }'::jsonb,
  false
FROM new_section ns;
