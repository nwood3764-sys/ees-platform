// ---------------------------------------------------------------------------
// assessmentReport — pure rules for the Energy Assessment Report.
//
// An energy assessment report is the deliverable of the AUDIT: the write-up of
// what the assessor found on the building. It is NOT a program submittal —
// Project Reservation and Final Project Payment Request live in
// paperworkSubmittals.js and are keyed by opportunity record type + incentive
// application stage. This one is keyed by the ASSESSMENT WORK ORDER's record
// type, because the report's shape follows what was assessed (a whole
// multifamily building vs a single-family home), not which program pays for it.
//
// Program variation on top of that shape (NC vs WI wording) is carried the way
// every other submittal document carries it: a template scoped to an
// opportunity record type overrides the global default for the same document
// key. So the two axes stay separate and neither is overloaded.
//
// Kept free of React and Supabase so the selection, shaping and labelling
// rules are testable — see scripts/assessment-report-fixture.mjs.
// ---------------------------------------------------------------------------

/** The submittal_document_templates kind every assessment report template uses. */
export const ASSESSMENT_REPORT_KIND = 'energy_assessment_report'

// ---------------------------------------------------------------------------
// THE REGISTRY: assessment work order record type → its report.
//
// `built: false` means the report for that assessment shape has no template
// yet. It is declared anyway so the gap is VISIBLE — the action says the
// report is not built for this assessment type rather than silently handing
// back another shape's report.
// ---------------------------------------------------------------------------
export const ASSESSMENT_REPORTS = Object.freeze({
  'MULTIFAMILY-ENERGY-ASSESSMENT': {
    workOrderRecordType: 'MULTIFAMILY-ENERGY-ASSESSMENT',
    documentKey: 'multifamily_energy_assessment_report',
    label:       'Multifamily Building Energy Assessment Report',
    title:       'Multifamily Building Energy Assessment Report',
    subtitle:    null,
    fileStem:    'Multifamily Energy Assessment Report',
    built:       true,
  },
  'SINGLE-FAMILY-ENERGY-ASSESSMENT': {
    workOrderRecordType: 'SINGLE-FAMILY-ENERGY-ASSESSMENT',
    documentKey: 'single_family_energy_assessment_report',
    label:       'Single-Family Energy Assessment Report',
    title:       'Single-Family Energy Assessment Report',
    subtitle:    null,
    fileStem:    'Single-Family Energy Assessment Report',
    built:       false,
  },
  'HES-ASSESSMENT': {
    workOrderRecordType: 'HES-ASSESSMENT',
    documentKey: 'hes_assessment_report',
    label:       'Home Energy Score Assessment Report',
    title:       'Home Energy Score Assessment Report',
    subtitle:    null,
    fileStem:    'Home Energy Score Assessment Report',
    built:       false,
  },
})

/** The report definition for an assessment work order record type, or null. */
export function assessmentReportFor(recordTypeValue) {
  if (!recordTypeValue) return null
  return ASSESSMENT_REPORTS[String(recordTypeValue).trim().toUpperCase()] || null
}

/** True when this work order record type is an assessment that has a report. */
export function hasAssessmentReport(recordTypeValue) {
  const def = assessmentReportFor(recordTypeValue)
  return !!(def && def.built)
}

import { photoTagLabel, isMeaningfulTag } from './photoTags.js'

// ---------------------------------------------------------------------------
// Shaping the captured field data.
// ---------------------------------------------------------------------------

/**
 * A captured field's printable value. Selects and text come back as text;
 * numbers as their numeric value. A field the assessor left blank returns
 * null so the renderer prints an em dash — "asked and not answered" has to
 * stay visible in an audit report.
 */
export function fieldDisplayValue(row) {
  if (!row) return null
  const txt = row.wsfv_text_value
  if (txt != null && String(txt).trim() !== '') return String(txt).trim()
  const num = row.wsfv_numeric_value
  if (num != null && String(num).trim() !== '' && isFinite(Number(num))) {
    return Number(num).toLocaleString('en-US', { maximumFractionDigits: 4 })
  }
  return null
}

/**
 * Shape one work step into the model's step entry: every field the TEMPLATE
 * declares, in template order, each carrying the captured value or null.
 *
 * Driving off the template (not off the rows that happen to exist) is what
 * makes the report honest: a section the assessor skipped prints its
 * questions with em dashes instead of quietly disappearing.
 */
export function buildStepEntry(step, templateFields, valuesByFieldId) {
  const fields = (templateFields || [])
    .slice()
    .sort((a, b) => (a.wstf_sort_order ?? 0) - (b.wstf_sort_order ?? 0))
    .filter(f => f.wstf_field_type !== 'photo')
    .map(f => ({
      label: f.wstf_field_label || f.wstf_field_name,
      unit:  f.wstf_unit || null,
      value: fieldDisplayValue(valuesByFieldId ? valuesByFieldId.get(f.id) : null),
    }))
  return {
    key:  step.work_step_template_id || step.id,
    name: step.work_step_name || '',
    notApplicable: isNotApplicable(step),
    notApplicableReason: step.work_step_not_applicable_reason || null,
    fields,
  }
}

