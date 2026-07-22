# LEAP Service Provider Portal + Intake — Architecture & Build Plan

**Status:** Active workstream (started 2026-07-21). This doc is the decided spec — the next session starts here with zero ambiguity.

Owner: Nicholas Wood. Author sessions develop on branch `claude/service-provider-portal-intake-w9zkq1` and ship via PR to `master`.

---

## 1. Vision / goal

Stand up EES's **subcontractor / service provider** operating layer inside LEAP:

1. **Service providers are accounts** — one new account **record type: "Service Provider"**, with the trade captured as a **picklist** (HVAC, Electrician, Weatherization, Plumbing, General Contractor), not as separate record types. No record-type/page-layout sprawl.
2. **A root-level Service Provider Portal** — a work-order management system. EES issues work orders to a provider; the provider reviews, accepts/declines, executes, and sees their pay. It is their window into only *their own* projects, work orders, invoices, and payments. A provider must **never** see another provider's work, pay, or the customer's contract values/margins.
3. **A payments layer** — provider pay is calculated from **installed measures** (e.g. a heat pump) via a dedicated **payout price book** that is regional (state) and can be negotiated per provider. Invoices and payments flow from that.
4. **A public intake site** — providers self-sign-up (embeddable on the EES website). Collects basic info, W-9 (uploaded document), license info, contact info/emails, and areas of operation (ZIP codes). **NC first, then WI.** Every applicant becomes a tracked (inactive) Service Provider account + application record; approval flips them active.
5. **(Later) a field-mobile user type** — providers manage their own work orders in the LEAP Pad (`/field`) app.

---

## 2. Decisions (DECIDED 2026-07-21, Nicholas)

| # | Decision | Choice |
|---|---|---|
| D1 | Provider identity | **One account record type "Service Provider"** + trade **picklist** field. No per-trade record types. **DECIDED** |
| D2 | Assignment granularity | **Work-order level.** Each single-trade work order is assigned to one provider; the portal groups a provider's work orders by project. **DECIDED** |
| D3 | Payment model | **Dedicated payout price book**, mirroring the sell-side `price_books`/`price_book_entries` pattern — **state-specific** (per Nicholas 2026-07-21: state, not "regional") with an optional **per-provider override**. Payout = installed quantity × resolved payout rate. **DECIDED** |
| D9 | Pricing/acceptance flow | Pricing rides on the work order as a **proposal** (priced lines = installed measures × resolved rate) that the provider **accepts or rejects**. A proposal may bundle a project's work orders ("project proposal") while acceptance resolves per work order. Acceptance locks the agreed payout, which flows into the invoice/payment section after the work is verified. No provider-entered dollar amounts. **DECIDED 2026-07-21, Nicholas** |
| D4 | Intake landing | **Dedicated application object with a stage lifecycle**, AND every applicant also gets a real **inactive Service Provider account + primary contact** (so repeat applicants are tracked over time). Approval activates them. **DECIDED** |
| D5 | W-9 | **Uploaded document** into a restricted storage bucket. No raw SSN/EIN captured in public form fields. **DECIDED** |
| D6 | Security | A provider can **never** see another provider's pay/projects/work orders, nor customer contract values/margins. Enforced via purpose-built SECURITY DEFINER RPCs scoped to the caller's own provider account. **DECIDED** |
| D7 | Portal delivery | Same-bundle route (matches all LEAP precedent: `/project-portal`, `/field`, `/sign`). Subdomain via the existing `portals.portal_hostname` column pointing at the same Netlify deploy. **DECIDED (recommendation, low-risk)** |
| D8 | Auth/access model | Continue the established **portal_users + SECURITY DEFINER RPC** pattern (as the Project Portal does), **not** the vestigial `external_partner` Postgres role. **DECIDED (recommendation)** |

Open sub-decision (not blocking Phase 1): whether a provider can carry **multiple trades**. Shipping single-picklist primary trade first (per D1); a multi-trade junction can be added later additively if Nicholas wants it. Flag before Phase 3 UI.

---

## 3. Current-state architecture (grounded in the actual code)

Everything below verified by reading the repo, not assumed.

