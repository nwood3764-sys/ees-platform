-- ─── Help article — DFR → SA conversion flow ─────────────────────────
--   • HA-00046 dfr-to-sa-conversion-flow
-- Documents the Schedule action on the Dispatch Console Follow-ups
-- queue. Companion to the migration in this same commit that adds
-- dfr_resolved_sa_id + extends the page layout, and to the
-- ConvertDfrToSaModal frontend component.
--
-- Covers the modal's UI, what happens on submit (two-write sequence
-- through the existing create-service-appointment edge function and
-- the new markDfrResolvedToSa helper), the trigger that stamps
-- dfr_resolved_at/_by, and the known v1 limitation for
-- out-of-territory addresses (deferred to a v1.1 sibling RPC tracked
-- in TASKS.md).

insert into help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary,
  ha_body_markdown, ha_category, ha_audience, ha_is_published
) values (
  '',
  'dfr-to-sa-conversion-flow',
  'Dispatcher Follow-up Requests — convert a DFR to a Service Appointment',
  'Schedule action on the Dispatch Console Follow-ups queue. Opens a ' ||
  'modal that turns a captured DFR into a real Service Appointment with ' ||
  'one button. Covers the form, the resource picker, what the database ' ||
  'does on submit, and the known v1 limitation for out-of-territory ' ||
  'addresses.',
  $body$
The Follow-ups queue surface has three inline actions per row: **Claim**, **Schedule**, and **Close**. This article covers Schedule — the conversion flow that turns a DFR into a real Service Appointment without the dispatcher re-entering customer info into the public scheduling pages.

### When to use it

After calling a customer captured in a DFR and confirming they still want service, the dispatcher picks a time + a resource and clicks Schedule. The modal does the rest — no walking through the public `/sa/<slug>` flow as if they were the customer, no copy-pasting record numbers between tabs.

For the three positive-conversion cases:

- `no_qualifying_resources` — usually means no auditor with the right cert was available in the public flow. Dispatcher knows which resource to assign and uses Schedule directly.
- `no_availability` — all visible slots in the public 14-day window were blocked. Dispatcher offers a slot outside that window or a slot that opened up.
- `general_inquiry` — customer wasn't sure what they needed. Dispatcher clarifies, picks the right work type, schedules.

For `out_of_territory` — see the v1 limitation section below.

### What the modal shows

The conversion modal opens beside the queue with these sections:

- **Header**: DFR record number + customer name + phone for at-a-glance context
- **Customer** and **Address**: read-only display of the captured DFR fields. If they're wrong, the dispatcher should edit the DFR record first (use the record number link) and then come back to the queue.
- **Work type**: dropdown of every publicly-schedulable, active work type with a public slug. Pre-filled to the DFR's captured work type if it's still in the schedulable set. Each option shows the work type's default duration.
- **Start** / **End**: datetime inputs. Start defaults to the DFR's `dfr_preferred_start_at` (the customer's preferred time captured on the public page), or tomorrow 9:00am local if blank. End auto-computes from start + work-type duration. Changing the work type re-derives the end. Changing start preserves the current duration.
- **Resource**: dropdown of every active field-staff contact (Team Lead, Lead Technician, Project Site Lead, Trainee). Sorted by name. The dropdown shows full name, crew label if any, and contact title.
- **Schedule appointment** button: disabled until every required field is filled.

### What happens on submit

Two writes in sequence, both on the same dispatcher session:

1. **Create the SA** — calls the existing `create-service-appointment` edge function with the captured customer info + the chosen slot and resource. The RPC inside the function runs the full record cascade (Account → Contact → Property → Building → Unit → Opportunity → Project → Work Order → Service Appointment → SAA → Service Appointment Token) inside one transaction, protected by `pg_advisory_xact_lock` on (resource_id, Chicago calendar day) so two dispatchers can't double-book the same resource for the same day.
2. **Link the DFR** — one UPDATE on the DFR row that sets `dfr_status` to Resolved and `dfr_resolved_sa_id` to the new SA's id. The `trg_dfr_stamp_resolution` trigger fires on the status transition and stamps `dfr_resolved_at` = now() + `dfr_resolved_by` = the dispatcher.

