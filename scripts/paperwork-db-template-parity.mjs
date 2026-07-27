// Render from the ACTUAL seeded database section lists and prove they match
// the shipped documents. The JSON below is copied verbatim from prod.
import crypto from 'node:crypto'
import { buildPaperworkModel, buildEesPdf } from '/home/user/ees-platform/src/data/paperworkModel.js'
import { readFileSync } from 'node:fs'

const dbTemplates = JSON.parse(readFileSync(new URL('./paperwork-db-templates.fixture.json', import.meta.url), 'utf8'))
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
  assetScoreImp: { euiUpgraded: 54, roofRs: [49] }, fields,
})
const hash = async b => {
  const buf = Buffer.from(await b.arrayBuffer())
  return crypto.createHash('sha256').update(
    buf.toString('latin1').replace(/\/CreationDate \(D:[^)]*\)/g,'').replace(/\/ID \[[^\]]*\]/g,'')
  ).digest('hex')
}
let fail = 0
for (const t of dbTemplates) {
  const builtin = await hash(await buildEesPdf(model, t.sdt_kind))
  const fromDb  = await hash(await buildEesPdf(model, t.sdt_kind, t.sections))
  const ok = builtin === fromDb
  console.log(`${ok?'PASS':'FAIL'}  ${t.sdt_document_key}: rendered from the seeded DB rows matches the shipped document`)
  if (!ok) fail = 1
}
// prove the DB config is actually consumed: change a heading in the DB shape
const inv = dbTemplates.find(t => t.sdt_document_key === 'homes_project_invoice')
const edited = inv.sections.map(s => s.type === 'measure_line_items_table'
  ? { ...s, config: { ...s.config, heading: 'EDITED HEADING' } } : s)
const before = await hash(await buildEesPdf(model, 'invoice', inv.sections))
const after  = await hash(await buildEesPdf(model, 'invoice', edited))
console.log(`${before!==after?'PASS':'FAIL'}  editing a section's config in the DB changes the document`)
if (before === after) fail = 1
process.exit(fail)
