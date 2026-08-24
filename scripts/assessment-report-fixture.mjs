// ---------------------------------------------------------------------------
// assessment-report-fixture — pins the Energy Assessment Report.
//
// Two things are checked, because two things can silently rot:
//   1. the pure rules (which record type gets which report, how a captured
//      step becomes printable rows, which photos qualify)
//   2. that the engine actually RENDERS — every section type in the default
//      template runs and produces a real multi-page PDF. The section list is
//      data, so a renderer that throws would otherwise only be found by a user
//      pressing Generate.
// ---------------------------------------------------------------------------
import assert from 'node:assert/strict'

import {
  ASSESSMENT_REPORTS, ASSESSMENT_REPORT_KIND, assessmentReportFor, hasAssessmentReport,
  fieldDisplayValue, buildStepEntry, isNotApplicable, reportPhotos, photoCaption,
  buildingSummaryRows, addressLines, cityStateZip, reportFileName,
} from '../src/lib/assessmentReport.js'
import {
  ASSESSMENT_SECTION_RENDERERS, DEFAULT_DOCUMENT_SECTIONS, DOCUMENT_KIND_ENGINE,
  SECTION_TYPES_BY_ENGINE, buildAssessmentReportPdf, buildSubmittalPdf,
} from '../src/data/paperworkModel.js'

let checks = 0
const ok = (cond, msg) => { assert.ok(cond, msg); checks++ }
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++ }

// ── 1. The registry ─────────────────────────────────────────────────────────
eq(assessmentReportFor('MULTIFAMILY-ENERGY-ASSESSMENT').documentKey,
  'multifamily_energy_assessment_report', 'MF assessment resolves to its own document key')
ok(hasAssessmentReport('MULTIFAMILY-ENERGY-ASSESSMENT'), 'the MF report is built')
ok(!hasAssessmentReport('SINGLE-FAMILY-ENERGY-ASSESSMENT'),
  'the SF report is DECLARED but not built — a visible gap, never a silent substitution')
eq(assessmentReportFor('multifamily-energy-assessment')?.documentKey,
  'multifamily_energy_assessment_report', 'record type match is case-insensitive')
eq(assessmentReportFor('INSULATION-REMOVAL'), null, 'a non-assessment work order has no report')
eq(assessmentReportFor(null), null, 'no record type resolves to no report')
// Every declared report has its own never-shared document key.
const keys = Object.values(ASSESSMENT_REPORTS).map(r => r.documentKey)
eq(keys.length, new Set(keys).size, 'no two assessment shapes share a document key')

// ── 2. Field values ─────────────────────────────────────────────────────────
eq(fieldDisplayValue({ wsfv_text_value: 'Flat / Low-Slope' }), 'Flat / Low-Slope', 'text value prints')
eq(fieldDisplayValue({ wsfv_numeric_value: 12345.5 }), '12,345.5', 'numeric value is thousands-grouped')
eq(fieldDisplayValue({ wsfv_text_value: '   ' }), null, 'whitespace is not an answer')
eq(fieldDisplayValue({ wsfv_numeric_value: 0 }), '0', 'zero IS an answer and must not read as blank')
eq(fieldDisplayValue(null), null, 'no row means no answer')

// ── 3. A step becomes printable rows, driven by the TEMPLATE ────────────────
const tplFields = [
  { id: 'f2', wstf_field_label: 'Roof Insulation R-Value', wstf_field_type: 'number', wstf_unit: 'R', wstf_sort_order: 2 },
  { id: 'f1', wstf_field_label: 'Roof Type',               wstf_field_type: 'select', wstf_sort_order: 1 },
  { id: 'f3', wstf_field_label: 'Roof Photo',              wstf_field_type: 'photo',  wstf_sort_order: 3 },
]
const values = new Map([['f1', { wsfv_text_value: 'Flat / Low-Slope' }]])
const step = buildStepEntry({ id: 's1', work_step_name: 'Roof / Ceiling', work_step_template_id: 'wst1' }, tplFields, values)
eq(step.fields.map(f => f.label), ['Roof Type', 'Roof Insulation R-Value'],
  'fields print in template order, and photo prompts are not data rows')
eq(step.fields[1].value, null,
  'a question the assessor skipped still prints — an audit report must show what was asked and not answered')
eq(step.fields[1].unit, 'R', 'the unit rides with the field')
ok(!step.notApplicable, 'a normal step is not N/A')

const naStep = buildStepEntry(
  { id: 's2', work_step_name: 'Building Diagnostics', work_step_not_applicable_reason: 'No combustion equipment' }, [], new Map())
