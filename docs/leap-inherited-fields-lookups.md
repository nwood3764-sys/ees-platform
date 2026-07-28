# LEAP Inherited Fields & Lookups — stop duplicating parent data on child records

Handoff for the "child records should reference parent data through lookups, not
copy it" workstream. Opened 2026-07-28 (branch
`claude/inherited-fields-child-records-qze3lm`).

## 1. Vision / goal

A child record should **reference** what its parent already knows, not carry a
stale copy of it. Two concrete rules:

1. **Every field that is fully derivable from a parent inherits automatically** —
   on create it is prefilled from the full ancestor chain (not just the direct
   parent), and it never blocks a save the database would accept.
2. **Derived parent data is shown as a read-only lookup / related field, not a
   duplicated, hand-editable column.** A company is ONE account; an opportunity's
   account always equals its property's account — so "Account" on the opportunity
   is a *reference to the property's account*, never a field a user re-picks.

Salesforce framing: parent data belongs on the child as a **Lookup relationship**
(the FK) or a **cross-object formula / related field** (a read-only reflection),
never as re-keyed columns that drift.

## 2. What just shipped (Phase 0 — the reported bug)

**Symptom (Nicholas, 2026-07-28):** created a new Opportunity from a *Building*;
Account came up blank and the save was blocked with "Required field missing:
Account." "Shouldn't this all be inherited?"

**Root cause:** the create-prefill in `RelatedListWidget.handleNewClick`
(`src/components/RecordDetail.jsx`) only walked **one hop** up the ancestor chain
— it seeded FKs that sit *directly on the parent record*. A Building carries
`property_id` but not the account, so `opportunity_account_id` was never seeded.
`opportunities.opportunity_account_id` is NOT NULL, so the client required-field
check rejected the create — even though the BEFORE INSERT trigger
`sync_opportunity_account_from_property` fills it from the property on write. The
account is 100% derived (0 of 17,537 active properties lack an account), yet it
was modeled as a manually-entered required FK.

**Fix (PR on this branch):**
- `handleNewClick` now climbs the **full** ancestor chain, data-driven from
  `TABLE_META` with a bounded fetch: building → property → account. The account
  is prefilled and shown on the form. This also fixes account inheritance for
  projects-from-building and any deeper-descendant create.
- `opportunity_account_id` added to `TRIGGER_DERIVED_REQUIRED` so a trigger-filled
  NOT NULL column never blocks a create.

Kept the field **editable** (not read-only) for now to avoid a create-mode
label-resolution edge (a read-only lookup renders through `formatFieldValue`,
which needs the prefilled id resolved in the `lookups` map; the editable combo
resolves its own label, exactly as Property/Building already do). Making derived
FKs read-only is Phase 4.

## 3. Current-state architecture map (grounded in the code)

There are **two** inheritance mechanisms in the codebase today — one correct, one
the source of Nicholas's "too many issues."

### 3a. FK lookups — the correct pattern (reference, not copy)
- `TABLE_META` (`RecordDetail.jsx` ~line 230) declares each object's `parents` /
  `parentTables`. Breadcrumbs, lookup hyperlinks, and `handleNewClick` prefill all
  read it. A `lookup` field IS the FK — it points at the live parent, never goes
  stale. **This is what "should all be lookup fields" means, and it mostly works.**
- `related_field` (added for cross-object page-layout fields) is a **read-only
  reflection** of a parent column, resolved at load in
  `layoutService.loadRecordDetailData` and, in create mode, in the
  `createRelatedValues` effect (`RecordDetail.jsx` ~line 5730). Stripped from every
  save. This is the right primitive for "show the owner's name from the account
  without copying it."

### 3b. Copied scalars — the duplication problem
`handleNewClick`'s enrollment branch copies **~27** `property_*` values into
`enrollment_*` columns at create (`copyFromProperty(...)`, address composition,
owner/management/contact fallbacks). `incentive_applications` follows the same
shape. These are **snapshots taken once at create and never re-synced** — the
property changes, the child does not. Column-count audit (2026-07-28):

