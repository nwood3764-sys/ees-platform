// ---------------------------------------------------------------------------
// submittedEnrollmentLayout — the Submitted Enrollment prints the record
// type's OWN page layout, not a list invented in code.
//
// Nicholas (2026-09-02), on the PDF for ENR-00063: "I don't know where this
// template came from, but these aren't things that are submitted, like the
// number of bedrooms... This is not from the enrollment form... I only want
// the fields that are actually submitted, which are the ones that are on the
// enrollment record. Per record type, they're different." And: "Whatever is on
// the page layout for that enrollment specifically needs to be captured,
// including whatever attachments or documents need to be included."
//
// He was right, and the numbers were stark. Against PL-00377
// (WI-IRA-MF-HOMES-Project-Reservation), the hardcoded 36-field list printed
// 27 fields that are NOT ON THAT LAYOUT AT ALL -- six bedroom counts, contact
// name/title/phone/email, owner type and address, HUD program, unit numbering
// scheme -- while roughly 45 fields that ARE on it never printed: the whole
// Primary Contractor block, the Support Contractor block, all of Payment
// Information, and Building Improvements including Modeled Savings, Requested
// Incentive Amount and Total Project Cost. One fixed list cannot be right for
// several record types, because each files a different form.
//
// So the layout IS the field list: same sections, same order, same labels the
// person filling it in saw. Add a field to the layout and the record of
// submission carries it; nothing to keep in sync, and the document cannot
// describe a form nobody filled in.
//
// WHAT IS DELIBERATELY NOT PRINTED:
//   system_audit fields   Created/Last Modified are the platform's own
//                         bookkeeping, not something submitted to a programme.
//                         The header already carries who generated the record
//                         and when.
//   the record's owner    an internal assignment; the programme never sees it.
//   status                internal, and the header already states it -- so
//                         printing it in the body would say it twice.
//   card widgets          related lists, galleries and conversation panels are
//                         not fields. The attached FILES are captured, by the
//                         document manifest, which is a separate section.
//
// Pure -- see scripts/submitted-enrollment-layout-fixture.mjs.
// ---------------------------------------------------------------------------

/** Layout field names never printed, whatever record type is being filed. */
export const NEVER_PRINTED_FIELDS = Object.freeze([
  'enrollment_owner',
  'enrollment_status',
])

/** Widget types that hold fields. Everything else on a layout is a card. */
const FIELD_WIDGET_TYPES = new Set(['field_group'])

function isPrintableField(field) {
  if (!field || !field.name) return false
  if (field.type === 'spacer' || field.type === 'blank') return false
  // Declared by the LAYOUT, never guessed from the column name -- the same
  // rule the record page uses to decide a field is platform bookkeeping.
  if (field.system_audit === true) return false
  if (NEVER_PRINTED_FIELDS.includes(field.name)) return false
  return true
}

/**
 * The label a field prints under: the layout's own label, because that is the
 * wording the person filling the form read. Falls back to the column name
 * humanised only when a layout carries no label at all.
 */
export function printedLabel(field) {
  const label = typeof field?.label === 'string' ? field.label.trim() : ''
  if (label) return label
  const name = String(field?.name || '')
  const bare = name.includes('.') ? name.split('.').pop() : name
  return bare
    .replace(/^enrollment_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim() || name
}

/**
 * Turn a page layout's sections into the groups the document prints.
 *
 * @param sections  layoutData.sections, exactly as loadRecordDetailData returns
 * @param readValue (field) => value already resolved for display, or null
 * @returns [{ heading, rows: [{ column, label, value }] }]
 *
 * A section every one of whose fields is empty is dropped -- a page of headings
 * over em dashes is not evidence of anything. A section with SOME values keeps
 * its empty rows, because "we submitted this blank" is itself a fact worth
 * recording.
 */
export function groupsFromLayout(sections, readValue) {
  const out = []
  for (const section of sections || []) {
    const rows = []
    for (const widget of section?.widgets || []) {
      if (!FIELD_WIDGET_TYPES.has(widget?.widget_type)) continue
      for (const field of widget?.config?.fields || widget?.widget_config?.fields || []) {
        if (!isPrintableField(field)) continue
        // A layout can legitimately carry the same column twice (dragged into
        // two sections); print it where it first appears and not again.
        if (rows.some(r => r.column === field.name)) continue
        rows.push({
          column: field.name,
          label: printedLabel(field),
          value: readValue ? readValue(field) : null,
        })
      }
    }
    if (!rows.length) continue
    if (!rows.some(r => r.value != null && r.value !== '')) continue
    out.push({ heading: section.section_label || section.label || 'Details', rows })
  }
  return out
}

/**
 * Does this record type print from its layout?
 *
 * Deliberately a LIST, and deliberately holding one entry. Nicholas: "Only do
 * this one right now. It's record type specific. Do not try to make changes on
 * all of them." Every other record type keeps the document it has today,
 * unchanged, until its own layout has been read and agreed the same way.
 */
export const LAYOUT_DRIVEN_RECORD_TYPES = Object.freeze([
  'WI-IRA-MF-HOMES-Project-Reservation',
])

export function printsFromLayout(recordTypeValue) {
  if (!recordTypeValue) return false
  return LAYOUT_DRIVEN_RECORD_TYPES.includes(String(recordTypeValue))
}