/**
 * A step the assessor explicitly marked Not Applicable, recognised by the
 * RECORDED REASON — the deliberate act — and never by work step status.
 *
 * Nothing in this report reads the status of a work order or a work step
 * (Nicholas, 2026-08-24: "if you're looking at the status of the work order or
 * work steps, that shouldn't be a trigger"). A report is a record of what was
 * captured; a photo that was taken is a fact whatever state somebody left the
 * step in, and an assessment does not become unprintable because a step still
 * says New. Even here the flag only adds a note — it never suppresses a
 * section's fields or its photos.
 */
export function isNotApplicable(step) {
  if (!step) return false
  const reason = step.work_step_not_applicable_reason
  return reason != null && String(reason).trim() !== ''
}

/**
 * The photos that belong in the report: exactly the ones an internal reviewer
 * flagged with "Include in final report" on the work order's Photos card, in
 * the order the steps are walked, then by capture time.
 *
 * This is the flag's FIRST consumer. Before this it was a curation marker
 * nothing read (migration 20260720140000).
 */
export function reportPhotos(photos) {
  return (photos || [])
    .filter(p => p && p.include_in_final_report && p.is_deleted !== true)
    .slice()
    .sort((a, b) => {
      const pa = a._work_step_position ?? 0, pb = b._work_step_position ?? 0
      if (pa !== pb) return pa - pb
      return String(a.taken_at || a.created_at || '').localeCompare(String(b.taken_at || b.created_at || ''))
    })
}

/**
 * The bold line under a report photo — what it SHOWS.
 *
 * Uses the platform's own tag rule (photoTags.photoTagLabel), so a photo
 * captured against a work step prompt reads with the wording the technician
 * saw and the program reviewer expects. A tag that describes nothing beyond
 * "a photo" ('general', 'photo', blank) is not a description, so the caption
 * is preferred over it, and the photo number is the last resort — never a
 * label that says nothing.
 */
export function reportPhotoLabel(photo, labels) {
  if (!photo) return 'Photo'
  if (isMeaningfulTag(photo.photo_type)) return photoTagLabel(photo, labels)
  const caption = photo.caption
  if (caption != null && String(caption).trim() !== '') return String(caption).trim()
  return photo.photo_number || 'Photo'
}

/** Caption line under a report photo: when it was taken, and where. */
export function photoCaption(photo, { formatDate } = {}) {
  const parts = []
  const when = photo.taken_at || photo.created_at
  if (when) parts.push(formatDate ? formatDate(when) : String(when))
  if (photo.latitude != null && photo.longitude != null) {
    parts.push(`${Number(photo.latitude).toFixed(5)}, ${Number(photo.longitude).toFixed(5)}`)
  }
  return parts.join('  ·  ')
}

// ---------------------------------------------------------------------------
// The company that performed the assessment is named for the state the
// BUILDING is in — an assessment on a North Carolina property is performed by
// Energy Efficiency Services of North Carolina, and a report that says
// Wisconsin on a Rocky Mount building is simply wrong on its face.
// ---------------------------------------------------------------------------
export const COMPANY_BASE_NAME = 'Energy Efficiency Services'

const STATE_NAMES = Object.freeze({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
})

/** "NC" → "North Carolina". Accepts a full name unchanged. Null when unknown. */
export function stateFullName(state) {
  const raw = String(state ?? '').trim()
  if (!raw) return null
  const abbr = STATE_NAMES[raw.toUpperCase()]
  if (abbr) return abbr
  const known = Object.values(STATE_NAMES).find(n => n.toLowerCase() === raw.toLowerCase())
  return known || null
}

/**
 * "Energy Efficiency Services of North Carolina" for a building in NC.
 * An unknown state falls back to the unqualified name — never to another
 * state's, which would put a false entity on a legal-looking document.
 */
export function companyNameForState(state) {
  const full = stateFullName(state)
  return full ? `${COMPANY_BASE_NAME} of ${full}` : COMPANY_BASE_NAME
}

// ---------------------------------------------------------------------------
// Record ids must never reach the page.
//
// Many `building_*` columns are picklist FKs holding a uuid, not text — the
// platform rule that `{object}_record_type` is a uuid FK into picklist_values
// applies to a good deal more than record type. Printing the stored value
// verbatim puts "09888d66-7719-49a8-b19b-ca885d26fd94" where "Apartment"
// belongs. A report is read by a property owner and a program reviewer: an
// identifier is never an acceptable thing to show them.
// ---------------------------------------------------------------------------
const RECORD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True when a value is a record id rather than something a person can read. */
export function isRecordId(value) {
  return typeof value === 'string' && RECORD_ID_RE.test(value.trim())
}

