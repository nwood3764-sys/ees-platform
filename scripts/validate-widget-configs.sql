-- =====================================================================
-- validate-widget-configs.sql
--
-- Stabilization check for every live page_layout_widgets.widget_config.
-- Validates that every column / table / FK reference inside a widget
-- config actually exists in information_schema.
--
-- USAGE
--   On-demand audit:
--     Paste this file into `execute_sql` via Supabase MCP, or run with
--       psql "$DATABASE_URL" -f scripts/validate-widget-configs.sql
--     A clean database returns zero rows.
--
--   Migration self-test pattern:
--     The DO $$ ... END $$ block at the bottom is what every future
--     widget-touching migration should append. It RAISEs inside the
--     transaction if any broken reference would land — so a migration
--     with invented column names is refused, not applied.
--
-- COVERS
--   * field_group         - host column refs + lookup_table + lookup_field
--   * related_list        - child table + columns[].name + sort_field
--                           + is_deleted_col + fk
--   * conversation_panel  - child table + fk
--   * file_gallery        - target table (documents / photos)
--
-- DOES NOT COVER
--   * chart widgets (bar_chart_h, bar_chart_v, donut_chart) - configs
--     are empty stubs today; revisit when chart configs gain table refs
--   * admin meta widgets (filter_config_editor, section_config_editor,
--     prtsn_history, merge_field_reference) - no column refs
-- =====================================================================

