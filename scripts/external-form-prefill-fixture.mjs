// Pure-rule checks for the Formstack prefill URL builder.
//
// The interesting cases are the ones a reader cannot verify by eye: the
// assessment application's date is THREE parameters with a three-letter month
// name, its currency fields must lose the trailing ".00", and a required field
// that is blank has to be reported rather than quietly dropped — that report is
// what stops a half-filled application being opened.
//
// The payload and the field map below are the REAL ones for IA-00042
// (779 Maple Avenue - Columbus), taken from
// build_external_form_prefill('wi_ira_mf_homes_assessment_application', …) and
// get_external_form_map on prod.

import {
  applyTransform, mapPayloadToParams, buildPrefillUrl, findMissingRequiredFields,
} from '../src/lib/externalFormPrefill.js'

let pass = 0, fail = 0
const eq = (label, actual, expected) => {
  if (actual === expected) { pass += 1; return }
  fail += 1
  console.error(`  FAIL ${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
}

// ── transforms ────────────────────────────────────────────────────────────
eq('month is the 3-letter name', applyTransform('2026-06-10', 'date_month_abbr'), 'Jun')
eq('day drops the leading zero',  applyTransform('2026-06-05', 'date_day'), '5')
eq('day keeps two digits',        applyTransform('2026-06-10', 'date_day'), '10')
eq('year',                        applyTransform('2026-06-10', 'date_year'), '2026')
eq('January is not month 0',      applyTransform('2026-01-31', 'date_month_abbr'), 'Jan')
eq('December is in range',        applyTransform('2026-12-01', 'date_month_abbr'), 'Dec')
eq('a non-date yields nothing rather than junk', applyTransform('not a date', 'date_month_abbr'), '')

eq('money loses the trailing .00', applyTransform('2000.00', 'money_plain'), '2000')
eq('money from a number',          applyTransform(2000, 'money_plain'), '2000')
eq('money keeps real cents',       applyTransform('1999.50', 'money_plain'), '1999.50')
eq('money strips $ and commas',    applyTransform('$2,000.00', 'money_plain'), '2000')
eq('money passes text through',    applyTransform('see invoice', 'money_plain'), 'see invoice')

eq('state name to abbreviation',   applyTransform('Wisconsin', 'state_2letter'), 'WI')
eq('an abbreviation is left alone', applyTransform('WI', 'state_2letter'), 'WI')
eq('boolean false is No, not blank', applyTransform(false, 'bool_yes_no'), 'No')
eq('boolean true is Yes',            applyTransform(true, 'bool_yes_no'), 'Yes')

// ── the real map + payload ────────────────────────────────────────────────
const FIELDS = [
  { param: 'field193332678',         leap_field: 'building_modeled_as',            transform: null,              required: true,  field_label: 'How was the building modeled?' },
  { param: 'field193332679',         leap_field: 'multiple_properties_same_owner', transform: 'bool_yes_no',     required: true,  field_label: 'Requesting incentives for more than one property or unit owned by the same person or entity?' },
  { param: 'field193332694',         leap_field: 'property_owner_name',            transform: null,              required: true,  field_label: 'Property Owner Name' },
  { param: 'field193332695',         leap_field: 'building_name',                  transform: null,              required: false, field_label: 'Building name' },
  { param: 'field193332696-address', leap_field: 'assessment_address_line1',       transform: null,              required: true,  field_label: 'Assessment Address - street' },
  { param: 'field193332696-address2',leap_field: 'assessment_address_line2',       transform: null,              required: false, field_label: 'Assessment Address - line 2' },
  { param: 'field193332696-city',    leap_field: 'assessment_city',                transform: null,              required: true,  field_label: 'Assessment Address - city' },
  { param: 'field193332696-state',   leap_field: 'assessment_state',               transform: 'state_2letter',   required: true,  field_label: 'Assessment Address - state' },
  { param: 'field193332696-zip',     leap_field: 'assessment_zip',                 transform: null,              required: true,  field_label: 'Assessment Address - ZIP' },
  { param: 'field193332697',         leap_field: 'units_per_building',             transform: null,              required: true,  field_label: 'How many units are in the building?' },
  { param: 'field193332698',         leap_field: 'modeling_software_used',         transform: null,              required: true,  field_label: 'What modeling software was used?' },
  { param: 'field193332699',         leap_field: 'ira_income_code',                transform: null,              required: true,  field_label: 'IRA Income Code' },
  { param: 'field193332700M',        leap_field: 'assessment_date',                transform: 'date_month_abbr', required: true,  field_label: 'Assessment Date' },
  { param: 'field193332700D',        leap_field: 'assessment_date',                transform: 'date_day',        required: true,  field_label: 'Assessment Date' },
  { param: 'field193332700Y',        leap_field: 'assessment_date',                transform: 'date_year',       required: true,  field_label: 'Assessment Date' },
  { param: 'field193332701',         leap_field: 'assessment_cost',                transform: 'money_plain',     required: true,  field_label: 'Assessment Cost' },
  { param: 'field193332702',         leap_field: 'requested_incentive_amount',     transform: 'money_plain',     required: true,  field_label: 'Requested Incentive Amount' },
  { param: 'field197209537',         leap_field: 'building_improvements',          transform: null,              required: true,  field_label: 'Building Improvements' },
  { param: 'field193332714',         leap_field: 'contractor_business_name',       transform: null,              required: true,  field_label: 'Registered Contractor - Business Name' },
  { param: 'field193332716-address', leap_field: 'contractor_office_street',       transform: null,              required: true,  field_label: 'Office Address - street' },
  { param: 'field193332716-city',    leap_field: 'contractor_office_city',         transform: null,              required: true,  field_label: 'Office Address - city' },
  { param: 'field193332716-state',   leap_field: 'contractor_office_state',        transform: 'state_2letter',   required: true,  field_label: 'Office Address - state' },
  { param: 'field193332716-zip',     leap_field: 'contractor_office_zip',          transform: null,              required: true,  field_label: 'Office Address - ZIP' },
  { param: 'field193332717-address', leap_field: 'payment_street',                 transform: null,              required: true,  field_label: 'Payment Address - street' },
  { param: 'field193332717-address2',leap_field: 'payment_line2',                  transform: null,              required: false, field_label: 'Payment Address - line 2' },
  { param: 'field193332717-city',    leap_field: 'payment_city',                   transform: null,              required: true,  field_label: 'Payment Address - city' },
  { param: 'field193332717-state',   leap_field: 'payment_state',                  transform: 'state_2letter',   required: true,  field_label: 'Payment Address - state' },
  { param: 'field193332717-zip',     leap_field: 'payment_zip',                    transform: null,              required: true,  field_label: 'Payment Address - ZIP' },
  { param: 'field193332718',         leap_field: 'contractor_phone',               transform: null,              required: false, field_label: 'Phone' },
  { param: 'field193332719',         leap_field: 'contractor_email',               transform: null,              required: true,  field_label: 'Email' },
  { param: 'field193332721',         leap_field: 'moving_forward_with_homes',      transform: null,              required: false, field_label: 'Will the customer be moving forward with a HOMES project?' },
  { param: 'field193332722',         leap_field: 'additional_comments',            transform: null,              required: false, field_label: 'Additional Comments' },
]
const MAP = { base_url: 'https://focusonenergy.formstack.com/forms/ira_assessment_app', fields: FIELDS }

// Exactly what the resolver returned for IA-00042 on prod.
const IA_00042 = {
  building_modeled_as: 'Multifamily',
  property_owner_name: 'Lutheran Social Services of Wisconsin and Upper Michigan, Inc.',
  building_name: '779 Maple Avenue - Columbus - 779',
  assessment_address_line1: '779 Maple Avenue',
  assessment_city: 'Columbus', assessment_state: 'WI', assessment_zip: '53925',
  units_per_building: 25,
  modeling_software_used: 'DOE-2-based software',
  ira_income_code: 'LEA-0000420945',
  assessment_date: '2026-06-10',
  assessment_cost: 2000.00,
  requested_incentive_amount: 2000.00,
  building_improvements: 'Multi-Family Building Central Equipment Common Area',
  contractor_business_name: 'Energy Efficiency Services of Wisconsin',
  contractor_office_street: '112 Owen Rd. PO Box 6141',
  contractor_office_city: 'Monona', contractor_office_state: 'Wisconsin', contractor_office_zip: '53716',
  payment_street: '112 Owen Rd. PO Box 6141',
  payment_city: 'Monona', payment_state: 'Wisconsin', payment_zip: '53716',
  contractor_phone: '5152978316', contractor_email: 'ira@EES-WI.org',
}

// A required answer that is genuinely absent must be reported, and it must be
// the ONLY thing reported — anything else would be a false alarm that stops the
// assessor opening a form they could have submitted. (On a real record this
// particular one is now derived: an application is always one building, so
// trg_3_ia_single_building_answer answers it No. The check stays because the
// REPORTING rule is what is under test, not this record's state.)
eq('a genuinely blank required answer is the only thing reported',
  JSON.stringify(findMissingRequiredFields(IA_00042, FIELDS)),
  JSON.stringify(['Requesting incentives for more than one property or unit owned by the same person or entity?']))

const answered = { ...IA_00042, multiple_properties_same_owner: false }
eq('nothing outstanding once it is answered',
  findMissingRequiredFields(answered, FIELDS).length, 0)

const params = Object.fromEntries(mapPayloadToParams(answered, FIELDS).map(p => [p.param, p.value]))
eq('the date splits into three parameters', `${params['field193332700M']}/${params['field193332700D']}/${params['field193332700Y']}`, 'Jun/10/2026')
eq('assessment cost is a bare number', params['field193332701'], '2000')
eq('requested incentive is a bare number', params['field193332702'], '2000')
eq('the building state is already an abbreviation', params['field193332696-state'], 'WI')
eq('the office state is abbreviated', params['field193332716-state'], 'WI')
eq('the payment state is abbreviated', params['field193332717-state'], 'WI')
eq('answering No sends No', params['field193332679'], 'No')
eq('the modelled-as radio matches the form option', params['field193332678'], 'Multifamily')
eq('the software radio matches the form option', params['field193332698'], 'DOE-2-based software')
eq('units come across', params['field193332697'], '25')
eq('a blank optional field is omitted entirely', 'field193332696-address2' in params, false)
eq('a blank optional picklist is omitted entirely', 'field193332721' in params, false)

// The attestations and the signature must never be sent — a certification is
// affirmed by a person, and LEAP pre-ticking one would be a forgery.
const FORBIDDEN = ['field193332725','field193332726','field193332727','field193332728','field193332729','field193332730']
eq('no attestation or signature parameter is ever built',
  FORBIDDEN.some(f => Object.keys(params).some(k => k.startsWith(f))), false)

// Nor may a single-family / multiple-units field id appear: they belong to
// branches of this conditional form that a multifamily application never shows.
const OTHER_BRANCH = ['193332682','193332683','193332684','193332685','193332686','193332687','193332688','193332689','193332707','193332708']
eq('no other-branch field id is built',
  OTHER_BRANCH.some(id => Object.keys(params).some(k => k.includes(id))), false)

const { url, filledCount } = buildPrefillUrl(MAP, answered)
// 32 mapped parameters minus the 4 blanks above (address line 2 x2, the
// HOMES follow-up, additional comments).
eq('every mapped answer reaches the URL', filledCount, 28)
eq('the URL points at the assessment application',
  url.startsWith('https://focusonenergy.formstack.com/forms/ira_assessment_app?'), true)
const qs = new URL(url).searchParams
eq('the owner name survives encoding', qs.get('field193332694'), IA_00042.property_owner_name)
eq('the address survives encoding', qs.get('field193332696-address'), '779 Maple Avenue')
eq('the email survives encoding', qs.get('field193332719'), 'ira@EES-WI.org')

// A record the resolver refused (wrong record type, or not readable) must not
// open a bare form as if it were ready.
// 26 required parameters, but the three Assessment Date rows share one label,
// so the user is asked for 24 answers — the modal must not say "Assessment Date"
// three times.
eq('an empty payload reports every required question once',
  findMissingRequiredFields({}, FIELDS).length, 24)
eq('Assessment Date is listed once, not three times',
  findMissingRequiredFields({}, FIELDS).filter(l => l === 'Assessment Date').length, 1)

console.log(`external-form-prefill: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
