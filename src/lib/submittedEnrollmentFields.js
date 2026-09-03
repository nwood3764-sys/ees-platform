// ---------------------------------------------------------------------------
// submittedEnrollmentFields — a Submitted Enrollment records EXACTLY what was
// pushed to the Jotform. Nothing else.
//
// Nicholas, 2026-09-02, after two wrong answers from me: "we only want to
// capture what was pushed to the jot form. What don't you understand?"
//
// Two sources were tried and both were wrong, for the same underlying reason --
// they described the RECORD rather than the SUBMISSION:
//
//   1. A hardcoded 36-field list. Against the real Project Reservation it
//      printed 27 fields that are on no layout and no form (six bedroom counts,
//      HUD program, unit numbering scheme) and omitted the contractor, support
//      contractor and payment blocks entirely.
//   2. The record type's PAGE LAYOUT. Closer, but a layout carries LEAP's own
//      bookkeeping -- Record Type, Owner, Status, the parent lookups -- none of
//      which is sent to Focus on Energy. Nicholas, on seeing Record Type on the
//      PDF: "We don't submit that in a jot form."
//
// The submission is not a view of the record. It is a specific set of
// parameters sent to a specific form, and LEAP already holds it exactly:
// external_form_field_map is the list, and build_external_form_prefill is the
// payload. The same two the button uses to build the URL.
//
// So the document is built from those, THROUGH mapPayloadToParams -- the very
// function that builds the query string. The document and the form therefore
// cannot disagree: same fields, same order, same transforms (a state sent as
// "WI" is recorded as "WI"), and a field that was blank and therefore never
// sent does not appear, because it was not submitted.
//
// SCOPED TO ONE RECORD TYPE, by explicit instruction: "Only do this one right
// now. It's record type specific. Do not try to make changes on all of them."
// Every other record type keeps the document it has today, untouched.
//
// Pure -- see scripts/submitted-enrollment-fields-fixture.mjs.
// ---------------------------------------------------------------------------

import { mapPayloadToParams } from './externalFormPrefill.js'

/**
 * Record type → the external form target whose submission it records.
 *
 * Deliberately a map holding ONE entry. A record type absent from it keeps the
 * document it had before, so adding a programme is a considered act, not a
 * side effect of adding a form.
 */
export const SUBMITTED_FORM_TARGET_BY_RECORD_TYPE = Object.freeze({
  'WI-IRA-MF-HOMES-Project-Reservation': 'wi_ira_mf_homes_project_reservation',
})

export function formTargetForRecordType(recordTypeValue) {
  if (!recordTypeValue) return null
  return SUBMITTED_FORM_TARGET_BY_RECORD_TYPE[String(recordTypeValue)] || null
}

/**
 * The rows a Submitted Enrollment prints: one per parameter actually sent.
 *
 * @param map     get_external_form_map output — { name, fields: [{ leap_field,
 *                param, field_label, transform, required }] }
 * @param payload build_external_form_prefill output
 * @returns [{ heading, rows: [{ column, label, value }] }] — one section, or
 *          none at all when nothing was sent.
 *
 * Values come from mapPayloadToParams, so what is recorded is the string that
 * went into the query string, not the raw column. A blank is absent rather than
 * shown as an em dash: it was never pushed, so it is not part of what was
 * submitted.
 */
export function groupsFromFormSubmission(map, payload) {
  const fields = map?.fields || []
  if (!fields.length) return []

  // param → every value actually sent. mapPayloadToParams applies each field's
  // transform and drops blanks, exactly as the URL builder does. A checkbox
  // question sends several values under one param, and all of them are the
  // record of what was submitted -- printing only the first would understate
  // the scope of work on the very document kept as evidence of it.
  const sent = new Map()
  for (const { param, value } of mapPayloadToParams(payload || {}, fields)) {
    if (!sent.has(param)) sent.set(param, [])
    sent.get(param).push(value)
  }

  const rows = []
  for (const f of fields) {
    if (!sent.has(f.param)) continue
    rows.push({
      column: f.leap_field,
      label: f.field_label || f.leap_field,
      value: sent.get(f.param).join(', '),
    })
  }
  if (!rows.length) return []
  return [{ heading: map?.name || 'Submitted to the program', rows }]
}

/**
 * The fields the form expects but that were NOT sent, so the record of a
 * submission can say what went in blank rather than quietly omitting it.
 * Required-but-missing is the case worth naming: it means the form was opened
 * incomplete.
 */
export function fieldsNotSubmitted(map, payload) {
  const fields = map?.fields || []
  if (!fields.length) return []
  const sent = new Set(mapPayloadToParams(payload || {}, fields).map(p => p.param))
  return fields
    .filter(f => !sent.has(f.param))
    .map(f => ({ column: f.leap_field, label: f.field_label || f.leap_field, required: !!f.required }))
}
