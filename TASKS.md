# EES Platform — Task List

Live task list. Updated as each commit lands. **Maintained by Claude** as part
of every working session — every completed step gets reflected here before
the next one starts.

## Format

- `[x]` = done and committed (commit hash in trailing parens)
- `[~]` = in progress (uncommitted changes on disk)
- `[ ]` = not started
- `[blocked]` = blocked on external dependency

**Self-referential hashes:** A commit can't know its own hash in advance, so
when a TASKS.md update lands in the same commit as the work it describes,
the entry uses `(this commit)` as a placeholder. A follow-up chore commit
runs `git log -1 --format=%H` and substitutes the real hash.

## Standing protocols

- **Documentation discipline:** every shipped feature that affects user behavior gets a help article in the same session — anchored to the relevant route, object, or concept so the in-app HelpIcon surfaces it in context. Don't go crazy; only document where users would intuitively reach for help. Required pieces per article: `ha_title`, `ha_summary` (search-friendly), `ha_body_markdown`, and at least one `help_article_anchors` row.
- **Migrations: production-only.** No Supabase dev branches. Always verify with a SELECT after `apply_migration`. Use `apply_migration` for DDL, `execute_sql` for reads.
- **Communication:** one yes/no question at a time. Make a recommendation, ask for approval. No multiple choice.

---

## Up next (open backlog)

### Foundation — start importing real data
- [ ] **Data import: property hierarchy first** — start with Property Owners → Properties → Buildings → Units (via the `accounts` and property tables), then Accounts, Contacts, then Opportunities → Projects → Work Orders. Always import a parent before its children. Format of source export TBD — needs SF CSV/JSON from Nicholas. Production data verified safe to add: schema is stable; renames/type changes/backfills are mechanical (~5 min each); no work blocked by populated tables. Destructive column drops always require a `SELECT COUNT(*)` check-in first per the safety rule.

### Permissions (continuation)
- [ ] **Field-level enforcement on the frontend** — `field_visible` and `field_editable` resolver functions exist in the DB but `RecordDetail.jsx` and widgets don't call them. Today field-level security is queryable but not enforced in the UI. Multi-session backlog item; pairs with the Permission Builder Field Permissions tab UI.
- [blocked] **Row-scoping policies for external portal users** — Property Owner, Property Manager, Subcontractor Partner roles have zero `role_object_access` rows so they're fully locked out at the object level. Activate when subcontractor portal subdomain is built — each gets scoped row-level policies via the resolver functions already in place.