### Accounts (identity)
- `public.accounts` (baseline `20260412000000_leap_baseline_schema.sql:170`). Unified org table.
- Record type = **`account_record_type uuid`** → `picklist_values.id` (FK `accounts_account_record_type_fkey`, idx `accounts_record_type_idx`). A record type is a `picklist_values` row with `picklist_object='accounts'`, `picklist_field='record_type'`.
- Existing account record types (runtime data, not in migrations): `property_owner`, `property_management_company`, `partner_organization`, plus Customer Household / EES-WI Internal.
- **Latent subcontractor columns already on accounts** (text — Salesforce import residue): `account_partner_type`, `account_subcontractor_application_status`, `account_geographic_service_area`, `account_list_of_services_provided`, `account_health_and_safety_programs`, `account_hud_participant_number`, `account_number_of_employees`, `account_year_company_was_formed`, `account_contact_id`. We add clean, purpose-named columns rather than overloading these where their types/semantics don't fit.
- No `record_types` table — record types live entirely in `picklist_values`.
- Page layouts: `page_layouts` (`page_layout_object`, `record_type_id`, `role_id`, `page_layout_is_default`) + `page_layout_widgets`. A new record type gets its own `page_layouts` row.

### Projects / Work Orders (the work)
- Hierarchy: `Property → Building → Opportunity → Project[] → Work Order[] (per unit) → Work Plan[] → Work Step[]`.
- `public.work_orders` (`...:5566`): `project_id`, `opportunity_id`, `property_id`, `building_id`, `unit_id`, `work_type_id` (all structural). Assignment today: `work_order_owner`→users, `assigned_technician_id`→users, **`assigned_subcontractor_id uuid` (NO FK — bare)**, `work_order_account_id`→accounts. Latent sub-workflow fields: `work_order_subcontractor_assigned_at`, `work_order_accepted_at`, `work_order_steps_confirmed_by_sub text`. Status via `work_order_status`/`work_order_approval_status` (picklists).
- `work_plans` / `work_steps` roll up under a WO; field-measured install quantities captured in `work_step_field_values.wsfv_numeric_value` (`20260713144748_work_step_measurement_capture.sql`).

### Measures / pricing (sell-side today)
- `public.opportunity_line_items` (`...:3411`): the "installed measures" — `product_id`, `oli_quantity numeric(10,2)`, `oli_unit_price`, `oli_total_price`, `price_book_entry_id`, `unit_id`. Hangs off the **opportunity**.
- `public.products` (`...:3881`): equipment catalog (heat-pump specs etc.). No price column.
- `public.price_books` (`...:3777`) + `public.price_book_entries` (`...:3755`): **one sell price per product per book** (`price_book_entry_unit_price`), `price_book_is_standard`. **No cost/payout dimension, no per-provider pricing.** This is the pattern our payout book mirrors.

### Payments (AP is greenfield)
- **No invoices/payments/payout/AP tables exist.** The only money tables (`project_payment_requests`, `payment_receipts`) model **incentive money coming IN** from utility programs — opposite direction. Provider AP is fully new.

### Portals (delivery)
- Single-SPA, **path/hostname-dispatched in `src/main.jsx:43-57`** (no router lib). Existing branches: `/project-portal` (`ProjectPortalRoot`), `/sign/...` (token), `/sa`, `/field`. Netlify `/* → /index.html` fallback serves the one bundle. `vite.config.js` is single-entry.
- DB: `portal_users` (`auth_user_id`, `portal_role uuid`, `portal_user_account_id`→accounts, `status`), `portal_user_property_grants` (owner-portal scoping), `portals` (`portal_url_path`, **`portal_hostname`** — subdomain-ready, nothing consumes it yet), `portal_role_assignments`. Portal role **"Service Provider Partner"** already exists (`src/data/helpService.js` PORTAL_ROLES).
- Auth flow: RPC `portal_invite_create` → edge fn `invite-portal-user` (`inviteUserByEmail`, writes `auth_user_id` back) → provider signs in → data served **only** via SECURITY DEFINER RPCs (`get_portal_project_tracker`, `get_portal_calendar`) + one narrow self-select policy `portal_user_self_select`.
- **Security fact that makes D6 clean:** portal users have **no `public.users` row**, so `current_app_user_id()` returns NULL and `app_user_can()` returns false — they are locked out of every normal table by default. All provider data must flow through scoped SECURITY DEFINER RPCs. This is a feature, not a gap.