ok(naStep.notApplicable, 'a recorded reason marks the step Not Applicable')
eq(naStep.notApplicableReason, 'No combustion equipment', 'the reason is carried into the report')
ok(isNotApplicable({ _status_label: 'Not Applicable' }), 'the N/A status label also counts')
ok(!isNotApplicable({ _status_label: 'Completed' }), 'a completed step is not N/A')

// ── 4. Photo selection — the include_in_final_report flag's first consumer ──
const photos = [
  { id: 'p3', include_in_final_report: true,  _work_step_position: 3, taken_at: '2026-08-24T10:00:00Z' },
  { id: 'p1', include_in_final_report: true,  _work_step_position: 1, taken_at: '2026-08-24T09:05:00Z' },
  { id: 'p2', include_in_final_report: true,  _work_step_position: 1, taken_at: '2026-08-24T09:01:00Z' },
  { id: 'px', include_in_final_report: false, _work_step_position: 1 },
  { id: 'pd', include_in_final_report: true,  _work_step_position: 1, is_deleted: true },
]
eq(reportPhotos(photos).map(p => p.id), ['p2', 'p1', 'p3'],
  'only flagged, non-deleted photos, ordered by step then capture time')
eq(reportPhotos([]).length, 0, 'no photos is not an error')
eq(reportPhotos(null).length, 0, 'a null photo list is not an error')
ok(photoCaption({ taken_at: '2026-08-24T10:00:00Z', latitude: 35.9382, longitude: -77.7905 },
  { formatDate: () => 'Aug 24, 2026' }).includes('35.93820'), 'GPS rides in the caption')
eq(photoCaption({}, {}), '', 'a photo with neither time nor GPS gets an empty caption, not "undefined"')

// ── 5. Building summary ─────────────────────────────────────────────────────
const rows = buildingSummaryRows(
  { building_name: '1615 E Raleigh Rd', building_year_built: 1974, building_total_units: 24, building_roof_type: null },
  { property_name: '100 Saint Francis Court', property_total_units: 24 })
const labels = rows.map(r => r[0])
ok(labels.includes('Year Built'), 'a populated column appears')
ok(!labels.includes('Roof Type'), 'an empty column is dropped — context, not a wall of em dashes')
eq(rows.find(r => r[0] === 'Property')[1], '100 Saint Francis Court', 'property name comes off the property record')
eq(buildingSummaryRows(null, null).length, 0, 'no records means no summary rows, not a crash')
eq(addressLines({ property_street: '100 Saint Francis Ct' }, 'property'), ['100 Saint Francis Ct'],
  'properties spell it property_street')
eq(addressLines({ building_address: '1615 E Raleigh Rd' }, 'building'), ['1615 E Raleigh Rd'],
  'buildings spell it building_address')
eq(cityStateZip({ property_city: 'Rocky Mount', property_state: 'NC', property_zip: '27801' }, 'property'),
  'Rocky Mount, NC 27801', 'city/state/zip composes')
eq(cityStateZip({}, 'property'), null, 'an unknown address composes to null, not ", "')
eq(reportFileName(ASSESSMENT_REPORTS['MULTIFAMILY-ENERGY-ASSESSMENT'], 'WO-00208', '1615 E Raleigh Rd'),
  'Multifamily Energy Assessment Report - WO-00208 - 1615 E Raleigh Rd.pdf', 'filename composes')
ok(!reportFileName({ fileStem: 'A/B:C' }, 'WO-1', null).includes('/'),
  'characters a filesystem rejects are stripped from the filename')

// ── 6. The engine is registered and separate from the submittal engines ─────
eq(DOCUMENT_KIND_ENGINE[ASSESSMENT_REPORT_KIND], 'energy_assessment', 'the kind routes to its own engine')
const assessmentTypes = SECTION_TYPES_BY_ENGINE.energy_assessment
eq(assessmentTypes.length, Object.keys(ASSESSMENT_SECTION_RENDERERS).length,
  'the editor palette is derived from the renderers, so an unrenderable section can never be added')
for (const engine of ['ees', 'sealed', 'combustion_safety']) {
  const shared = SECTION_TYPES_BY_ENGINE[engine].filter(t => assessmentTypes.includes(t))
  eq(shared, [], `the assessment engine shares no section type with the ${engine} engine`)
}

// ── 7. Every section in the default template actually renders ───────────────
const defaults = DEFAULT_DOCUMENT_SECTIONS.energyAssessmentReport
ok(defaults.length >= 15, 'the default template covers the whole building walk')
for (const s of defaults) {
  ok(ASSESSMENT_SECTION_RENDERERS[s.type], `default section "${s.type}" has a renderer`)
}
// One assessment_field_data per captured section, each naming a real step.
const stepSections = defaults.filter(s => s.type === 'assessment_field_data')
eq(stepSections.length, 14, 'one section per captured work step')
ok(stepSections.every(s => s.config.photos === 'step'),
  'each system section prints its own photos, so the report reads beside the Asset Score sections')

