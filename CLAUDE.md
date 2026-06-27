# CLAUDE.md — LEAP Platform

This file is the standing instruction set for the LEAP repo. Read it at the start of every session. Detailed specs live in `/docs/` — read the relevant file on demand when a task touches it (table at the bottom).

---

## What LEAP is

LEAP is a custom, enterprise-grade business operations platform that replaces Salesforce Service Cloud, Salesforce Field Service Lightning, and Jobber. It is the CRM, ERP, project management, field service, inventory, and customer portal — one relational database.

The company running on LEAP is **Energy Efficiency Services of Wisconsin (EES / EES-WI)** — a BPI-certified home performance and HVAC contractor, HQ in Madison WI, operating across WI, NC, CO, MI, IN.

**LEAP is the platform. Energy Efficiency Services is the company.** (Naming hard rule below.)

## Stack

- **Frontend:** React + Vite. Single-file HTML for simple modules; React + Tailwind + shadcn/ui for complex multi-view apps.
- **Database:** Supabase / PostgreSQL — project `flyjigrijjjtcsvpgzvk`. RLS on all tables, FKs enforced, `created_at`/`updated_at` on every record, soft-deletes only.
- **Hosting:** Netlify. Commits to `master` auto-deploy. Subdomain convention `[module].ees-wi.org`.
- **Repo:** `nwood3764-sys/ees-platform`, branch `master`. Commit author must be `Nicholas Wood / nicholas.wood@ees-wi.org` or Netlify blocks the build.

---

## Core philosophy

Default every decision to **Salesforce parity**. If a concept exists in Salesforce, use the same terminology, structure, and mental model unless there's a clearly better approach — and when in doubt, ask. Object=Table, Record Type=Record Type, Page Layout=Page Layout, Picklist=Picklist, Master-Detail=required FK, Lookup=optional FK, Junction Object=Junction Table, Reports & Dashboards=Reports & Dashboards.

Enterprise standards are non-negotiable: data integrity, audit trails, recycle bin, validation rules, field history, role-based security, cascading rules, referential integrity. No shortcuts, no basic implementations.

**Explicit status names.** No generic "active/pending/in progress." Format `[Object] [State]` — e.g. "Project To Be Scheduled," "Work Order To Be Verified." Every status implies the next action; completion of one triggers the next.

**Every record has a named owner** assigned at creation — required field, never a team or pool.

**Every task has an evidence artifact** (photo, document, measurement, verified yes/no) and a second-set-of-eyes verifier before it closes.

**Nothing is hardcoded.** Work types, work plans, work steps, status lifecycles, picklist values, record types, field/role permissions, template assignments — all in the database, manageable through LEAP Admin. New objects/tables/modules are always additive, never break existing functionality.

**Explicit naming always.** No abbreviations, no ambiguous terms. Full descriptive names.

## Build discipline — no workarounds, no reuse across purposes

Every artifact is built for one purpose and named for that purpose. When a request needs a report, dashboard, widget, object, view, column, function, or layout, create a *new* one for that request. Never reach for an existing artifact that's "close enough" — close enough is a workaround.

Prohibited workarounds: reusing an artifact built for a different purpose because it's structurally similar; switching an artifact's primary object/scope to dodge a harder-but-correct path; routing around an untested-but-correct code path; folding two distinct purposes into one artifact; tidying/deleting adjacent records as part of an unrelated task; band-aiding a symptom instead of building the correct structure.

A clean build answers: new purpose-named artifact? yes. Own definition, not inherited? yes. Changing primary object only because correct path is harder? no. Folding two purposes into one? no. Modifying unrelated artifacts as part of this? no.

In particular: **every opportunity record type has its own unique, never-shared opportunity stage picklist**, scoped via `picklist_value_record_type_assignments`. Absolute rule, no exceptions.

## Naming hard rule

The platform is **LEAP**. The company is **Energy Efficiency Services / EES / EES-WI**. Domain **EES-WI.org**. The word **"Anura" is never used** — not in filenames, report/dashboard names, code, comments, migrations, help articles, or prose. If it appears, replace it silently (LEAP for platform, EES for company). The `anura-` prefixed files in `/docs/` are legacy names that predate the rename; read them for substance, write output as LEAP/EES. Do not ask which name to use; do not flag the discrepancy.

---

## Design system

Never deviate without explicit instruction.

