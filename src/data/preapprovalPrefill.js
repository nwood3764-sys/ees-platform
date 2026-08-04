// preapprovalPrefill.js
//
// Opens an external program application form (Focus On Energy, hosted on
// Formstack) pre-filled from a LEAP record, so the user only reviews and
// submits. Nothing about the target form is hardcoded here: the target URL and
// the per-field wiring live in the database (external_form_targets /
// external_form_field_map, read via get_external_form_map), and the record's
// resolved values come from a purpose-built RPC. This file only:
//   1. loads the resolved record values + the field map,
//   2. applies the small value transforms the map asks for, and
//   3. assembles the prefill query string and opens it.
//
// Formstack fills a hosted form from its URL query string: `?field<ID>=Value`
// (address fields use `field<ID>-address/-city/-state/-zip`; radios take their
// stored option value). See the seed in
// supabase/migrations/20260803194426_external_form_prefill_wi_ira_assessment_preapproval.sql.

import { supabase } from '../lib/supabase'

// The one target key wired today — the WI IRA HOMES multifamily assessment
// pre-approval. A second program is another external_form_targets row + key.
export const WI_IRA_ASSESSMENT_PREAPPROVAL_KEY = 'wi_ira_mf_homes_assessment_preapproval'

// US state name -> USPS abbreviation (plus DC + territories the form lists).
// Used by the `state_2letter` transform: account billing_state is stored as a
// full name ("Wisconsin") but the form's state dropdown stores "WI".
const STATE_ABBR = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', guam: 'GU', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME',
  maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'puerto rico': 'PR', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', 'virgin islands (us)': 'VI',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
}

function toStateAbbr(value) {
  const s = String(value).trim()
  if (s.length === 2) return s.toUpperCase()   // already an abbreviation
  return STATE_ABBR[s.toLowerCase()] || s
}

function toMmddyyyy(value) {
  // Accepts 'YYYY-MM-DD' (what the RPC emits) -> 'MM/DD/YYYY'.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value))
  if (!m) return String(value)
  return `${m[2]}/${m[3]}/${m[1]}`
}

// Apply a field-map transform. Pure; unknown transforms pass through unchanged.
export function applyTransform(value, transform) {
  switch (transform) {
    case 'bool_yes_no':   return value === true || value === 'true' ? 'Yes' : 'No'
    case 'state_2letter': return toStateAbbr(value)
    case 'date_mmddyyyy': return toMmddyyyy(value)
    default:              return value
  }
}

// Turn the resolved payload + field map into the array of {param, value} the
// query string is built from. Skips blanks so the form only receives real data.
export function mapPayloadToParams(payload, fields) {
  const out = []
  for (const f of fields || []) {
    let v = payload?.[f.leap_field]
    if (v === null || v === undefined || v === '') continue
    v = applyTransform(v, f.transform)
    if (v === null || v === undefined || v === '') continue
    // Option-value map (e.g. a radio whose stored value differs from the LEAP
    // label) is applied after the transform.
    const ovm = f.option_value_map
    if (ovm && typeof ovm === 'object' && Object.prototype.hasOwnProperty.call(ovm, v)) {
      v = ovm[v]
    }
    out.push({ param: f.param, value: String(v) })
  }
  return out
}

export function buildPrefillUrl(map, payload) {
  const params = mapPayloadToParams(payload, map?.fields)
  const qs = new URLSearchParams()
  for (const { param, value } of params) qs.set(param, value)
  const query = qs.toString()
  return { url: query ? `${map.base_url}?${query}` : map.base_url, filledCount: params.length }
}

// Which required form fields are still blank in the resolved payload. The
// payload is built from the enrollment AND its inherited parent records
// (account / property / building) by build_wi_ira_assessment_prefill, so a
// blank here means the data is genuinely missing upstream, not just unmapped.
// `required` and `field_label` are per-field flags stored on the field map
// (external_form_field_map), so which fields are mandatory is admin-editable,
// never hardcoded. Returns an array of human-readable field labels.
export function findMissingRequiredFields(payload, fields) {
  const out = []
  for (const f of fields || []) {
    if (!f.required) continue
    const v = payload?.[f.leap_field]
    if (v === null || v === undefined || String(v).trim() === '') {
      out.push(f.field_label || f.leap_field)
    }
  }
  return out
}

// Load the resolved record values + the field map for a target.
export async function loadAssessmentPrefill(enrollmentId, targetKey = WI_IRA_ASSESSMENT_PREAPPROVAL_KEY) {
  const [{ data: payload, error: pErr }, { data: map, error: mErr }] = await Promise.all([
    supabase.rpc('build_wi_ira_assessment_prefill', { p_enrollment_id: enrollmentId }),
    supabase.rpc('get_external_form_map', { p_key: targetKey }),
  ])
  if (pErr) throw pErr
  if (mErr) throw mErr
  return { payload: payload || {}, map: map || {} }
}

// Orchestrate the open. Pass a pre-opened window handle (opened synchronously in
// the click handler) so popup blockers don't fire; the async work then redirects
// it. Returns { url, filledCount } on success or { error } on failure.
export async function openAssessmentPreapprovalForm(enrollmentId, targetWindow) {
  try {
    if (!enrollmentId) return { error: 'No record selected.' }
    const { payload, map } = await loadAssessmentPrefill(enrollmentId)
    if (!map || !map.base_url) return { error: 'This program has no pre-approval form configured.' }
    // Completeness gate: every required field (resolved from the enrollment and
    // its parent records) must be populated before the form can be submitted.
    // If any are blank, don't open the form — return the list so the caller can
    // ask the user to complete them first.
    const missing = findMissingRequiredFields(payload, map.fields)
    if (missing.length) return { missing }
    const { url, filledCount } = buildPrefillUrl(map, payload)
    if (targetWindow) targetWindow.location = url
    else window.open(url, '_blank', 'noopener')
    return { url, filledCount }
  } catch (e) {
    console.warn('open pre-approval form failed', e)
    return { error: e?.message || 'Could not build the pre-approval form.' }
  }
}
