// Fixture test for document type labels.
//
// The rule this pins: a document's type is never printed as its raw slug. A
// registered type shows the label an admin wrote; an unregistered one is
// humanized with LEAP's acronyms kept upper-case; the 'attachment' catch-all
// names no kind of file and shows nothing at all.
//
// The cases are the real slugs on the WI-IRA-MF-HOMES-PR — Enrollments layout,
// which is where Nicholas read `reservation_customer_report` in a column headed
// "Type" and asked where it came from.
//
// Run with:  node scripts/document-types-fixture.mjs

import {
  humanizeDocumentType,
  documentTypeLabel,
  documentTypeOptions,
} from '../src/lib/documentTypes.js'
import { CATCH_ALL_DOCUMENT_TYPE } from '../src/lib/documentSlots.js'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures += 1
    console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`)
  }
}

// The registry as it comes back from picklist_values (documents,document_type).
const registry = new Map([
  ['reservation_customer_report', 'Asset Score Report'],
  ['reservation_hpxml', 'HPXML / BuildingSync File'],
  ['audit_template_report', 'Audit Template Report'],
])

// ─── Humanizing an unregistered slug ─────────────────────────────────────────

check('underscores become words', humanizeDocumentType('audit_template_report'), 'Audit Template Report')
check('HPXML stays an acronym', humanizeDocumentType('reservation_hpxml'), 'Reservation HPXML')
check('a bare xml is XML', humanizeDocumentType('assessment_xml'), 'Assessment XML')
check('w9 is written W-9', humanizeDocumentType('payment_w9'), 'Payment W-9')
check('coi is COI', humanizeDocumentType('coi'), 'COI')
check('a single word is capitalized', humanizeDocumentType('video'), 'Video')
check('an already-capitalized slug is normalized', humanizeDocumentType('Signed_INVOICE'), 'Signed Invoice')
check('hyphens are separators too', humanizeDocumentType('scope-of-work'), 'Scope Of Work')
check('an empty value humanizes to nothing', humanizeDocumentType(''), '')
check('null humanizes to nothing', humanizeDocumentType(null), '')
check('whitespace humanizes to nothing', humanizeDocumentType('   '), '')

// ─── The label a screen prints ───────────────────────────────────────────────

check('a registered type shows its label, not its slug',
  documentTypeLabel('reservation_customer_report', registry), 'Asset Score Report')
check('the slug Nicholas questioned no longer reaches the screen',
  documentTypeLabel('reservation_customer_report', registry) === 'reservation_customer_report', false)
check('HPXML reads as a file, not as a reservation stage',
  documentTypeLabel('reservation_hpxml', registry), 'HPXML / BuildingSync File')
check('an unregistered type is humanized rather than printed raw',
  documentTypeLabel('customer_contract_sow', registry), 'Customer Contract SOW')
check('the catch-all sentinel prints nothing — it names no kind of file',
  documentTypeLabel(CATCH_ALL_DOCUMENT_TYPE, registry), null)
check('an empty type prints nothing', documentTypeLabel('', registry), null)
check('a null type prints nothing', documentTypeLabel(null, registry), null)
check('no registry at all still yields words',
  documentTypeLabel('audit_template_report', null), 'Audit Template Report')
check('a plain object registry works like a Map',
  documentTypeLabel('audit_template_report', { audit_template_report: 'Audit Template Report' }),
  'Audit Template Report')
check('a blank registered label falls back to humanizing',
  documentTypeLabel('audit_template_report', new Map([['audit_template_report', '   ']])),
  'Audit Template Report')
check('a surrounding-space slug is matched trimmed',
  documentTypeLabel('  audit_template_report  ', registry), 'Audit Template Report')

// ─── The slot picker's options ───────────────────────────────────────────────

const registered = [
  { value: 'reservation_hpxml', label: 'HPXML / BuildingSync File' },
  { value: 'audit_template_report', label: 'Audit Template Report' },
  { value: 'reservation_customer_report', label: 'Asset Score Report' },
]
const options = documentTypeOptions(registered, ['customer_contract_sow', 'audit_template_report'])
check('the catch-all is always first, and named for what it does',
  [options[0].value, options[0].label],
  [CATCH_ALL_DOCUMENT_TYPE, 'Any document (catch-all)'])
check('registered types follow, in the picklist’s own order',
  options.slice(1, 4).map(o => o.label),
  ['HPXML / BuildingSync File', 'Audit Template Report', 'Asset Score Report'])
check('a slug already on the layout that nobody registered is still offered',
  options[4], { value: 'customer_contract_sow', label: 'Customer Contract SOW', isCatchAll: false, unregistered: true })
check('a slug that is both in use and registered is offered once',
  options.filter(o => o.value === 'audit_template_report').length, 1)
check('no registry and nothing in use still offers the catch-all',
  documentTypeOptions(null, null).map(o => o.value), [CATCH_ALL_DOCUMENT_TYPE])
check('a registered row with no label falls back to humanizing',
  documentTypeOptions([{ value: 'assessment_asset_score' }], []).at(-1).label,
  'Assessment Asset Score')

console.log(failures === 0
  ? `document-types fixture: ${checks} checks passed`
  : `document-types fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