**Palette:** sidebar bg `#07111f`, page bg `#f0f3f8`, card `#ffffff`, card secondary `#f7f9fc`, border `#e4e9f2`, border dark `#d0d8e8`, emerald accent `#3ecf8e` (primary action), emerald mid `#2aab72`, sky blue secondary `#7eb3e8`, amber warning `#e8a949`, text primary `#0d1a2e`, text secondary `#4a5e7a`, text muted `#8fa0b8`, nav inactive `rgba(255,255,255,0.62)`, nav active `rgba(255,255,255,0.96)`.

**No red/orange anywhere.** Error/warning/destructive states use blue (sky `#7eb3e8`) or navy.

**Type:** Inter for UI, JetBrains Mono for codes/numbers/IDs. **Icons:** SVG only, no emoji in UI chrome.

**Layout:** fixed 240px sidebar, sticky 54px topbar, scrollable content. Always mobile responsive — breakpoints: tablet ≤900px (grid stacks to single column), mobile ≤768px (sidebar hidden, hamburger + backdrop), small ≤520px (secondary nav hidden). Cards: 1px border, subtle shadow, 8px radius. Animations subtle, 200–250ms ease, translateY(5px) fade-up on load. Sidebar active state: 3px emerald left border, lighter bg, full white text.

## Financial visibility tiers

Controlled at the database view level, not just UI. Stored in `field_permissions`, applied dynamically — never hardcoded in app logic.
- **Tier 1** (all internal staff): existence, status, assignments, dates, property info, work order details.
- **Tier 2** (Project Managers and above): contract values, rebate/incentive amounts, invoice totals, opportunity line item amounts.
- **Tier 3** (Admin only): gross margin, labor cost, overhead, net revenue, P&L, all financial aggregates.

---

## Schema patterns (hard-won — follow exactly)

- **`public.users.id` ≠ `auth.users.id`** — linked via `public.users.auth_user_id`. All owner-FK columns target `public.users.id`. Translate with `current_app_user_id()` / `getCurrentUserId()`.
- **`{object}_record_type` columns are `uuid` FK to `picklist_values.id`**, not text. Backfills resolve UUID via `(picklist_object, picklist_field='record_type', picklist_value)`.
- **`report_filters` is authoritative** for active filters — always query with `is_deleted IS NOT TRUE` before assuming filters are absent. The inline `rpt_runtime_prompts` JSON on `reports` rows is NOT the source of truth.
- **`block_hard_delete()` trigger is on all tables** — all deletions are soft-deletes.
- **Always verify column names** in `information_schema.columns` before writing DML. Prefix conventions are inconsistent; assumed names will be wrong.
- Auto-number triggers exist on `reports` (`trg_reports_rn`) and `dashboards` (`trg_dashboards_rn`) — pass `''` for record-number columns and the trigger fills them.
- `report_filters.rfilt_prompt_input_type` accepts `'select'`, not `'picklist'`. Verify check constraints with `pg_get_constraintdef` before authoring.
- After any DROP/CREATE of a function: re-issue REVOKE/GRANT and `NOTIFY pgrst, 'reload schema'`.

## Vite hazards

Named imports Vite can't resolve are left `undefined` silently; circular vendor chunks cause TDZ errors. Always run `npm run build:safe` (preflight + Vite + runtime-smoke) and smoke-load before relying on a build. Never use bare `npm run build`. Run `npm install` first in a fresh clone.

## Ship cycle (non-negotiable)

schema migration → explicit SELECT verify → code → `npm run build:safe` → commit as Nicholas Wood → push to `master` → `get_advisors(security)` after any DDL → help article in the same session for any user-facing feature.

Security advisor baseline is ~179 known lints (mostly `auth_security_definer_function`, one `rls_disabled_in_public` for `spatial_ref_sys`, one `extension_in_public`, declined leaked-password protection). Only NEW findings beyond this set require action.

---

## Working style

Drive the work; don't check in constantly. Surface only genuine binary decisions — state a recommendation first, then ask once, yes/no. Don't list options. Don't defer builds. No tangential commentary or unsolicited analysis. Verify a push actually reached the live bundle before reporting success.

---

## CURRENT BUILD STATE (as of 2026-06-27)

Active workstream: **Outreach Dashboard (DSH-00010)**.

