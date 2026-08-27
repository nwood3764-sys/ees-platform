// ---------------------------------------------------------------------------
// submitted-enrollment-fixture — pins the Submitted Enrollment document.
//
// Two things are checked, because two things can silently rot:
//   1. the pure rules (which program a record type is, what counts as a
//      submitted value, how the document manifest is ordered)
//   2. that the engine actually RENDERS — every section type in the default
//      template runs and produces a real PDF. The section list is data, so a
//      renderer that throws would otherwise only be found by a user pressing
//      Generate.
//
// The rule this fixture exists to defend: a submitted field that was left
// BLANK must still print. This is a record of what was filed, and "we
// submitted nothing here" and "this report forgot to mention it" must never
// look the same to whoever reads it a year later.
// ---------------------------------------------------------------------------
import assert from 'node:assert/strict'

import {
  SUBMITTED_ENROLLMENT_PROGRAMS, SUBMITTED_ENROLLMENT_KIND, SUBMITTED_ENROLLMENT_DOCUMENT_KEY,
  SUBMITTED_ENROLLMENT_FIELD_GROUPS, SUBMITTED_ENROLLMENT_TITLE,
  submittedEnrollmentFor, hasSubmittedEnrollment,
  submittedFieldValue, buildSubmittedEnrollmentSummary, buildDocumentManifest,
  documentTypeLabel, formatFileSize, documentDownloadName, submittedEnrollmentFileName,
} from '../src/lib/submittedEnrollment.js'
import {
  SUBMITTED_ENROLLMENT_SECTION_RENDERERS, DEFAULT_DOCUMENT_SECTIONS, DOCUMENT_KIND_ENGINE,
  SECTION_TYPES_BY_ENGINE, buildSubmittedEnrollmentPdf, buildSubmittalPdf,
} from '../src/data/paperworkModel.js'
import { SUBMITTAL_SECTION_SCHEMAS, SUBMITTAL_SECTION_LABELS } from '../src/data/submittalSectionSchemas.js'

let checks = 0
const ok = (cond, msg) => { assert.ok(cond, msg); checks++ }
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++ }

// ── 1. The registry ─────────────────────────────────────────────────────────
// ONE title on every enrollment. The first cut gave each record type its own
// ("Assessment Preapproval Submission Record", "North Carolina IRA Multifamily
// Submission Record") — one document, its name drifting eight ways, and a
// coined noun for an object the platform already had a name for.
eq(submittedEnrollmentFor('WI-IRA-MF-HOMES-Assessment-Preapproval').title,
  'Submitted Enrollment', 'the document is called the same thing on every enrollment')
eq(submittedEnrollmentFor('nc-ira-mf').title, 'Submitted Enrollment', 'including this one')
eq(submittedEnrollmentFor('nc-ira-mf').programLabel,
  'NC IRA Multifamily', 'the PROGRAM is what varies, and it rides the subtitle')
eq(submittedEnrollmentFor('WI-IRA-MF-HOMES-Assessment-Preapproval').programLabel,
  'WI IRA MF HOMES — Assessment Preapproval', 'record type match is case-insensitive')
eq(new Set(Object.keys(SUBMITTED_ENROLLMENT_PROGRAMS).map(k => submittedEnrollmentFor(k).title)).size, 1,
  'no record type may retitle the document')
ok(hasSubmittedEnrollment('enrollments'), 'every enrollment can produce a submission record')
ok(!hasSubmittedEnrollment('work_orders'), 'a work order does not — that is the assessment report')
ok(!hasSubmittedEnrollment('projects'), 'nor a project — those are the project submittals')

// An UNREGISTERED record type still gets a record, named for itself. A program
// added in Setup is a filing like any other; refusing to record what it filed
// because nobody edited the registry would be the registry serving itself.
const unknown = submittedEnrollmentFor('CO-IRA-MF', 'CO-IRA-MF')
eq(unknown.title, 'Submitted Enrollment', 'an unregistered program still gets the document')
eq(unknown.programLabel, 'CO-IRA-MF', 'named for itself in the subtitle')
eq(submittedEnrollmentFor(null).title, 'Submitted Enrollment', 'no record type still resolves')
eq(submittedEnrollmentFor(null).programLabel, null, 'with no program to name')

