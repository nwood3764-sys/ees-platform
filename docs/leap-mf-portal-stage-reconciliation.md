# LEAP — Multi-Family Project Portal: Stage Reconciliation (Confirmed Data Map)

**Date:** 2026-06-29 · **Owner:** Nicholas Wood · **Status:** DECIDED & SHIPPED (picklist build applied to prod)

This is the Section 0 "Stage Reconciliation" artifact required by the MF Project Portal handoff before
any portal build. It confirms LEAP's opportunity stage model against the handoff's 10-phase HOMES/HEAR
lifecycle, records the decisions, and documents the picklist build that wired the portal's real record
types to their lifecycles.

---

## 1. Governing principle — the stage bar is fully data-driven, per record type

The portal renders an opportunity's stage bar **entirely from the `opportunity_stage` picklist values
assigned to that opportunity's record type** (via `picklist_value_record_type_assignments`). The number
of stages, their labels, and their order all come from the database. Add or remove a stage in LEAP
Admin and the portal reflects it automatically, per record type. **Nothing about the count ("10") is
hardcoded.** This overrides the handoff prototype's hardcoded `HS`/`RS` arrays and `stage / 10` math.

Per build discipline: **every opportunity record type has its own unique, never-shared
`opportunity_stage` picklist.**

---

## 2. Decisions (DECIDED 2026-06-29, Nicholas Wood)

1. **Opportunity granularity = building-level.** The handoff's per-unit model (152 units, one HOMES +
   one HEAR opp per unit) was a demo template only. EES tracks opportunities at the **building** level.
   `opportunities` has `property_id` + `building_id` but **no `unit_id`**. No unit backfill.