-- ---------------------------------------------------------------------
-- Read-only audit query. Returns one row per broken reference.
-- ---------------------------------------------------------------------
WITH ac AS (
  SELECT table_name, column_name
    FROM information_schema.columns WHERE table_schema = 'public'
),
at_tbl AS (
  SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
),
live_widgets AS (
  SELECT w.id AS widget_id, w.widget_type, w.widget_config,
         pl.page_layout_name, pl.page_layout_object AS host_table
    FROM page_layout_widgets w
    JOIN page_layouts pl ON pl.id = w.page_layout_id
   WHERE NOT w.is_deleted AND NOT pl.is_deleted
),
-- field_group: host column refs
fg_host_bad AS (
  SELECT widget_id, page_layout_name, 'field_group:missing_host_column' AS problem,
         host_table || '.' || (f->>'name') AS broken_ref
    FROM live_widgets, jsonb_array_elements(widget_config->'fields') AS f
   WHERE widget_type = 'field_group' AND f->>'name' IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM ac WHERE ac.table_name = host_table AND ac.column_name = f->>'name')
),
-- field_group: lookup_table refs
fg_lookup_tbl_bad AS (
  SELECT widget_id, page_layout_name, 'field_group:missing_lookup_table',
         f->>'lookup_table'
    FROM live_widgets, jsonb_array_elements(widget_config->'fields') AS f
   WHERE widget_type = 'field_group' AND f->>'lookup_table' IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM at_tbl WHERE at_tbl.table_name = f->>'lookup_table')
),
-- field_group: lookup_field refs (only when lookup_table is valid)
fg_lookup_field_bad AS (
  SELECT widget_id, page_layout_name, 'field_group:missing_lookup_field',
         (f->>'lookup_table') || '.' || (f->>'lookup_field')
    FROM live_widgets, jsonb_array_elements(widget_config->'fields') AS f
   WHERE widget_type = 'field_group'
     AND f->>'lookup_table' IS NOT NULL AND f->>'lookup_field' IS NOT NULL
     AND EXISTS (SELECT 1 FROM at_tbl WHERE at_tbl.table_name = f->>'lookup_table')
     AND NOT EXISTS (SELECT 1 FROM ac WHERE ac.table_name = f->>'lookup_table' AND ac.column_name = f->>'lookup_field')
),
-- related_list: child table
rl_tbl_bad AS (
  SELECT widget_id, page_layout_name, 'related_list:missing_table',
         widget_config->>'table'
    FROM live_widgets
   WHERE widget_type = 'related_list'
     AND (widget_config->>'table' IS NULL
          OR NOT EXISTS (SELECT 1 FROM at_tbl WHERE at_tbl.table_name = widget_config->>'table'))
),
-- related_list: fk on child table
rl_fk_bad AS (
  SELECT widget_id, page_layout_name, 'related_list:missing_fk',
         (widget_config->>'table') || '.' || (widget_config->>'fk')
    FROM live_widgets
   WHERE widget_type = 'related_list' AND widget_config->>'fk' IS NOT NULL
     AND EXISTS (SELECT 1 FROM at_tbl WHERE at_tbl.table_name = widget_config->>'table')
     AND NOT EXISTS (SELECT 1 FROM ac WHERE ac.table_name = widget_config->>'table' AND ac.column_name = widget_config->>'fk')
),
-- related_list: sort_field on child table
rl_sort_bad AS (
  SELECT widget_id, page_layout_name, 'related_list:missing_sort_field',
         (widget_config->>'table') || '.' || (widget_config->>'sort_field')
    FROM live_widgets
   WHERE widget_type = 'related_list' AND widget_config->>'sort_field' IS NOT NULL
     AND EXISTS (SELECT 1 FROM at_tbl WHERE at_tbl.table_name = widget_config->>'table')
     AND NOT EXISTS (SELECT 1 FROM ac WHERE ac.table_name = widget_config->>'table' AND ac.column_name = widget_config->>'sort_field')
),
-- related_list: is_deleted_col on child table
rl_isdel_bad AS (
  SELECT widget_id, page_layout_name, 'related_list:missing_is_deleted_col',
         (widget_config->>'table') || '.' || (widget_config->>'is_deleted_col')
    FROM live_widgets
   WHERE widget_type = 'related_list' AND widget_config->>'is_deleted_col' IS NOT NULL
     AND EXISTS (SELECT 1 FROM at_tbl WHERE at_tbl.table_name = widget_config->>'table')
     AND NOT EXISTS (SELECT 1 FROM ac WHERE ac.table_name = widget_config->>'table' AND ac.column_name = widget_config->>'is_deleted_col')
),
-- related_list: columns[].name on child table
rl_col_bad AS (
  SELECT widget_id, page_layout_name, 'related_list:missing_column',
         (widget_config->>'table') || '.' || (c->>'name')
    FROM live_widgets, jsonb_array_elements(widget_config->'columns') AS c
   WHERE widget_type = 'related_list' AND c->>'name' IS NOT NULL
     AND EXISTS (SELECT 1 FROM at_tbl WHERE at_tbl.table_name = widget_config->>'table')
     AND NOT EXISTS (SELECT 1 FROM ac WHERE ac.table_name = widget_config->>'table' AND ac.column_name = c->>'name')
),
-- conversation_panel: child table
cp_tbl_bad AS (
  SELECT widget_id, page_layout_name, 'conversation_panel:missing_table',
         widget_config->>'table'
    FROM live_widgets
   WHERE widget_type = 'conversation_panel'
     AND (widget_config->>'table' IS NULL
          OR NOT EXISTS (SELECT 1 FROM at_tbl WHERE at_tbl.table_name = widget_config->>'table'))
),
-- conversation_panel: fk on child table
cp_fk_bad AS (
  SELECT widget_id, page_layout_name, 'conversation_panel:missing_fk',
         (widget_config->>'table') || '.' || (widget_config->>'fk')
    FROM live_widgets
   WHERE widget_type = 'conversation_panel' AND widget_config->>'fk' IS NOT NULL
     AND EXISTS (SELECT 1 FROM at_tbl WHERE at_tbl.table_name = widget_config->>'table')
     AND NOT EXISTS (SELECT 1 FROM ac WHERE ac.table_name = widget_config->>'table' AND ac.column_name = widget_config->>'fk')
),
-- file_gallery: target table must exist
fg_target_bad AS (
  SELECT widget_id, page_layout_name, 'file_gallery:missing_target_table',
         widget_config->>'target'
    FROM live_widgets
   WHERE widget_type = 'file_gallery' AND widget_config->>'target' IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM at_tbl WHERE at_tbl.table_name = widget_config->>'target')
)
SELECT * FROM fg_host_bad
UNION ALL SELECT * FROM fg_lookup_tbl_bad
UNION ALL SELECT * FROM fg_lookup_field_bad
UNION ALL SELECT * FROM rl_tbl_bad
UNION ALL SELECT * FROM rl_fk_bad
UNION ALL SELECT * FROM rl_sort_bad
UNION ALL SELECT * FROM rl_isdel_bad
UNION ALL SELECT * FROM rl_col_bad
UNION ALL SELECT * FROM cp_tbl_bad
UNION ALL SELECT * FROM cp_fk_bad
UNION ALL SELECT * FROM fg_target_bad
ORDER BY problem, broken_ref;
