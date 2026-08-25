// Fixture test for document slots on a page layout.
//
// The rule everything rests on: a gallery that names a `document_type` is a
// SLOT and shows only that kind of file; a gallery that names none (or the
// 'attachment' sentinel) is a CATCH-ALL and shows everything no slot on the
// same layout claims. A required slot with nothing in it is an outstanding
// item, and the platform must be able to say so.
//
// Run with:  node scripts/document-slots-fixture.mjs
//
// The cases are drawn from the live WI-IRA-MF-HOMES Final Project Payment
// Request layout (PL-00382), whose seven typed slots all rendered the identical
// full document list until 2026-08-25, and from the WI-IRA-MF-HOMES-AUDIT
// application layout built the same day.

import {
  CATCH_ALL_DOCUMENT_TYPE,
  documentSlotType,
  isDocumentSlot,
  isRequiredDocumentSlot,
  documentSlotHelpText,
  slotTypesOnLayout,
  filterSlotDocuments,
  documentSlotState,
  missingRequiredDocuments,
} from '../src/lib/documentSlots.js'

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

// A widget as page_layout_widgets stores it.
const gallery = (title, config) => ({
  widget_type: 'file_gallery', widget_title: title, widget_config: config,
})

// ── Slot vs catch-all ───────────────────────────────────────────────────────
check('slot: a named document_type is a slot',
  documentSlotType({ target: 'documents', document_type: 'payment_w9' }), 'payment_w9')
check('catch-all: the attachment sentinel is not a kind',
  documentSlotType({ target: 'documents', document_type: CATCH_ALL_DOCUMENT_TYPE }), null)
check('catch-all: no document_type at all',
  documentSlotType({ target: 'documents' }), null)
check('catch-all: empty string is not a kind',
  documentSlotType({ target: 'documents', document_type: '' }), null)
check('catch-all: whitespace is not a kind',
  documentSlotType({ target: 'documents', document_type: '   ' }), null)
check('slot: surrounding whitespace is trimmed',
  documentSlotType({ target: 'documents', document_type: '  qi_tool_pdf ' }), 'qi_tool_pdf')
check('slot: a non-string document_type is not a kind',
  documentSlotType({ target: 'documents', document_type: 7 }), null)
check('slot: null config is a catch-all, not a crash',
  documentSlotType(null), null)
check('slot: accepts a widget row, not just a bare config',
  documentSlotType(gallery('Upload W9', { target: 'documents', document_type: 'payment_w9' })),
  'payment_w9')
check('isDocumentSlot: true for a typed gallery',
  isDocumentSlot({ target: 'documents', document_type: 'payment_w9' }), true)
check('isDocumentSlot: false for the catch-all',
  isDocumentSlot({ target: 'documents', document_type: 'attachment' }), false)

// ── Required ────────────────────────────────────────────────────────────────
check('required: a typed slot marked required',
  isRequiredDocumentSlot({ target: 'documents', document_type: 'payment_w9', required: true }), true)
check('required: a typed slot not marked required',
  isRequiredDocumentSlot({ target: 'documents', document_type: 'payment_hpxml' }), false)
check('required: a CATCH-ALL can never be required — "attach anything" is not a rule',
  isRequiredDocumentSlot({ target: 'documents', document_type: 'attachment', required: true }), false)
check('required: required must be a real true, not a truthy string',
  isRequiredDocumentSlot({ target: 'documents', document_type: 'payment_w9', required: 'yes' }), false)

// ── Help text ───────────────────────────────────────────────────────────────
check('help: the layout author\'s guidance comes through',
  documentSlotHelpText({ help_text: 'Required if scope of work changed after the reservation.' }),
  'Required if scope of work changed after the reservation.')
check('help: blank help text is no help text', documentSlotHelpText({ help_text: '  ' }), null)
check('help: absent help text is null', documentSlotHelpText({ target: 'documents' }), null)

// ── The live payment-request layout ─────────────────────────────────────────
const paymentLayout = [
  gallery('HPXMLv4/Building Sync File', { target: 'documents', document_type: 'payment_hpxml',
    help_text: 'Required if scope of work changed after the reservation.' }),
  gallery('Upload W9', { target: 'documents', document_type: 'payment_w9', required: true }),
  gallery('Audit Template Report', { target: 'documents', document_type: 'audit_template_report', required: true }),
  gallery('HOMES Final Invoice', { target: 'documents', document_type: 'homes_final_invoice', required: true }),
  gallery('QI Tool pdf', { target: 'documents', document_type: 'qi_tool_pdf', required: true }),
  // Not a documents gallery — must be ignored entirely.
  { widget_type: 'file_gallery', widget_title: 'Photos', widget_config: { target: 'photos', photo_type: 'general' } },
  { widget_type: 'status_path', widget_title: '', widget_config: { status_field: 'ia_status' } },
]

check('layout: every slot type is collected, photos and non-galleries ignored',
  [...slotTypesOnLayout(paymentLayout)].sort(),
  ['audit_template_report', 'homes_final_invoice', 'payment_hpxml', 'payment_w9', 'qi_tool_pdf'])
check('layout: no widgets is an empty claim set', [...slotTypesOnLayout([])], [])
check('layout: undefined widgets is an empty claim set', [...slotTypesOnLayout(undefined)], [])