| Object | total cols | FK cols | parent-mirror scalar cols |
|---|---|---|---|
| enrollments | 78 | 9 | **~27** |
| incentive_applications | 135 | 11 | **~21** |
| work_orders | 102 | 31 | ~5 |
| opportunities | 176 | 15 | ~5 |
| projects | 66 | 13 | ~1 |

(Heuristic match on `owner|site_address|management|hud_|_city|_zip|_county|_state|
contract|occupied|total_units|assisted` — directional, not exact, but it locates
the offenders: **enrollments and incentive_applications**.)

### 3c. Field-type system (PR #281) — what already exists
- `FieldCreateEditModal` groups types **Basic / Relationship / Advanced**. The
  Relationship group already offers **Picklist** and **Lookup (relationship)**.
- `related_field` is a real render type but is **not** an admin-createable field
  type in that modal — it can only be added through the layout editor's "Related
  Object Fields" palette. Promoting it to a first-class "Related field (from
  parent)" type closes the gap Nicholas is pointing at ("that's not a field type,
  we need to create it").
- `describe_object_columns` is the single overlay choke point; the field type is
  metadata over storage (compute-at-read), so a copied column can be re-presented
  as a related field with no physical retype (matches the PR #281 decision).

## 4. Target architecture + principles

- **Derivable-from-parent ⇒ related field (read-only), not a stored copy.** Use the
  existing `related_field` compute-at-read path. Additive, reversible, no DDL.
- **Derived FKs render read-only** (opportunity_account, project_account) — the
  trigger owns the value; the UI should not invite an edit it will overwrite.
- **Inheritance is full-chain and data-driven** (shipped Phase 0) — never a
  per-object copy list where a generic climb would do.
- **Keep the physical columns** during transition (fallback + existing HUD import
  data) — re-present, don't drop, until each is proven redundant.

## 5. Phased build plan (each phase additive, independently shippable)

- **Phase 0 — DONE.** Full-chain inheritance + account exempt-from-required.
- **Phase 1 — Classification audit.** For each child object, tag every column:
  `owned` / `derived-fk` / `copied-scalar (parent, column)`. Deliver as an
  admin-readable table (report or doc). Grounds every later phase.
- **Phase 2 — First-class "Related field (from parent)" type** in
  `FieldCreateEditModal` (Relationship group), wiring the existing `related_field`
  render + validate path so admins add parent references without code.
- **Phase 3 — Convert the worst duplication.** Replace the copied `enrollment_*`
  and `ia_*` scalars on their page layouts with related fields; stop copying them
  at create (`handleNewClick`). Columns stay as fallback, flagged deprecated.
- **Phase 4 — Derived FKs read-only + live-derive.** Render opportunity/project
  account read-only; derive it live when the property changes on the form (not
  only on save), resolving the label into the `lookups` map first.

## 6. Decisions

- **DECIDED (2026-07-28): inheritance is a full-chain, TABLE_META-driven climb**,
  not per-object copy lists. (Phase 0 shipped.)
- **OPEN — how far to de-duplicate (Phase 3):** (A) keep the copied columns and
  re-present them as read-only related fields on layouts (additive, reversible,
  recommended — some hold HUD-import data the parent lacks), vs (B) drop/deprecate
  the duplicated columns outright (destructive migration, irreversible). Recommend
  **A**. Needs Nicholas's call before Phase 3.

## 7. File + DB-table index

| Concern | File / object |
|---|---|
| Ancestor chain + prefill | `src/components/RecordDetail.jsx` — `TABLE_META`, `handleNewClick` |
| Required-field exemptions | `RecordDetail.jsx` — `TRIGGER_DERIVED_REQUIRED`, `DERIVED_READONLY` |
| Related-field render (create) | `RecordDetail.jsx` — `createRelatedValues` effect (~5730) |
| Related-field load (view/edit) | `src/data/layoutService.js` — `loadRecordDetailData` |
| Field-type editor | `src/modules/admin/FieldCreateEditModal.jsx` — `TYPE_OPTIONS` |
| Type overlay | `describe_object_columns` RPC |
| Derived account trigger | `sync_opportunity_account_from_property` on `opportunities` |
| Duplication offenders | `enrollments`, `incentive_applications` |
