// Prove the section-driven renderer reproduces the shipped documents exactly.
import crypto from 'node:crypto'
import { buildPaperworkModel, buildEesPdf, buildSealedPdf, DEFAULT_DOCUMENT_SECTIONS }
  from '../src/data/paperworkModel.js'

const fields = {
  ownerName: 'Hampton Housing Partners LLC', ownerAddress: '100 Main St',
  ownerCityStateZip: 'Madison, WI 53703', contactName: 'Jane Manager',
  contactEmail: 'jane@example.com', contactPhone: '608-555-0100',
  propertyName: 'Hampton Apartments', installationAddress: '200 Hampton Ct',
  installationCityStateZip: 'Madison, WI 53704', iqNumber: 'LEA-12345',
  invoiceNumber: 'INV-WI-001', projectInvoiceNumber: 'INV-WI-002',
  invoiceDate: '7/26/2026', estimatedStartDate: '8/1/2026', estimatedEndDate: '8/15/2026',
  startDate: '8/1/2026', endDate: '8/14/2026',
}
const model = buildPaperworkModel({
  units: 8,
  assetScoreBase: { euiCurrent: 100, roofArea: 7150.0, roofRs: [2] },
  assetScoreImp: { euiUpgraded: 54, roofRs: [49] },
  fields,
})

// jsPDF embeds a CreationDate; strip it so the comparison is about content.
const contentHash = async (blob) => {
  const buf = Buffer.from(await blob.arrayBuffer())
  const stripped = buf.toString('latin1')
    .replace(/\/CreationDate \(D:[^)]*\)/g, '')
    .replace(/\/ID \[[^\]]*\]/g, '')
  return crypto.createHash('sha256').update(stripped).digest('hex')
}

let fail = 0
for (const kind of ['audit', 'proposal', 'invoice']) {
  // implicit default list vs the same list passed explicitly (the template path)
  const a = await contentHash(await buildEesPdf(model, kind))
  const b = await contentHash(await buildEesPdf(model, kind, DEFAULT_DOCUMENT_SECTIONS[kind]))
  const ok = a === b
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${kind}: template-driven render is byte-identical to the built-in (${a.slice(0,12)})`)
  if (!ok) fail = 1
}

// A template that reorders/omits sections must actually change the output,
// otherwise the section list isn't really driving anything.
const trimmed = DEFAULT_DOCUMENT_SECTIONS.invoice.filter(s => s.type !== 'rebate_credits_table')
const full = await contentHash(await buildEesPdf(model, 'invoice'))
const less = await contentHash(await buildEesPdf(model, 'invoice', trimmed))
console.log(`${full !== less ? 'PASS' : 'FAIL'}  omitting a section changes the document (sections are live)`)
if (full === less) fail = 1

// Unknown section type must fail loudly rather than silently drop content.
try {
  await buildEesPdf(model, 'invoice', [{ type: 'does_not_exist' }])
  console.log('FAIL  unknown section type should throw'); fail = 1
} catch (e) {
  console.log(`PASS  unknown section type throws: ${e.message}`)
}

// --- Sealed documents: the same three proofs ------------------------------
for (const kind of ['proposal', 'invoice']) {
  const key = kind === 'invoice' ? 'sealedInvoice' : 'sealedProposal'
  const a = await contentHash(await buildSealedPdf(model, kind))
  const b = await contentHash(await buildSealedPdf(model, kind, DEFAULT_DOCUMENT_SECTIONS[key]))
  const ok = a === b
  console.log(`${ok ? 'PASS' : 'FAIL'}  sealed ${kind}: template-driven render is byte-identical to the built-in (${a.slice(0,12)})`)
  if (!ok) fail = 1
}

// Omitting a Sealed section must change the output (sections are live).
const sealedTrim = DEFAULT_DOCUMENT_SECTIONS.sealedInvoice.filter(s => s.type !== 'sealed_totals_list')
const sFull = await contentHash(await buildSealedPdf(model, 'invoice'))
const sLess = await contentHash(await buildSealedPdf(model, 'invoice', sealedTrim))
console.log(`${sFull !== sLess ? 'PASS' : 'FAIL'}  omitting a Sealed section changes the document (sections are live)`)
if (sFull === sLess) fail = 1

// Unknown Sealed section type must throw.
try {
  await buildSealedPdf(model, 'invoice', [{ type: 'nope' }])
  console.log('FAIL  unknown Sealed section type should throw'); fail = 1
} catch (e) {
  console.log(`PASS  unknown Sealed section type throws: ${e.message}`)
}

process.exit(fail)
