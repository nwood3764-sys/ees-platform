-- ─── Help article — Dashboards module ─────────────────────────────────
--   • HA-00045 dashboards-widgets-and-folder-shares
-- EIGHTH AND FINAL ARTICLE closing the open help-articles backlog.
-- After this commit, the "Help articles for remaining shipped features"
-- backlog item is fully closed.
--
-- Body content references real platform state at migration-write time:
--   2 dashboards, 2 dashboard_widgets, 2 dashboard_filters,
--   the four widget types (kpi / chart / table / gauge),
--   the grid placement model (position_row + position_col + width +
--     height with dash_columns total),
--   the tight coupling to Reports (every widget is backed by exactly
--     one reports row via dw_report_id),
--   dashboard-level filters that cascade across all widgets at view
--     time and are silently ignored by widgets whose backing report
--     doesn't have the filtered column,
--   the same folder/share model as reports (user_shares +
--     role_shares with access_level view/edit, plus folder df_is_public
--     flag).

insert into help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary,
  ha_body_markdown, ha_category, ha_audience, ha_is_published
) values (
  '',
  'dashboards-widgets-and-folder-shares',
  'Dashboards — assembling reports into grid widgets with shared filters',
  'How dashboards build on the Reports module. Covers the data model ' ||
  '(dashboards / dashboard_widgets / dashboard_filters / dashboard_folders), ' ||
  'the grid placement scheme (row/col + width/height per widget), the ' ||
  'tight coupling to saved reports (every widget is backed by one ' ||
  'reports row), dashboard-level filters that cascade across all ' ||
  'widgets at view time, the folder model with user and role shares ' ||
  'plus access levels, and the current state vs the deferred ' ||
  'storage-layer work.',
  $body$
A dashboard is a curated grid of report-backed widgets sharing a set of view-time filters. Every widget renders one saved report — there's no widget that queries the database directly. This tight coupling to Reports means dashboards reuse the entire report engine (filters, groupings, calculated fields, related-field traversal, runtime prompts) for free.

### The data model

Four tables (counts today):

| Table | Purpose | Today |
|---|---|---|
| `dashboards` | One row per dashboard. Carries name, description, folder, layout config, owner. | 2 |
| `dashboard_widgets` | One row per widget on a dashboard. Carries the backing report id, position + size on the grid, widget type, type-specific config. | 2 |
| `dashboard_filters` | One row per dashboard-level filter prompt. Applied to all widgets at view time. | 2 |
| `dashboard_folders` | Organize dashboards for sharing. Mirrors `report_folders` exactly. | (same as reports) |

Plus the same two-table share model as reports: `dashboard_folder_user_shares` and `dashboard_folder_role_shares` with `access_level` text.

### Grid placement

The dashboard is a grid with `dash_columns` columns (typically 12 for desktop layouts, fewer for mobile). Each widget occupies a rectangular region:

- `dw_position_row` + `dw_position_col` — top-left corner (0-indexed)
- `dw_width` + `dw_height` — span in grid units

For a 12-column dashboard, a widget at `row=0, col=0, width=6, height=4` spans the left half of the top section. A widget at `row=0, col=6, width=6, height=4` sits in the right half of the same row. A widget at `row=4, col=0, width=12, height=2` is a full-width band below.

The renderer reflows the grid on narrow viewports — typically by collapsing to a single column and stacking widgets in row order. `dash_layout` jsonb on the parent dashboard carries the dashboard-wide layout config (grid spacing, narrow-viewport breakpoint, theme).

### Widget types

`dw_widget_type` is one of:
- **kpi** — single-value display. Pulls the first row / first column of the backing report.
- **chart** — bar / line / pie / donut / area. Reads the chart config from `dw_widget_config` jsonb, ignoring the report's own `rpt_charts`.
- **table** — tabular render of the report rows. Truncated to a row limit configured in `dw_widget_config`.
- **gauge** — single-value with a configured min/max + target band.

Each widget can override its title (`dw_title`) independently of the backing report's name — so the same report can render twice under different titles ("Open Work Orders" as a KPI in one dashboard, "Work Order Backlog Trend" as a chart in another).

`dw_widget_config` jsonb carries type-specific config:
```json
{ "chart_type": "bar",          // for chart widgets
  "x_field": "month",
  "y_field": "incentive_amount",
  "y_aggregate": "sum",
  "color_field": "program_name",
  "show_legend": true,
  "row_limit": 100,             // for table widgets
  "kpi_format": "currency",     // for kpi widgets
  "kpi_target": 50000,
  "gauge_min": 0, "gauge_max": 100, "gauge_target_band": [60, 90]
}
```

### Dashboard-level filters

`dashboard_filters` rows define prompts that apply across all widgets at view time. Each filter:

- `dfilt_label` — display label ("State", "Quarter", "Program")
- `dfilt_field_name` — the column to filter on (must exist on each widget's backing report or be reachable via the report's related-field paths)
- `dfilt_operator` — `=`, `in`, `between`, etc.
- `dfilt_default_value` jsonb — initial value when the dashboard is first viewed
- `dfilt_options` jsonb — for picklist prompts, the option list
- `dfilt_display_order` — left-to-right order of the prompts above the grid

At view time, the dashboard renders the prompts at the top, the user fills them, and the engine pushes the values into every widget's backing report as additional filter clauses before executing. Widgets whose backing reports don't have the filtered column simply ignore the prompt.

This is how a "Q3 2026 Operations Dashboard" works — set up a date filter at the dashboard level, every chart/KPI/table re-queries with that date range when the user changes the prompt.

### Folders and sharing

`dashboard_folders` mirrors `report_folders`:
- `df_name`, `df_description`
- `df_parent_folder_id` — folders can nest
- `df_is_public` — folder-wide public flag (any user with platform access sees it)
- `df_owner_user_id` — full-access owner

For non-public folders:
- `dashboard_folder_user_shares` — explicit user grants. `dfus_access_level` is `view` or `edit`.
- `dashboard_folder_role_shares` — role-level grants. Everyone with the role inherits the same `dfrs_access_level`.

The visibility merge at view time: a user sees a dashboard if (a) they own the parent folder, (b) the folder is public, (c) they have a user_shares row for the folder, or (d) they have one of the folder's role_shares matching their role. `view` lets them open and use the dashboard; `edit` additionally lets them modify widgets, filters, layout.

### Relationship to Reports

Dashboards are a thin presentation layer over Reports — every widget is backed by exactly one `reports` row via `dw_report_id`. The engine:

1. Resolves the dashboard's filters to runtime values (defaults or user-edited)
2. For each widget, loads the backing report + its filters + groupings + calc fields
3. Merges the dashboard-level filter values into the widget's filter set
4. Executes the report query against the merged set
5. Renders the result per the widget's type-specific config

This means:
- Changing a backing report affects every dashboard that uses it. Useful for "update this one report and every dashboard reflects it"; risky for "subtle change to a report breaks three dashboards no one remembered were using it."
- You can't have a widget without a saved report. The "ad-hoc widget" pattern requires authoring a saved report first.
- All Reports module features work in dashboards — runtime prompts, cross-filters, calc fields, related-field traversal, multi-level groupings.

### Current state vs spec

Open backlog: "Reports & Dashboards module (deferred pending storage layer completion)" — what's there today is functional but limited:
- Data model complete
- Widget rendering wired up for chart and KPI types
- Grid placement working
- Dashboard-level filters wired up
- Folder model + share tables in place

What's not yet in the UI (committed work for future sessions):
- Drag-to-reposition widgets on the grid (today: edit positions via the widget detail pane)
- Inline widget creation (today: pick a saved report from a list, drops in at the next free grid slot)
- Bulk export of a dashboard as PDF (today: per-widget download or run the backing reports individually)
- Scheduled dashboard delivery (similar to scheduled_reports but rendering the full dashboard as PDF; not yet built)

The data model is stable enough that custom dashboards can be created via SQL today, and the existing widget renderers will pick them up. The UI authoring polish is the remaining work.
$body$,
  'Reports',
  'internal',
  true
);