### Financial visibility tiers
- `field_metadata` / `field_permissions` exist but are **empty / not enforced** (CLAUDE.md flags this a "hard blocker before external/portal users"). **We do not need to light up the whole tier system for this build** — because provider data flows only through RPCs we author, we simply never return Tier 2/3 fields (customer contract value, margin, labor cost) to a provider. Scoping enforces the tier boundary. (A future full tier build remains separate.)

### Pain points / hazards to respect
- Vite named-import + circular-vendor-chunk trap → always `npm run build:safe`, never bare build. Isolate any new heavy vendor (none expected here).
- `public.users.id ≠ auth.users.id`; portal users are in `portal_users`, not `users`.
- `{object}_record_type` columns are uuid FKs to `picklist_values`, resolved via `(picklist_object, picklist_field='record_type', picklist_value)`.
- Every opportunity record type must have its **own** stage picklist via `picklist_value_record_type_assignments` — applies if any new opportunity/project record types are introduced for provider work.
- `block_hard_delete()` on all tables; soft-delete only. Verify column names in `information_schema.columns` before DML. Re-issue REVOKE/GRANT + `NOTIFY pgrst, 'reload schema'` after any function DROP/CREATE. Run `get_advisors(security)` after DDL (baseline ~174–179 known lints; only NEW findings act).

---

## 4. Target architecture & design principles

- **Additive only.** New record type, new columns, new tables, new RPCs, new route. Nothing existing changes behavior.
- **Salesforce parity.** Payout book = standard-vs-custom price book mental model. Application = a record with an explicit stage lifecycle. Explicit `[Object] [State]` status names throughout.
- **Security by scoping, not by trust.** Every provider-facing read/write is a SECURITY DEFINER RPC that derives the caller's provider account from `portal_users.auth_user_id = auth.uid()` and filters to that account only. No provider RPC ever accepts an arbitrary account id from the client as the trust boundary.
- **Every record has a named owner; every application a reviewer; every payout an auditable line back to an installed measure.**

### New objects (summary)
| Object | Prefix | Purpose |
|---|---|---|
| Service Provider account record type | (accounts) | Provider identity |
| `service_provider_applications` | `SPA-` | Intake application + stage lifecycle |
| `sp_payout_price_books` | `SPPB-` | Regional / per-provider payout rate books |
| `sp_payout_price_book_entries` | `SPPE-` | Per-measure payout unit price |
| `service_provider_invoices` | `SPI-` | Provider AP invoice (per accepted work) |
| `service_provider_invoice_line_items` | `SPIL-` | Installed-measure line → payout amount |
| `service_provider_payments` | `SPP-` | Payment made against an invoice |

(Prefixes chosen distinct from existing `SA-` service appointments. Final prefixes confirmed against the auto-number template before authoring.)