const model = {
  title: 'Multifamily Building Energy Assessment Report',
  subtitle: 'Whole-Building Energy Audit — ASHRAE Level II Equivalent',
  program: { label: 'NC-IRA-MF-HOMES' },
  property: { name: '100 Saint Francis Court', addressLines: ['100 Saint Francis Ct'], cityStateZip: 'Rocky Mount, NC 27801' },
  building: { name: '1615 E Raleigh Rd', label: '1615 E Raleigh Rd' },
  workOrder: { number: 'WO-00208', name: 'Multifamily Energy Assessment', status: 'In Progress' },
  preparedFor: { name: 'Saint Francis Court LP', lines: ['1 Owner Way', 'Raleigh, NC 27601'] },
  auditor: { name: 'Field Auditor' },
  assessedOn: 'August 24, 2026',
  generatedOn: 'August 24, 2026',
  summaryRows: [['Property', '100 Saint Francis Court'], ['Year Built', '1974']],
  steps: [
    { key: 'k1', name: 'Building Geometry & Use', fields: [{ label: 'Number of Floors', value: '3' }, { label: 'Gross Floor Area', value: '24,000', unit: 'sq ft' }] },
    { key: 'k2', name: 'Roof / Ceiling',          fields: [{ label: 'Roof Type', value: null }] },
    { key: 'k3', name: 'Building Diagnostics',    fields: [], notApplicable: true, notApplicableReason: 'No combustion equipment' },
  ],
  // No dataUrl: the renderer must draw the box and caption anyway.
  photos: [
    { id: 'p1', group: 'Building Geometry & Use', label: 'North Elevation', caption: 'Aug 24, 2026  ·  35.93820, -77.79050' },
    { id: 'p2', group: 'Building Photos',         label: 'Front Door',      caption: 'Aug 24, 2026' },
  ],
  recommendations: [],
  textBlocks: {},
}

const blob = await buildAssessmentReportPdf(model, ASSESSMENT_REPORT_KIND, null)
ok(blob && blob.size > 4000, `the default template renders a real PDF (${blob?.size} bytes)`)
const viaDispatch = await buildSubmittalPdf(model, ASSESSMENT_REPORT_KIND, null)
ok(viaDispatch && viaDispatch.size > 4000, 'buildSubmittalPdf dispatches the assessment kind to its engine')

// A template that names a step this work order never captured must say so
// rather than throw — templates outlive the plans they were written against.
const missing = await buildAssessmentReportPdf(model, ASSESSMENT_REPORT_KIND, [
  { type: 'assessment_cover' },
  { type: 'assessment_field_data', config: { step: 'Vertical Transportation', heading: 'Elevators' } },
  { type: 'assessment_footer' },
])
ok(missing.size > 1000, 'a section naming an uncaptured step renders a "not captured" note, not an error')

// A report with no flagged photos at all still renders.
const noPhotos = await buildAssessmentReportPdf({ ...model, photos: [] }, ASSESSMENT_REPORT_KIND, null)
ok(noPhotos.size > 3000, 'a report with no flagged photos still renders')

// An unknown section type is a loud failure, not a silently missing section.
await assert.rejects(
  () => buildAssessmentReportPdf(model, ASSESSMENT_REPORT_KIND, [{ type: 'not_a_real_section' }]),
  /Unknown assessment section type/, 'an unknown section type throws')
checks++

// ── 8. The template editor can edit every section this engine renders ───────
const { paletteForKind, SUBMITTAL_SECTION_LABELS, buildDefaultSectionConfig, engineForKind } =
  await import('../src/data/submittalSectionSchemas.js')

eq(engineForKind(ASSESSMENT_REPORT_KIND), 'energy_assessment', 'the editor resolves the assessment engine')
const palette = paletteForKind(ASSESSMENT_REPORT_KIND)
eq(palette.length, assessmentTypes.length,
  'the Add-Section palette offers exactly the section types the engine can render')
for (const type of assessmentTypes) {
  ok(SUBMITTAL_SECTION_LABELS[type] && SUBMITTAL_SECTION_LABELS[type] !== type,
    `"${type}" has a human label in the editor, not a raw slug`)
}
// A newly-added Captured Section prints its own photos by default, which is
// what keeps a hand-built template reading beside the Asset Score report.
eq(buildDefaultSectionConfig('assessment_field_data').photos, 'step',
  'a newly-added Captured Section prints its own photos')
// A section a user adds from the palette must render without further config.
for (const entry of palette) {
  await buildAssessmentReportPdf(model, ASSESSMENT_REPORT_KIND,
    [{ type: entry.type, config: entry.defaultConfig }])
  checks++
}

console.log(`assessment-report-fixture: ${checks} checks passed`)
