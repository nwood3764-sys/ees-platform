// ---------------------------------------------------------------------------
// enrollmentSubmissionReport — pure rules for the Enrollment Submission Record.
//
// An enrollment IS a submission to a program administrator: WI-IRA-MF-HOMES
// Assessment Preapproval, WI-IRA-MF-HOMES Project Reservation, NC-IRA-MF, and
// so on — one record type per packet EES files. What the enrollment has never
// had is a way to say, after the fact, exactly what went in: the figures that
// were claimed, the documents that were attached, and when.
//
// That is what this report is. It is NOT an assessment report — that one is
// the deliverable of a building walk, keyed by the assessment WORK ORDER's
// record type, and it prints captured field data and photographs. This one is
// a record of a filing, keyed by the ENROLLMENT's record type, and it prints
// the submitted values and a manifest of the attached files with a working
// download link for each. Separate purposes, separate document keys, separate
// section types, separate templates.
//
// Nicholas, 2026-08-27: "Probably good to have one PDF file that works
// similarly to our assessment report, so we can have it so we know exactly
// what was submitted. The downloadable links for documents and etc."
//
// Kept free of React and Supabase so every selection and labelling rule is
// testable — see scripts/enrollment-submission-report-fixture.mjs.
// ---------------------------------------------------------------------------

/** The submittal_document_templates kind every submission record uses. */
export const SUBMISSION_REPORT_KIND = 'enrollment_submission_report'

/**
 * The one document key this report renders under.
 *
 * Deliberately ONE key across all programs, unlike the assessment report's
 * key-per-record-type. There the shape genuinely differs — a whole multifamily
 * building is not walked like a single-family home. Here the shape is the same
 * filing every time; what differs between WI and NC is wording and which
 * documents are expected, and LEAP already carries that on the template axis
 * (a template scoped to the opportunity's record type overrides the global
 * default for the same key). Minting eight identical keys would fake a
 * difference that isn't there and leave eight templates to maintain in step.
 */
export const SUBMISSION_DOCUMENT_KEY = 'enrollment_submission_record'

// ---------------------------------------------------------------------------
// THE REGISTRY: enrollment record type → the submission it records.
//
// Every active enrollment record type is declared, because every enrollment is
// a submission — there is no enrollment for which "what was submitted" is a
// meaningless question. The registry earns its place by naming each packet the
// way the program does, so the PDF's title and the saved file say which filing
// this is rather than a generic "Enrollment Report".
// ---------------------------------------------------------------------------
export const SUBMISSION_REPORTS = Object.freeze({
  'WI-IRA-MF-HOMES-ASSESSMENT-PREAPPROVAL': {
    enrollmentRecordType: 'WI-IRA-MF-HOMES-Assessment-Preapproval',
    programLabel: 'WI IRA MF HOMES — Assessment Preapproval',
    title:    'Assessment Preapproval Submission Record',
    fileStem: 'Assessment Preapproval Submission Record',
  },
  'WI-IRA-MF-HOMES-PROJECT-RESERVATION': {
    enrollmentRecordType: 'WI-IRA-MF-HOMES-Project-Reservation',
    programLabel: 'WI IRA MF HOMES — Project Reservation',
    title:    'Project Reservation Submission Record',
    fileStem: 'Project Reservation Submission Record',
  },
  'WI-IRA-MF': {
    enrollmentRecordType: 'WI-IRA-MF',
    programLabel: 'WI IRA Multifamily',
    title:    'Wisconsin IRA Multifamily Submission Record',
    fileStem: 'WI IRA MF Submission Record',
  },
  'WI-IRA-SF': {
    enrollmentRecordType: 'WI-IRA-SF',
    programLabel: 'WI IRA Single-Family',
    title:    'Wisconsin IRA Single-Family Submission Record',
    fileStem: 'WI IRA SF Submission Record',
  },
  'NC-IRA-MF': {
    enrollmentRecordType: 'NC-IRA-MF',
    programLabel: 'NC IRA Multifamily',
    title:    'North Carolina IRA Multifamily Submission Record',
    fileStem: 'NC IRA MF Submission Record',
  },
  'NC-IRA-SF': {
    enrollmentRecordType: 'NC-IRA-SF',
    programLabel: 'NC IRA Single-Family',
    title:    'North Carolina IRA Single-Family Submission Record',
    fileStem: 'NC IRA SF Submission Record',
  },
  'MI-IRA-MF': {
    enrollmentRecordType: 'MI-IRA-MF',
    programLabel: 'MI IRA Multifamily',
    title:    'Michigan IRA Multifamily Submission Record',
    fileStem: 'MI IRA MF Submission Record',
  },
  'MI-IRA-SF': {
    enrollmentRecordType: 'MI-IRA-SF',
    programLabel: 'MI IRA Single-Family',
    title:    'Michigan IRA Single-Family Submission Record',
    fileStem: 'MI IRA SF Submission Record',
  },
})