// One document key across all programs — see the note in the module. Program
// wording rides the template axis, not eight duplicate keys.
eq(SUBMITTED_ENROLLMENT_DOCUMENT_KEY, 'submitted_enrollment', 'one key, deliberately')
eq(SUBMITTED_ENROLLMENT_KIND, 'submitted_enrollment', 'kind and key agree — one name, not two')
eq(DOCUMENT_KIND_ENGINE[SUBMITTED_ENROLLMENT_KIND], 'submitted_enrollment',
  'the kind routes to its own engine')
ok(!Object.values(SUBMITTED_ENROLLMENT_PROGRAMS).some(r => r.documentKey || r.title),
  'the registry carries the PROGRAM only — no per-record-type keys or titles')

// ── 2. Submitted values ─────────────────────────────────────────────────────
eq(submittedFieldValue({ enrollment_occupied_units: 24 }, 'enrollment_occupied_units'), '24',
  'a number prints')
eq(submittedFieldValue({ enrollment_unoccupied_units: 0 }, 'enrollment_unoccupied_units'), '0',
  'ZERO IS AN ANSWER — printing an em dash here would misreport the filing')
eq(submittedFieldValue({ enrollment_contact_name: '  ' }, 'enrollment_contact_name'), null,
  'whitespace is not an answer')
eq(submittedFieldValue({ enrollment_contact_name: null }, 'enrollment_contact_name'), null,
  'null is not an answer')
eq(submittedFieldValue({ enrollment_fifty_pct_lmi_declaration: true }, 'enrollment_fifty_pct_lmi_declaration'),
  'Yes', 'a boolean reads as Yes')
eq(submittedFieldValue({ enrollment_fifty_pct_lmi_declaration: false }, 'enrollment_fifty_pct_lmi_declaration'),
  'No', 'FALSE reads as No, never as blank — a declined declaration was still answered')
eq(submittedFieldValue({ enrollment_total_project_cost: 87150 }, 'enrollment_total_project_cost'),
  '$87,150.00', 'a cost column prints as currency')
eq(submittedFieldValue({ enrollment_requested_incentive_amount: '80000' }, 'enrollment_requested_incentive_amount'),
  '$80,000.00', 'a numeric string in a cost column prints as currency')
eq(submittedFieldValue({ enrollment_eligibility_pathways: ['HUD', 'LIHTC'] }, 'enrollment_eligibility_pathways'),
  'HUD, LIHTC', 'an array joins')
eq(submittedFieldValue({ enrollment_eligibility_pathways: [] }, 'enrollment_eligibility_pathways'), null,
  'an empty array is not an answer')

// Dates are formatted from the STRING PARTS. `new Date('2026-08-18')` parses as
// UTC midnight, so in every timezone EES works in it would render Aug 17 — a
// record of what was filed cannot move a submission date by a day.
eq(submittedFieldValue({ enrollment_estimated_assessment_date: '2026-08-18' },
  'enrollment_estimated_assessment_date'), 'August 18, 2026', 'a bare date reads as a date')
eq(submittedFieldValue({ enrollment_determination_date: '2026-01-01' },
  'enrollment_determination_date'), 'January 1, 2026', 'no timezone slip on New Year\u2019s Day')
eq(submittedFieldValue({ enrollment_determination_date: '2026-08-18T00:00:00Z' },
  'enrollment_determination_date'), 'August 18, 2026', 'a timestamp reads as its date')
eq(submittedFieldValue({ enrollment_determination_date: 'not a date' },
  'enrollment_determination_date'), 'not a date', 'an unparseable value prints verbatim, never dropped')

// A record id must never reach the page — many submitted columns hold picklist
// or lookup uuids, and "09888d66-…" where "Apartment" belongs reads as a defect.
const UUID = '09888d66-7719-49a8-b19b-ca885d26fd94'
eq(submittedFieldValue({ enrollment_property_type: UUID }, 'enrollment_property_type'), null,
  'an unresolvable id is DROPPED, never printed')
eq(submittedFieldValue({ enrollment_property_type: UUID }, 'enrollment_property_type',
  new Map([[UUID, 'Apartment']])), 'Apartment', 'a resolved id prints its label')
eq(submittedFieldValue({ enrollment_property_type: UUID }, 'enrollment_property_type',
  { [UUID]: 'Apartment' }), 'Apartment', 'a plain object of labels works too')
eq(submittedFieldValue({ enrollment_eligibility_pathways: [UUID] }, 'enrollment_eligibility_pathways',
  new Map([[UUID, 'HUD Assisted']])), 'HUD Assisted', 'ids inside an array resolve as well')