2. **`*-IRA-MF-HOMES-AUDIT` is the HOMES opportunity object** the portal tracks ("the homes audit
   record type is the object"); projects → work orders → work plans hang beneath each opportunity.
   HEAR uses the base `*-IRA-MF-HEAR` record type (no HEAR-AUDIT record type exists).
3. **Data-driven, nothing hardcoded** (see §1).

---

## 3. Reconciliation result — opportunity stages already match

LEAP's `opportunities.opportunity_stage` picklist already contained the exact 10-phase HOMES and HEAR
lifecycles. `picklist_sort_order` **is** the phase index. No stage value needed renaming and no
portal-layer index mapping is required.

| Phase (index) | Handoff doc | LEAP stage (display label) |
|---|---|---|
| 1 | Income Qualification | Income Qualification |
| 2 | Energy Assessment | Energy Assessment |
| 3 | Energy Modeling | Energy Modeling |
| 4 | Project Reservation | Project Reservation |
| 5 | Project Planning | Project Planning |
| 6 | Implementation | Project Implementation |
| 7 | Commissioning | Commissioning & Verification |
| 8 | Prepare & Submit IRA Payment Request | Payment Request Submitted |
| 9 | Final Inspection | Final Inspection |
| 10 | IRA Program Payment Issued | Payment Issued |

Phase 0 = Not Started (no/empty stage). The "complete" index = the **max** sort_order assigned to the
record type (currently 10 — derived, not fixed). Wording differences (6/7/8) are cosmetic; same phase,
same order.

**Project & Work Order statuses are NOT reconciled** — the handoff (§12.3–12.4) displays them verbatim
and they do not drive the phase bar. For reference: `projects.project_status` has 36 granular values;
`work_orders.work_order_status` has 12 (New → To Be Scheduled → To Be Assigned → Assigned → To Be
Accepted → Scheduled → In Progress → To Be Verified → Corrections Needed → Verified → Unable to
Complete → Closed).

---

## 4. The gap found, and what was built

At reconciliation, the 10-phase lifecycles were wired (`picklist_value_record_type_assignments`) only
to the **data-less** `WI-IRA-MF-HOMES` / `WI-IRA-MF-HEAR` base types. The record types the portal
actually tracks were unwired; all 29 real MF opportunities (`*-MF-HOMES-AUDIT`) sat at the generic
`Opportunity — Property Identified` stage.

**Migration `supabase/migrations/20260629120000_mf_opportunity_stage_lifecycles.sql`** (applied to prod
`flyjigrijjjtcsvpgzvk`) gave each target record type its own unique 10-phase `opportunity_stage` set +
assignments, soft-deleted the stale `Property Identified` assignment from the HOMES-AUDIT types, and
re-pointed the 29 demo records to their record type's Phase 1.

### Record-type → stage-lifecycle matrix (after build)

| Record type | Program | 10-phase wired | Notes |
|---|---|---|---|
| `WI-IRA-MF-HOMES-AUDIT` | HOMES | ✅ (new, own set) | 0 records |
| `NC-IRA-MF-HOMES-AUDIT` | HOMES | ✅ (new, own set) | 27 records → Phase 1 |
| `MI-IRA-MF-HOMES-AUDIT` | HOMES | ✅ (new, own set) | 2 records → Phase 1 |
| `NC-IRA-MF-HEAR` | HEAR | ✅ (new, own set) | 0 records |
| `MI-IRA-MF-HEAR` | HEAR | ✅ (new, own set) | 0 records |
| `WI-IRA-MF-HOMES` (base) | HOMES | ✅ (pre-existing) | 0 records; base type, not the portal object |
| `WI-IRA-MF-HEAR` (base) | HEAR | ✅ (pre-existing) | 0 records |

Each set's values are unique per record type (e.g. `Opportunity — NC HOMES Audit Phase 1: Income
Qualification`); display labels (`Opportunity — HOMES Income Qualification`) repeat across types by
design for consistent portal display.

**Deferred (no records, build when needed):** base `NC/MI-IRA-MF-HOMES` and the SF / FOE record types
are out of MF-portal scope. There is no `*-MF-HEAR-AUDIT` record type.

---

## 5. Confirmed hierarchy & API names (Step 0.4)

```
accounts
  └─ properties        (property_account_id → accounts; property_management_company_id → accounts)
       └─ buildings     (property_id → properties)
            └─ units     (building_id → buildings)        ← 0 records; not used by the portal
       └─ opportunities (property_id, building_id, opportunity_account_id → accounts) ← building-level
            └─ projects  (opportunity_id → opportunities; also property_id, building_id)
                 └─ work_orders (project_id → projects; also opportunity_id, unit_id, building_id, property_id)
```

Stage/status/record-type columns are `uuid` FKs to `picklist_values`:
`opportunity_stage`, `opportunity_record_type`, `opportunity_status`, `project_status`,
`project_record_type`, `work_order_status`, `work_order_record_type`. Soft-delete columns are
object-prefixed (`opportunity_is_deleted`, `building_is_deleted`, …).

---

## 6. Portal de-hardcoding contract (for the next portal build)

The customer-facing portal (`src/pages/ProjectPortalRoot.jsx`, `src/data/projectPortalService.js`,
RPC `get_portal_project_tracker()`) exists but **was never stood up** (no live URL). It currently
**violates §1**: `ProjectPortalRoot.jsx` hardcodes a fixed 10-element `PHASE_SHORT` array, and
`projectPortalService.js` hardcodes `TOTAL_PHASES = 10` and `opportunityPct = stageOrder / 10`. The RPC
returns only each opportunity's own stage, not its record type's full ordered stage list.

When the portal is built for real, it must be reworked to be data-driven:
- `get_portal_project_tracker()` returns, per opportunity (keyed by record type), the full ordered
  `[{label, sort_order}]` stage list from `picklist_value_record_type_assignments`.
- `ProjectPortalRoot.jsx` drops `PHASE_SHORT`; dot count = number of assigned stages, dot labels =
  their `picklist_label`, current/fill = the opp's `stage_order`.
- `projectPortalService.js` drops `TOTAL_PHASES = 10`; percent = `stage_order / max(sort_order)` for
  that record type.

Not-yet-built portal surfaces from the handoff (later phases): SOW checklists, required-document
checklists, dual side-by-side HOMES/HEAR panels, project/work-order drill-down, the Documents tab.

---

## 7. Verification (this session)

- Each target record type returns exactly 10 stages, distinct sort orders 1..10, 10 distinct values.
- No `opportunity_stage` value is shared across record types (build discipline).
- The 29 demo records resolve to `Opportunity — HOMES Income Qualification` (sort 1).
- `get_advisors(security)`: 165 findings, all in the known baseline categories — **no new findings**.