**Done and shipped to master:**
- Two purpose-built reports: **RPT-00036** Outreach Status Report (primary object `properties`, NC state runtime filter) and **RPT-00037** Outreach Pipeline by Stage Report (primary object `opportunities`, NC filter).
- **DSH-00010 Outreach Dashboard** — 5 widgets: Total Properties (metric) + By Status (bar) on row 0; By County (bar, top 20) + By Property Owner (bar, top 20) on row 1; Pipeline by Stage (funnel) on row 2. Cascading state filter on `property_state`, default NC.
- State filter converted from hardcoded text input to a data-driven dropdown: new RPC `dashboard_filter_distinct_values` (security invoker, RLS-respecting), `dfilt_options` descriptor `{source:'distinct', object:'properties', field:'property_state'}`, `fetchFilterOptions` helper in `reportsService.js`, `DashboardRunner.jsx` renders `<select>` when options exist.
- `OutreachModule.jsx` corrected from `moduleId="enrollment"` to `moduleId="outreach"` (`crumb="Outreach"`) — now resolves to home page **HP-00006** with its DSH-00010 dashboard component. (Opportunities was already in the Outreach nav — `CODE_SECTIONS` `{id:'opps'}` — no change needed.)
- Embedded-dashboard **Edit** button rewired (`ConfiguredHome` → `HomeComponentRenderer` → `EmbeddedDashboard` → `DashboardRunner.onEdit`) to open the full `DashboardEditor` (Salesforce-style builder) full-screen, home remounts after save.
- `HomePageBuilder.jsx` got pre-save validation + `friendlySaveError()` translating raw Postgres errors into plain messages. HP-00006 component title corrected to "Outreach Dashboard."

**Architecture facts confirmed:** Dashboards (`dashboards` + `dashboard_widgets`, rendered by `DashboardRunner`) and Home Pages (`home_pages` + `home_page_components`, rendered by `HomeComponentRenderer`) are parallel subsystems. A home page component with `hpc_type='dashboard'` and `hpc_source_id` = a dashboard UUID renders `DashboardRunner` directly. Home page resolves per module via `resolve_home_page_for_module` RPC. `report_aggregate` RPC returns `{label, value, raw_value}`, verified NC-scoped for County (20 groups), Owner (20 groups), Pipeline by Stage (1 group). Note: `report_groupings.rgr_field_via_path` documented shape `{from,fk,to}` does NOT match what `getRowValue` in the live runner expects (bare FK string arrays like `["property_id"]`) — verify against the runner before authoring related-field groupings.

**Open / on the horizon (confirm with Nicholas before acting):**
- **By Status widget disposition** — all NC properties currently have null `property_status`, so the widget may warrant soft-deletion. Confirm: keep or remove.
- Verify all four grouped widgets render correctly on the live site after the recent pushes.
- Activity tracking layer for DSH-00010 (emails/calls logged against opportunities) — additive, no rework.
- Financial visibility tier gating (Tier 1/2/3) — hard blocker before external/portal users; `field_metadata` and `field_permissions` are currently empty.
- Null record types on real records across multi-type objects (`work_steps` 52, `buildings` 7, `contacts` 6, `work_orders` 5, `opportunities` 4, `projects` 3, `incentive_applications` 2) — resolve via Salesforce import.
- Docs cleanup: rename the 19 `anura-`-prefixed files in `/docs/`, scrub "Anura" from content (→ LEAP / EES), fix internal cross-references. Not yet executed — Claude Code can do this in one pass.

---

## Detailed reference — `/docs/`

| Topic | File |
|---|---|
| Master project instructions | `ANURA-PROJECT-INSTRUCTIONS.md` (legacy name; content is LEAP) |
| Property hierarchy | `anura-property-hierarchy.md` |
| Roles, field ops, asset accountability | `anura-roles-and-field-structure.md` |
| Program portfolio (5 states) | `anura-programs.md` |
| 12-stage project lifecycle | `anura-project-lifecycle.md` |
| Status lifecycles per object | `anura-status-lifecycles.md` |
| Work types, work plans, materials | `anura-work-types.md` |
| Vehicles and fleet | `anura-fleet.md` |
| Communications and templates | `anura-communications.md`, `leap-communications-module-1.md` |
| Admin Builders | `anura-admin-builders.md` |
| Portals (owner and partner) | `anura-portals.md` |
| Field Mobile | `anura-field-mobile.md` |
| Reports and dashboards | `anura-reports.md` |
| Data standards, validation, retention | `anura-data-standards.md` |
| AI assistant | `anura-ai-spec.md` |
| Module list and build order | `anura-modules-and-build-order.md` |
| Schema session instructions | `anura-schema-session.md` |
| HUD data sources | `anura-hud-data-sources.md` |
| Agent operating mode | `anura-agent-operating-mode.md` |
| Build discipline (folded into this file) | `leap-build-discipline.md` |
| Naming standard (folded into this file) | `leap-naming-standard.md` |
