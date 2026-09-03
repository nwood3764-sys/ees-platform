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
  // Jotform's native date control is three inputs and its own hint says
  // "2 digit month, 2 digit day, 4 digit year" — so the leading zero that
  // Formstack's day drops is exactly what this one needs. Two questions, two
  // transforms, rather than one that is wrong for one of them.
  if (part === 'month2') return m[2]
  if (part === 'day2')   return m[3]
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
    case 'date_month_2':    return datePart(value, 'month2')
    case 'date_day_2':      return datePart(value, 'day2')
    case 'date_year':       return datePart(value, 'year')
    case 'money_plain':     return toPlainMoney(value)
    default:              return value
  }
}

// One answer, resolved through the field's transform and option-value map.
// Returns null when there is nothing to send, so a blank never reaches the URL.
function resolveOne(raw, f) {
  if (raw === null || raw === undefined || raw === '') return null
  let v = applyTransform(raw, f.transform)
  if (v === null || v === undefined || v === '') return null
  // Option-value map (e.g. a radio whose stored value differs from the LEAP
  // label) is applied after the transform.
  const ovm = f.option_value_map
  if (ovm && typeof ovm === 'object' && Object.prototype.hasOwnProperty.call(ovm, v)) {
    v = ovm[v]
  }
  if (v === null || v === undefined || v === '') return null
  return String(v)
}

// Turn the resolved payload + field map into the array of {param, value} the
// query string is built from. Skips blanks so the form only receives real data.
//
// A CHECKBOX question is several answers to one parameter -- "What work will be
// completed?" is `whatWork346[]` and a project usually has more than one
// measure -- so an array value becomes one entry PER element, all under the
// same param. That is why the URL is built by appending rather than setting:
// setting would keep only the last measure and silently drop the rest, which
// reads on the form as a project doing one thing.
export function mapPayloadToParams(payload, fields) {
  const out = []
  for (const f of fields || []) {
    // A question the form will not take from the URL is kept OUT of the query
    // string, not sent and hoped for. See fieldsToEnterByHand below.
    if (f.url_prefillable === false) continue
    const raw = payload?.[f.leap_field]
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const v = resolveOne(item, f)
        if (v !== null) out.push({ param: f.param, value: v })
      }
      continue
    }
    const v = resolveOne(raw, f)
    if (v !== null) out.push({ param: f.param, value: v })
  }
  return out
}

// The answers LEAP holds that the form will not accept from a URL.
//
// Jotform renders some questions as a `control_widget` in its own iframe. The
// HEAR submittal's "Estimated project completion date" is one: the widget
// stamps its own default over anything the URL supplies, so the parameter is
// accepted and then overwritten -- which is worse than not sending it, because
// the box looks answered. Measured on the live form, not assumed.
//
// Dropping the value silently would send somebody back to the record to look it
// up. So it is resolved exactly as if it were being sent -- same transform, same
// option map -- and handed over to be entered once, with the value in hand.
//
// A field is only listed when it is BOTH un-prefillable and has a value; there
// is nothing to hand over otherwise, and a required blank is already the
// missing-fields gate's job.
export function fieldsToEnterByHand(payload, fields) {
  const out = []
  const seen = new Set()
  for (const f of fields || []) {
    if (f.url_prefillable !== false) continue
    const raw = payload?.[f.leap_field]
    const values = (Array.isArray(raw) ? raw : [raw])
      .map(v => resolveOne(v, f))
      .filter(v => v !== null)
    if (!values.length) continue
    const label = f.field_label || f.leap_field
    if (seen.has(label)) continue
    seen.add(label)
    out.push({ label, value: values.join(', ') })
  }
  return out
}

export function buildPrefillUrl(map, payload) {
  const params = mapPayloadToParams(payload, map?.fields)
  const qs = new URLSearchParams()
  for (const { param, value } of params) qs.append(param, value)
  const query = qs.toString()
  // Counted by QUESTION, not by answer: three ticked measures are one field
  // filled, and telling somebody "12 fields filled" when 10 of them are boxes
  // in one list overstates what the form received.
  const filledCount = new Set(params.map(p => p.param)).size
  return { url: query ? `${map.base_url}?${query}` : map.base_url, filledCount }
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
    // An empty array is a checkbox question nobody ticked -- blank, not answered.
    const blank = v === null || v === undefined
      || (Array.isArray(v) ? v.length === 0 : String(v).trim() === '')
    if (blank) {
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
