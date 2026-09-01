// externalFormPrefill.js
//
// The pure rules for turning a LEAP record's resolved values into a Formstack
// prefill URL. No network, no supabase — so every transform and every
// "would this field be reported missing?" decision is testable on its own
// (scripts/external-form-prefill-fixture.mjs).
//
// Formstack fills a hosted form from its URL query string: `?field<ID>=Value`
// (address fields use `field<ID>-address/-address2/-city/-state/-zip`; a date is
// three parameters `<ID>M`/`<ID>D`/`<ID>Y` with the month as a three-letter
// NAME; radios take their option value verbatim). Which parameter maps to which
// LEAP value lives in the database (external_form_targets /
// external_form_field_map) — nothing about a form is hardcoded here.

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

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// The assessment application's date is three separate parameters — <id>M, <id>D
// and <id>Y — and the month is the three-letter NAME ('Jun'), not a number.
// That is how the form's own hidden inputs carry it, so each part is its own
// map row against the same LEAP date, with its own transform.
function datePart(value, part) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value))
  if (!m) return ''
  if (part === 'month') return MONTH_ABBR[Number(m[2]) - 1] || ''
  if (part === 'day')   return String(Number(m[3]))
  return m[1]
}

// A currency field wants a bare number: no $, no thousands separators, and no
// trailing ".00" (2000.00 -> 2000). Anything that is not a number is passed
// through untouched rather than mangled into one.
function toPlainMoney(value) {
  const s = String(value).replace(/[$,\s]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return String(value)
  return s.replace(/\.0+$/, '')
}

// Apply a field-map transform. Pure; unknown transforms pass through unchanged.
export function applyTransform(value, transform) {
  switch (transform) {
    case 'bool_yes_no':   return value === true || value === 'true' ? 'Yes' : 'No'
    case 'state_2letter': return toStateAbbr(value)
    case 'date_mmddyyyy': return toMmddyyyy(value)
    case 'date_month_abbr': return datePart(value, 'month')
    case 'date_day':        return datePart(value, 'day')
    case 'date_year':       return datePart(value, 'year')
    case 'money_plain':     return toPlainMoney(value)
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
  const seen = new Set()
  for (const f of fields || []) {
    if (!f.required) continue
    const v = payload?.[f.leap_field]
    if (v === null || v === undefined || String(v).trim() === '') {
      // One form field can be several parameters — a date is <id>M/<id>D/<id>Y,
      // an address is five — and they share one label. List it once; the user is
      // being told which QUESTION to answer, not which parameter is empty.
      const label = f.field_label || f.leap_field
      if (seen.has(label)) continue
      seen.add(label)
      out.push(label)
    }
  }
  return out
}
