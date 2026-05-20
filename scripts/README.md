# Scripts

Operational scripts for the EES Platform. None of these are required at
runtime; they are tooling for development discipline and post-migration
verification.

## `validate-widget-configs.sql`

Audit query that returns one row per broken reference inside any live
`page_layout_widgets.widget_config`. A clean platform returns zero rows.

This addresses the failure mode where a migration authors a
`widget_config` referencing a column that doesn't exist on the target
table — invisible until a user opens the page and the related-list or
field-group query 500s.

### When to run it

* After any migration that inserts or rewrites `page_layout_widgets`,
  `page_layout_sections`, or `page_layouts` rows. Run it as a follow-up
  via `execute_sql` and confirm the result is empty.
* Before any commit that contains widget-config changes — run the
  query against production, expect zero rows.
* On demand whenever a record-detail page renders incorrectly. If the
  audit returns rows, the bug is in the widget config, not the
  data layer.

### The migration self-test pattern

Every future widget-touching migration should embed a copy of the
validation logic as a `DO $$ ... END $$` block at the end of the
migration body. If any broken reference would remain, the block
`RAISE EXCEPTION`s and the entire migration rolls back inside the same
transaction.

The canonical pattern lives at the bottom of
`supabase/migrations/20260519XXXXXX_stabilization_sweep_widget_configs.sql`
(the stabilization sweep itself). Copy that DO-block verbatim into any
future widget migration; it covers field_group, related_list, and
conversation_panel host/lookup/column/FK references.

### Why a SQL file and not a Node script

The query is single-source-of-truth for what "valid widget config"
means. Keeping it as SQL means it can be:

1. Pasted into `execute_sql` for ad-hoc verification.
2. Run via `psql -f` against the production database for batch
   verification.
3. Wrapped in a `DO $$` block and pasted into any migration as a
   self-test.

A Node wrapper would add a dependency and a parallel definition; the
SQL is the spec.
