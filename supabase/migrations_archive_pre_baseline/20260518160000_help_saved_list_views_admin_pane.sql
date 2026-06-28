-- ─── Help article — Saved List Views admin pane ──────────────────────
--   • HA-00047 saved-list-views-admin-pane
-- Documents the new Admin → Saved List Views pane that surfaces every
-- saved_list_views row in one place. Covers the scope model (personal /
-- role / shared), default-flag semantics, the jsonb filter / visible-
-- columns model, and where list views surface in module record listings.

insert into help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary,
  ha_body_markdown, ha_category, ha_audience, ha_is_published
) values (
  '',
  'saved-list-views-admin-pane',
  'Admin → Saved List Views: manage per-module record listings',
  'New Admin pane that lists every saved_list_views row across the ' ||
  'platform. Covers what list views are, how their three-tier scope ' ||
  '(personal / role / shared) works, the role of the default flag, ' ||
  'the filter / sort / columns model, and where list views surface ' ||
  'in module record listings.',
  $body$
List views are the saved configurations behind every module's record listing — the default "All Service Appointments" view in Field, the "Open Queue" view on the Dispatch Console Follow-ups surface, the "All Opportunities" view in Outreach. Each list view captures a name, the table it operates on, a module, a scope, an optional default flag, a sort, a visible-columns set, and a filter set.

Before this pane, list views could only be created or edited by SQL or by the rare in-app affordances that wrote to `saved_list_views` directly. Admin → Saved List Views now surfaces every row in one place — searchable, sortable, filterable — and the Open Record action drops into the standard record-detail page-layout view so an admin can change name, scope, default flag, sort, columns, or filters without leaving the app.

### Scope model — personal / role / shared

A list view's visibility is determined by which of three exclusive scopes it sits in:

- **Shared** — `list_view_is_shared = true`. Visible to every authenticated user. The right scope for canonical "default" views per module (e.g. "All Open Service Appointments").
- **Role-scoped** — `list_view_role_id` is set, `is_shared = false`. Visible only to users in that role. Use for views that make sense for a specific job function (e.g. a Dispatcher-only "Unresolved Follow-ups" view).
- **Personal** — `list_view_user_id` is set, neither of the above. Visible only to that user. Use for ad-hoc filters an individual saves while working a queue.

The Scope column on the pane resolves these three states into a single string so you can sort or filter by scope at a glance — `Shared`, `Role: Dispatcher`, `User: Nicholas Wood`, or `Personal` (when none of the scope columns are populated, which usually means a legacy row).

### Default flag

`list_view_is_default = true` marks a view as the one shown by default when a user opens the module's record listing. Exactly one list view per (object, scope) tuple should carry the default flag — the platform doesn't enforce this constraint at the DB level, but enforcing it manually keeps the user experience predictable. A user with both a personal default and a role default will see their personal one win; the role default wins over a shared default.

### Filter / sort / columns model

Three jsonb columns hold the actual view configuration:

- `list_view_visible_columns` — array of column-spec objects describing which fields appear in the list. Each entry typically carries `{ field, label, width }` plus optional rendering hints. The Columns count on the pane row shows how many entries are present.
- `list_view_filters` — array of filter-spec objects. Each entry typically carries `{ field, operator, value }`. The Filters count on the pane row shows how many entries are present.
- `list_view_sort_field` + `list_view_sort_direction` — a single sort applied after filters. The Sort column on the pane shows `field ↑` or `field ↓`.

The record-detail page layout renders both jsonb columns as `json` fields, which means they edit as a textarea with parse-validation. A green pill below the textarea shows "valid JSON" once it parses; a red one shows the parse error. The platform doesn't ship a structured filter-builder UI in v1 — the textarea is the editor.

### Where list views surface

Every internal-module record listing in the platform reads from this table. The DFR work shipped earlier in 2026-05 added two list views ("All Dispatcher Follow-ups" + "Open Queue") for `dispatcher_followup_requests` in the `field` module. The same pattern applies to projects, work orders, opportunities, incentive applications, and every other major object.

When a module's record listing renders, the resolution order is:

1. The user's personal default for that object (if any)
2. Their role's default for that object (if any)
3. The shared default for that object
4. Falls back to a system-generated all-columns view if none of the above exist

### Common admin tasks

- **Add a new list view** — click `+ List View` at the top of the pane. The platform creates a row with the next `LV-####` number and opens the record-detail page. Fill in name, object, module, sort, columns, filters, then save. Mark `Is Shared = true` or set a role/user to control visibility.
- **Promote a personal view to shared** — open the view, clear `User`, set `Is Shared = true`. The view immediately becomes visible to all users.
- **Demote a shared view to role-scoped** — open the view, clear `Is Shared`, set `Role`.
- **Change the default for a module** — set the new view's `Is Default = true` and clear the flag on the previous default. This is a two-step manual update; the platform doesn't auto-clear competing defaults in v1.
- **Soft-delete a stale view** — use the standard record-detail delete action with a reason. Deleted views are hidden from module pickers but recoverable from Setup → Recycle Bin.

### Schema reference

`saved_list_views` table (19 columns total):

- Identity: `id`, `list_view_record_number`
- Display: `list_view_name`, `list_view_object`, `list_view_module`
- Scope: `list_view_user_id`, `list_view_role_id`, `list_view_is_shared`
- Defaults: `list_view_is_default`
- Sort: `list_view_sort_field`, `list_view_sort_direction`
- Config: `list_view_visible_columns` (jsonb), `list_view_filters` (jsonb)
- Audit: `list_view_owner`, `list_view_created_by`, `created_at`, `updated_at`, `is_deleted`, `deletion_reason`

The pane's fetcher (`fetchSavedListViews` in `src/data/adminService.js`) does one query and resolves owner + role uuids client-side to render the Scope column as human-readable text.
$body$,
  'Setup',
  'internal',
  true
);

with t as (select id from help_articles where ha_slug='saved-list-views-admin-pane' and not ha_is_deleted)
insert into help_article_anchors (
  haa_article_id, haa_anchor_type, haa_route, haa_object, haa_field, haa_concept, haa_sort_order
)
select id, anchor_type, route, object, field, concept, sort_order
from t, (values
  ('object'::text, null::text, 'saved_list_views'::text, null::text,             null::text,                       1),
  ('route',        '/admin/setup',                    null,    null,                   null,                             2),
  ('concept',      null,       null,                          null,                   'saved-list-views',               3),
  ('concept',      null,       null,                          null,                   'list-view-scope',                4),
  ('concept',      null,       null,                          null,                   'list-view-default-flag',         5),
  ('concept',      null,       null,                          null,                   'list-view-filters',              6),
  ('concept',      null,       null,                          null,                   'list-view-visible-columns',      7),
  ('concept',      null,       null,                          null,                   'admin-setup-pane',               8)
) as t2(anchor_type, route, object, field, concept, sort_order);