// ── 3. The summary ──────────────────────────────────────────────────────────
const enr = {
  enrollment_contact_name: 'Jane Henderson',
  enrollment_contact_email: 'jane@example.org',
  enrollment_occupied_units: 22,
  enrollment_unoccupied_units: 0,
  enrollment_total_project_cost: 87150,
}
const summary = buildSubmittedEnrollmentSummary(enr)
ok(summary.length >= 2, 'groups with an answer are kept')
const applicant = summary.find(g => g.heading === 'Applicant')
ok(applicant, 'the Applicant group survives')
eq(applicant.rows.length, SUBMITTED_ENROLLMENT_FIELD_GROUPS.find(g => g.heading === 'Applicant').fields.length,
  'a kept group keeps ALL its rows, so an unanswered field stays visible beside the answered ones')
ok(applicant.rows.some(r => r.value === null),
  'the unanswered rows are present and null — the renderer prints them as em dashes')
ok(!summary.some(g => g.heading === 'Bedroom Mix'),
  'a group in which nothing at all was filled in is dropped rather than printing a wall of dashes')
const units = summary.find(g => g.heading === 'Property and Units')
eq(units.rows.find(r => r.column === 'enrollment_unoccupied_units').value, '0',
  'zero survives all the way into the summary')
eq(buildSubmittedEnrollmentSummary({}).length, 0, 'an empty enrollment yields no groups')
eq(buildSubmittedEnrollmentSummary(null).length, 0, 'a missing record does not throw')

// ── 4. The document manifest ────────────────────────────────────────────────
const docs = [
  { id: 'a', name: 'Utility Bills.pdf', document_type: 'attachment', file_size_bytes: 240000,
    created_at: '2026-08-02T10:00:00Z', include_in_final_report: false },
  // file_size_bytes is documents' REAL size column (checked against
  // information_schema, not assumed) — the first cut of this read `file_size`
  // and every size in the manifest would have printed blank.
  { id: 'b', name: 'Audit Template Report.xlsx', document_type: 'audit_template_report',
    file_size_bytes: 1_500_000, created_at: '2026-08-01T10:00:00Z', include_in_final_report: true },
  { id: 'c', name: 'Deleted.pdf', document_type: 'attachment', is_deleted: true,
    include_in_final_report: true },
  { id: 'd', name: 'Reservation.hpxml', document_type: 'reservation_hpxml',
    created_at: '2026-08-03T10:00:00Z', include_in_final_report: false },
]
const all = buildDocumentManifest(docs)
eq(all.length, 3, 'a soft-deleted document is never in the manifest')
eq(all[0].id, 'b', 'flagged documents sort first — they ARE the submission')
eq(all[0].inSubmission, true, 'the flag rides through to the renderer')
eq(all[0].typeLabel, 'Audit Template Report', 'the document type reads as a label')
eq(all[0].size, '1.4 MB', 'the size reads in units a person uses, from documents.file_size_bytes')
eq(buildDocumentManifest([{ id: 'x', name: 'n', file_size_bytes: 240000 }])[0].size, '234 KB',
  'the real column name is what the manifest reads')
const flagged = buildDocumentManifest(docs, { flaggedOnly: true })
eq(flagged.length, 1, 'flaggedOnly narrows to the flagged set')
eq(flagged[0].id, 'b', 'and it is the flagged one')

// With NOTHING flagged, flaggedOnly must NOT produce an empty manifest: a
// record that silently omits every attachment is worse than one listing extras.
const noneFlagged = docs.filter(d => !d.include_in_final_report && !d.is_deleted)
eq(buildDocumentManifest(noneFlagged, { flaggedOnly: true }).length, 2,
  'nothing flagged falls back to every attachment rather than an empty manifest')
eq(buildDocumentManifest([], { flaggedOnly: true }).length, 0, 'no documents means no rows')
eq(buildDocumentManifest(null).length, 0, 'a missing list does not throw')

eq(documentTypeLabel('income_qualification_tenant_sheet'), 'Income Qualification Tenant Sheet',
  'a slug humanizes')
eq(documentTypeLabel('reservation_hpxml'), 'Reservation HPXML', 'known acronyms stay upper-case')
eq(documentTypeLabel(''), 'Document', 'an untyped file still has a label')
eq(formatFileSize(0), null, 'an unknown size is null, not "0 B"')
eq(formatFileSize(900), '900 B', 'bytes')
eq(formatFileSize(240000), '234 KB', 'kilobytes')