/**
 * The submission definition for an enrollment record type.
 *
 * An UNREGISTERED record type still gets a report — it falls back to a
 * definition built from the record type's own label. A new program added in
 * Setup is a filing like any other, and refusing to record what was submitted
 * because nobody edited this file would be the registry serving itself. The
 * registry's job is to name the known packets well, not to gate them.
 */
export function submissionReportFor(recordTypeValue, recordTypeLabel = null) {
  const key = String(recordTypeValue ?? '').trim().toUpperCase()
  if (key && SUBMISSION_REPORTS[key]) return SUBMISSION_REPORTS[key]
  const name = String(recordTypeLabel || recordTypeValue || '').trim()
  if (!name) {
    return {
      enrollmentRecordType: null,
      programLabel: null,
      title:    'Enrollment Submission Record',
      fileStem: 'Enrollment Submission Record',
    }
  }
  return {
    enrollmentRecordType: recordTypeValue || null,
    programLabel: name,
    title:    `${name} Submission Record`,
    fileStem: `${name} Submission Record`,
  }
}

/**
 * Every enrollment can produce this report — it is a record of a filing, and
 * an enrollment is always a filing. Exported as a named rule (rather than the
 * action hardcoding `true`) so the day a record type genuinely should not
 * offer one, there is a single place that says so.
 */
export function hasSubmissionReport(tableName) {
  return tableName === 'enrollments'
}

// ---------------------------------------------------------------------------
// What was submitted — the summary rows.
// ---------------------------------------------------------------------------

/**
 * The enrollment fields the record prints, in groups, in filing order.
 *
 * Declared HERE rather than read off whichever columns happen to be populated,
 * for the same reason the assessment report drives its sections off the work
 * step template: a figure that was left blank has to print as a blank. "We
 * submitted no unit count" and "this report forgot to mention the unit count"
 * must not look identical to whoever reads this a year from now.
 */
export const SUBMISSION_FIELD_GROUPS = Object.freeze([
  { heading: 'Applicant', fields: [
    ['enrollment_contact_name',   'Contact Name'],
    ['enrollment_contact_title',  'Contact Title'],
    ['enrollment_contact_phone',  'Contact Phone'],
    ['enrollment_contact_email',  'Contact Email'],
    ['enrollment_owner_type',     'Owner Type'],
    ['enrollment_owner_address',  'Owner Address'],
    ['enrollment_payee',          'Payee'],
    ['enrollment_tax_classification', 'Tax Classification'],
  ] },
  { heading: 'Property and Units', fields: [
    ['enrollment_property_type',        'Property Type'],
    ['enrollment_building_type',        'Building Type'],
    ['enrollment_number_of_buildings',  'Number of Buildings'],
    ['enrollment_units_per_building',   'Units per Building'],
    ['enrollment_occupied_units',       'Occupied Units'],
    ['enrollment_unoccupied_units',     'Unoccupied Units'],
    ['enrollment_unit_numbering_scheme','Unit Numbering Scheme'],
    ['enrollment_hud_program',          'HUD Program'],
  ] },
  { heading: 'Bedroom Mix', fields: [
    ['enrollment_br_studio', 'Studio'],
    ['enrollment_br_1',      '1 Bedroom'],
    ['enrollment_br_2',      '2 Bedroom'],
    ['enrollment_br_3',      '3 Bedroom'],
    ['enrollment_br_4',      '4 Bedroom'],
    ['enrollment_br_5plus',  '5+ Bedroom'],
  ] },
  { heading: 'Income Qualification', fields: [
    ['enrollment_qualifying_mode',            'Qualifying Mode'],
    ['enrollment_eligibility_pathways',       'Eligibility Pathways'],
    ['enrollment_categorical_eligibility',    'Categorical Eligibility'],
    ['enrollment_required_proof',             'Required Proof'],
    ['enrollment_fifty_pct_lmi_declaration',  '50% LMI Declaration'],
    ['enrollment_subsidized_share_pct',       'Subsidized Share (%)'],
    ['enrollment_income_level',               'Income Level'],
    ['enrollment_determination_date',         'Determination Date'],
  ] },
  { heading: 'Scope and Modeling', fields: [
    ['enrollment_application_for',        'Application For'],
    ['enrollment_work_measures',          'Work Measures'],
    ['enrollment_heating_type',           'Heating Type'],
    ['enrollment_building_project_type',  'Building Project Type'],
    ['enrollment_modeling_approach',      'Modeling Approach'],
    ['enrollment_modeling_software',      'Modeling Software'],
    ['enrollment_modeled_savings',        'Modeled Savings'],
  ] },
  { heading: 'Costs and Dates', fields: [
    ['enrollment_total_project_cost',        'Total Project Cost'],
    ['enrollment_total_ira_homes_cost',      'Total IRA HOMES Cost'],
    ['enrollment_requested_incentive_amount','Requested Incentive Amount'],
    ['enrollment_estimated_assessment_date', 'Estimated Assessment Date'],
    ['enrollment_estimated_completion_date', 'Estimated Completion Date'],
  ] },
])

