-- ─── Help article — Reports module ────────────────────────────────────
--   • HA-00044 reports-module-build-and-schedule
-- Seventh article closing the open help-articles backlog.
--
-- Body content references real platform state at migration-write time:
--   8 reports, 3 report_filters, 3 report_groupings, 4
--     report_calculated_fields, 8 report_folders,
--   4 scheduled_reports, 7 scheduled_report_runs,
--   the dispatch-scheduled-reports v10/v11 dispatcher that achieved
--     full parity with reportsService.js this session,
--   the filter-logic shunting-yard RPN evaluator + recursive-descent
--     expression parser shared between Reports and PRT.

insert into help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary,
  ha_body_markdown, ha_category, ha_audience, ha_is_published
) values (
  '',
  'reports-module-build-and-schedule',
  'Reports — building queries, filters, groupings, calculated fields, and scheduled exports',
  'How the Reports module works end to end. Covers the report data model ' ||
  '(reports / report_filters / report_groupings / report_calculated_fields), ' ||
  'how to pick a primary object and walk related-field paths, the filter ' ||
  'logic expression (1 AND 2 OR 3 references to filter indexes), ' ||
  'multi-level groupings with subtotals and date-granularity buckets, ' ||
  'row-scope vs group-scope calculated fields, runtime prompts that ' ||
  'parameterize a saved report at run time, scheduled reports + their ' ||
  'run history, and the dispatch-scheduled-reports edge function that ' ||
  'fires them.',
  $body$
The Reports module is LEAP's general-purpose query, summarization, and export layer. Authors build reports against a primary object, add filters and groupings, optionally add calculated fields, and either run on-demand or schedule recurring exports. It's the Salesforce Reports equivalent — same mental model, different UI.

### The data model

Five core tables (counts today):

| Table | Purpose | Today |
|---|---|---|
| `reports` | One row per saved report. Carries the primary object, selected fields, filter logic expression, sort + grouping config, runtime prompt config, chart config. | 8 |
| `report_filters` | One row per filter clause. Numbered by `rfilt_filter_index` so the parent report's `rpt_filter_logic` expression can reference them. | 3 |
| `report_groupings` | One row per grouping level (typically 0/1/2 for up to 3-deep grouping). Each level points at one field and carries sort + subtotal config. | 3 |
| `report_calculated_fields` | One row per calculated column. Has scope (row vs group), expression, data type, format options. | 4 |
| `report_folders` | Organize reports for sharing + permissions. Folders use the same role/user-share model as dashboard_folders. | 8 |

Plus the scheduling pair:

| Table | Purpose | Today |
|---|---|---|
| `scheduled_reports` | One row per recurring export config. Frequency, send time, timezone, recipients, format, subject + message. | 4 |
| `scheduled_report_runs` | Append-only log of every fire of a scheduled_report. Captures started/completed/status/row_count/recipient_count/attachment_size/error_message/warnings/provider_message_id. | 7 |

### Building a report

The author picks a **primary object** — any LEAP table can be the root (projects, work_orders, incentive_applications, contacts, etc.). Every field on the primary object is selectable, plus every field reachable via foreign-key traversal.

**Selected fields** live in `rpt_selected_fields` jsonb — an ordered array of column specs. For related-field columns, each spec carries a `via_path` (array of FK hops) so the query engine knows how to join. Example shape:

```json
[
  { "table": "projects",     "field": "project_record_number" },
  { "table": "projects",     "field": "project_status" },
  { "table": "accounts",     "field": "account_name",
    "via_path": [{ "from": "projects", "fk": "project_account_id", "to": "accounts" }] },
  { "table": "work_types",   "field": "work_type_name",
    "via_path": [{ "from": "projects", "fk": "work_type_id", "to": "work_types" }] }
]
```

The same `via_path` pattern applies to filters, groupings, and calculated fields — any field that can be selected can also be filtered, grouped, or referenced in an expression.

### Filters and filter logic

Each row in `report_filters` is one filter clause:
- `rfilt_field_name` + `rfilt_field_table` + `rfilt_field_via_path` — which column (with related-field traversal)
- `rfilt_operator` — `=`, `!=`, `<`, `>`, `>=`, `<=`, `in`, `not_in`, `like`, `ilike`, `is_null`, `is_not_null`, `between`, etc.
- `rfilt_value` — jsonb. For `in`/`not_in` an array; for `between` a `{ from, to }`; for `is_null` ignored.

The parent report's `rpt_filter_logic` text field combines them by index: `(1 AND 2) OR 3` means "filter #1 AND filter #2, or filter #3 alone". If `rpt_filter_logic` is empty, default is "all filters AND'd together". The expression is parsed and evaluated by a shunting-yard RPN evaluator in both the on-demand path and the scheduled-report dispatcher.

**Cross-filters** (`rfilt_is_cross_filter=true`) are sub-query filters — "show projects WHERE there exists an incentive_application matching <sub-filters>". They carry:
- `rfilt_cross_object` — the related table to sub-query
- `rfilt_cross_match` — `with` (EXISTS) or `without` (NOT EXISTS)
- `rfilt_cross_subfilters` — jsonb array of inner filter specs

The dispatcher pre-queries the cross-object set of matching parent IDs, then applies the resulting UUID set as an `IN` filter. Same evaluator code path as on-demand.

**Runtime prompts** (`rfilt_is_runtime_prompt=true`) let a saved report accept user input at run time — "Show me projects in {state}". The author defines:
- `rfilt_runtime_label` — what the prompt asks ("State")
- `rfilt_prompt_input_type` — `text`, `date`, `picklist`, `multipicklist`, `lookup`, `number`
- `rfilt_prompt_options` — for picklist/multipicklist, the option list

At run time the user fills the prompts and the engine substitutes the value into the filter before evaluation. The same report can serve many ad-hoc questions without authoring a new report per variation.

### Groupings

Up to three levels of grouping (`rgr_grouping_level` = 0, 1, 2). Each level:
- Points at one field (with `via_path` for related fields)
- Has a sort direction (`asc` / `desc`)
- Optionally sorts by an aggregate from the report (e.g. "group by work_type ordered by SUM(incentive_amount) desc")
- Optionally shows a subtotal row at the bottom of each group
- For date fields, can bucket by `day` / `week` / `month` / `quarter` / `year` via `rgr_date_granularity`

The summary-format report renders one row per leaf group with the aggregate columns; the tabular-with-grouping format renders the detail rows with subtotal bands.

### Calculated fields

Two scopes (`rcf_scope`):

- **Row-scope** — expression evaluated per detail row. Reference other columns in the report. Examples:
  - `"incentive_amount * 0.85"` — discount calculation
  - `"DATEDIFF('day', project_started_at, NOW())"` — project age in days
  - `"COALESCE(account_name, 'No account')"` — null-safe display
- **Group-scope** — expression evaluated per group at a specified `rcf_grouping_level`. Reference aggregate functions and group-level fields. Examples:
  - `"COUNT(work_orders.id)"` at grouping_level=1 — work order count per group
  - `"SUM(incentive_amount) / NULLIF(SUM(target_amount), 0)"` — incentive-vs-target ratio per group

`rcf_format_options` jsonb controls display: number of decimals, currency symbol, percentage rendering, thousands separator. `rcf_data_type` informs the format defaults but format options always win.

Expressions are parsed by a recursive-descent expression parser that's shared with the project-report generator. Both modules use the same calc-field semantics, so what works in a PRT calculated field works in a Reports calculated field.

### Sort and chart config

`rpt_sort_config` jsonb — ordered array of sort specs. Applied after grouping. Defaults to grouping order if empty.

`rpt_charts` jsonb — chart configurations attached to the report. Each chart spec has a chart type (bar / line / pie / etc.), an x-axis field, a y-axis aggregate, optional series/category breakdowns. Charts render alongside the tabular output when the report is run interactively; in scheduled-export mode they're embedded into PDF exports and skipped for CSV/XLSX.

### Folders and sharing

Reports live in `report_folders`. The same folder model as dashboards:
- Folder owner has full access
- `report_folder_user_shares` — explicit user grants (view / edit)
- `report_folder_role_shares` — role-level grants

Users see reports if (a) they own the report, (b) the folder is publicly shared, or (c) they have a row in either share table for the folder.

### Scheduled reports

A `scheduled_reports` row binds one `reports` row to a recurring fire schedule and a recipient list. Config fields:

- **Frequency** — `daily`, `weekly`, `monthly`. Combined with `sr_day_of_week` (for weekly) and `sr_day_of_month` (for monthly) and `sr_send_time` + `sr_timezone` to derive `sr_next_send_at`.
- **Recipients** — three arrays: `sr_recipient_user_ids` (users in the platform), `sr_recipient_role_ids` (everyone with that role), `sr_recipient_emails` (external emails). All three are merged at fire time.
- **Format** — `csv`, `xlsx`, or `pdf`. CSV and XLSX are tabular; PDF renders the full report with charts.
- **Subject + message** — email subject and body. Support `{{}}` merge fields against report run metadata.
- **`sr_is_active`** — toggle without deleting.
- **`sr_last_sent_at` / `sr_next_send_at`** — populated by the dispatcher each fire.

### Dispatcher engine

The `dispatch-scheduled-reports` edge function (v10/v11) runs on a pg_cron schedule and fires every scheduled_reports row whose `sr_next_send_at <= now()` and `sr_is_active = true`. For each fire:

1. Load the parent report + filters + groupings + calculated fields
2. Substitute any runtime prompt defaults (scheduled fires can't prompt — use saved defaults)
3. Build and execute the query (including filter logic, cross-filters, related-field joins)
4. Apply groupings + calculated fields
5. Render output in the requested format (CSV / XLSX / PDF with charts)
6. Email the attachment via `send-notification-email` v2 to all recipients
7. Write the `scheduled_report_runs` audit row with row_count, attachment_size, recipient_count, status, error_message, warnings
8. Advance `sr_next_send_at` to the next fire window per the frequency config

The dispatcher reached feature parity with the on-demand `reportsService.js` engine in May 2026: multi-hop embed support, custom filter logic via shunting-yard RPN evaluator, related-field filters/sorts via PostgREST `fk.field` syntax, cross-filter support via pre-queried UUID sets, row-scope calculated field evaluation via the ported recursive-descent parser. Saved reports run identically on-demand and on schedule.

### Run history

`scheduled_report_runs` is append-only. Each fire produces one row with:
- `srr_started_at` / `srr_completed_at` — duration of the fire
- `srr_status` — `ok` / `error` / `partial` (some recipients failed)
- `srr_row_count` — how many rows the report returned
- `srr_recipient_count` — how many emails went out
- `srr_recipients` — the array of recipient emails (resolved from user/role + literal email arrays)
- `srr_attachment_size` — bytes
- `srr_error_message` — the error if status = error
- `srr_warnings` — non-fatal warnings (e.g. "one related-field path returned null for some rows")
- `srr_email_provider` + `srr_provider_message_id` — for delivery debugging

Inspect via SQL against `scheduled_report_runs` filtered by `srr_scheduled_report_id`.

### Common patterns

**"How many projects in <state> last quarter"** — primary object projects, runtime-prompt filter on state, date filter between Q1 start/end, no grouping, count aggregate.

**"Incentive payouts by program by month"** — primary object project_payment_requests, grouping level 0 = program (via project), level 1 = pay_date with month granularity, SUM(payment_amount) calculated field at group scope.

**"Active work orders per Team Lead this week"** — primary object work_orders, filter status = Active + scheduled_start in this week, grouping by assigned Team Lead, count work_orders.id calculated field.

**"Subcontractors with no work order this month"** — primary object accounts, filter record_type = Subcontractor Partner, cross-filter on work_orders WITHOUT scheduled_start this month.

### Current state

What works today:
- Full data model
- On-demand run via the Reports module UI
- Scheduled fires via dispatch-scheduled-reports v10+
- Filter logic + cross-filters + runtime prompts + multi-level groupings + calc fields all functioning end-to-end

Per the open backlog: "Reports & Dashboards module (deferred pending storage layer completion)" — the dashboard widget surface is partially built; the more advanced report-builder UI work (drag-drop column reordering, inline chart preview, expression-editor autocomplete) is on the wish list but not yet committed to.
$body$,
  'Reports',
  'internal',
  true
);

with t as (select id from help_articles where ha_slug='reports-module-build-and-schedule' and not ha_is_deleted)
insert into help_article_anchors (
  haa_article_id, haa_anchor_type, haa_route, haa_object, haa_field, haa_concept, haa_sort_order
)
select id, anchor_type, route, object, field, concept, sort_order
from t, (values
  ('object'::text,  null::text, 'reports'::text,                 null::text, null::text, 1),
  ('object',        null,       'report_filters',                null,       null,       2),
  ('object',        null,       'report_groupings',              null,       null,       3),
  ('object',        null,       'report_calculated_fields',      null,       null,       4),
  ('object',        null,       'report_folders',                null,       null,       5),
  ('object',        null,       'scheduled_reports',             null,       null,       6),
  ('object',        null,       'scheduled_report_runs',         null,       null,       7),
  ('concept',       null,       null,                            null,       'reports-module',                8),
  ('concept',       null,       null,                            null,       'filter-logic',                  9),
  ('concept',       null,       null,                            null,       'cross-filters',                10),
  ('concept',       null,       null,                            null,       'runtime-prompts',              11),
  ('concept',       null,       null,                            null,       'report-groupings',             12),
  ('concept',       null,       null,                            null,       'calculated-fields',            13),
  ('concept',       null,       null,                            null,       'scheduled-reports',            14),
  ('concept',       null,       null,                            null,       'related-field-traversal',      15)
) as t2(anchor_type, route, object, field, concept, sort_order);
