// System Information audit fields — pure-logic fixture.
//
// Covers the two rules that decide how the four fields behave in the client:
//   * isSystemAuditColumn — the NAME rule, used only where there is no layout
//     to consult (create-form field selection, editable-column metadata). It
//     must recognise every spelling in this schema and must NOT be used to
//     decide read-only, which is why the false positives it produces on real
//     business timestamps are asserted here rather than treated as bugs.
//   * isSystemAuditField — the LAYOUT rule, which is what holds a field
//     read-only. It answers only for fields the platform actually marked.
//   * fieldRenderKey — uniqueness where a column legitimately appears twice
//     (audit_log's created and last-modified are both al_performed_at).

import {
  isSystemAuditColumn,
  isSystemAuditField,
  fieldRenderKey,
} from '../src/lib/systemAuditFields.js'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures += 1
    console.error(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

// ── isSystemAuditColumn: every spelling in the schema ──────────────────────
for (const name of [
  // prefixed — the platform convention
  'property_created_at', 'property_created_by', 'property_updated_at', 'property_updated_by',
  'work_order_created_at', 'ia_updated_by', 'price_book_entry_created_by',
  'page_layout_updated_by', 'list_view_created_by', 'picklist_updated_at',
  // bare — the older tables (activities, documents, photos, page_layouts, ...)
  'created_at', 'created_by', 'updated_at', 'updated_by',
  // the _id suffix — tasks.created_by_id
  'created_by_id', 'updated_by_id', 'task_created_by_id',
]) check(`isSystemAuditColumn('${name}')`, isSystemAuditColumn(name), true)

// Business columns that must never be swept in.
for (const name of [
  'property_name', 'account_owner', 'opportunity_stage', 'contact_email',
  'assessment_created_by_note',      // a suffix, not the column itself
  'created_at_label', 'updated_by_reason',
  'signed_at', 'verified_by', 'taken_by', 'performed_by', 'assigned_by',
  'uploaded_by', 'triggered_by', 'author_user_id', 'deleted_by', 'deleted_at',
  'al_performed_at', 'fh_changed_by',
]) check(`isSystemAuditColumn('${name}')`, isSystemAuditColumn(name), false)

check('isSystemAuditColumn(null)', isSystemAuditColumn(null), false)
check('isSystemAuditColumn(undefined)', isSystemAuditColumn(undefined), false)
check("isSystemAuditColumn('')", isSystemAuditColumn(''), false)
check('isSystemAuditColumn(number)', isSystemAuditColumn(42), false)

// Documented false positive: a real business timestamp whose name ends the same
// way. It is correct to HIDE this on a create form (the name rule's only job),
// and it is exactly why read-only is decided by the layout flag instead — see
// the isSystemAuditField block below.
check("isSystemAuditColumn('vehicle_odometer_updated_at')",
  isSystemAuditColumn('vehicle_odometer_updated_at'), true)

// ── isSystemAuditField: the layout's own declaration ───────────────────────
check('marked field', isSystemAuditField(
  { name: 'unit_created_by', type: 'lookup', label: 'Created By', system_audit: true }), true)
check('marked date field', isSystemAuditField(
  { name: 'unit_updated_at', type: 'datetime', label: 'Last Modified Date', system_audit: true }), true)

// An unmarked field is editable even when its NAME looks like an audit column —
// this is the vehicle_odometer_updated_at case, and any field an admin placed
// themselves.
check('unmarked audit-looking field', isSystemAuditField(
  { name: 'vehicle_odometer_updated_at', type: 'datetime', label: 'Odometer Updated' }), false)
check('ordinary field', isSystemAuditField({ name: 'property_name', type: 'text' }), false)
check('flag must be strictly true', isSystemAuditField(
  { name: 'unit_created_by', system_audit: 'true' }), false)
check('null field', isSystemAuditField(null), false)
check('undefined field', isSystemAuditField(undefined), false)

// ── fieldRenderKey: unique among siblings ──────────────────────────────────
// audit_log resolves created and last-modified to the SAME column, so the group
// legitimately carries one name twice. Keys must still differ.
const auditLogFields = [
  { name: 'al_performed_at', label: 'Created Date' },
  { name: 'al_performed_by', label: 'Created By' },
  { name: 'al_performed_at', label: 'Last Modified Date' },
  { name: 'al_performed_by', label: 'Last Modified By' },
]
const keys = auditLogFields.map(fieldRenderKey)
check('audit_log keys are unique', new Set(keys).size, 4)
check('key shape', fieldRenderKey({ name: 'unit_created_at' }, 3), 'unit_created_at#3')
check('spacer key falls back to spacer_id', fieldRenderKey({ spacer_id: 'sp1' }, 0), 'sp1#0')
check('nameless key still resolves', fieldRenderKey({}, 7), 'field#7')

if (failures > 0) {
  console.error(`\nsystem-audit-fields-fixture: ${failures} of ${checks} checks FAILED`)
  process.exit(1)
}
console.log(`system-audit-fields-fixture: ${checks} checks passed`)
