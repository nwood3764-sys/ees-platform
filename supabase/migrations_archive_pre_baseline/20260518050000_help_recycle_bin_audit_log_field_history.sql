-- ─── Three help articles for shipped admin features ───────────────────
--   • HA-00038 Recycle Bin
--   • HA-00039 Audit Log
--   • HA-00040 Field History
-- Closes part of the open backlog item "Help articles for remaining
-- shipped features" (Recycle Bin / Audit Log / Field History batch).
--
-- Body content references real database state at migration-write time:
--   audit_log row counts (~7.2k total: 5239 INSERT, 1529 UPDATE,
--     360 SOFT_DELETE, 57 HARD_DELETE, 2 RESTORE),
--   field_history (701 events, 125 active tracked fields),
--   the 29-table curated Recycle Bin dropdown + All Tables sentinel,
--   the typed-UUID purge confirmation flow,
--   the cascade-restore gap (open TASKS item).

insert into help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary,
  ha_body_markdown, ha_category, ha_audience, ha_is_published
) values
(
  '',
  'recycle-bin-restore-and-purge',
  'Recycle Bin — restoring soft-deleted records and permanent purge',
  'How soft-deleted records flow through the Recycle Bin under Setup. ' ||
  'Covers the curated table dropdown, the restore action, the typed-UUID ' ||
  'confirmation required for permanent purge, the audit-log trail every ' ||
  'recycle-bin action leaves, and the cascade behavior gap that''s still ' ||
  'on the open backlog.',
  $body$
LEAP never hard-deletes anything from a record-detail page. Every "Delete" button is a soft-delete — it flips `is_deleted` to true and leaves the row in the table. The Recycle Bin under **Setup → Recycle Bin** is where those rows live until an admin decides what to do with them.

### Getting there

Setup → Recycle Bin (left nav under the Setup module). Visible to anyone with Setup access; restoring and purging is admin-only via the table's RLS policies.

### What you see

A curated table dropdown at the top — 29 entries covering the main business objects (Projects, Opportunities, Work Orders, Properties, Buildings, Units, Accounts, Contacts, Assessments, Incentive Applications, Payment Requests, etc.), the configuration/builder objects (Work Types, Programs, Document/Email Templates, Project Report Templates), the Reports module objects (Reports, Dashboards, Scheduled Reports), and field operations (Vehicles, Equipment, Job Kits).

Child tables (report_filters, dashboard_widgets, page_layout_widgets, etc.) are deliberately not in the dropdown. They're managed via their parent's delete cascade and showing them as standalone bin entries would be noisy without serving the real admin workflow ("I deleted a Project — restore it").

There's also an **All Tables** sentinel option that flips the pane into a cross-table mode showing every soft-deleted row across every soft-deletable table at once. Useful when you don't remember which table the deletion happened in.

Each row shows:
- **Record** — the record id (also the link target on click)
- **Name** — the row's display name (e.g. project_name, opportunity_name, contact_full_name) when the table has one
- **Deleted At** — when the soft-delete happened
- **Deleted By** — who soft-deleted it
- **Reason** — the deletion_reason captured at delete time (required field on every soft-delete)

### Restoring

Click **Restore** on a row to flip `is_deleted` back to false. The row immediately reappears in the original table's list views and related lists. The restoration writes a `RESTORE` row to audit_log.

**Important cascade gap** (open backlog item): the data-standards spec calls for cascade-restore — restoring a parent should restore its children together. The current schema has zero FK CASCADE on delete (all NO ACTION) and no `deletion_batch_id` tracking, so this isn't implemented yet. Restoring a parent today restores only the parent itself; any child rows that were soft-deleted in the same operation stay in the bin. Workaround: restore the children separately, or filter the bin by `Deleted At` near the parent's timestamp to find them. The full implementation is sized in TASKS as a sizeable slice (recursive walk in a SECURITY DEFINER function with depth limits, or batch-id tagging on every soft-deletable table).

### Permanent purge

Purge is the only way to truly remove a record from LEAP. Two protections prevent accidental purges:

1. **Typed UUID confirmation.** The purge modal requires you to type the record's full UUID into a text box. The "Purge" button stays disabled until the typed string matches exactly. No copy-paste shortcuts from elsewhere in the UI.
2. **Full snapshot in the audit log.** Every purge writes a `HARD_DELETE` row to `audit_log` with the entire record state captured in `al_record_snapshot` (jsonb). This is the only recovery path for a purged record — there's no "un-purge" button, but if you discover after the fact that the purge was a mistake, the snapshot in audit_log can be replayed back into the table by an admin.

There are 57 HARD_DELETE rows in audit_log today; 360 SOFT_DELETE rows; 2 RESTORE rows. Most soft-deletes never need to be purged — the bin happily holds them indefinitely.

### Cascade on purge

Same gap as restore — a parent purge today doesn't cascade to its children. Child rows that were soft-deleted alongside the parent will stay in the bin. This is rarely a problem in practice because if the parent is gone, the orphan children's FK references no longer point anywhere, and they get cleaned up naturally during periodic admin sweeps.

### Audit-log breadcrumbs

Every recycle-bin action is auditable:

- **Soft-delete** → `audit_log` row with `al_action='SOFT_DELETE'`, the deleting user in `al_performed_by`, the deletion reason in `al_notes`, and a snapshot of the row at delete time in `al_record_snapshot`.
- **Restore** → `audit_log` row with `al_action='RESTORE'`, the restoring user in `al_performed_by`.
- **Permanent purge** → `audit_log` row with `al_action='HARD_DELETE'`, the purging user in `al_performed_by`, and the full final snapshot in `al_record_snapshot`. This is the snapshot you'd replay if the purge turned out to be a mistake.

Search the audit log under **Setup → Audit Log** with the action filter to find any of these.
$body$,
  'Setup',
  'internal',
  true
),
(
  '',
  'audit-log-viewer-and-search',
  'Audit Log — append-only history of every record-level change',
  'How LEAP captures who did what to which record and when. Covers the ' ||
  'five action types (INSERT/UPDATE/SOFT_DELETE/RESTORE/HARD_DELETE), the ' ||
  'filter controls on the Audit Log pane (object, record UUID, action, ' ||
  'limit), and how to use the full record snapshot on HARD_DELETE rows ' ||
  'to recover a purged record.',
  $body$
The audit log is LEAP's append-only record of every meaningful change to every meaningful row. It's not editable — admins can read it, filter it, and search it, but nothing in the platform writes anything but new rows to it.

### Getting there

Setup → Audit Log. Visible to admins; the pane is gated by Setup permissions.

### What gets logged

Five action types cover the lifecycle of every soft-deletable row in the platform:

- **`INSERT`** — a new row was created. Today: ~5,239 rows.
- **`UPDATE`** — a row was changed. Today: ~1,529 rows. *Note*: per-field detail of what changed lives in the separate `field_history` table (see HA-Field History). The audit_log UPDATE row captures the fact of the update and the record state after, not the individual field deltas.
- **`SOFT_DELETE`** — a row was moved to the Recycle Bin. Today: ~360 rows. Captures the deletion reason in `al_notes`.
- **`RESTORE`** — a row was restored from the Recycle Bin. Today: 2 rows.
- **`HARD_DELETE`** — a row was permanently purged from the Recycle Bin. Today: 57 rows. The full record state at time of purge is in `al_record_snapshot` — this snapshot is the only recovery path for a purged record.

Every row also captures `al_performed_by` (the user who did it), `al_performed_at` (when), `al_object` (which table), `al_record_id` (which row), and optionally `al_notes` (human-readable context — deletion reasons, automated-action descriptions, etc.).

### Filter controls

The pane has four filters:

- **Object** — table name (e.g. `projects`, `work_orders`, `incentive_applications`). Free-text input; substring matching against `al_object`.
- **Record** — full record UUID. The input validates against the UUID format before issuing the query; an invalid UUID holds the filter rather than 400-ing the database.
- **Action** — one of the five action types, or blank for all.
- **Limit** — 100 / 200 / 500 / 1000 rows. Default 200. The table is unbounded (7,000+ rows today and growing) so an unfiltered query would be slow; the limit forces a sensible window.

Filters are applied together as AND. The query runs on Refresh (manual) — typing into the filters doesn't re-query on every keystroke. There's an explicit **Refresh** button at the top of the pane.

### Common investigation patterns

**"What happened to record X?"** — paste the record's UUID into the Record filter, action blank, limit 500. You'll see every INSERT / UPDATE / SOFT_DELETE / etc. event for that one row in chronological order. The most recent row tells you the current state.

**"Who deleted this?"** — same as above, then look for the SOFT_DELETE or HARD_DELETE row. `al_performed_by` is the user; `al_notes` is the deletion reason they typed.

**"Did anyone touch the templates last week?"** — Object filter `project_report_templates`, action blank, limit 500. Sort the result by `al_performed_at` descending to see most-recent first.

**"Show me every restore"** — Action filter `RESTORE`, everything else blank. Today there are only 2 — restore is rare because most soft-deletes don't get reversed.

**"Recover a purged record"** — Action filter `HARD_DELETE`, Object filter the right table. Find the row, expand `al_record_snapshot`, hand it to an admin to replay. The snapshot is the entire row as it existed at purge time, in jsonb.

### Why audit_log is separate from field_history

Two tables, two purposes. `audit_log` answers "what happened to this row at the row level" — created, updated, soft-deleted, restored, purged. `field_history` answers "what specific field values changed, when, and from what to what" — the inline diff visible in each record's Activity Timeline. An UPDATE in audit_log corresponds to one or more rows in field_history if any tracked fields changed. The two tables don't enforce a strict join — field_history rows can exist without an audit_log UPDATE row (when the trigger fires but no tracked field actually changed value) and vice versa.

### Retention

No retention policy. The audit log is forever — that's the point. The table is partitioned-friendly but not partitioned yet; sized growth is monitored via the database dashboard.
$body$,
  'Setup',
  'internal',
  true
),
(
  '',
  'field-history-tracking',
  'Field History — per-field change tracking on key business fields',
  'How LEAP captures the before-and-after value of every tracked-field ' ||
  'change. Covers the field_history events table, the ' ||
  'field_history_tracked_fields config table, where the changes surface ' ||
  '(the Activity Timeline on each record-detail page), the top-tracked ' ||
  'objects today, and how an admin adds a new tracked field.',
  $body$
Field history is the per-field equivalent of the audit log. Where the audit log says "this row was updated at 2:14 PM by Alice," field history says "at 2:14 PM, Alice changed `project_status` from *Project Scheduled* to *Project In Progress*."

### Where you see it

Every record-detail page in LEAP has an **Activity Timeline** (Salesforce-style vertical feed) along the right side. The timeline pulls from both `audit_log` and `field_history` and renders a unified history with inline diff cards for every tracked-field change. You don't need to navigate anywhere special — opening a record is enough.

Per-second changes from the same user are batched into a single logical "update" card so a 6-field edit shows as one card with six diffs, not six cards.

### What's tracked

Today: 125 fields actively tracked across the platform. 701 change events captured so far.

Top objects by tracked-field count:

| Object | Tracked fields |
|---|---|
| Incentive Applications | 10 |
| Work Orders | 10 |
| Project Payment Requests | 8 |
| Project Report Templates | 7 |
| Project Report Template Sections | 7 |
| Envelope Recipients | 6 |
| Projects | 6 |
| Contacts | 6 |
| Opportunities | 5 |
| Tasks | 5 |
| Accounts | 5 |
| Envelopes | 5 |

Tracking emphasizes fields where the *change* itself is meaningful for compliance, accountability, or troubleshooting: status fields, owner fields, dollar amounts, dates with downstream consequences, signature/verification flags, e-signature recipient routing. Not every field — adding tracking to a typo-prone notes field would generate noise without value.

### Two tables, one feature

**`field_history`** (the event log)
- `fh_object` — table name
- `fh_record_id` — the row that changed
- `fh_field` — which column
- `fh_old_value` / `fh_new_value` — both stored as text (cast at write time)
- `fh_changed_by` — public.users.id (resolved from auth.uid)
- `fh_changed_at` — timestamp

**`field_history_tracked_fields`** (the config table)
- `fhtf_table_name` + `fhtf_column_name` — which column on which table
- `fhtf_is_active` — boolean toggle; setting to false stops new events being captured without losing historical ones
- `fhtf_description` — optional human-readable note about why this field is tracked
- Plus standard audit columns

The platform's trigger machinery reads `field_history_tracked_fields` at write time. Any row in there with `fhtf_is_active=true` causes change events on the corresponding column to land in `field_history`. Toggling `fhtf_is_active` to false stops capture immediately — no migration needed, no trigger redeploy.

### Adding a tracked field

Today this is a SQL-only operation (Phase 2 of the spec adds an admin UI). The pattern:

```sql
INSERT INTO field_history_tracked_fields (
  fhtf_table_name, fhtf_column_name, fhtf_is_active, fhtf_description
) VALUES (
  'work_orders', 'wo_scheduled_start', true,
  'Tracking schedule drift for the dispatcher post-mortem report'
);
```

The next change to `wo_scheduled_start` on any work_orders row will write a field_history event. No backfill — only future changes are captured.

### Removing a tracked field

Don't delete the row. Set `fhtf_is_active=false`:

```sql
UPDATE field_history_tracked_fields
SET fhtf_is_active = false
WHERE fhtf_table_name = 'work_orders' AND fhtf_column_name = 'wo_scheduled_start';
```

This preserves all historical events (so the Activity Timeline keeps showing them) but stops new events from being captured. Deleting the row would orphan the historical events from their config context.

### Field history vs the audit log

| | Audit log | Field history |
|---|---|---|
| Granularity | row-level | field-level |
| What it answers | "What happened to this record?" | "What specific values changed and to what?" |
| Action types | INSERT/UPDATE/SOFT_DELETE/RESTORE/HARD_DELETE | only changes (no insert/delete; that's covered by audit) |
| Surface | Setup → Audit Log pane | Record-detail Activity Timeline |
| Trigger | every soft-deletable row | only configured tracked fields |

Both feed the Activity Timeline together. The audit log carries the existence-level events; field history carries the inline diffs.
$body$,
  'Setup',
  'internal',
  true
);

with rb as (select id from help_articles where ha_slug='recycle-bin-restore-and-purge' and not ha_is_deleted)
insert into help_article_anchors (
  haa_article_id, haa_anchor_type, haa_route, haa_object, haa_field, haa_concept, haa_sort_order
)
select id, anchor_type, route, object, field, concept, sort_order
from rb, (values
  ('route'::text,   '/admin/setup/recycle_bin'::text, null::text, null::text, null::text, 1),
  ('concept',       null,                             null,       null,       'recycle-bin',          2),
  ('concept',       null,                             null,       null,       'soft-delete',          3),
  ('concept',       null,                             null,       null,       'permanent-purge',      4),
  ('concept',       null,                             null,       null,       'restore-record',       5),
  ('concept',       null,                             null,       null,       'cascade-restore',      6)
) as t(anchor_type, route, object, field, concept, sort_order);

with al as (select id from help_articles where ha_slug='audit-log-viewer-and-search' and not ha_is_deleted)
insert into help_article_anchors (
  haa_article_id, haa_anchor_type, haa_route, haa_object, haa_field, haa_concept, haa_sort_order
)
select id, anchor_type, route, object, field, concept, sort_order
from al, (values
  ('route'::text,   '/admin/setup/audit_log'::text, null::text,        null::text, null::text, 1),
  ('object',        null,                           'audit_log',       null,       null,       2),
  ('concept',       null,                           null,              null,       'audit-log',            3),
  ('concept',       null,                           null,              null,       'investigate-change',   4),
  ('concept',       null,                           null,              null,       'hard-delete-recovery', 5),
  ('concept',       null,                           null,              null,       'who-did-what',         6)
) as t(anchor_type, route, object, field, concept, sort_order);

with fh as (select id from help_articles where ha_slug='field-history-tracking' and not ha_is_deleted)
insert into help_article_anchors (
  haa_article_id, haa_anchor_type, haa_route, haa_object, haa_field, haa_concept, haa_sort_order
)
select id, anchor_type, route, object, field, concept, sort_order
from fh, (values
  ('object'::text,  null::text, 'field_history'::text,                  null::text, null::text, 1),
  ('object',        null,       'field_history_tracked_fields',         null,       null,       2),
  ('concept',       null,       null,                                   null,       'field-history',                3),
  ('concept',       null,       null,                                   null,       'activity-timeline',            4),
  ('concept',       null,       null,                                   null,       'tracked-fields',               5),
  ('concept',       null,       null,                                   null,       'before-after-diff',            6),
  ('concept',       null,       null,                                   null,       'compliance-tracking',          7)
) as t(anchor_type, route, object, field, concept, sort_order);