On success: toast confirms `SA-#### created from DFR-####`, the DFR row drops out of the queue locally, and the new SA is visible in the swimlane Console view immediately.

### Error handling

The modal surfaces these inline rather than throwing:

- **Slot taken** — the resource was just booked for an overlapping time by another flow. Dispatcher picks a different slot or resource.
- **Outside our service territory** — the captured ZIP isn't in any active `service_territory_zips` row. See the v1 limitation.
- **RPC validation** — invalid phone format, malformed ZIP, etc. Surfaces the RPC's error message verbatim.

### v1 limitation: out-of-territory addresses

The current `create_service_appointment` RPC enforces a hard territory check. A DFR captured with reason `out_of_territory` can't be converted via this flow — the RPC will refuse the cascade and the modal will surface a friendly error with guidance to use Close + handle the appointment manually.

The v1.1 follow-up will add a dispatcher-mode RPC variant that bypasses the territory check for authenticated internal staff and persists the SA with `service_territory_id` NULL (the column is already nullable). Until then, out-of-territory dispatcher conversions are a manual workflow with the DFR queue tracking the lead.

### Data layer

- `markDfrResolvedToSa({ dfr_id, sa_id })` — atomic UPDATE that sets status=Resolved + dfr_resolved_sa_id in one write. Trigger handles the rest. In `src/data/dispatcherFollowups.js`.
- `createServiceAppointment(...)` — reuses the same helper the customer-facing flow uses, no separate path. In `src/serviceAppointments/serviceAppointmentService.js`.

### Schema

- `dispatcher_followup_requests.dfr_resolved_sa_id uuid` — nullable lookup → `service_appointments(id)` ON DELETE SET NULL. Partial index on (dfr_resolved_sa_id) WHERE NOT NULL for fast "DFRs that produced an SA" reporting.
- Surfaced in the Status & Resolution field_group widget on the DFR record-detail page layout as a lookup with `lookup_field = 'sa_record_number'`.

### Reporting

The DFR conversion rate is now easy to compute:

```
select
  count(*) filter (where dfr_resolved_sa_id is not null) as converted,
  count(*) filter (where dfr_status = (select id from picklist_values
                                       where picklist_object='dispatcher_followup_requests'
                                         and picklist_field='dfr_status'
                                         and picklist_value='Resolved')) as resolved,
  count(*) as total
from dispatcher_followup_requests where not dfr_is_deleted;
```

Conversion rate = converted / resolved (i.e. of the DFRs that were resolved positively, how many actually produced an SA vs. were handled some other way).
$body$,
  'Field & Dispatch',
  'internal',
  true
);

with t as (select id from help_articles where ha_slug='dfr-to-sa-conversion-flow' and not ha_is_deleted)
insert into help_article_anchors (
  haa_article_id, haa_anchor_type, haa_route, haa_object, haa_field, haa_concept, haa_sort_order
)
select id, anchor_type, route, object, field, concept, sort_order
from t, (values
  ('object'::text, null::text, 'dispatcher_followup_requests'::text, null::text,             null::text,                       1),
  ('object',       null,       'service_appointments',               null,                   null,                             2),
  ('field',        null,       'dispatcher_followup_requests',       'dfr_resolved_sa_id',   null,                             3),
  ('route',        '/field/dispatch',                          null, null,                   null,                             4),
  ('concept',      null,       null,                                 null,                   'dfr-conversion',                 5),
  ('concept',      null,       null,                                 null,                   'dfr-to-sa',                      6),
  ('concept',      null,       null,                                 null,                   'dispatcher-schedule-action',     7),
  ('concept',      null,       null,                                 null,                   'out-of-territory-limitation',    8)
) as t2(anchor_type, route, object, field, concept, sort_order);
