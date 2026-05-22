-- ============================================================================
-- communications_anchor_fks_and_widgets_v1
--
-- Extends the LEAP Communications module's record-anchoring surface to six
-- additional objects so the ConversationPanel widget can be rendered on their
-- record-detail pages.
--
-- Part 1 — schema:
--   Adds six nullable FK columns on `conversations` (one per new anchor
--   object) plus partial indexes matching the existing
--   `WHERE conv_is_deleted = false` pattern used on account_id/contact_id/
--   project_id/service_appointment_id.
--
-- Part 2 — page layouts:
--   For every active page_layout whose object is one of the six target
--   objects AND which does not yet have a conversation_panel widget,
--   inserts a single 'Conversations' section at section_order=201 with
--   one conversation_panel widget pointing at the appropriate FK column.
--   The NOT EXISTS guard makes this idempotent.
--
-- Mirrors the existing accounts/contacts/projects/service_appointments
-- pattern verified empirically (22 existing Conversations sections, all
-- with section_columns=1, collapsible=true, collapsed_by_default=true,
-- tab='Details', placement='main').
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Part 1: anchor FK columns + indexes
-- ---------------------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS work_order_id uuid REFERENCES work_orders(id),
  ADD COLUMN IF NOT EXISTS incentive_application_id uuid REFERENCES incentive_applications(id),
  ADD COLUMN IF NOT EXISTS opportunity_id uuid REFERENCES opportunities(id),
  ADD COLUMN IF NOT EXISTS assessment_id uuid REFERENCES assessments(id),
  ADD COLUMN IF NOT EXISTS building_id uuid REFERENCES buildings(id),
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES properties(id);

CREATE INDEX IF NOT EXISTS conversations_work_order_id_idx
  ON conversations (work_order_id) WHERE conv_is_deleted = false;
CREATE INDEX IF NOT EXISTS conversations_incentive_application_id_idx
  ON conversations (incentive_application_id) WHERE conv_is_deleted = false;
CREATE INDEX IF NOT EXISTS conversations_opportunity_id_idx
  ON conversations (opportunity_id) WHERE conv_is_deleted = false;
CREATE INDEX IF NOT EXISTS conversations_assessment_id_idx
  ON conversations (assessment_id) WHERE conv_is_deleted = false;
CREATE INDEX IF NOT EXISTS conversations_building_id_idx
  ON conversations (building_id) WHERE conv_is_deleted = false;
CREATE INDEX IF NOT EXISTS conversations_property_id_idx
  ON conversations (property_id) WHERE conv_is_deleted = false;

-- ---------------------------------------------------------------------------
-- Part 2: insert Conversations section + conversation_panel widget into every
-- active page_layout whose object is one of the six target objects and which
-- doesn't already have a conversation_panel widget anywhere on it. The
-- target_objects VALUES list pairs the plural object name (used by
-- page_layouts.page_layout_object) with the singular FK column on
-- conversations.
-- ---------------------------------------------------------------------------
WITH target_objects (obj, fk) AS (
  VALUES
    ('work_orders',             'work_order_id'),
    ('incentive_applications',  'incentive_application_id'),
    ('opportunities',           'opportunity_id'),
    ('assessments',             'assessment_id'),
    ('buildings',               'building_id'),
    ('properties',              'property_id')
),
target_layouts AS (
  SELECT pl.id AS layout_id, t.obj, t.fk
  FROM page_layouts pl
  JOIN target_objects t ON t.obj = pl.page_layout_object
  WHERE NOT pl.is_deleted
    AND NOT EXISTS (
      SELECT 1
      FROM page_layout_sections pls
      JOIN page_layout_widgets plw ON plw.section_id = pls.id
      WHERE pls.page_layout_id = pl.id
        AND plw.widget_type = 'conversation_panel'
        AND NOT plw.is_deleted
        AND NOT pls.is_deleted
    )
),
new_sections AS (
  INSERT INTO page_layout_sections (
    page_layout_id, section_order, section_label, section_columns,
    section_is_collapsible, section_is_collapsed_by_default,
    section_tab, section_placement
  )
  SELECT layout_id, 201, 'Conversations', 1, true, true, 'Details', 'main'
  FROM target_layouts
  RETURNING id AS section_id, page_layout_id
)
INSERT INTO page_layout_widgets (
  page_layout_widget_record_number,
  page_layout_id, section_id, widget_type, widget_title,
  widget_column, widget_position, widget_size, widget_config,
  widget_is_user_customizable, widget_is_required
)
SELECT
  '',
  ns.page_layout_id,
  ns.section_id,
  'conversation_panel',
  'Conversations',
  1, 1, 'large',
  jsonb_build_object('fk', t.fk, 'table', 'conversations', 'channel_filter', NULL),
  true, false
FROM new_sections ns
JOIN page_layouts pl ON pl.id = ns.page_layout_id
JOIN target_objects t ON t.obj = pl.page_layout_object;
