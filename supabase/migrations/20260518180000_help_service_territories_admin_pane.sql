-- ─── Help article — Service Territories admin pane ────────────────────
--   • HA-00048 service-territories-admin-pane
-- Documents the new Admin → Service Territories pane that surfaces every
-- service_territories row. Covers the hierarchy model (parent_territory_id
-- + top_level_territory_id self-refs), the zip-code junction
-- (service_territory_zips), travel-time fields, and how territories drive
-- the address-to-territory match that powers Service Appointment scheduling.

insert into help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary,
  ha_body_markdown, ha_category, ha_audience, ha_is_published
) values (
  '',
  'service-territories-admin-pane',
  'Admin → Service Territories: manage geographic regions and zip assignments',
  'New Admin pane that lists every service_territories row. Covers ' ||
  'the hierarchy model (parent_territory_id + top_level_territory_id), ' ||
  'the zip-code junction (service_territory_zips), travel-time fields, ' ||
  'and how territories drive the address-to-territory match that ' ||
  'powers Service Appointment scheduling.',
  $body$
Service territories are the geographic regions field staff are assigned to. Each Service Appointment is matched to a territory via zip code (or, in the future, a PostGIS polygon) — that match determines which resources can be scheduled and what the dispatcher sees on the Dispatch Console swimlane. Before this pane, territories could only be edited via SQL. Admin → Service Territories now surfaces every row in one place — searchable, sortable, filterable — and the Open Record action drops into the standard record-detail page-layout view.

### Hierarchy model

Territories are hierarchical via two self-referencing FK columns:

- `parent_territory_id` — the immediate parent (one level up). `NULL` means this territory is top-level.
- `top_level_territory_id` — the root ancestor, computed for fast filtering. Equal to `id` when this row is itself top-level.

In the seeded data:

- **Wisconsin (ST-00001)** is top-level with two sub-territories: **Southeastern Wisconsin (ST-00007)** and **Southwestern Wisconsin (ST-00006)**.
- **Michigan (ST-00004)** is top-level with two sub-territories: **Michigan Lower Peninsula (ST-00008)** and **Michigan Upper Peninsula (ST-00009)**.
- **Colorado, Indiana, North Carolina** are top-level with no sub-territories yet.

The Parent column on the pane shows the resolved parent territory name (or `—` for top-level rows). The fetcher bulk-resolves the self-ref against the loaded page to avoid an N+1 query.

### Zip-code junction

`service_territory_zips` (stz_) is the junction table mapping zip codes to territories. The Zips column on the pane shows the live count per territory. Today:

- Southeastern Wisconsin: 22 zips
- Southwestern Wisconsin: 23 zips
- All other territories: 0 zips (pending import)

When a customer submits a Service Appointment with a zip, `create_service_appointment` (RPC) looks up the zip in `service_territory_zips`, resolves the territory, and writes it onto the SA. If no zip match is found, the RPC raises `territory_not_found` — unless `bypass_territory_check=true` is passed (the v1.1 bypass shipped earlier this 2026-05 session for the DFR → SA Schedule action).

### Travel-time fields

Three numeric fields on each territory describe travel characteristics:

- `service_territory_travel_time_buffer_minutes` — fixed buffer added to every drive-time estimate (e.g. 15 minutes to account for parking, loading equipment).
- `service_territory_avg_travel_time_minutes` — measured average across recent trips.
- `service_territory_typical_travel_time_minutes` — manually-curated median, used as a fallback when there's no measured data yet.

These feed the `compute-availability` edge function when ranking which technicians can make a given appointment window without overflowing their schedule.

### PostGIS polygon (future)

`service_territory_polygon` is a PostGIS geometry column reserved for true polygon-based territory matching (when the platform eventually supports drawing boundaries on a map instead of maintaining a zip-list). Today it's unused — the zip-junction is the only resolver wired up. The column was added so future geometry work doesn't require a schema migration.

### Common admin tasks

- **Add a new territory** — click `+ Service Territory` at the top of the pane. The platform creates a row with the next `ST-####` number and opens the record-detail page. Fill in name, set `Is Active = true`, optionally set parent if it's a sub-territory.
- **Add zips to a territory** — the zip-junction isn't editable from the Service Territories pane directly in v1. Use SQL or the (forthcoming) related-list affordance on the Service Territory record-detail page.
- **Deactivate a territory** — set `Is Active = false`. Inactive territories are still visible in lookups but excluded from new SA territory matching.
- **Restructure hierarchy** — change `parent_territory_id` on a sub-territory to move it under a different parent. The platform doesn't auto-recompute `top_level_territory_id` in v1 — do that explicitly after the move.

### Schema reference

`service_territories` table (24 columns):

- Identity: `id`, `service_territory_record_number`, `service_territory_name`
- Hierarchy: `parent_territory_id`, `top_level_territory_id`
- Activation: `service_territory_is_active`
- Description: `service_territory_description`
- Address: `service_territory_street`, `_city`, `_state`, `_zip`, `_country`
- Travel time: `_travel_time_buffer_minutes`, `_avg_travel_time_minutes`, `_typical_travel_time_minutes`
- Geometry: `service_territory_polygon` (PostGIS, reserved)
- Audit: `service_territory_owner`, `service_territory_created_by`, `_created_at`, `_updated_by`, `_updated_at`, `_is_deleted`, `_deleted_at`, `_deleted_by`, `_deletion_reason`

The pane's fetcher (`fetchServiceTerritories` in `src/data/adminService.js`) does three coordinated queries: the territory rows, the owner lookup, and the zip-count aggregate. Self-ref parent names are resolved against the loaded page first, with a follow-up query only for ids that aren't in the page (rare in practice given the small territory count).
$body$,
  'Setup',
  'internal',
  true
);

with t as (select id from help_articles where ha_slug='service-territories-admin-pane' and not ha_is_deleted)
insert into help_article_anchors (
  haa_article_id, haa_anchor_type, haa_route, haa_object, haa_field, haa_concept, haa_sort_order
)
select id, anchor_type, route, object, field, concept, sort_order
from t, (values
  ('object'::text, null::text, 'service_territories'::text, null::text,             null::text,                       1),
  ('object',       null,       'service_territory_zips',   null,                   null,                             2),
  ('route',        '/admin/setup',                         null,    null,                   null,                             3),
  ('concept',      null,       null,                       null,                   'service-territories',            4),
  ('concept',      null,       null,                       null,                   'territory-hierarchy',            5),
  ('concept',      null,       null,                       null,                   'territory-zip-junction',         6),
  ('concept',      null,       null,                       null,                   'territory-travel-time',          7),
  ('concept',      null,       null,                       null,                   'territory-polygon',              8)
) as t2(anchor_type, route, object, field, concept, sort_order);