### Payout resolution (D3)
`resolve_payout_rate(provider_account_id, state, product_id)`:
1. Active entry in the provider-specific book for that state → use it.
2. Else active entry in the regional **standard** book for that state → use it.
3. Else null (surface "no rate configured" — never guess).
Payout for a work order = Σ over installed measures (`opportunity_line_items` filtered to the WO's unit, and/or field-measured `work_step_field_values`) of `quantity × resolved_rate`.

### Work-order assignment + acceptance (D2)
Add to `work_orders` (purpose-named, clean FK):
- `work_order_service_provider_account_id uuid` → accounts(id) (the assigned provider).
- `work_order_provider_acceptance_status uuid` → picklist (`Work Order Issued to Provider` → `Work Order Accepted by Provider` / `Work Order Declined by Provider`).
- `work_order_provider_declined_reason text`, reuse existing `work_order_accepted_at` / `work_order_subcontractor_assigned_at`.

---

## 5. Phased build plan (each phase additive + independently shippable)

**Phase 1 — Foundation: identity + application object.**
- `service_provider` account record type (picklist_values) + account page layout.
- Trade picklist field `account_service_provider_type` (uuid FK) with 5 values; provider-profile columns (license #, license state/expiry, insurance, W-9 document ref, active flag, primary contact) — clean purpose-named additions.
- `service_provider_applications` object: record number, audit, soft-delete, RLS, stage picklist (`Application Submitted → Under Review → Additional Info Requested → Approved / Declined`), applicant fields, areas-of-operation (ZIPs), W-9 doc ref, link to created account + reviewer/decision fields.
- Application-submit path creates/matches an inactive Service Provider account + primary contact.
- LEAP Admin page layout for the application object. Help article.

**Phase 2 — Payout price book + AP model.**
- `sp_payout_price_books` (+ region/state + optional provider override + is_standard) and `sp_payout_price_book_entries` (product-keyed payout unit price).
- `work_orders` assignment + acceptance columns (above).
- `service_provider_invoices` / `_invoice_line_items` / `service_provider_payments`.
- `resolve_payout_rate` + `calculate_work_order_payout` RPCs. Admin UI to manage payout books. Help article.

**Phase 3 — Provider portal app.**
- `/provider-portal` route + `portal_hostname` subdomain; `ProviderPortalRoot`.
- Scoped RPCs: `get_provider_work_orders`, `provider_accept_work_order` / `provider_decline_work_order`, `get_provider_invoices`, `get_provider_payments` — all filtered to the caller's provider account, returning **no** customer financials.
- Work-order review/accept UI grouped by project; payments/invoices UI. Invite flow reusing `invite-portal-user`. Help article.

**Phase 4 — Public intake site.**
- Public no-auth route `/apply` (+ optional subdomain), NC first then WI (region field).
- Edge function `service-provider-intake` (anon → creates application + inactive account + contact + W-9 upload to restricted bucket; rate-limit/abuse guard).
- Form: basic info, W-9 upload, license info, contact/emails, areas of operation (ZIPs), trade, region. Help article.

**Phase 5 — Field-mobile provider user type (parked).**
- Provider users on `/field` managing their own work orders. Build when Nicholas calls for it.

---

## 6. Technical recommendations / hazards
- Mirror the exact new-object boilerplate (record-number sequence + BEFORE INSERT trigger, standard audit columns, `updated_at` trigger, `block_hard_delete`, 4-policy RLS via `app_user_can`, role/object-access registration, `NOTIFY pgrst`) — template extracted from `20260707120000_property_owner_research_tool_v1.sql`.
- No new heavy frontend vendor needed; the portal reuses existing React/Tailwind/shadcn stack. Still `npm run build:safe` every time.
- W-9 bucket: private, RLS/policy-restricted, never publicly readable; edge function writes with service role; internal reviewers read via signed URLs.
- Run `get_advisors(security)` after each DDL migration; only act on NEW lints beyond the ~174–179 baseline.

## 7. File + DB-table index (what the next session touches most)
- Migrations: `supabase/migrations/2026072x_*` (new). Baseline reference: `20260412000000_leap_baseline_schema.sql` (accounts:170, work_orders:5566, opportunity_line_items:3411, price_books:3777, price_book_entries:3755, portal_users/portals ~3709/3732).
- App: `src/main.jsx` (route dispatch), new `src/pages/ProviderPortalRoot.jsx`, new `src/serviceProviders/*`, `src/data/serviceProviderService.js`; admin surface `src/modules/PortalModule.jsx` + `src/data/portalService.js`.
- Intake: new public entry + edge fn `supabase/functions/service-provider-intake/`.
- Reuse: `supabase/functions/invite-portal-user/index.ts`, `portal_invite_create`.

---

## 8. Progress log

- **2026-07-22 — Merged `master` (NC site-visit scheduling).** Renamed the three SP migration files to their prod-recorded versions (`20260721212400/224648/230720`) so their prefixes no longer collide with the NC migrations. Merged build green.
- **2026-07-22 — Phase 4a (public intake) SHIPPED to branch.** Migration `20260722120000_service_provider_intake.sql` (applied + verified on prod) + the anon edge function + the public form.
  - **Backend:** private `service-provider-documents` storage bucket (authenticated-read; uploads via service role) + `create_service_provider_application(jsonb)` — one transactional SECURITY DEFINER RPC (service_role only) that lands a submission as an **inactive** Service Provider account + primary contact + `service_provider_applications` row (stage 'Application Submitted', source 'Public Intake Site') + one `service_provider_service_areas` row per ZIP. **Repeat applicants** (same normalized legal name + state) reuse their existing account. Owner resolved to first active Project Coordinator → Admin → system user. Verified on prod (reuse path, 2 applications on one account, in-array ZIP dedup, W-9 linked, account inactive; seed rows purged). No new advisor findings (service-role-only → no executable lint).
  - **Edge function `service-provider-intake`** (deployed, ACTIVE, verify_jwt=true → public anon key): CORS, honeypot, required-field validation, W-9 base64 → private bucket upload (10 MB cap, PDF/image only, orphan cleanup on failure), then calls the RPC. Live HTTP round-trip not exercised from the build sandbox (egress policy blocks the functions endpoint) — RPC verified separately; test from the browser form.
  - **Frontend:** `/provider-signup` public route in `src/main.jsx`; `src/pages/ProviderIntakeRoot.jsx` — a public, no-auth multi-section form (company, contact, license, insurance, ZIP areas of operation, W-9 upload, honeypot) that base64s the W-9 and invokes the edge function, then shows a confirmation with the application number. State selector defaults to NC. Link to it from `ees-nc.org` (URL is domain-independent).
  - **Domain note:** LEAP = the `ees-ops` Netlify site (`ees-ops.netlify.app`, no custom domain yet — recommend a CNAME like `app.ees-wi.org`). Marketing sites: WI `www.ees-wi.org`, MI `ees-mi.org`, NC `ees-nc.org`.
- **2026-07-22 — Phase 4b (approval → provision, auto-invite, review UI) SHIPPED to branch.** Nicholas: **auto-send** the invite on approval.
  - **RPCs** (migration `20260722130000`): `approve_service_provider_application(app, portal_role)` — app_user_can-gated; stage → Approved, account → active + 'Service Provider Active', provisions (or finds) the `Provider User` portal login ('Portal User Pending'). `decline_service_provider_application(app, reason)` — stage → Declined, account → 'Service Provider Declined'. Verified on prod (activation + portal-user provisioning; seed rows purged).
  - **Edge function `approve-service-provider`** (deployed, verify_jwt=true): runs the approve RPC as the caller, then **auto-sends** `inviteUserByEmail` (redirect `/provider-portal`) via the service role and links `auth_user_id` back — clone of `invite-portal-user`.
  - **Internal review UI:** new **Service Providers** nav module (`src/modules/ServiceProviderModule.jsx` + `src/data/serviceProviderService.js`) — a review queue of applications with **Approve & invite** / **Decline** (reason), pending/all filter, expandable detail. Registered in `NAV_MODULES`, `App.jsx` switch, `urlNav.js` KNOWN_MODULES; module access seeded for Program/Project Manager, Project Coordinator, Director of Field Services (migration `20260722140000`; Admins via `'*'`).
  - **Still open (small):** the staff **"Issue to Provider"** button on a work order / project (the `generate_service_provider_proposal` RPC is live and tested — it just needs one UI hook in the work-order detail). This is the only remaining piece to drive the whole loop from the staff UI; issuing can be done via the RPC until then.


- **2026-07-21 — Phase 3 (Provider Portal) SHIPPED to branch.** Migration `20260721160000_service_provider_portal_rpcs.sql` (applied + verified on prod) + the portal frontend; `build:safe` green; +4 advisor lints = the standard authenticated-executable lint on the 4 new SECURITY DEFINER RPCs.
  - **RPCs:** `get_provider_portal_data()` (caller → portal_users record_type 'Provider User' → portal_user_account_id → only that provider's work orders/proposals/invoices; no customer contract values/margins ever selected); `provider_respond_to_proposal(proposal, accept, reason)` (accept/reject an issued proposal, cascade to its work orders, hard-scoped to caller's account); internal `generate_service_provider_proposal(provider, work_order_ids, state, notes)` (prices installed measures via `resolve_payout_rate`, app_user_can-gated) and `generate_provider_invoice_from_proposal(proposal)`.
  - **Security verified end-to-end** on prod (isolated seed rows, rolled back): provider A sees its proposal, provider B sees none and gets `proposal_not_found` trying to act on it; accept cascades WO → Accepted + $1,000 agreed payout; invoice total $1,000.
  - **Frontend:** `/provider-portal` route in `src/main.jsx`; `src/pages/ProviderPortalRoot.jsx` (purpose-built, reuses the LEAP `C` design tokens + navy shell — not the customer portal's screens) with inline LoginGate, a Work Orders view (proposals to review + accept/decline, assigned work orders grouped by project) and a Payments view (invoices with lines + payments); `src/data/providerPortalService.js`.
  - **Remaining connective tissue (Phase 3c / folds into Phase 4):** (a) internal staff "Issue to Provider" action wiring `generate_service_provider_proposal` from a work order / project; (b) provider onboarding/invite — create the `portal_users` row (record_type 'Provider User', `portal_user_account_id` = the provider account) + send the auth invite (clone `invite-portal-user` with redirect `/provider-portal`); naturally built with the intake approval step. Until then a provider portal user can be provisioned by staff and the portal is fully functional for them.

- **2026-07-21** — Workstream opened. Architecture mapped, D1–D8 decided. This doc written.
- **2026-07-21 — Phase 1 SHIPPED to branch `claude/service-provider-portal-intake-w9zkq1`** (migration `20260721120000_service_provider_identity_and_application.sql`, applied + verified on prod; `build:safe` green; no new security-advisor findings). Delivered: "Service Provider" account record type; trade + provider-status picklists; provider-profile columns on accounts (license, insurance, W-9 doc ref); `service_provider_applications` (SPA-) with stage lifecycle; `service_provider_service_areas` (SPSA-); RLS + role access; frontend metadata/object-catalog registration. Record-number trigger functionally verified (SPA-00001), test row purged, sequence reset to 1.
  - Deferred within Phase 1: bespoke admin page layout + help article — intentionally bundled with the user-facing phases (intake/portal), since the object has no creation entry point until then. Generic RecordDetail/Object Manager render it today.
- **2026-07-21 — Phase 2 SHIPPED to branch** (migration `20260721140000_service_provider_payout_proposals_ap.sql`, applied + verified on prod; `build:safe` green; +1 advisor lint = the standard `authenticated_security_definer_function_executable` on `resolve_payout_rate`, expected). Delivered:
  - **Payout price book** — `sp_payout_price_books` (SPPB-, state-specific + optional per-provider override, `is_standard`) and `sp_payout_price_book_entries` (SPPE-, per-measure payout rate). `resolve_payout_rate(provider, state, product)`: provider override wins, else state standard book.
  - **Proposals** — `service_provider_proposals` (SPRO-, may bundle a project's WOs) + `service_provider_proposal_lines` (SPRL-, priced measure → work order). Line amount + header total maintained by triggers.
  - **AP** — `service_provider_invoices` (SPI-), `service_provider_invoice_line_items` (SPIL-, amount + total triggers), `service_provider_payments` (SPP-).
  - **work_orders** — assignment (`work_order_service_provider_account_id`), acceptance (`work_order_provider_acceptance_status` + issued/accepted/declined picklist, `work_order_provider_responded_at`, `work_order_provider_declined_reason`), `work_order_active_proposal_id`, `work_order_agreed_payout_amount`.
  - Status picklists for WO acceptance / proposal / invoice / payment. Full RLS + role access (internal staff; portal roles excluded). Frontend metadata + object-catalog registration for all 7 objects. Functionally verified: rate resolution ($1,500) and proposal-total rollup ($6,000 across 2 lines); seed rows purged, sequences reset to 1.
  - Deferred to Phase 3 (portal): the mutating RPCs — `generate_service_provider_proposal` (internal issue), `provider_accept_proposal` / `provider_decline_proposal` (scoped to caller's account), and invoice generation on WO verification. Built alongside the UI that calls them.
