# LEAP Field Type System — formulas, roll-ups, modifiable types

Handoff for the field-type workstream. First increment shipped 2026-07-28
(PR #281, branch `claude/field-types-audit-formulas-gzrh48`, migration
`20260728174537` live on prod).

## 1. Vision / goal

Every field on a LEAP object should have a **field type an admin can change**,
plus Salesforce-parity **Formula** and **Roll-Up Summary** field kinds — managed
from the Object Manager, no code. Type is metadata over storage (as in
Salesforce): changing it re-renders the field without altering the physical
column or its data.

## 2. What just shipped (Phase 1)

**Model — `field_metadata` is now authoritative for the logical type.** New
columns: `fm_field_kind` (`standard`|`formula`|`rollup`), `fm_display_type`,
`fm_formula_expression`, `fm_formula_return_type`, `fm_formula_refs` (jsonb),
`fm_rollup_config` (jsonb). Previously `field_metadata` was presentation-only and
its data-type was advisory (never read back) — everything rendered from the raw
Postgres column type.

**`describe_object_columns`** LEFT JOINs `field_metadata` and returns the logical
overlay (`field_kind`, `display_type`, `formula_*`, `rollup_config`, `field_label`,
`financial_tier`, …) alongside the physical columns. Physical-type derivation is
byte-identical to the prior definition — only additive columns were appended — so
every renderer that already flows through this RPC became type-aware at once.

**`admin_update_field_definition`** (SECURITY DEFINER, admin-only) — edits type /
formula / rollup with server-side validation (column exists; rollup child
table/fk/field exist; function whitelist). Re-activates metadata on edit
(`fm_is_deleted=false` on conflict).

**`compute_record_rollups(p_object, p_record_id)`** (SECURITY INVOKER,
RLS-respecting) — returns a jsonb map of every rollup field's aggregated value
(COUNT/SUM/AVG/MIN/MAX) over child records, auto-excluding soft-deleted children.
Optional simple filters (`[{column,op,value}]`, ops whitelisted, columns
validated).

**Client:**
- `FieldCreateEditModal` — grouped **Field Type** selector (Basic / Relationship /
  Advanced); **Formula** config (return type + CodeMirror `FormulaEditor` reusing
  the report engine + same-object and cross-object *via-lookup* reference pickers);
  **Roll-Up** config (child object from incoming FKs / function / numeric field /
  display). Create mode still creates a real backing column first
  (`admin_add_custom_field`), then records the logical definition.
- `layoutService.loadRecordDetailData` → `computeFieldValues`: computes formula
  values client-side (lazy-imported engine, scope = own columns + resolved
  cross-object parent values) and rollup values via the RPC, and **overlays each
  field's live logical type onto the layout** so a type change renders without
  re-saving the page layout. Formula/rollup fields render read-only with a chip
  and are stripped from every save.
- `formatFieldValue` / `EditField` (RecordDetail) — formula & rollup read-only
  render + `formatByReturnType`; `fieldMetadataService.deriveEditorType`,
  `eesFieldTypes.deriveEesFieldType`, and `ObjectDetail.fmtType` honor the overlay
  (Fields list shows "Currency", "Formula (Text)", "Roll-Up (Sum)", …).
- `engine.js` gains `evaluateFieldFormula(expr, scope, returnType)` — text/date/
  boolean formulas treat a blank reference as blank (a passthrough shows the
  value, not "0"); numeric return types keep the report engine's blank→0 rule.

Help article **HA-00156** (`field-types-formulas-rollups`).

## 3. Architecture map (files touched)

| Concern | File / object |
|---|---|
| Logical type storage | `field_metadata` (+ 6 columns) |
| Type overlay (single choke point) | `describe_object_columns` RPC |
| Edit type/formula/rollup | `admin_update_field_definition` RPC |
| Rollup compute | `compute_record_rollups` RPC |
| Field editor UI | `src/modules/admin/FieldCreateEditModal.jsx` |
| Formula engine + editor | `src/lib/formula/engine.js`, `src/lib/formula/FormulaEditor.jsx` |
| Record load / compute / overlay | `src/data/layoutService.js` (`computeFieldValues`) |
| Render + save-strip | `src/components/RecordDetail.jsx` |
| Type derivers | `src/data/fieldMetadataService.js`, `src/modules/admin/widgets/eesFieldTypes.js` |
| Fields list + modal mount | `src/modules/admin/ObjectDetail.jsx` |
| Service wrappers | `src/data/adminService.js` (`updateFieldDefinition`, `fetchFieldMetadata`) |

## 4. Design principles / decisions

- **DECIDED (2026-07-28): compute-at-read, not stored/trigger-maintained.**
  Additive, no per-field DDL, no physical retype, reversible. Matches how
  `related_field` and report calc fields already work. Stored/trigger-maintained
  values (so reports see them) are a future option, not Phase 1.
- **DECIDED: type is metadata over storage.** Display-type changes
  (text↔textarea, →currency/percent/email/phone/url, number formatting, →picklist)
  never retype the column. Formula/rollup make the field read-only computed.
- Formula references use a named-alias map (`fm_formula_refs`): `kind:'field'`
  (same object) or `kind:'related'` (cross-object via an outgoing FK). Aliases are
  valid identifiers so the mathjs sandbox can resolve them.

## 5. Known limitations / follow-ups (next phases)

1. **Reports + list views** don't compute formula/rollup values — they read the
   (blank) stored column. The record page is live and correct. Surfacing computed
   values in `reportsService`/`ReportRunner` and `EditableListView`/`ListView` is
   the highest-value next phase. Options: (a) evaluate in the report/list query
   layer like the record loader does, or (b) a stored/trigger-maintained mode
   (recompute on write of the record and its referenced parent/children).
2. **Physical column retypes** (e.g. real text→numeric storage, →lookup uuid) are
   out of scope — only display overlays and computed kinds. A guarded
   `admin_alter_field_type` with data-conversion checks would be a separate,
   higher-risk build.
3. **Formula depth**: cross-object refs are one hop (outgoing FK). Multi-hop
   (grandparent) and child-aggregate-in-formula are not supported — use a rollup
   for aggregates.
4. **Rollup recompute cadence**: computed on record open. No cached/stored value,
   so no cross-record reporting yet (see #1).
5. **Display formatting**: email/phone/url render as plain text (not mailto/tel/
   anchor) on the read-only path — cosmetic follow-up.

## 6. Hazards

- `describe_object_columns` return-type change required a `DROP FUNCTION` (CREATE
  OR REPLACE can't add OUT columns). Nothing depends on it (PostgREST resolves by
  name), so the drop is safe — but any future signature change repeats this.
- `field_metadata` has `block_hard_delete` — verification rows are soft-deleted,
  and `admin_update_field_definition` undeletes on edit so a previously
  soft-deleted metadata row can't silently swallow a field change.
- Formula engine (`mathjs` + `@formulajs`) lives in the lazy `vendor-formula`
  chunk; `FormulaEditor` pulls `vendor-codemirror`. Both are dynamically imported
  off the record-open path — keep them lazy.