// A saved attachment must not land in the reader's downloads as a uuid.
eq(documentDownloadName({ name: 'Utility Bills.pdf' }, 'ENR-00007'),
  'ENR-00007 - Utility Bills.pdf', 'the download carries the enrollment it belonged to')
eq(documentDownloadName({ name: 'a/b:c.pdf' }, null), 'a-b-c.pdf', 'path characters are stripped')
eq(submittedEnrollmentFileName(submittedEnrollmentFor('NC-IRA-MF'), 'ENR-00007'),
  'Submitted Enrollment - ENR-00007.pdf', 'the file is named for the document and the record it is about')

// ── 5. Every section type has a schema and a label ──────────────────────────
for (const type of SECTION_TYPES_BY_ENGINE.submitted_enrollment) {
  ok(SUBMITTAL_SECTION_SCHEMAS[type], `${type} has a typed config form`)
  ok(SUBMITTAL_SECTION_LABELS[type], `${type} has a human label`)
}
for (const s of DEFAULT_DOCUMENT_SECTIONS.submittedEnrollment) {
  ok(SUBMITTED_ENROLLMENT_SECTION_RENDERERS[s.type], `default section ${s.type} has a renderer`)
}

// ── 6. It RENDERS ───────────────────────────────────────────────────────────
const model = {
  title: 'Submitted Enrollment',
  programLabel: 'WI IRA MF HOMES — Assessment Preapproval',
  enrollment: { number: 'ENR-00007', name: 'Alden Rd — Preapproval', status: 'Submitted' },
  property: { name: '1837 Alden Rd', addressLines: ['1837 Alden Rd'], cityStateZip: 'Janesville, WI 53546' },
  building: { name: '1837', label: '1837' },
  opportunity: { number: 'OPP-00066', name: 'Alden Rd — WI-IRA-MF-HOMES' },
  company: { name: 'Energy Efficiency Services of Wisconsin' },
  submittedBy: 'Nicholas Wood',
  submittedOn: 'August 2, 2026',
  generatedOn: 'Aug 27, 2026, 08:15 PM',
  generatedBy: 'Nicholas Wood',
  summary,
  documents: all.map(d => ({ ...d, uploadedOn: 'August 1, 2026', uploadedBy: 'Priya Nair',
    linkUrl: d.id === 'b' ? 'https://leap.energyefficiencyservices.org/f/abc' : null })),
  documentNote: null,
  textBlocks: {},
}
const blob = await buildSubmittedEnrollmentPdf(model, SUBMITTED_ENROLLMENT_KIND, null)
ok(blob && blob.size > 1200, `the default template renders a real PDF (${blob?.size} bytes)`)

// Through the shared dispatch, the way the app calls it.
const viaDispatch = await buildSubmittalPdf(model, SUBMITTED_ENROLLMENT_KIND, null)
ok(viaDispatch && viaDispatch.size > 1200, 'buildSubmittalPdf routes the kind to this engine')

// Every section type renders on its own with only its defaults.
for (const type of SECTION_TYPES_BY_ENGINE.submitted_enrollment) {
  const one = await buildSubmittedEnrollmentPdf(model, SUBMITTED_ENROLLMENT_KIND, [{ type }])
  ok(one && one.size > 500, `${type} renders alone`)
}

// An enrollment with nothing on it still produces a record rather than throwing
// — "we filed almost nothing" is itself the answer somebody needs.
const bare = await buildSubmittedEnrollmentPdf(
  { title: 'Submitted Enrollment', summary: [], documents: [], textBlocks: {} },
  SUBMITTED_ENROLLMENT_KIND, null)
ok(bare && bare.size > 800, 'an empty enrollment still renders')

// A file with no link keeps its row: the reader must know it was part of the
// filing even when they have to open the record to fetch it.
const unlinked = await buildSubmittedEnrollmentPdf(
  { ...model, documents: [{ name: 'No link.pdf', typeLabel: 'Attachment', inSubmission: true }] },
  SUBMITTED_ENROLLMENT_KIND, [{ type: 'submitted_enrollment_documents' }])
ok(unlinked && unlinked.size > 500, 'a document with no link still prints a row')

// An unknown section type must throw loudly rather than silently skip — a
// template naming a renderer that does not exist is a broken template.
let threw = false
try { await buildSubmittedEnrollmentPdf(model, SUBMITTED_ENROLLMENT_KIND, [{ type: 'nope' }]) }
catch { threw = true }
ok(threw, 'an unknown section type throws instead of printing a short report')

console.log(`submitted-enrollment fixture: ${checks} checks passed`)
