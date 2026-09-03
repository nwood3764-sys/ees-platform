// Fixture test for a Submitted Enrollment recording exactly what was pushed to
// the Jotform.
//
// Nicholas, 2026-09-02, after two wrong sources: "we only want to capture what
// was pushed to the jot form. What don't you understand?" -- and, on seeing
// Record Type printed: "We don't submit that in a jot form."
//
// A hardcoded field list described a form nobody files; the page layout
// described the RECORD, carrying LEAP's own bookkeeping. The submission is the
// set of parameters actually sent, which LEAP already holds: the field map and
// the prefill payload the button itself uses.
//
// The checks below use the REAL Project Reservation map shape, including the
// state transform -- because the point of building this from mapPayloadToParams
// is that the document and the query string can never disagree.
//
// Run with:  node scripts/submitted-enrollment-fields-fixture.mjs

import {
  groupsFromFormSubmission, fieldsNotSubmitted, formTargetForRecordType,
  SUBMITTED_FORM_TARGET_BY_RECORD_TYPE,
} from '../src/lib/submittedEnrollmentFields.js'

let failures = 0, checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) { failures += 1; console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`) }
}

// The real map, trimmed — field_label, param, transform, required, in order.
const MAP = {
  name: 'Focus On Energy - IRA HOMES Multifamily Project Submittal Form (Project Reservation)',
  fields: [
    { leap_field: 'ia_application_for',       param: 'imApplying',                    field_label: "I'm Applying for a(n)",         required: true },
    { leap_field: 'contractor_business_name', param: 'primaryContractor28',           field_label: 'Primary Contractor Business Name', required: true },
    { leap_field: 'contractor_state',         param: 'primaryContractor116[state]',   field_label: 'Primary Contractor State',      required: true, transform: 'state_2letter' },
    { leap_field: 'has_support_contractor',   param: 'willA78',                       field_label: 'Will a Support Contractor work on this project?', required: true },
    { leap_field: 'installation_state',       param: 'installationAddress[state]',    field_label: 'Installation State',            required: true },
    { leap_field: 'building_owner_name',      param: 'buildingOwner[first]',          field_label: 'Building Owner Name',           required: false },
    { leap_field: 'iq_code',                  param: 'incomequalifiedConfirmation',   field_label: 'Income-Qualified Confirmation Code', required: false },
  ],
}
const PAYLOAD = {
  ia_application_for: 'Project Reservation',
  contractor_business_name: 'Sealed Inc',
  contractor_state: 'Wisconsin',          // stored long, SENT as WI
  has_support_contractor: 'Yes',
  installation_state: 'WI',
  building_owner_name: 'LSS HOUSING, INC.',
  // iq_code absent: the building has no LEA, so nothing was pushed for it
}
const groups = groupsFromFormSubmission(MAP, PAYLOAD)
const rows = groups[0]?.rows || []
const labelled = Object.fromEntries(rows.map(r => [r.label, r.value]))

// ── One section, named for the form that received it ──────────────────────
check('one section', groups.length, 1)
check('headed by the form’s own name', groups[0].heading,
  'Focus On Energy - IRA HOMES Multifamily Project Submittal Form (Project Reservation)')

// ── The rows ARE the parameters that were sent ────────────────────────────
check('every sent field is recorded, in the form’s order',
  rows.map(r => r.column),
  ['ia_application_for', 'contractor_business_name', 'contractor_state',
   'has_support_contractor', 'installation_state', 'building_owner_name'])
check('the label is the form’s wording',
  labelled["I'm Applying for a(n)"], 'Project Reservation')

// The whole reason this is built through mapPayloadToParams: the value recorded
// is the value SENT. "Wisconsin" reaches Focus on Energy as "WI", so "WI" is
// what was submitted and "WI" is what the record says.
check('a transformed value is recorded as SENT, not as stored',
  labelled['Primary Contractor State'], 'WI')
check('an already-short state passes through untouched',
  labelled['Installation State'], 'WI')

// ── Not submitted is not recorded ─────────────────────────────────────────
check('a field with no value was never pushed, so it is not in the record',
  rows.some(r => r.column === 'iq_code'), false)
check('...but it IS reportable as not submitted',
  fieldsNotSubmitted(MAP, PAYLOAD),
  [{ column: 'iq_code', label: 'Income-Qualified Confirmation Code', required: false }])
check('a required field left blank is flagged as required',
  fieldsNotSubmitted(MAP, { contractor_state: 'WI' })
    .filter(f => f.required).map(f => f.column),
  ['ia_application_for', 'contractor_business_name', 'has_support_contractor', 'installation_state'])

// ── What must NEVER appear: LEAP's own bookkeeping ────────────────────────
// Record Type, Owner and Status are not parameters on any form, so they cannot
// reach the document by construction -- there is no field map row for them.
for (const bookkeeping of ['enrollment_record_type', 'enrollment_owner', 'enrollment_status'])
  check(`${bookkeeping} is not submitted, so it is not recorded`,
    rows.some(r => r.column === bookkeeping), false)
// Nor can anything that was merely on a page layout.
for (const notOnTheForm of ['enrollment_br_studio', 'enrollment_hud_program', 'enrollment_unit_numbering_scheme'])
  check(`${notOnTheForm} was never on the form`,
    rows.some(r => r.column === notOnTheForm), false)

// ── Degenerate shapes ─────────────────────────────────────────────────────
check('a form with no mapped fields records nothing', groupsFromFormSubmission({ name: 'x', fields: [] }, PAYLOAD), [])
check('no map at all records nothing', groupsFromFormSubmission(null, PAYLOAD), [])
check('nothing sent means no section at all', groupsFromFormSubmission(MAP, {}), [])
check('a null payload is survived', groupsFromFormSubmission(MAP, null), [])
check('fieldsNotSubmitted survives a null map', fieldsNotSubmitted(null, PAYLOAD), [])

// ── Scoping: ONE record type, by explicit instruction ─────────────────────
check('the reservation records its submission',
  formTargetForRecordType('WI-IRA-MF-HOMES-Project-Reservation'), 'wi_ira_mf_homes_project_reservation')
check('the pre-approval is UNTOUCHED', formTargetForRecordType('WI-IRA-MF-HOMES-Assessment-Preapproval'), null)
check('the HEAR reservation is UNTOUCHED', formTargetForRecordType('WI-IRA-MF-HEAR-Project-Reservation'), null)
check('NC is UNTOUCHED', formTargetForRecordType('NC-IRA-MF'), null)
check('exactly one record type is form-driven',
  Object.keys(SUBMITTED_FORM_TARGET_BY_RECORD_TYPE).length, 1)
check('a null record type is not', formTargetForRecordType(null), null)

if (failures > 0) {
  console.error(`\nsubmitted-enrollment-fields fixture: ${failures} of ${checks} checks FAILED`)
  process.exit(1)
}
console.log(`submitted-enrollment-fields fixture: ${checks} checks passed`)
