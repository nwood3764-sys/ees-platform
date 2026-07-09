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

## Handoff standard

When closing out a workstream or teeing up the next one, write the handoff as a dedicated `docs/leap-*.md` file — not just chat. Use `docs/leap-builder-rearchitecture.md` as the model. Structure:

1. **Vision / goal** — what we're building, in plain terms.
2. **What just shipped** — context from the session that produced the handoff (PRs, what's live).
3. **Current-state architecture map** — grounded in the *actual code*: file paths, DB tables, and a candid list of pain points. Use an Explore subagent to map it accurately rather than guessing.
4. **Target architecture + design principles.**
5. **Phased build plan** — each phase additive and independently shippable.
6. **Technical recommendations** — libraries (with licenses), schema changes, known hazards (e.g. the Vite vendor-chunk trap).
7. **Decisions** — recommendation first; mark each **DECIDED** with date + owner as it's confirmed, so the next session never relitigates.
8. **File + DB-table index** — what the next session will touch most.

Then set the **CURRENT BUILD STATE → Active workstream** line to point at the doc, add the doc to the `/docs/` reference table, and merge it to `master` (via PR) so a fresh session reads it on clone. The whole point: the next session starts from a complete, decided spec with zero ambiguity.

---

## CURRENT BUILD STATE (as of 2026-06-29)

Active workstream: **Builder rearchitecture — WYSIWYG drag-and-drop builders (Salesforce parity).** Full handoff + per-phase status: `docs/leap-builder-rearchitecture.md`. Goal: one three-pane canvas (palette / live canvas / inspector) + a per-surface component registry, replacing the form-driven builders.

**Shipped to production (master):**
- **Phase 0 — Foundation:** `react-grid-layout` + `@dnd-kit/*` (isolated vendor chunks, verified no TDZ cycle); `src/builder/` — geometry model (`{x,y,w,h}` 12-col), per-surface component registries, three-pane `LeapCanvas`.
- **Phase 1 — Dashboards:** `DashboardCanvasEditor` replaced the old `DashboardEditor` everywhere; live report-data previews; geometry + Title/Subtitle/Footer chrome persisted in `dw_widget_config`; `DashboardRunner` renders by geometry (view == build) with legacy fallback.
- **Phase 2 — Home pages:** canvas generalized into a per-surface engine (registry object); `HomePageCanvasEditor` replaced `HomePageBuilder`; geometry in `hpc_config._geometry`; `ConfiguredHome` honors geometry with legacy fallback.
- **Phase 3 — Reports:** drag-and-drop field selection; formula engine extended (38 functions) + visual calc-field editor (insert field/function pickers + Check syntax); **live preview from unsaved config** (`runReport` split into a loader + `runReportDefinition`; `buildReportDefinition` mirrors `saveReport`). NOTE: deliberately extended `lib/reportFormulaEval` instead of swapping to mathjs/formulajs (would break existing formulas — see handoff doc).
- Legacy `DashboardEditor.jsx`, `HomePageBuilder.jsx`, and the Phase 0 `BuilderStudio` preview deleted.
- **Help articles (prod):** HA-00113/114/115 for the new builders.

**Phase 4 (record page layouts) — re-platform DECLINED:** the existing `LayoutEditor`/`LayoutCanvas` already IS a working WYSIWYG drag canvas, so folding it onto the shared engine is high risk / low user-value on a core feature. The WYSIWYG goal is met across all four surfaces. The rearchitecture is functionally complete; the unified fold remains an optional, staging-soaked follow-up. See handoff doc.

**Shipped 2026-06-29 (PR #11, live on master/prod):**
- Dashboard filter columns now override a report's own saved filter on the same column (`reportsService.runReport`/`runWidgetAggregate` `overrideFields` param; `DashboardRunner` passes its filter columns). Fixed Outreach Dashboard STATE filter — "All" = all states (10,964), non-NC states filter correctly, NC stays the default.
- Enrollment module (`OutreachModule.jsx`, route `/m/enrollment`) home now resolves to HP-00005 Enrollment Home / DSH-00009 Enrollment Overview instead of the Outreach dashboard (was wrongly `moduleId="outreach"`).

**Migration baseline / dev workflow (2026-06-28):** the migration history was squashed into a single verified baseline so Supabase branching (isolated sandbox DBs) works. `supabase/migrations/` now contains only `20260412000000_leap_baseline_schema.sql` (generated from live prod, fingerprint-verified against production on a throwaway branch — every table/column/function/policy/constraint identical). The 190 prior files live in `supabase/migrations_archive_pre_baseline/` (reference only, never replayed). Production's 870-row migration registry was replaced with the single baseline row; the full history is backed up in `supabase_migrations.schema_migrations_backup_20260628`. Going forward, every schema change is a NEW migration file added after the baseline. Custom RLS roles (`internal_staff`, `external_partner`, `customer`) are created at the top of the baseline. See `docs/leap-dev-workflow.md`.

**Done and shipped to master:**
- Two purpose-built reports: **RPT-00036** Outreach Status Report (primary object `properties`, NC state runtime filter) and **RPT-00037** Outreach Pipeline by Stage Report (primary object `opportunities`, NC filter).
- **DSH-00010 Outreach Dashboard** — 5 widgets: Total Properties (metric) + By Status (bar) on row 0; By County (bar, top 20) + By Property Owner (bar, top 20) on row 1; Pipeline by Stage (funnel) on row 2. Cascading state filter on `property_state`, default NC.
- State filter converted from hardcoded text input to a data-driven dropdown: new RPC `dashboard_filter_distinct_values` (security invoker, RLS-respecting), `dfilt_options` descriptor `{source:'distinct', object:'properties', field:'property_state'}`, `fetchFilterOptions` helper in `reportsService.js`, `DashboardRunner.jsx` renders `<select>` when options exist.
- `OutreachModule.jsx` corrected from `moduleId="enrollment"` to `moduleId="outreach"` (`crumb="Outreach"`) — now resolves to home page **HP-00006** with its DSH-00010 dashboard component. (Opportunities was already in the Outreach nav — `CODE_SECTIONS` `{id:'opps'}` — no change needed.)
- Embedded-dashboard **Edit** button rewired (`ConfiguredHome` → `HomeComponentRenderer` → `EmbeddedDashboard` → `DashboardRunner.onEdit`) to open the full `DashboardEditor` (Salesforce-style builder) full-screen, home remounts after save.
- `HomePageBuilder.jsx` got pre-save validation + `friendlySaveError()` translating raw Postgres errors into plain messages. HP-00006 component title corrected to "Outreach Dashboard."

**Architecture facts confirmed:** Dashboards (`dashboards` + `dashboard_widgets`, rendered by `DashboardRunner`) and Home Pages (`home_pages` + `home_page_components`, rendered by `HomeComponentRenderer`) are parallel subsystems. A home page component with `hpc_type='dashboard'` and `hpc_source_id` = a dashboard UUID renders `DashboardRunner` directly. Home page resolves per module via `resolve_home_page_for_module` RPC. `report_aggregate` RPC returns `{label, value, raw_value}`, verified NC-scoped for County (20 groups), Owner (20 groups), Pipeline by Stage (1 group). Note: `report_groupings.rgr_field_via_path` documented shape `{from,fk,to}` does NOT match what `getRowValue` in the live runner expects (bare FK string arrays like `["property_id"]`) — verify against the runner before authoring related-field groupings.

**Shipped 2026-07-05 — Activity + email layer (PRs #57–61, #84–90, live on prod):**
Salesforce-parity activity logging (Log Activity composer, type picklist, multi-relate `activity_relations` junction with rollup) + fully intelligent two-way email: real Graph sends from shared state mailboxes, per-thread conversations, cross-object merge fields, attachments on the actual email, hidden reply-to token → replies auto-thread in ~60s, 6h subscription auto-renew, NC DKIM signed. Autonomous self-test harness `admin-test-send-email` (send/reply_sim/inspect) — **run it after any email-pipeline change**. Full handoff, per-state rollout playbook, and follow-up list: `docs/leap-activity-email-layer.md`. Help articles HA-00118/119.

**Shipped 2026-07-06 — Email layer round 2 (PRs #92–95, live on prod):**
WI email fully live: purpose-aware mailbox routing (`obm_purpose` — General Correspondence vs Assessments; WI correspondence → `ira@ees-wi.org`, assessments boxes never picked), Graph subscription + ees-wi.org DKIM enabled, full self-test loop verified (send/attachment/merge/reply-thread, seed record PROP-23706). Attachment virus-scan layer (`scan-message-attachments`, 5-min cron — EICAR/executable-content/extension/spoof checks; blocked files undownloadable; HA-00120). Inline email replies in the conversation panel (stale "not supported" notice removed). Program signatures (`obm_signature_html`, appended by send-email-v1 v13 on every send incl. replies; seeded NC + WI). Note: the scanner + renewal crons and the shared pipeline secret are prod-only config, deliberately NOT in repo migrations.

**Shipped 2026-07-07 — Property Owner Research tool (branch `claude/property-owner-research-tool-7r7kzk`; schema + edge fn live on prod):**
Finds decision makers (CEO/owner/president, asset manager, facilities director — NOT site property-management staff) for owner groups (accounts) and specific properties. Tiered by cost: **free AI web research** (Claude Opus + web search over the org's domain, leadership pages, parent companies, registries — runs as an edge-function background task, client polls) → **Lusha prospecting search** (no credits; names/titles + has-email/phone flags) → **Lusha enrich** (paid credits, per explicitly selected person only, confirm dialog). New objects `owner_research_requests` (ORQ-) / `owner_research_candidates` (ORC-) with full LEAP conventions (record numbers, audit, soft-delete, RLS via `app_user_can`, role access mirrors `accounts` minus portal roles); target job titles are the admin-manageable picklist `orq_target_job_title`. Edge fn `property-owner-research` (v7; auth = JWT→app user, plus the shared-pipeline-secret self-test gate à la `admin-test-send-email`); LUSHA_API_KEY lives in Supabase Vault, read via service-role-only `get_integration_secret()`. Hard-won edge-fn facts: a research turn blows the platform's **150s request idle timeout** → web research runs via `EdgeRuntime.waitUntil` + client polling, and must also fit the **400s worker wall clock** → time-boxed (5 searches, `effort: low`, explicit speed instruction); stale Submitted runs >8 min are auto-failed on the next call; Lusha **enrich** nests contact data under `data` (`emailAddresses[].email`, `phoneNumbers[].number`, `socialLinks.linkedin`) — not top-level. UI: `PropertyOwnerResearchPanel` on the Related tab of accounts + properties (`src/data/ownerResearchService.js`); candidates promote to Contacts (CT-) or dismiss; manual Google/LinkedIn/state-registry shortcut links per state. All three tiers live-verified against Westminster Company: ORQ-00001 Lusha search (4 candidates), ORQ-00005 web research (ORC-00005 Leah Lyerly, EVP & Founder, 2 evidence links), enrich on ORC-00001 (Jane Henderson VP → work email A+ confidence, phone flagged doNotCall, LinkedIn; 1 credit spent). Help article HA-00121.

**Next workstream (planned, awaiting Nicholas's phase confirmation): Owner research → outreach workflow.** v1 testing showed the tool needs to be a pipeline, not a lookup: multi-stage deep research (stage-chained edge invocations, each with a fresh time budget), a cross-record review/approval queue in the Outreach module, approval creating real Contacts/Accounts (incl. repointing properties off placeholder "Unknown Owner" accounts), batch research, and handoff into the email/opportunity outreach motion. Full plan + decisions table: `docs/leap-owner-research-workflow.md`.

**Open / on the horizon (confirm with Nicholas before acting):**
- **By Status widget disposition** — all NC properties currently have null `property_status`, so the widget may warrant soft-deletion. Confirm: keep or remove.
- Verify all four grouped widgets render correctly on the live site after the recent pushes.
- Email-layer follow-ups (see handoff doc §5): Message-ID reconciliation (tier-2 reply matching), CC/BCC in composer UI, multi-contact activities UI, commit out-of-band function sources (`outlook-oauth-*`, `create-graph-subscriptions`, `send-email-via-graph`) or retire the per-user Outlook path, contact dedupe (nwood3764@gmail.com on two contacts), remaining state mailboxes/DKIM (MI/CO/IN — playbook in handoff §4), real program signature content per mailbox (starter blocks seeded).
- Financial visibility tier gating (Tier 1/2/3) — hard blocker before external/portal users; `field_metadata` and `field_permissions` are currently empty.
- Null record types on real records across multi-type objects (`work_steps` 52, `buildings` 7, `contacts` 6, `work_orders` 5, `opportunities` 4, `projects` 3, `incentive_applications` 2) — resolve via Salesforce import.
- Docs cleanup: ✅ Done — the 19 `anura-`-prefixed files in `/docs/` were renamed to `leap-*`, "Anura" scrubbed from content (→ LEAP / EES), and internal cross-references fixed. The word now appears only in `leap-naming-standard.md` and one line of `leap-build-discipline.md`, where it is the deliberate definition of the forbidden-word rule.

---

## Detailed reference — `/docs/`

| Topic | File |
|---|---|
| Master project instructions | `LEAP-PROJECT-INSTRUCTIONS.md` |
| Property hierarchy | `leap-property-hierarchy.md` |
| Roles, field ops, asset accountability | `leap-roles-and-field-structure.md` |
| Program portfolio (5 states) | `leap-programs.md` |
| 12-stage project lifecycle | `leap-project-lifecycle.md` |
| Status lifecycles per object | `leap-status-lifecycles.md` |
| Work types, work plans, materials | `leap-work-types.md` |
| Vehicles and fleet | `leap-fleet.md` |
| Communications and templates | `leap-communications.md`, `leap-communications-module-1.md` |
| Admin Builders | `leap-admin-builders.md` |
| Builder rearchitecture (WYSIWYG) handoff | `leap-builder-rearchitecture.md` |
| Portals (owner and partner) | `leap-portals.md` |
| Field Mobile | `leap-field-mobile.md` |
| Reports and dashboards | `leap-reports.md` |
| Data standards, validation, retention | `leap-data-standards.md` |
| AI assistant | `leap-ai-spec.md` |
| Module list and build order | `leap-modules-and-build-order.md` |
| Schema session instructions | `leap-schema-session.md` |
| Development workflow (sandbox → prod) | `leap-dev-workflow.md` |
| Staging environment (full-data copy) | `leap-staging-environment.md` |
| Environment & promotion standard (prod-safe) | `leap-environment-promotion-standard.md` |
| HUD data sources | `leap-hud-data-sources.md` |
| Agent operating mode | `leap-agent-operating-mode.md` |
| Build discipline (folded into this file) | `leap-build-discipline.md` |
| Naming standard (folded into this file) | `leap-naming-standard.md` |
| Session log 2026-07-01 (nav/list/layout/property fixes + verification) | `leap-session-2026-07-01.md` |
| Activity + email layer (log activity, two-way Graph email, self-test harness) | `leap-activity-email-layer.md` |
| Owner research → outreach workflow (staged research, review queue, approval) | `leap-owner-research-workflow.md` |
