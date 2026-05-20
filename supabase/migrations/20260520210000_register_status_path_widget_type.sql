-- =====================================================================
-- Register status_path widget type
--
-- A Salesforce-style Path component: horizontal chevron strip across
-- the top of a record showing the full status lifecycle. Completed
-- stages are filled, current stage is highlighted, future stages are
-- dimmed. Clicking a chevron fires the matching status transition
-- (subject to the existing transition rules in status_transitions).
--
-- Configured per page layout. widget_config supports:
--   status_field         text   — which status column to render
--                                 (e.g. 'project_status', 'opportunity_status')
--   show_guidance        bool   — show per-stage guidance text below the strip
--   show_completed_count bool   — show 'Stage X of N' label above the strip
-- =====================================================================

INSERT INTO public.widget_types (
  widget_type_key,
  widget_type_label,
  widget_type_category,
  widget_type_description,
  widget_type_config_schema,
  widget_type_default_size,
  widget_type_is_active
) VALUES (
  'status_path',
  'Status Path',
  'header',
  'Horizontal chevron strip showing the record''s position in its status lifecycle. Sits at the top of the record, between the header and the section tabs. Click a chevron to advance status.',
  jsonb_build_object(
    'fields', jsonb_build_array(
      jsonb_build_object('key','status_field','label','Status field','type','text','required',true,'placeholder','e.g. project_status, opportunity_status'),
      jsonb_build_object('key','show_guidance','label','Show stage guidance text below strip','type','boolean','default',true),
      jsonb_build_object('key','show_completed_count','label','Show "Stage X of N" counter above strip','type','boolean','default',true)
    )
  ),
  'full',
  true
)
ON CONFLICT (widget_type_key) DO UPDATE
  SET widget_type_label       = EXCLUDED.widget_type_label,
      widget_type_category    = EXCLUDED.widget_type_category,
      widget_type_description = EXCLUDED.widget_type_description,
      widget_type_config_schema = EXCLUDED.widget_type_config_schema,
      widget_type_default_size = EXCLUDED.widget_type_default_size,
      widget_type_is_active   = EXCLUDED.widget_type_is_active;