/** Every record id sitting in the model's printable values, de-duplicated. */
export function collectRecordIds(model) {
  const ids = new Set()
  for (const [, value] of (model?.summaryRows || [])) if (isRecordId(value)) ids.add(value.trim())
  for (const step of (model?.steps || [])) {
    for (const f of (step.fields || [])) if (isRecordId(f.value)) ids.add(String(f.value).trim())
  }
  return Array.from(ids)
}

/**
 * Replace record ids with their human labels.
 *
 * Anything still unresolved is REMOVED, never printed: a summary row whose
 * value cannot be named is dropped (the summary is context, and a row nobody
 * can read is worse than no row), and a captured field falls back to an em
 * dash — the question was asked and its answer is unreadable, which is much
 * closer to "not answered" than to a valid value.
 */
export function applyLookupLabels(model, labelById) {
  const label = id => (labelById?.get?.(String(id).trim()) || null)
  return {
    ...model,
    summaryRows: (model?.summaryRows || [])
      .map(([k, v]) => (isRecordId(v) ? [k, label(v)] : [k, v]))
      .filter(([, v]) => v != null && String(v).trim() !== ''),
    steps: (model?.steps || []).map(step => ({
      ...step,
      fields: (step.fields || []).map(f =>
        isRecordId(f.value) ? { ...f, value: label(f.value) } : f),
    })),
  }
}

// ---------------------------------------------------------------------------
// Building summary rows — the orientation table, read off the building and
// property RECORDS (not the field capture, which gets its own sections).
// Rows whose column is empty are dropped: this table is context, and a wall of
// em dashes ahead of the real findings helps nobody.
// ---------------------------------------------------------------------------
const SUMMARY_SPEC = [
  ['Property',                'property_name',                     'property'],
  ['Building',                'building_name',                     'building'],
  ['Building Address',        'building_address',                  'building'],
  ['Year Built',              'building_year_built',               'building'],
  ['Stories',                 'building_stories',                  'building'],
  ['Total Units in Building', 'building_total_units',              'building'],
  ['Building Square Footage', 'building_square_footage',           'building'],
  ['Building Type',           'building_type',                     'building'],
  ['Construction Type',       'building_construction_type',        'building'],
  ['Foundation Type',         'building_foundation_type',          'building'],
  ['Roof Type',               'building_roof_type',                'building'],
  ['Window Type',             'building_window_type',              'building'],
  ['Heating System Type',     'building_heating_system_type',      'building'],
  ['Heating Fuel',            'building_heating_fuel_type',        'building'],
  ['Cooling System Type',     'building_cooling_system_type',      'building'],
  ['Water Heating Type',      'building_water_heating_system_type', 'building'],
  ['Ventilation Type',        'building_ventilation_type',         'building'],
  ['Total Units on Property', 'property_total_units',              'property'],
  ['Total Buildings on Property', 'property_total_buildings',      'property'],
]

/** [[label, value], …] for the Building Summary section. */
export function buildingSummaryRows(building, property) {
  const src = { building: building || {}, property: property || {} }
  const out = []
  for (const [label, column, from] of SUMMARY_SPEC) {
    const v = src[from][column]
    if (v == null || String(v).trim() === '') continue
    out.push([label, typeof v === 'number' ? v.toLocaleString('en-US') : String(v)])
  }
  return out
}

/** Address lines for the cover block, blank parts dropped. */
export function addressLines(rec, prefix) {
  const street = rec?.[`${prefix}_street_address`] || rec?.[`${prefix}_street`] || rec?.[`${prefix}_address`]
  return [street].filter(v => v != null && String(v).trim() !== '').map(String)
}

/** "City, ST 12345" from a record's city/state/zip columns. */
export function cityStateZip(rec, prefix) {
  const city = rec?.[`${prefix}_city`], state = rec?.[`${prefix}_state`], zip = rec?.[`${prefix}_zip`]
  const left = [city, state].filter(v => v != null && String(v).trim() !== '').join(', ')
  return [left, zip].filter(v => v != null && String(v).trim() !== '').join(' ').trim() || null
}

/**
 * Filename for a generated report: the BUILDING it is about, then which report
 * it is. Named for the building because that is how these are filed and looked
 * for — a folder of "Multifamily Energy Assessment Report - WO-00206.pdf" tells
 * nobody which building they are holding.
 *
 * Characters a filesystem rejects are stripped.
 */
export function reportFileName(def, buildingName, fallbackLabel) {
  const building = [buildingName, fallbackLabel].find(v => v != null && String(v).trim() !== '')
  const parts = [building, def?.fileStem || 'Energy Assessment Report']
    .filter(v => v != null && String(v).trim() !== '')
    .map(v => String(v).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim())
  return `${parts.join(' - ')}.pdf`
}