// Every document on one record.
const docs = [
  { id: 'd1', name: 'w9.pdf',              document_type: 'payment_w9' },
  { id: 'd2', name: 'final-invoice.pdf',   document_type: 'homes_final_invoice' },
  { id: 'd3', name: 'scope-notes.pdf',     document_type: 'attachment' },
  { id: 'd4', name: 'site-sketch.pdf',     document_type: 'attachment' },
  { id: 'd5', name: 'report.xml',          document_type: 'payment_hpxml' },
]

check('THE BUG: a slot lists only its own kind, not every document on the record',
  filterSlotDocuments(docs, { target: 'documents', document_type: 'payment_w9' }).map(d => d.id),
  ['d1'])
check('slot: a slot with nothing in it is empty, not the full list',
  filterSlotDocuments(docs, { target: 'documents', document_type: 'qi_tool_pdf' }).map(d => d.id),
  [])
check('catch-all with no slots on the layout shows everything',
  filterSlotDocuments(docs, { target: 'documents', document_type: 'attachment' }).map(d => d.id),
  ['d1', 'd2', 'd3', 'd4', 'd5'])
check('catch-all leaves claimed kinds to their own slot — no file shown twice',
  filterSlotDocuments(docs, { target: 'documents' }, slotTypesOnLayout(paymentLayout)).map(d => d.id),
  ['d3', 'd4'])
check('filter: a non-array rows argument is empty, not a crash',
  filterSlotDocuments(null, { target: 'documents', document_type: 'payment_w9' }), [])
check('filter: claimed types accepted as a plain array too',
  filterSlotDocuments(docs, { target: 'documents' }, ['payment_w9', 'payment_hpxml']).map(d => d.id),
  ['d2', 'd3', 'd4'])

// ── Card state ──────────────────────────────────────────────────────────────
check('state: a required slot holding a file is satisfied',
  documentSlotState({ target: 'documents', document_type: 'payment_w9', required: true }, [docs[0]]),
  { kind: 'slot', type: 'payment_w9', required: true, count: 1, satisfied: true })
check('state: a required slot holding nothing is outstanding',
  documentSlotState({ target: 'documents', document_type: 'qi_tool_pdf', required: true }, []),
  { kind: 'slot', type: 'qi_tool_pdf', required: true, count: 0, satisfied: false })
check('state: an OPTIONAL empty slot is not outstanding',
  documentSlotState({ target: 'documents', document_type: 'payment_hpxml' }, []),
  { kind: 'slot', type: 'payment_hpxml', required: false, count: 0, satisfied: true })
check('state: an empty catch-all is not outstanding',
  documentSlotState({ target: 'documents', document_type: 'attachment' }, []),
  { kind: 'catch_all', type: null, required: false, count: 0, satisfied: true })

// ── Verify Fields ───────────────────────────────────────────────────────────
check('missing: names every required slot with nothing in it, in layout order',
  missingRequiredDocuments(paymentLayout, docs),
  [{ type: 'audit_template_report', label: 'Audit Template Report' },
   { type: 'qi_tool_pdf',           label: 'QI Tool pdf' }])
check('missing: an optional empty slot is never reported',
  missingRequiredDocuments(
    [gallery('HPXMLv4/Building Sync File', { target: 'documents', document_type: 'payment_hpxml' })], []),
  [])
check('missing: nothing uploaded at all reports every required slot',
  missingRequiredDocuments(paymentLayout, []).map(m => m.type),
  ['payment_w9', 'audit_template_report', 'homes_final_invoice', 'qi_tool_pdf'])
check('missing: a slot with no title falls back to its type',
  missingRequiredDocuments(
    [gallery('', { target: 'documents', document_type: 'assessment_energy_report', required: true })], []),
  [{ type: 'assessment_energy_report', label: 'assessment_energy_report' }])
check('missing: a required PHOTO gallery is not a document requirement',
  missingRequiredDocuments(
    [{ widget_type: 'file_gallery', widget_title: 'Photos',
       widget_config: { target: 'photos', photo_type: 'general', required: true } }], []),
  [])
check('missing: no documents argument is treated as none uploaded',
  missingRequiredDocuments(paymentLayout, undefined).map(m => m.type),
  ['payment_w9', 'audit_template_report', 'homes_final_invoice', 'qi_tool_pdf'])

// ── The audit application's own slots ───────────────────────────────────────
const auditLayout = [
  gallery('Energy Report (PDF)', { target: 'documents', document_type: 'assessment_energy_report', required: true }),
  gallery('HPXMLv4 / BuildingSync File', { target: 'documents', document_type: 'assessment_hpxml_buildingsync', required: true }),
  gallery('Signed Assessment Invoice', { target: 'documents', document_type: 'assessment_signed_invoice', required: true }),
  gallery('Supporting Documents', { target: 'documents', document_type: CATCH_ALL_DOCUMENT_TYPE }),
]
const auditDocs = [
  { id: 'a1', document_type: 'assessment_energy_report' },
  { id: 'a2', document_type: 'attachment' },
]
check('audit: the three required slots are declared',
  [...slotTypesOnLayout(auditLayout)],
  ['assessment_energy_report', 'assessment_hpxml_buildingsync', 'assessment_signed_invoice'])
check('audit: two of three outstanding after the energy report lands',
  missingRequiredDocuments(auditLayout, auditDocs).map(m => m.label),
  ['HPXMLv4 / BuildingSync File', 'Signed Assessment Invoice'])
check('audit: the catch-all shows only the unclaimed file',
  filterSlotDocuments(auditDocs, auditLayout[3].widget_config, slotTypesOnLayout(auditLayout)).map(d => d.id),
  ['a2'])

console.log(failures === 0
  ? `document-slots fixture: ${checks} checks passed`
  : `document-slots fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