/** Columns rendered as currency when they carry a number. */
const CURRENCY_FIELDS = new Set([
  'enrollment_total_project_cost',
  'enrollment_total_ira_homes_cost',
  'enrollment_requested_incentive_amount',
])

/** Columns that hold a date, printed the way the rest of the record reads. */
const DATE_FIELDS = new Set([
  'enrollment_determination_date',
  'enrollment_estimated_assessment_date',
  'enrollment_estimated_completion_date',
])

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

/**
 * A stored date as a person reads it.
 *
 * Formatted from the STRING PARTS, never via `new Date('2026-08-18')`: that
 * parses as UTC midnight, so in any negative-offset timezone — which is every
 * state EES works in — it renders as the day before. A record of what was
 * filed cannot afford to move a submission date by a day.
 */
function formatSubmittedDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim())
  if (!m) return null
  const [, y, mo, d] = m
  const month = MONTHS[Number(mo) - 1]
  if (!month) return null
  return `${month} ${Number(d)}, ${y}`
}

/**
 * One field's printable value, or null when it was not filled in.
 *
 * Zero is an answer, not a blank — `0 unoccupied units` is a fact somebody
 * submitted, and printing an em dash there would misreport the filing.
 */
export function submissionFieldValue(record, column, labels = null) {
  if (!record) return null
  const raw = record[column]
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No'
  if (Array.isArray(raw)) {
    const items = raw.map(v => resolveLabel(v, labels)).filter(v => v != null && String(v).trim() !== '')
    return items.length ? items.join(', ') : null
  }
  if (typeof raw === 'number') {
    return CURRENCY_FIELDS.has(column)
      ? raw.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
      : raw.toLocaleString('en-US', { maximumFractionDigits: 4 })
  }
  const s = String(raw).trim()
  if (s === '') return null
  if (DATE_FIELDS.has(column)) return formatSubmittedDate(s) || s
  // A uuid in a submitted field is a picklist or lookup id; print what it
  // MEANS or drop it. A record id on the page tells the reader nothing and
  // looks like a defect (the same rule the assessment report's building
  // summary follows).
  if (UUID_RE.test(s)) {
    const label = resolveLabel(s, labels)
    return label && !UUID_RE.test(String(label)) ? String(label) : null
  }
  const num = Number(s)
  if (CURRENCY_FIELDS.has(column) && s !== '' && isFinite(num)) {
    return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
  }
  return s
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function resolveLabel(value, labels) {
  if (value == null) return null
  const key = String(value)
  if (labels && typeof labels.get === 'function' && labels.get(key) != null) return labels.get(key)
  if (labels && !(labels instanceof Map) && Object.prototype.hasOwnProperty.call(labels, key)) return labels[key]
  return value
}

/**
 * The summary groups for one enrollment: every declared field, in order, each
 * carrying its value or null.
 *
 * A group in which nothing at all was filled in is dropped — a page of nothing
 * but em dashes under "Bedroom Mix" is filler, and the enrollment record types
 * genuinely do not all use the same fields. A group with even one answer keeps
 * all of its rows, so the unanswered ones stay visible next to the answered.
 */
export function buildSubmissionSummary(record, labels = null, groups = SUBMISSION_FIELD_GROUPS) {
  const out = []
  for (const group of groups || []) {
    const rows = (group.fields || []).map(([column, label]) => ({
      column, label, value: submissionFieldValue(record, column, labels),
    }))
    if (!rows.some(r => r.value != null)) continue
    out.push({ heading: group.heading, rows })
  }
  return out
}

// ---------------------------------------------------------------------------
// The document manifest.
// ---------------------------------------------------------------------------

/** Human label for a document_type slug ('audit_template_report' → 'Audit Template Report'). */
export function documentTypeLabel(type) {
  const s = String(type ?? '').trim()
  if (!s) return 'Document'
  if (s === 'attachment') return 'Attachment'
  return s.split(/[_\s]+/).filter(Boolean)
    .map(w => (/^(hpxml|pdf|hud|ira|lmi|qi)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

/** A file size in units a person reads. Returns null for an unknown size. */
export function formatFileSize(bytes) {
  const n = Number(bytes)
  if (!isFinite(n) || n <= 0) return null
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The filename a reader gets when they follow a link out of the PDF.
 *
 * Storage keys are uuids, so without this a saved attachment lands in their
 * downloads as "1d655a50-….pdf" and tells them nothing about which filing it
 * belonged to.
 */
export function documentDownloadName(doc, enrollmentNumber) {
  const base = String(doc?.name || doc?.fileName || 'document').replace(/[\\/:*?"<>|]+/g, '-').trim()
  const stem = base.replace(/\.[A-Za-z0-9]{1,8}$/, '')
  const ext = (base.match(/\.[A-Za-z0-9]{1,8}$/) || [''])[0]
  const prefix = enrollmentNumber ? `${enrollmentNumber} - ` : ''
  return `${prefix}${stem}${ext}`
}

/**
 * Order the manifest: flagged documents first (they are the submission), then
 * the rest, each block by document type then by upload date.
 *
 * `flaggedOnly` narrows to the flagged set — the mode a finished filing uses,
 * where the "Include in report" flag on the Documents card IS the statement of
 * what was sent. With nothing flagged it returns everything rather than an
 * empty manifest, because a report that silently omits every attachment is
 * worse than one that lists a few extras, and the modal says which mode it is
 * in before you generate.
 */
export function buildDocumentManifest(documents, { flaggedOnly = false } = {}) {
  const live = (documents || []).filter(d => d && d.is_deleted !== true)
  const flagged = live.filter(d => d.include_in_final_report === true)
  const pool = (flaggedOnly && flagged.length) ? flagged : live
  const rank = d => (d.include_in_final_report === true ? 0 : 1)
  return pool.slice().sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    const ta = String(a.document_type || ''), tb = String(b.document_type || '')
    if (ta !== tb) return ta.localeCompare(tb)
    return String(a.created_at || '').localeCompare(String(b.created_at || ''))
  }).map(d => ({
    id: d.id,
    name: d.name || d.file_name || 'Untitled',
    typeLabel: documentTypeLabel(d.document_type),
    // documents.file_size_bytes is the real column — LEAP's own name, checked
    // against information_schema rather than assumed. The fallbacks cover
    // callers that pass an already-shaped row.
    size: formatFileSize(d.file_size_bytes ?? d.file_size ?? d.size),
    inSubmission: d.include_in_final_report === true,
    uploadedAt: d.created_at || null,
    uploadedBy: d.uploaded_by_name || null,
    _row: d,
  }))
}

/** The saved file's name: the filing, then the record it belongs to. */
export function submissionFileName(def, enrollmentNumber, propertyLabel) {
  const parts = [def?.fileStem || 'Enrollment Submission Record']
  if (enrollmentNumber) parts.push(String(enrollmentNumber))
  else if (propertyLabel) parts.push(String(propertyLabel))
  return `${parts.join(' - ').replace(/[\\/:*?"<>|]+/g, '-')}.pdf`
}