### Help system & documentation
- [ ] **Help articles for remaining shipped features** — ongoing protocol per standing rule. Outstanding: Recycle Bin (restore + purge workflow), Page Layouts / Object Manager (admin editing), Reports module (build, schedule, filters, groupings, calc fields), Dashboards (widgets + folder shares), Audit Log (what's tracked, search), Field History (which fields, viewing), Document/Email Templates (merge fields, publish/lock, snapshots), E-Signature / Envelopes (send, sign, void, lifecycle). Authoring opportunistically as we touch each feature; not a single-session push.

### Recycle Bin
- [ ] **Cascade rule per spec: parent restore restores children together** — investigated previously. Current schema has zero FK CASCADE on delete (all NO ACTION), no batch-id tracking. Implementing properly needs either (a) walking parent-child topology in a SECURITY DEFINER function with depth limits, or (b) adding `deletion_batch_id` on every soft-deletable table. Both sizeable. Deferring until soft-delete cascade pain is real.

### Scheduling Platform (FSL-equivalent customer-facing scheduling — multi-session build)
Replaces the current Jobber-based booking flow. Customer self-serve booking for residential energy assessments via slug-based public URLs on the existing ees-ops site. Schema slice (8 new tables, PostGIS, polygons, picklist lifecycle) shipped this session. Remaining slices below.

- [x] **Customer-bookable work_types seeded** (`9057d98`, 2 migrations) — 4 customer-bookable + 2 dispatcher-only work_types created as net-new rows. Customer-bookable: Single-Family Energy Assessment (WT-00072, 90 min, slug `single-family-assessment`), Townhome Energy Assessment (WT-00073, 30 min, slug `townhome-assessment`), Multifamily Energy Assessment (WT-00074, 60 min × number_of_buildings, slug `multifamily-assessment`), Multifamily Diagnostic Assessment (WT-00075, 120 min, slug `multifamily-diagnostic`, 1/2 crew). Dispatcher-only: HVAC Quote (WT-00076, 45 min), Customer Consultation (WT-00077, 45 min). New column `work_types.work_type_default_project_record_type uuid → picklist_values(id)` so book-appointment edge fn reads the project record type directly from the work_type instead of slug→record-type mapping in code. Each customer-bookable type gets its own URL `/book/<slug>` and its own marketing funnel.
- [ ] **`compute-availability` edge function** — core slot-generation engine. Inputs: address + work_type slug + date range. Validates address via Google Address Validation API. Resolves containing service territory by polygon containment (PostGIS `ST_Contains`) with ZIP-list fallback. Filters qualifying Service Resources (Technician contacts with required `work_type_skill_requirements` satisfied via `contact_skills`). For each candidate slot: computes drive time from home base or previous appointment via Google Routes API (`compute-route-matrix` wrapper, cache-aware), enforces 15-min minimum buffer, validates 45-min lunch block fits within 11:30-13:00 window, applies day-fill preference for resource selection. Returns achievable slots only. Out-of-territory addresses return empty slot list + flag for dispatcher follow-up.
- [ ] **`book-appointment` edge function** — transactional cascade. One call creates Account (match by normalized address or create), Contact (match by email+phone within account or create), Project (new, record_type=work_type's appointment type, project_record_type picklist value), Service Appointment (new, scheduled time/territory/work_type), Work Order (new, from work_type's `work_type_default_work_plan_template_id`), Service Appointment Assignment (junction Contact↔SA for assigned auditor). Issues a Booking Token for the customer's manage-appointment link. Fires booking_confirmation notification template via Twilio + Graph.
- [ ] **`compute-route-matrix` edge function** — Google Routes API wrapper. Uses Compute Route Matrix endpoint with `routingPreference: TRAFFIC_AWARE`. Caches results in `drive_time_cache` keyed on SHA-256 hashes of origin/destination; 60-min TTL during business hours.
- [ ] **`validate-address` edge function** — Google Address Validation API wrapper. Returns canonical normalized address for Account dedup.
- [ ] **`send-sms` edge function** — Twilio wrapper. Writes to `notification_logs` with `nl_provider='twilio'` and Twilio SID. Blocked from production sending until A2P 10DLC registration completes (Nicholas's parallel workstream).
- [ ] **`send-email` edge function** — Microsoft Graph wrapper using application-permission Mail.Send. Sender mailbox derived from the appointment's Service Territory state (e.g. WI appointments send from `assessments.wi@EES-WI.org`, future MI from `assessments.mi@EES-WI.org`, etc.) rather than a single hardcoded sender. First mailbox confirmed by Nicholas: `assessments.wi@EES-WI.org`. Writes to `notification_logs` with `nl_provider='microsoft_graph'` and Graph message ID. Blocked on Azure AD app registration + Mail.Send permission grant on the mailbox.
- [ ] **`twilio-inbound` webhook** — receives Twilio SMS replies. v1 stores reply against `notification_logs`; v1.x surfaces in dispatcher inbox UI.
- [ ] **Customer booking pages** — one per customer-bookable work_type, routes `/book/<slug>` on the existing ees-ops site outside the auth shell. Lean intake form: first/last name, validated service address, phone, email, IRA HOMES program confirmation number, SMS consent checkbox. Multifamily variant includes "Number of buildings" field. Address validation before slot display. Slot list calls `compute-availability`. Confirmation page shows date/time/auditor + small "Manage appointment" link backed by single-use booking token. Custom Fields hook so admin can add per-work-type intake fields later without code changes.
- [ ] **Dispatcher console** — live map (all Service Resources' GPS pins color-coded by status, 30-60s refresh), schedule grid (Gantt-style; drag-and-drop reassign within skills constraints, drag-and-drop reschedule within rules), appointment management (search, filter, manual booking for dispatcher-only types and out-of-territory leads), resource management (skills, territory memberships, absences, home-base override).
- [ ] **Auditor PWA** — installable React PWA for Android crew phones. Day view (today's schedule, chronological). Tap-to-call/text/navigate per appointment. On-My-Way button (manual + 30-min ETA prompt + 15-min auto-fire backup). Arrived button (manual + GPS auto-fire). Unable-to-Complete flag. Microsoft SSO via Azure AD. GPS always-on as install condition. The Start Work Order action hands off to the existing audit workflow (out of this build).
- [ ] **Notification templates seed** — defaults for nine trigger events (booking_confirmation, reminder_48hr, reminder_24hr, reminder_morning_of, on_my_way, arrived, completed, rescheduled, canceled) per the spec's voice. Authoring UI inside Anura Admin's Templates Builder (when that module exists; until then, seed via migration + edit via SQL).
- [blocked] **Twilio A2P 10DLC registration** — Brand + Campaign "Customer Care / Appointment Notifications". 5-10 business day approval. Nicholas's parallel workstream.
- [blocked] **Azure AD app registration + Mail.Send permission grant** — `assessments.wi@EES-WI.org` shared mailbox confirmed created by Nicholas (2026-05-14). Remaining: Azure AD app registration with Mail.Send application permission, plus PowerShell `Add-MailboxPermission` / `Add-RecipientPermission` (Send As) scoping the app to the mailbox. Future state mailboxes (assessments.mi, assessments.nc, assessments.co, assessments.in) follow same pattern.
- [blocked] **Google Cloud project for Routes API + Address Validation API** — billing enabled, API keys in Edge Function secrets, key restricted by Supabase Edge IP range. Nicholas's parallel workstream.

### Major unbuilt (each is a multi-session commitment)
- [ ] **Templates Builder dedicated module** — today document/email templates are managed inside record-detail views; Salesforce parity wants a dedicated module
- [ ] **Lifecycle Builder** — define per-object status transitions, automation triggers, ownership rules
- [ ] **Automation Builder** — Salesforce Flow Builder equivalent (record-change triggers, scheduled actions, multi-step flows)
- [ ] **EES AI assistant** — Claude-API-backed in-app assistant per `anura-ai-spec.md`
- [ ] **E-signature workflow polish** — schema exists (envelopes/recipients/tabs), workflow needs front-end completion
- [ ] **Portal subdomain deployments** — `owner.ees-ops.netlify.app`, `partner.ees-ops.netlify.app`, etc.
- [ ] **Field Mobile PWA** — purpose-built mobile per `anura-field-mobile.md`; includes photo compression at upload + watermarking pipeline
- [ ] **Azure AD / LEAP integration** — app pending Nicholas's manual setup at entra.microsoft.com

### Long-term cleanup (not urgent)
- [ ] **`cfp_*` tables permission policies** — two Cap Forecasting Pipeline tables still have `USING (true)` policies (isolated feature, not in main app flow). Replace with role-aware policies when CFP feature is touched again.

---

## Recently completed (this session — 2026-05-14)

- [x] **Scheduling — `compute-availability` edge function v2** (this commit) — Customer-facing slot-generation engine deployed at `https://flyjigrijjjtcsvpgzvk.supabase.co/functions/v1/compute-availability` (public, `verify_jwt=false`). Inputs: work_type slug, address, optional intake fields, optional date range. Outputs: territory-resolved slot list over 14 days (configurable up to 28) with per-resource attribution. Honors work_type_skill_requirements (only qualifying Technicians eligible), Service Territory containment (ZIP-list now, polygon when geocoder lands), operating_hours per territory per day-of-week, existing service_appointments on the resource's calendar, resource_absences, 15-min minimum buffer between appointments, 45-min lunch block that must START in [11:30, 12:15], 7:00 AM workday start, day-fill resource preference. 4 supporting RPCs added: `resolve_territory_by_point` (PostGIS ST_Contains with deepest-match-wins), `technicians_in_territory` (union of denormalized primary FK + service_territory_members), `appointments_for_resource_in_window` (joins service_appointment_assignments + status filter), `count_appts_for_resource_in_territory_day` (day-fill ranking). Mockable transport layer: Google Address Validation + Routes both passthrough/haversine fallback in v1, real APIs swap in when env keys land. Timezone-correct for America/Chicago via `Intl.DateTimeFormat`-based helpers (Deno Edge runtime defaults to UTC; server-local setHours would shift slots by 5-6 hours). 45 Wisconsin ZIPs seeded into service_territory_zips (23 SW WI, 22 SE WI). SW/SE Wisconsin polygon seam shifted from -89.7 to -88.7 longitude so Madison resolves correctly. Smoke test verified: Madison 53703 → SW WI, Javier + Kenji return 90 slots over 3-day window with lunch math correct. Migrations: scheduling_seed_wisconsin_zip_codes, scheduling_compute_availability_rpcs, scheduling_fix_wisconsin_subterritory_boundaries.
- [x] **Scheduling — BPI MFBA skill + corrected MF Diagnostic requirement** (this commit) — Added `BPI Multifamily Building Analyst` skill (distinct from `BPI Building Analyst`, which is single-family). Multifamily Diagnostic Assessment now requires only BPI MFBA (replaces previous BPI BA + BPI EP requirement, which was soft-deleted). Kenji Chen assigned BPI MFBA as the senior multifamily auditor. Qualification matrix: Single-Family/Townhome/Multifamily Energy Assessment → Javier + Kenji (BPI BA); Multifamily Diagnostic → Kenji alone (BPI MFBA). Migration: scheduling_add_bpi_mfba_and_correct_mf_diagnostic_requirement. (Open question for next slice: should Multifamily Energy Assessment also require BPI MFBA instead of BPI BA?)
- [x] **Scheduling — slot-engine test data ready** (`91c1584`, 2 migrations) — Skill requirements added on all 4 customer-bookable work_types: Single-Family / Townhome / Multifamily Energy Assessment require BPI Building Analyst; Multifamily Diagnostic Assessment requires BPI Building Analyst + BPI Envelope Professional. Test-data fix: Kenji Chen gained BPI Envelope Professional so at least one Technician qualifies for Multifamily Diagnostic. Final qualification matrix: Javier Martinez + Kenji Chen qualify for Single-Family/Townhome/Multifamily Energy Assessment; Kenji Chen alone qualifies for Multifamily Diagnostic. Daniel Okonkwo (trainee, OSHA 10 only) qualifies for none, which is correct. Territory assignments: all 4 Technicians set with Southwestern Wisconsin primary (denormalized on `contacts.contact_service_territory_id`) plus matching `service_territory_members` row with `stm_is_primary=true`; all 4 also non-primary members of Southeastern Wisconsin. Migrations: scheduling_skill_requirements_and_technician_territories, scheduling_kenji_bpi_envelope_professional.
- [x] **Scheduling Platform — schema slice** (`903a534`, 7 migrations) — FSL-equivalent customer-facing scheduling foundation. PostGIS enabled. `service_territories` gained `service_territory_polygon geography(MultiPolygon,4326)` with GIST index. `work_types` extended with `work_type_is_publicly_bookable`, `work_type_public_slug`, `work_type_customer_facing_description`, `work_type_duration_per_unit_minutes`, `work_type_unit_count_intake_field` (unique slug index where publicly bookable + not deleted). Eight new tables: `service_territory_zips` (ZIP-list fallback), `service_territory_members` (multi-territory junction with `stm_is_primary` mirror; primary remains `contacts.contact_service_territory_id`), `operating_hours` (per-territory day-of-week × time windows), `resource_absences` (PTO/Training/Sick/Other absence blocks per contact), `booking_tokens` (single-use customer manage-appointment tokens, edge-function-only writes), `drive_time_cache` (Google Routes results keyed on SHA-256 origin/destination hashes, edge-function-only), `notification_templates` (outbound SMS/email templates keyed on trigger event with per-work_type variants), `notification_logs` (append-only audit of every send, keyed on Twilio SID / Graph message ID). All new tables: standard EES audit columns, record-number triggers, RLS enabled with role-aware policies via `app_user_can`. Picklist seeding: 8 service_appointments.status values (scheduled, en_route, arrived, in_progress, completed, cannot_complete, canceled, no_show), 6 net-new projects.record_type values (single_family_energy_assessment, townhome_energy_assessment, multifamily_energy_assessment, multifamily_diagnostic_assessment, hvac_quote, customer_consultation — not in SF export, EES-native), 4 resource_absences.absence_type values. `role_object_access` seeded for all 8 new tables across 10 internal roles (external roles locked out). Operational territories seeded: 4 new sub-territories (Southwestern Wisconsin + Southeastern Wisconsin under Wisconsin parent; Michigan Lower Peninsula + Michigan Upper Peninsula under Michigan parent) plus North Carolina polygon. All 5 operational territories have default operating hours: Mon-Fri 07:30 first-slot / 18:00 last-slot, Sat 07:30 / 11:00, Sun closed (no row). Coarse bounding-box polygons placeholder until admin draws real shapes.

- [x] **Help frontend — context-aware ? button + /help full center** (`345cc34`) — added `HelpTopbarButton` in topbar right corner (every page), opens HelpPanel with anchors derived from current page via `useCurrentPageAnchors` hook. HelpPanel upgraded with top search box, footer "Browse all help articles" link, and search-mode swap. New `HelpCenterPage` at `/help` and `/help/<slug>` — sidebar by category, search, reading pane, audience filter. `urlNav.js` routes `/help/*` outside module switch.
- [x] **HA-00013 "Finding Help — The Help Center and the Help Button"** — documents both entry points for users. Audience='all'. Anchored to module:home, help-system concepts, and /help route.
- [x] **Help articles for Project Reports** (`df6ea44`) — HA-00009/00010/00011/00012 (Generate / Authoring / Publish Workflow / Photo Variants).
- [x] **Help articles for permission sweep** (`fc625bd`) — HA-00006/00007/00008 (changelog / per-role defaults / troubleshooting runbook).
- [x] **Permission sweep — role-based RLS enforced on all business tables** (`af31b82`, migrations `20260514204537` + `20260514204558`) — seeded `role_object_access` with 65 readable tables × 9 internal roles × 4 actions matrix; dropped 51 `internal_staff_*` permissive overrides. Net: every authenticated request flows through `app_user_can()`. Admin short-circuits true; external roles fully locked out until portal ships.
- [x] **PRG Phase 3 — documents FK columns** (`13d7560`, PRG v16) — `documents.project_report_template_id` + `documents.project_report_template_snapshot_id` FK columns (both nullable, ON DELETE SET NULL), 2 partial indexes, check constraint `documents_prtsn_implies_prt_chk`. Edge fn populates both on insert. Verified live with PROJ-00001 against PRT-00001 v2.

## Completed (chronological, most recent first)

- `8c47b67` dispatcher v10 — row-scope calculated field support
- `542bc82` chore: backfill TASKS.md commit hash for 05f582f
- `05f582f` dispatcher v9 — cross-filter support
- `11151ab` chore: backfill TASKS.md commit hash for 6857310
- `6857310` dispatcher v8 — related-field filters/sorts support
- `2afad5b` chore: backfill TASKS.md commit hash for 9f69b48
- `9f69b48` dispatcher v7 — custom filter logic support
- `8034885` dispatcher v6 — multi-hop via_path support
- `8af706f` admin_health_summary recycle-bin total aligned with 29-table dropdown
- `6b4d0d2` chore: backfill TASKS.md commit hash for ea766b0
- `ea766b0` Recycle Bin cross-table 'All tables' mode
- `39632a3` chore: backfill TASKS.md commit hash for c4da7be
- `c4da7be` audit triggers on folder + folder-share + help tables (9 tables)
- `eb07ab6` add TASKS.md — live working task list
- `0f6e53c` field-history tracking on PRT + envelope columns
- `05a903b` audit triggers on envelope family (3 tables)
- `fbb199f` Setup Home health strip + clickable Most Visited cards
- `5dc957c` audit triggers on PRT family (4 tables)
- `718c37d` Recycle Bin Phase 2 — permanent purge with admin gate
- `4ff648a` field-history tracking on permission/scope/portal columns
- `293e435` Recycle Bin Phase 1 — view + restore
- `52b453d` AuditLogPane with object/record/action filters
- `1339bbf` fetchAuditLog filter params + performer name resolution
- `b0f0f5d` audit triggers on permission/scope/portal tables (6 tables)
- `a64932b` clone_permission_set + Clone button
- `41d3c0a` clone_scheduled_report + Save As button
- `b2549fc` clone_dashboard + Save As button
- `f9fb5ab` audit triggers on Reports + Permission Builder tables (11 tables)
- `4b9cb5b` XLSX attachment support in dispatcher
