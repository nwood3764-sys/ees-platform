-- Update HA-00046 to reflect the v1.1 territory-bypass shipped in the
-- same commit as this migration. The article body removes the v1
-- limitation language and adds an "Out-of-territory handling" section
-- describing the new bypass flag, the server-side gating, and the
-- territory_bypassed return field.

update help_articles
set ha_body_markdown = $body$
The Follow-ups queue surface has three inline actions per row: **Claim**, **Schedule**, and **Close**. This article covers Schedule — the conversion flow that turns a DFR into a real Service Appointment without the dispatcher re-entering customer info into the public scheduling pages.

### When to use it

After calling a customer captured in a DFR and confirming they still want service, the dispatcher picks a time + a resource and clicks Schedule. The modal does the rest — no walking through the public `/sa/<slug>` flow as if they were the customer, no copy-pasting record numbers between tabs.

Works for all four DFR reasons:

- `no_qualifying_resources` — usually means no auditor with the right cert was available in the public flow. Dispatcher knows which resource to assign and uses Schedule directly.
- `no_availability` — all visible slots in the public 14-day window were blocked. Dispatcher offers a slot outside that window or a slot that opened up.
- `general_inquiry` — customer wasn't sure what they needed. Dispatcher clarifies, picks the right work type, schedules.
- `out_of_territory` — the captured ZIP isn't inside any active service territory. The RPC bypasses the territory check for authenticated dispatchers and creates the SA with `service_territory_id = NULL`. See the section on out-of-territory handling below.

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

1. **Create the SA** — calls the `create_service_appointment` RPC directly via `supabase.rpc()` (not via the public edge function — that path is anon-keyed and would lose the dispatcher's session). The modal passes `bypass_territory_check: true` in the payload. Inside the RPC the flag is gated server-side: it's only honored when `current_app_user_id() IS NOT NULL`, so anon callers cannot activate the bypass even if they try to pass the flag. The full record cascade (Account → Contact → Property → Building → Unit → Opportunity → Project → Work Order → Service Appointment → SAA → Service Appointment Token) runs inside one transaction protected by `pg_advisory_xact_lock` on (resource_id, Chicago calendar day).
2. **Link the DFR** — one UPDATE on the DFR row that sets `dfr_status` to Resolved and `dfr_resolved_sa_id` to the new SA's id. The `trg_dfr_stamp_resolution` trigger fires on the status transition and stamps `dfr_resolved_at` = now() + `dfr_resolved_by` = the dispatcher.

On success: toast confirms `SA-#### created from DFR-####` (plus `(out-of-territory bypass applied)` if the bypass triggered), the DFR row drops out of the queue locally, and the new SA is visible in the swimlane Console view immediately.

### Out-of-territory handling (v1.1)

The `create_service_appointment` RPC accepts a `bypass_territory_check` flag in its payload. The flag is honored only when the caller is an authenticated app user (`current_app_user_id() IS NOT NULL`). When the bypass is active and the captured ZIP doesn't match any active `service_territory_zips` row, the cascade proceeds with `service_territory_id = NULL` instead of returning the standard "Address is outside our service territory" error. The column is already nullable; no schema change was needed.

Security model:

- Customer flow (anon → edge function → service-role-key RPC call): `current_app_user_id()` returns NULL because the service-role JWT has no `sub` mapping to `auth.users`. The bypass flag is silently ignored even if passed. Customer behavior is unchanged.
- Dispatcher flow (authenticated → direct RPC call with session JWT): `current_app_user_id()` resolves to the dispatcher's public.users.id. The bypass flag is honored.

The RPC return now includes a `territory_bypassed` boolean. It's true only when all three conditions held: the flag was set in the payload, the caller was authenticated, and the ZIP didn't match a territory. The modal reads this and adjusts the success toast accordingly so the dispatcher knows the bypass triggered.

### Error handling

The modal surfaces these inline rather than throwing:

- **Slot taken** — the resource was just booked for an overlapping time by another flow. Dispatcher picks a different slot or resource.
- **RPC validation** — invalid phone format, malformed ZIP, etc. Surfaces the RPC's error message verbatim.

### Data layer

- `markDfrResolvedToSa({ dfr_id, sa_id })` — atomic UPDATE that sets status=Resolved + dfr_resolved_sa_id in one write. Trigger handles the rest. In `src/data/dispatcherFollowups.js`.
- `dispatcherCreateServiceAppointment(...)` — direct supabase.rpc() wrapper that calls the RPC with the dispatcher's session JWT and passes the bypass flag. In `src/serviceAppointments/serviceAppointmentService.js`.
- `createServiceAppointment(...)` — the original anon-keyed edge-function helper. Stays in place for the customer-facing scheduling flow.

### Schema

- `dispatcher_followup_requests.dfr_resolved_sa_id uuid` — nullable lookup → `service_appointments(id)` ON DELETE SET NULL. Partial index on (dfr_resolved_sa_id) WHERE NOT NULL for fast "DFRs that produced an SA" reporting.
- Surfaced in the Status & Resolution field_group widget on the DFR record-detail page layout as a lookup with `lookup_field = 'sa_record_number'`.
- `service_appointments.service_territory_id` — already nullable; out-of-territory dispatcher conversions leave this NULL.

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

For SAs created via the dispatcher bypass specifically:

```
select sa_record_number, sa_created_at
from service_appointments
where service_territory_id is null
  and not coalesce(sa_is_deleted, false);
```

A NULL `service_territory_id` is the signal that the SA was created via the dispatcher-mode bypass path — no customer-facing flow ever leaves it null.
$body$,
ha_updated_at = now()
where ha_slug = 'dfr-to-sa-conversion-flow' and not ha_is_deleted;
