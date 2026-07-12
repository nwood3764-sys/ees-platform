# Owner Research → Outreach Workflow — Handoff & Build Plan

Status: **Phases 1 + 2 SHIPPED (2026-07-09)** — staged deep research + the
Owner Research review queue are live. Phases 3 (batch) and 4 (outreach
handoff) remain planned below.
Predecessor: Property Owner Research tool v1 (PRs #102, #105–#108; edge fn v13).

**What shipped in Phases 1+2 (edge fn v14, migration
`20260708120000_owner_research_workflow_v2.sql`):**
- `deep_research` action: Owner Identification → Organization Research →
  Decision Maker Discovery (web + inline credit-free Lusha, merged by person)
  → Contact Info Gathering. Each stage is its own invocation (fresh 400s
  budget, effort `medium`), chained via self-invocation through the shared
  pipeline-secret gate; `run_stage` retries a single stage. Stage outputs
  persist in `orq_stage_results`; stale sweep covers per-stage timeouts.
  Runs end at "Research Request Ready for Review".
- Review queue: `OwnerResearchQueue` in Outreach → **Owner Research**
  (module_sections seeded). Approve identified org → account match
  (normalized name/domain, reviewer picks; never auto-merged) or create →
  optional property repoint (explicit checkbox) → pending candidates
  re-linked to the real account. Approve person → edit-before-save →
  Contact created. Reject with reason (`orc_rejected_reason`). Bulk approve.
- Live-verified on 314 Greendale Dr, Wilmington NC (ORQ-00015): identified
  **JES Holdings, LLC** (jesholdings.com) as the owner behind the LIHTC
  entity, mapped its structure (Fairway Management, Affordable Equity
  Partners, MACO Development), and returned 13 candidates (1 web-evidenced
  Founder/CEO + 12 enrichable Lusha executives) in ~6.5 minutes across the
  four stages — left pending in the queue as real review-flow test data.

---

## 1. Vision / goal

Turn owner research from a per-record lookup panel into a **working outreach
pipeline**: LEAP researches deeply (multi-pass, not a time-boxed skim), a human
reviews and approves what came back, approval creates *real* records (Contacts,
Accounts, property repoints), and approved decision makers flow straight into
the outreach motion (email from the state mailbox, opportunity, pipeline
stage). Nothing static: every research finding is either promoted into the CRM
graph or explicitly rejected, and the system gets smarter about each property
as stages complete.

The operator experience: pick properties (or one), press Research, come back
to a **review queue** of evidence-linked findings, approve with one click, and
watch contacts + accounts + outreach activity materialize.

## 2. What just shipped (v1 — context)

- Objects `owner_research_requests` (ORQ-) / `owner_research_candidates`
  (ORC-) with full LEAP conventions; admin-managed target-title picklist.
- Edge fn `property-owner-research` (v13): `web_research` (Claude Opus +
  web search/fetch, background task + client polling), `lusha_search`
  (credit-free), `lusha_enrich` (paid, per-person confirm).
- `PropertyOwnerResearchPanel` on the Related tab of accounts + properties;
  promote-to-contact, dismiss, manual search links; HA-00121.
- Placeholder-owner handling: "Unknown Owner" accounts are never searched
  literally; research pivots to identifying the owner from the property's
  identifiers (LIHTC/HUD IDs, address, parcel) and **persists the identified
  org on the ORQ row**, which then feeds the next Lusha search.

**Live-tested findings that motivate this plan** (all on prod):
- A single research turn must fit the edge platform's **150s request idle
  timeout** (solved: background task) and the **400s worker wall clock**
  (solved: time-boxed run + fetch size caps + stale-run auto-fail). This caps
  any one run at ~6 searches + 4 page fetches — a skim, not research.
- On a real unknown-owner property (314 Greendale Dr, Wilmington NC) the tool
  correctly identified the development (Hanover Garden Apartments / Tidewater
  Townhomes, LIHTC NCA20040082) but ran out of budget before finding the
  owner entity's people. **Depth requires multiple chained runs.**
- The valuable intermediate finding (who owns it) initially got discarded
  because only *people* were stored. v13 persists it — the general principle:
  **every stage's output is a first-class, stored, reusable fact.**

## 3. Current-state architecture map (actual code)

| Piece | Where | Pain point |
|---|---|---|
| Research runs | `owner_research_requests` (flat, one status) | No stages; one shot per click; depth capped by 400s wall clock |
| Candidates | `owner_research_candidates` | Reviewed only inside one record's panel; no cross-record queue; no bulk approve |
| Research engine | `supabase/functions/property-owner-research/index.ts` (one Claude turn) | Single-pass; effort `low` for speed; no follow-up passes; no org→people chaining without user re-click |
| UI | `src/components/PropertyOwnerResearchPanel.jsx` (record panel) | Per-record only; operator must visit each property |
| Promote | `promoteCandidateToContact` in `src/data/ownerResearchService.js` | Creates the contact but does nothing about the placeholder account, the property repoint, or the outreach follow-through |
| Identified org | `orq_company_name` on the request | Displayed, but never becomes an Account; placeholder accounts stay wrong |
| Outreach motion | Email layer (send-email-v1, state mailboxes), opportunities, Outreach dashboard | Entirely disconnected from research output |

## 4. Target architecture + design principles

**A research request becomes a state machine**, not a single shot:

```
Research Request Submitted
  → Stage: Owner Identification        (property ids → who owns/controls it)
  → Stage: Organization Research       (org verified: domain, parent, registry)
  → Stage: Decision Maker Discovery    (web people pass + Lusha search merged)
  → Stage: Contact Info Gathering      (public info; Lusha enrich stays manual)
  → Research Request Ready for Review
  → (human) approve / edit / reject per finding
  → Research Request Completed
```

- **Stage chaining beats the wall clock.** Each stage is its own edge-function
  invocation with a fresh 400s budget. At stage end the function writes stage
  output to the DB and fires the next stage via `pg_net.http_post` (same
  shared-secret self-invocation gate that already exists). Stages that need no
  AI (Lusha search) run inline. Total research depth: 4× today's budget, still
  fully serverless, each stage independently retryable and auditable.
- **Every stage output is a stored fact** on the request (`orq_stage`,
  `orq_stage_results jsonb`) — identified org, verified domain, parent
  company, registry entry, people, public emails. Later stages consume earlier
  facts; re-runs skip completed stages.
- **Approval is the only path to CRM records.** Candidates and identified orgs
  are staging data. Approving:
  - an **identified org** → match against existing accounts (name/domain
    match, `account_hud_participant_number`) → create Account if no match →
    repoint `property_account_id` from the placeholder → log activity.
  - a **person** → create Contact on the (now-real) account, carry title,
    email, phone, LinkedIn, evidence links → log activity via `log_activity`.
  Rejection keeps the ORC row (auditable) with an explicit rejected status.
- **The queue is the workspace.** A new "Owner Research" section in the
  Outreach module: all candidates + identified orgs awaiting review across
  every property/account, filterable by state/status/source, with bulk
  approve and per-row edit-then-approve. The record panel stays (drill-down
  view), the queue is where the daily work happens.
- **Approved contact → outreach motion.** One-click (or auto, configurable)
  follow-through: create the opportunity on the account, draft the intro
  email from the correct state mailbox (existing purpose-aware routing),
  pipeline stage set — visible on the Outreach dashboard.
- Nothing hardcoded: stages, titles, matching rules, auto-follow-through
  behavior all admin-manageable.

## 5. Phased build plan (each additive + shippable)

**Phase 1 — Multi-stage research engine (depth).**
Add `orq_stage` + `orq_stage_results` to requests; refactor the edge fn into
stage handlers; chain via self-invocation with fresh time budgets; raise
model effort to `medium` per stage (affordable once each stage is small);
merge Lusha search into Decision Maker Discovery automatically (credit-free)
so one click yields both web + Lusha candidates. Panel shows live stage
progress ("Identifying owner… → Researching organization…").

**Phase 2 — Review queue + approval that builds the CRM graph.**
New Outreach-module section "Owner Research": cross-record queue of pending
candidates and identified orgs. Approve person → Contact (with edit-before-
save modal). Approve org → account match/create + property repoint (explicit
confirmation, shows what will change). Reject with reason. Bulk approve.
Statuses per LEAP convention ("Research Candidate Approved", "… Rejected").

**Phase 3 — Batch research.**
"Research all" from a property list/filter (e.g., every NC property with a
placeholder owner): queue table + pg_cron drainer (N concurrent stage runs),
progress bar in the queue section, per-property results roll into the same
review queue. Cost governor: batch runs are web-research only; Lusha enrich
stays per-person manual.

**Phase 4 — Outreach handoff.**
From an approved contact: create opportunity (correct record type + stage),
compose intro email via the existing email layer (state mailbox routing,
merge fields, signature), log the whole chain as activities. Optional
automation toggle per state program. Dashboard widget: research → contact →
outreach conversion.

## 6. Technical recommendations

- **Stage chaining:** self-invocation via `pg_net.http_post` with the existing
  `x-pipeline-test-secret` gate (rename to `x-pipeline-secret`; it is already
  fail-closed). Each stage updates `orq_stage`, appends to
  `orq_stage_results`, and schedules the next. A pg_cron sweeper retries
  stalled stages (the stale-run sweep generalizes to per-stage).
- **Account matching before create:** exact/normalized name match +
  domain match + HUD participant number; anything ambiguous goes to the
  reviewer, never auto-merged.
- **Known hazards (hard-won, keep respecting):** 150s request idle timeout →
  always background + poll; 400s worker wall clock → cap per-stage tool use,
  `max_content_tokens` on web fetch; Lusha enrich nests contact data under
  `data`; Lusha search returns 404 for "no matches"; placeholder org names
  regex (`isPlaceholderOrgName`) must gate every org-shaped write.
- **Effort/model:** Opus, `effort: medium` per stage (stages are small);
  identification stage keeps the identifier-first search strategy (LIHTC/HUD
  IDs, parcel, address+ZIP).
- No new libraries required; everything rides existing patterns (pg_net,
  pg_cron, edge functions, ConfiguredHome/module sections).

## 7. Decisions (recommendation first — confirm/adjust)

| # | Decision | Recommendation | Status |
|---|---|---|---|
| 1 | Phase order | 1 → 2 → 3 → 4 as above (depth first, then the queue, then scale, then handoff) | **DECIDED 2026-07-09** (Nicholas — proceed on recommendation) |
| 2 | Property repoint on org approval | Yes, with explicit confirmation in the approve dialog (fixes placeholder data as you work) | **DECIDED 2026-07-09** (implemented as recommended — checkbox in the approve dialog) |
| 3 | Lusha enrich in batch runs | Never automatic — always per-person manual confirm | **DECIDED 2026-07-09** (implemented as recommended) |
| 4 | Outreach follow-through (Phase 4) | Draft email for review, don't auto-send | PROPOSED |

## 8. File + DB-table index (what the next session touches)

- `supabase/functions/property-owner-research/index.ts` — stage handlers
- `supabase/migrations/…_owner_research_workflow_v2.sql` — `orq_stage`,
  `orq_stage_results`, queue table, statuses, approval columns
- `src/modules/OutreachPropertiesModule.jsx` — new `research` section
- `src/components/OwnerResearchQueue.jsx` (new) — review queue
- `src/components/PropertyOwnerResearchPanel.jsx` — stage progress display
- `src/data/ownerResearchService.js` — approval/matching/queue services
- Tables: `owner_research_requests`, `owner_research_candidates`, `accounts`,
  `properties`, `contacts`, `opportunities`, `activities`
