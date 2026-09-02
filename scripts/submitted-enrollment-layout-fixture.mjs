// Fixture test for the Submitted Enrollment printing its record type's own
// page layout.
//
// The gap this covers (Nicholas, 2026-09-02, on ENR-00063's PDF): "these
// aren't things that are submitted, like the number of bedrooms... This is not
// from the enrollment form. I only want the fields that are actually
// submitted, which are the ones that are on the enrollment record. Per record
// type, they're different."
//
// Measured against the real PL-00377: the hardcoded list printed 27 fields not
// on that layout and omitted ~45 that were, including the entire contractor
// and payment blocks. One fixed list cannot serve several record types.
//
// The scoping check at the bottom is the one Nicholas asked for explicitly --
// "Only do this one right now... Do not try to make changes on all of them."
// If that check ever passes for a second record type by accident, another
// programme's document silently changed shape.
//
// Run with:  node scripts/submitted-enrollment-layout-fixture.mjs

import {
  groupsFromLayout, printedLabel, printsFromLayout,
  LAYOUT_DRIVEN_RECORD_TYPES, NEVER_PRINTED_FIELDS,
} from '../src/lib/submittedEnrollmentLayout.js'

let failures = 0, checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) { failures += 1; console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`) }
}
const fg = (fields) => ({ widget_type: 'field_group', widget_config: { fields } })
const headings = (g) => g.map(s => s.heading)
const cols = (g, h) => (g.find(s => s.heading === h)?.rows || []).map(r => r.column)

// The shape loadRecordDetailData returns for PL-00377, trimmed to what matters.
const SECTIONS = [
  { section_label: 'Enrollment', widgets: [fg([
    { name: 'opportunity_id',        label: 'Opportunity', type: 'lookup' },
    { name: 'enrollment_record_type',label: 'Record Type', type: 'picklist' },
    { name: 'enrollment_status',     label: 'Status',      type: 'picklist' },
    { name: 'enrollment_owner',      label: 'Owner',       type: 'lookup' },
  ])] },
  { section_label: 'Primary Contractor Information', widgets: [fg([
    { name: 'enrollment_contractor_account_id', label: 'Primary Contractor', type: 'lookup' },
    { name: 'enrollment_contractor_account_id.billing_city', label: 'City', type: 'related_field' },
    { name: 'enrollment_has_support_contractor', label: 'Will a Support Contractor…', type: 'boolean' },
  ])] },
  { section_label: 'Building Improvements', widgets: [fg([
    { name: 'enrollment_requested_incentive_amount', label: 'Total IRA HOMES Rebate Requested', type: 'currency' },
    { name: 'enrollment_modeled_savings', label: 'Modeled Savings', type: 'number' },
  ])] },
  // Every field empty -- a page of headings over em dashes is not evidence.
  { section_label: 'Income Qualification', widgets: [fg([
    { name: 'enrollment_income_level', label: 'Income Level', type: 'picklist' },
  ])] },
  { section_label: 'System Information', widgets: [fg([
    { name: 'enrollment_created_at', label: 'Create Date',   system_audit: true },
    { name: 'enrollment_created_by', label: 'Created By',    system_audit: true },
  ])] },
  // Cards are not fields. The FILES are captured by the document manifest.
  { section_label: 'Documents', widgets: [{ widget_type: 'file_gallery', widget_config: {} }] },
  { section_label: 'Related Records', widgets: [{ widget_type: 'related_list', widget_config: {} }] },
]

const VALUES = {
  opportunity_id: 'OPP-00198',
  enrollment_record_type: 'WI-IRA-MF-HOMES-Project-Reservation',
  enrollment_status: 'Enrollment To Be Prepared',
  enrollment_owner: 'Lucas Wood',
  enrollment_contractor_account_id: 'Sealed Inc',
  'enrollment_contractor_account_id.billing_city': 'Verona',
  enrollment_has_support_contractor: 'Yes',
  enrollment_requested_incentive_amount: '$40,000.00',
  enrollment_modeled_savings: null,
  enrollment_income_level: null,
  enrollment_created_at: 'Sep 1, 2026',
  enrollment_created_by: 'Nicholas Wood',
}
const groups = groupsFromLayout(SECTIONS, f => VALUES[f.name] ?? null)

// ── The layout IS the field list ──────────────────────────────────────────
check('sections come from the layout, in its order', headings(groups),
  ['Enrollment', 'Primary Contractor Information', 'Building Improvements'])
// The block that was entirely missing before -- ~45 layout fields never printed.
check('the contractor block prints, including its related field',
  cols(groups, 'Primary Contractor Information'),
  ['enrollment_contractor_account_id',
   'enrollment_contractor_account_id.billing_city',
   'enrollment_has_support_contractor'])
// Both columns appear: the filled one, and the blank one beside it, because a
// section with SOME values keeps its blanks (asserted again below).
check('money on the layout prints',
  cols(groups, 'Building Improvements'),
  ['enrollment_requested_incentive_amount', 'enrollment_modeled_savings'])

// ── What is deliberately never printed ────────────────────────────────────
check('the record owner is not submitted to anybody',
  cols(groups, 'Enrollment').includes('enrollment_owner'), false)
check('status is in the header, not printed twice',
  cols(groups, 'Enrollment').includes('enrollment_status'), false)
check('system_audit fields are platform bookkeeping', headings(groups).includes('System Information'), false)
check('a card is not a field — the gallery contributes no rows',
  headings(groups).includes('Documents'), false)
check('nor does a related list', headings(groups).includes('Related Records'), false)
check('the never-printed list is exactly owner and status',
  [...NEVER_PRINTED_FIELDS].sort(), ['enrollment_owner', 'enrollment_status'])

// ── Empty handling ────────────────────────────────────────────────────────
check('a section with nothing filled in is dropped',
  headings(groups).includes('Income Qualification'), false)
// ...but a section with SOME values keeps its blanks: "submitted blank" is a fact.
check('a blank row inside a filled section is kept',
  (groups.find(s => s.heading === 'Building Improvements')?.rows || []).length, 2)
check('...and that blank row carries no value',
  groups.find(s => s.heading === 'Building Improvements').rows[1].value, null)

// A layout can carry the same column in two sections; print it once.
const DUP = [
  { section_label: 'A', widgets: [fg([{ name: 'x', label: 'X' }, { name: 'x', label: 'X again' }])] },
]
check('a column dragged in twice prints once', cols(groupsFromLayout(DUP, () => 'v'), 'A'), ['x'])

check('spacers are not fields',
  groupsFromLayout([{ section_label: 'A', widgets: [fg([
    { name: 's', type: 'spacer' }, { name: 'y', label: 'Y' }])] }], () => 'v')[0].rows.length, 1)
check('no sections at all yields nothing', groupsFromLayout([], () => 'v'), [])
check('null is survived', groupsFromLayout(null, () => 'v'), [])

// ── Labels are the layout's own wording ───────────────────────────────────
check('the layout label wins', printedLabel({ name: 'enrollment_x', label: 'Total IRA HOMES Rebate Requested' }),
  'Total IRA HOMES Rebate Requested')
check('a missing label humanises the column',
  printedLabel({ name: 'enrollment_modeled_savings' }), 'Modeled Savings')
check('a related field humanises its own column, not the fk',
  printedLabel({ name: 'enrollment_contractor_account_id.billing_city' }), 'Billing City')

// ── Scoping: ONE record type, by explicit instruction ─────────────────────
check('the reservation prints from its layout',
  printsFromLayout('WI-IRA-MF-HOMES-Project-Reservation'), true)
check('the pre-approval is UNTOUCHED',
  printsFromLayout('WI-IRA-MF-HOMES-Assessment-Preapproval'), false)
check('so is the HEAR reservation',
  printsFromLayout('WI-IRA-MF-HEAR-Project-Reservation'), false)
check('and NC', printsFromLayout('NC-IRA-MF'), false)
check('nothing is layout-driven by accident', LAYOUT_DRIVEN_RECORD_TYPES.length, 1)
check('an unknown record type is not', printsFromLayout('anything-else'), false)
check('a null record type is not', printsFromLayout(null), false)

if (failures > 0) {
  console.error(`\nsubmitted-enrollment-layout fixture: ${failures} of ${checks} checks FAILED`)
  process.exit(1)
}
console.log(`submitted-enrollment-layout fixture: ${checks} checks passed`)