with t as (select id from help_articles where ha_slug='dashboards-widgets-and-folder-shares' and not ha_is_deleted)
insert into help_article_anchors (
  haa_article_id, haa_anchor_type, haa_route, haa_object, haa_field, haa_concept, haa_sort_order
)
select id, anchor_type, route, object, field, concept, sort_order
from t, (values
  ('object'::text,  null::text, 'dashboards'::text,                       null::text, null::text, 1),
  ('object',        null,       'dashboard_widgets',                      null,       null,       2),
  ('object',        null,       'dashboard_filters',                      null,       null,       3),
  ('object',        null,       'dashboard_folders',                      null,       null,       4),
  ('object',        null,       'dashboard_folder_user_shares',           null,       null,       5),
  ('object',        null,       'dashboard_folder_role_shares',           null,       null,       6),
  ('concept',       null,       null,                                     null,       'dashboards-module',          7),
  ('concept',       null,       null,                                     null,       'dashboard-widgets',          8),
  ('concept',       null,       null,                                     null,       'dashboard-filters',          9),
  ('concept',       null,       null,                                     null,       'kpi-widget',                10),
  ('concept',       null,       null,                                     null,       'dashboard-grid-layout',     11),
  ('concept',       null,       null,                                     null,       'folder-shares',             12),
  ('concept',       null,       null,                                     null,       'dashboard-report-coupling', 13)
) as t2(anchor_type, route, object, field, concept, sort_order);
