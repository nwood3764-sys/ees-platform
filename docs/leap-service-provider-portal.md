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
