import { jsPDF } from 'jspdf'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { getCurrentUserId } from './layoutService'
import { uploadDocument, listDocuments, hydrateDocumentUrls } from './storageService'

// ---------------------------------------------------------------------------
// incomeQualificationService.js
//
// Multifamily HUD income-qualification tool, ported from the standalone
// EESW HUD Multifamily Income Qualification Builder into LEAP.
//
// A "run" targets ONE incentive application (the program enrollment record).
// It resolves the linked property's HUD data, determines categorical
// eligibility, generates the IRA multifamily application PDF and the tenant
// data XLSX, saves both as `documents` rows anchored to the incentive
// application (bucket program-applications), and writes an
// `income_qualifications` determination row linking both files.
//
// Categorical rule (verbatim from the program form): if >=50% of occupied
// units are low/moderate-income — which a project-based Section 8 / 202 / 811
// / PRAC / RAD contract proves automatically — the ENTIRE building is income
// qualified. No per-tenant AMI math. Mode is "Entire Building" (categorical)
// vs "Individual Tenants" (no categorical program on file).
// ---------------------------------------------------------------------------

// ─── Eligibility classification (ported from eligClass / eligProof) ────────

export function eligClass(programString) {
  const p = String(programString || '')
  const hits = []
  if (/Sec 8|HFDA\/8|515\/8|202\/8|PD\/8/.test(p)) hits.push('Section 8 (project-based)')
  if (/202/.test(p)) hits.push('Section 202')
  if (/811/.test(p)) hits.push('Section 811')
  if (/PRAC/.test(p)) hits.push('PRAC (202/811)')
  if (/RAD/.test(p)) hits.push('RAD conversion')
  return [...new Set(hits)]
}

export function eligProof(programString) {
  const p = String(programString || '')
  if (/202|811|PRAC/.test(p)) return 'HUD Section 202/811 capital advance or PRAC contract documentation'
  if (/Sec 8|HFDA\/8|515\/8|202\/8|PD\/8|RAD/.test(p)) return 'HUD project-based Section 8 HAP contract (HAP cover page + contract number)'
  return 'HUD assistance contract documentation'
}

const BRLBL = ['Studio', '1BR', '2BR', '3BR', '4BR', '5BR+']

// ─── Resolve the tool's working record from a LEAP incentive application ───
//
// The standalone tool operated on an `r` object with property_id (HUD id),
// name, address, city, zip, county, total_units, assisted_units, category,
// owner_*, mgmt_*, is_202_811, is_opp_zone, programs[], br_total[6],
// contracts[]. We reconstruct that shape from the LEAP property row +
// property_hud_contracts jsonb so the generators port unchanged.

function brTotalFromMix(mix) {
  if (!mix) return [0, 0, 0, 0, 0, 0]
  return [
    Number(mix.br_0) || 0,
    Number(mix.br_1) || 0,
    Number(mix.br_2) || 0,
    Number(mix.br_3) || 0,
    Number(mix.br_4) || 0,
    Number(mix.br_5plus) || 0,
  ]
}

function contractsFromHud(hud, totalAssisted) {
  // LEAP stores only primary contract fields in the jsonb. Build a single
  // contract entry from them; multi-contract properties (rare — 7 in the WI
  // set) collapse to the primary, which is sufficient for the application.
  if (!hud) return []
  const numbers = String(hud.contract_numbers || hud.primary_contract_number || '')
    .split(/[,;]\s*/).filter(Boolean)
  const primaryNum = hud.primary_contract_number || numbers[0] || ''
  return [{
    contract_number: primaryNum,
    program: hud.primary_program || '',
    assisted_units: totalAssisted,
    tracs_status: hud.primary_tracs_status || '',
    br: brTotalFromMix(hud.bedroom_mix),
    expiration: (hud.primary_expiration || '').slice(0, 10),
  }]
}

async function resolveRunRecord(enrollmentId) {
  // Load the enrollment + its parent property. The enrollment carries the
  // tool's full field set on the record itself; we read those fields first and
  // fall back to the linked property's HUD jsonb to populate anything not yet
  // filled on the enrollment (e.g. a freshly created record).
  const { data: enr, error: enrErr } = await supabase
    .from('enrollments')
    .select(`
      id, enrollment_record_number, enrollment_name, property_id, opportunity_id,
      enrollment_hud_property_id, enrollment_property_name, enrollment_site_address,
      enrollment_city, enrollment_state, enrollment_zip, enrollment_county,
      enrollment_total_units, enrollment_assisted_units,
      enrollment_property_category, enrollment_is_202_811, enrollment_is_opportunity_zone,
      enrollment_owner_organization, enrollment_owner_type, enrollment_owner_address,
      enrollment_owner_phone, enrollment_owner_email,
      enrollment_management_agent, enrollment_management_phone, enrollment_management_email,
      enrollment_hud_program, enrollment_hud_contract_number,
      enrollment_br_studio, enrollment_br_1, enrollment_br_2,
      enrollment_br_3, enrollment_br_4, enrollment_br_5plus,
      properties:property_id (
        id, property_name, property_hud_property_id,
        property_street, property_city, property_state, property_zip,
        property_total_units, property_hud_contracts
      )
    `)
    .eq('id', enrollmentId)
    .single()
  if (enrErr) throw new Error(`Enrollment load failed: ${enrErr.message}`)
  if (!enr) throw new Error('Enrollment not found.')
  const prop = enr.properties
  if (!prop) throw new Error('This enrollment has no linked property.')

  const hud = prop.property_hud_contracts || null

  // Prefer the enrollment's own bedroom breakdown; fall back to the property
  // HUD bedroom_mix when the enrollment hasn't been populated yet.
  const enrBr = [
    enr.enrollment_br_studio, enr.enrollment_br_1, enr.enrollment_br_2,
    enr.enrollment_br_3, enr.enrollment_br_4, enr.enrollment_br_5plus,
  ].map(n => Number(n) || 0)
  const brTotal = enrBr.some(n => n > 0) ? enrBr : brTotalFromMix(hud?.bedroom_mix)
  const brSum = brTotal.reduce((a, b) => a + b, 0)

  const totalUnits = Number(enr.enrollment_total_units) || Number(prop.property_total_units) || 0
  const assistedUnits = Number(enr.enrollment_assisted_units) || (brSum > 0 ? brSum : totalUnits)

  // value-with-fallback helper: enrollment field, then property/HUD source
  const v = (enrVal, fallback) => (enrVal != null && enrVal !== '' ? enrVal : (fallback ?? ''))

  const category = v(enr.enrollment_property_category, hud?.category)
  const programString = [
    enr.enrollment_hud_program, hud?.primary_program, hud?.elig_pathway,
  ].filter(Boolean).join(' ')

  return {
    // identifiers
    _enrollmentId: enr.id,
    _enrollmentName: enr.enrollment_name,
    _enrollmentRecordNumber: enr.enrollment_record_number,
    _propertyId: prop.id,
    _opportunityId: enr.opportunity_id || null,
    // tool `r` shape
    property_id: v(enr.enrollment_hud_property_id, prop.property_hud_property_id || prop.id),
    name: v(enr.enrollment_property_name, prop.property_name) || '(unnamed property)',
    address: v(enr.enrollment_site_address, prop.property_street),
    city: v(enr.enrollment_city, prop.property_city),
    state: v(enr.enrollment_state, prop.property_state) || 'WI',
    zip: v(enr.enrollment_zip, prop.property_zip),
    county: v(enr.enrollment_county, ''),
    total_units: totalUnits,
    assisted_units: assistedUnits,
    category,
    owner_org: v(enr.enrollment_owner_organization, ''),
    owner_type: v(enr.enrollment_owner_type, ''),
    owner_addr: v(enr.enrollment_owner_address, ''),
    owner_city: '',
    owner_state: v(enr.enrollment_state, prop.property_state) || 'WI',
    owner_zip: '',
    owner_phone: v(enr.enrollment_owner_phone, ''),
    owner_email: v(enr.enrollment_owner_email, ''),
    mgmt_org: v(enr.enrollment_management_agent, ''),
    mgmt_phone: v(enr.enrollment_management_phone, ''),
    mgmt_email: v(enr.enrollment_management_email, ''),
    is_202_811: enr.enrollment_is_202_811 || hud?.is_202_811 ? 'Y' : 'N',
    is_opp_zone: enr.enrollment_is_opportunity_zone || hud?.is_opp_zone ? 'Y' : 'N',
    programs: [enr.enrollment_hud_program, hud?.primary_program, hud?.elig_pathway].filter(Boolean),
    _programString: programString,
    br_total: brTotal,
    contracts: contractsFromHud(hud, assistedUnits),
  }
}

// ─── Unit rows (ported from unitRowsFor) ───────────────────────────────────

function unitRowsFor(r) {
  const out = []
  const brSum = r.br_total.reduce((a, b) => a + b, 0)
  let modalBed = 1, maxc = -1
  r.br_total.forEach((cnt, bed) => { if (cnt > maxc) { maxc = cnt; modalBed = bed } })
  const modalOcc = modalBed + 1
  const occSeq = []
  if (brSum > 0) {
    r.br_total.forEach((cnt, bedrooms) => { const occ = bedrooms + 1; for (let u = 0; u < cnt; u++) occSeq.push(occ) })
    for (let u = brSum; u < r.total_units; u++) occSeq.push(modalOcc)
  } else {
    for (let u = 0; u < r.total_units; u++) occSeq.push('')
  }
  for (let i = 0; i < r.total_units; i++) {
    out.push({ unit: i + 1, occ: occSeq[i] != null ? occSeq[i] : '' })
  }
  return out
}

function safeFilePart(s) {
  return String(s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function docBaseName(r, doctype, ext) {
  const addr = safeFilePart(r.address || 'property')
  const contract = (r.contracts && r.contracts[0] && r.contracts[0].contract_number)
    ? r.contracts[0].contract_number.replace(/[^A-Za-z0-9]+/g, '')
    : safeFilePart(r.property_id)
  return `${addr}_${contract}_${doctype}.${ext}`
}

// ─── Tenant Data Sheet XLSX (ported from genXLSX) → Blob ───────────────────

function buildTenantXlsxBlob(r) {
  const wb = XLSX.utils.book_new()
  const aoa = []
  aoa[1] = ['IRA Home Energy Rebates: Multiple Unit Tenant Data Sheet']
  aoa[2] = ['Please fill out all the fields, unless specified.']
  aoa[5] = ['Building Name (optional)', 'Tenant Name', 'Number of Occupants', 'Address', 'Unit Number', 'City', 'State', 'ZIP Code']
  const rows = unitRowsFor(r)
  let ri = 6
  rows.forEach(u => {
    const concatAddr = `${r.address} Unit ${u.unit}`
    aoa[ri++] = [r.address, '', u.occ, concatAddr, u.unit, r.city, 'WI', r.zip]
  })
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 17.3 }, { wch: 24 }, { wch: 25.6 }, { wch: 30 }, { wch: 13.9 }, { wch: 12.6 }, { wch: 8.7 }, { wch: 10.9 }]
  ws['!merges'] = [{ s: { r: 1, c: 0 }, e: { r: 1, c: 3 } }, { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } }]
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const arrayBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([arrayBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// ─── Application PDF (ported/condensed from genPDF) → Blob ──────────────────
//
// Produces the property-data + field-definitions sheet and the filled IRA
// multifamily application snapshot. Layout mirrors the standalone tool's
// jsPDF output; the exhaustive HUD field-definition glossary from the source
// is preserved in spirit via the supporting rows but trimmed to the data
// LEAP actually holds.

function buildApplicationPdfBlob(r, determination) {
  const d = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = 612, M = 46
  const GREEN = [31, 92, 61], INK = [16, 19, 15], MUT = [107, 102, 87], FLAG = [168, 50, 31], LINE = [200, 194, 180]

  const pdfSafe = s => String(s == null ? '' : s)
    .replace(/\u2265/g, '>=').replace(/\u2264/g, '<=')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2022\u25b6\u25aa\u00b7]/g, '-')
    .replace(/[^\x00-\x7F]/g, '')
  const _text = d.text.bind(d)
  d.text = function (txt, x, yy, opts) {
    const clean = Array.isArray(txt) ? txt.map(pdfSafe) : pdfSafe(txt)
    return _text(clean, x, yy, opts)
  }
  const _split = d.splitTextToSize.bind(d)
  d.splitTextToSize = function (txt, wd, opts) { return _split(pdfSafe(txt), wd, opts) }

  function header(title, sub) {
    d.setFillColor(...INK); d.rect(0, 0, W, 8, 'F')
    let y = 40
    d.setFont('helvetica', 'bold'); d.setFontSize(8); d.setTextColor(...GREEN)
    d.text('ENERGY EFFICIENCY SERVICES OF WISCONSIN', M, y)
    d.setTextColor(...MUT); d.text('IRA HOME ENERGY REBATES · MULTIFAMILY', W - M, y, { align: 'right' })
    y += 8; d.setDrawColor(...INK); d.setLineWidth(1.5); d.line(M, y, W - M, y)
    y += 22
    d.setFont('helvetica', 'bold'); d.setFontSize(15); d.setTextColor(...INK)
    d.text(title, M, y); y += 16
    if (sub) { d.setFont('helvetica', 'normal'); d.setFontSize(8.5); d.setTextColor(...MUT); d.text(sub, M, y); y += 14 }
    return y
  }

  const elig = determination.pathways
  const isElig = determination.mode === 'Entire Building'
  const subsidizedPct = r.total_units ? Math.round(r.assisted_units / r.total_units * 100) : 0

  // ── Page 1: Property Data & Field Definitions ──
  let y = header('Property Data & Field Definitions',
    `${r.name} · ${r.address}, ${r.city}, WI ${r.zip} · HUD ID ${r.property_id}`)

  const rows = [
    ['HUD Property ID', r.property_id],
    ['Property Name', r.name],
    ['Site Address', r.address],
    ['City', r.city], ['State', 'WI'], ['ZIP', r.zip],
    ['Total Units', String(r.total_units)],
    ['Assisted / Subsidized Units', String(r.assisted_units)],
    ['Subsidized Share %', `${subsidizedPct}%`],
    ['Property Category', r.category],
    ['202/811', r.is_202_811],
    ['Opportunity Zone', r.is_opp_zone],
    ['Qualifying Mode', determination.mode],
    ['Categorical Eligibility', elig.join('; ') || 'NONE DETECTED — VERIFY'],
    ['Required Proof', determination.requiredProof],
    ['50% LMI Declaration', isElig ? 'AFFIRMED — categorical building' : 'NOT categorical — verify pathway'],
  ]
  d.setFontSize(9)
  const cF = M, cV = M + 200, wV = W - M - (M + 200)
  rows.forEach(([f, v]) => {
    if (y > 740) { y = header('Property Data & Field Definitions (cont.)', `${r.name} · HUD ID ${r.property_id}`) }
    const vLines = d.splitTextToSize(String(v), wV - 6)
    d.setFont('helvetica', 'bold'); d.setTextColor(...INK); d.text(f, cF, y)
    const flagged = /NONE DETECTED|NOT categorical|VERIFY/.test(String(v))
    d.setFont('helvetica', 'normal'); d.setTextColor(...(flagged ? FLAG : INK))
    d.text(vLines, cV, y)
    y += Math.max(1, vLines.length) * 12 + 4
  })

  // HUD contracts
  y += 6
  if (y > 720) y = header('HUD Contracts (cont.)', `${r.name} · HUD ID ${r.property_id}`)
  d.setFont('helvetica', 'bold'); d.setFontSize(10); d.setTextColor(...GREEN)
  d.text('HUD Contracts', M, y); y += 4
  d.setDrawColor(...LINE); d.setLineWidth(0.6); d.line(M, y, W - M, y); y += 14
  d.setFontSize(8.5)
  r.contracts.forEach(c => {
    if (y > 740) y = header('HUD Contracts (cont.)', `${r.name} · HUD ID ${r.property_id}`)
    d.setFont('helvetica', 'bold'); d.setTextColor(...INK); d.text(c.contract_number || '—', M, y)
    d.setFont('helvetica', 'normal'); d.setTextColor(...MUT)
    d.text(`${c.program} · ${c.assisted_units} units · ${c.tracs_status} · exp ${c.expiration || '—'}`, M + 150, y)
    y += 14
  })
  BRLBL.forEach((l, i) => {
    if (r.br_total[i] > 0) {
      if (y > 748) y = header('Bedroom Mix (cont.)', `${r.name}`)
      d.setFont('helvetica', 'normal'); d.setTextColor(...MUT)
      d.text(`Bedroom count — ${l}: ${r.br_total[i]}`, M, y); y += 12
    }
  })

  // ── Page 2: Application Form (filled snapshot) ──
  d.addPage()
  let fy = header('Application Form',
    'IRA Home Energy Rebates — Multifamily Low-Income Energy Assessment (filled snapshot)')
  const ffield = (label, value) => {
    if (fy > 748) fy = header('Application Form (cont.)', `${r.name} · HUD ID ${r.property_id}`)
    d.setFont('helvetica', 'bold'); d.setFontSize(8.5); d.setTextColor(...INK)
    d.text(label, M, fy)
    d.setFont('helvetica', 'normal'); d.setTextColor(...MUT)
    const vLines = d.splitTextToSize(String(value == null || value === '' ? '-' : value), W - 2 * M - 240)
    d.text(vLines, M + 240, fy)
    fy += Math.max(1, vLines.length) * 11 + 5
  }
  const fsec = t => {
    fy += 8
    if (fy > 720) fy = header('Application Form (cont.)', `${r.name} · HUD ID ${r.property_id}`)
    d.setFont('helvetica', 'bold'); d.setFontSize(8.5); d.setTextColor(...GREEN)
    d.text(String(t).toUpperCase(), M, fy)
    d.setDrawColor(...LINE); d.setLineWidth(0.6); d.line(M, fy + 4, W - M, fy + 4); fy += 16
  }

  fsec('Property')
  ffield('What type of property is this?', 'Multifamily')
  ffield('Property name', r.name)
  ffield('Street address', r.address)
  ffield('City', r.city); ffield('State', 'WI'); ffield('ZIP', r.zip)
  ffield('Number of units in building', String(r.total_units))

  fsec('Income Qualification')
  ffield('Income qualifying mode', determination.mode)
  ffield('Categorical eligibility', elig.join('; ') || 'NONE DETECTED — VERIFY')
  ffield('Required proof', determination.requiredProof)
  ffield('Tenant data spreadsheet', docBaseName(r, 'Tenant Data Sheet', 'xlsx'))
  ffield('Proof of categorical income', 'Attached')

  fsec('Declaration')
  const dl = d.splitTextToSize(
    isElig
      ? 'I verify that for the property listed, at least 50% of occupied units are occupied by tenants that meet the program definition of low- or moderate-income, affirmed categorically via the HUD assistance contract.'
      : 'No categorical program detected on the HUD record for this property. Income qualification must be verified by individual tenant income certification before submission.',
    W - 2 * M)
  d.setFont('helvetica', 'normal'); d.setFontSize(8.5); d.setTextColor(...INK)
  d.text(dl, M, fy)

  const arrayBuf = d.output('arraybuffer')
  return new Blob([arrayBuf], { type: 'application/pdf' })
}

// ─── Public: classify only (no side effects) ───────────────────────────────

export async function classifyEnrollment(enrollmentId) {
  const r = await resolveRunRecord(enrollmentId)
  const pathways = eligClass(r._programString)
  const mode = pathways.length > 0 ? 'Entire Building' : 'Individual Tenants'
  const subsidizedPct = r.total_units ? Math.round((r.assisted_units / r.total_units) * 100) : 0
  return {
    record: r,
    mode,
    pathways,
    requiredProof: eligProof(r._programString),
    totalUnits: r.total_units,
    assistedUnits: r.assisted_units,
    subsidizedSharePct: subsidizedPct,
  }
}

// ─── Public: run = classify + generate files + persist determination ───────

export async function runIncomeQualification(enrollmentId) {
  if (!enrollmentId) throw new Error('runIncomeQualification: enrollmentId is required')
  const userId = await getCurrentUserId()

  const det = await classifyEnrollment(enrollmentId)
  const r = det.record

  // Generate both files as Blobs, wrap as File so uploadDocument gets a name.
  const pdfBlob = buildApplicationPdfBlob(r, det)
  const xlsxBlob = buildTenantXlsxBlob(r)
  const pdfName = docBaseName(r, 'IRA_Multifamily_Application', 'pdf')
  const xlsxName = docBaseName(r, 'Tenant_Data_Sheet', 'xlsx')
  const pdfFile = new File([pdfBlob], pdfName, { type: 'application/pdf' })
  const xlsxFile = new File([xlsxBlob], xlsxName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  // Upload both to the enrollment record.
  const pdfDoc = await uploadDocument({
    file: pdfFile,
    relatedObject: 'enrollments',
    relatedId: enrollmentId,
    documentType: 'income_qualification_application',
    name: pdfName,
    category: 'Income Qualification',
  })
  const xlsxDoc = await uploadDocument({
    file: xlsxFile,
    relatedObject: 'enrollments',
    relatedId: enrollmentId,
    documentType: 'income_qualification_tenant_sheet',
    name: xlsxName,
    category: 'Income Qualification',
  })

  // Persist the determination back onto the enrollment record itself. The
  // enrollment IS the home for these fields — the tool computes them and saves
  // the values on the record (the PDF is the rendered snapshot of the same).
  const updateRow = {
    enrollment_qualifying_mode: det.mode,
    enrollment_eligibility_pathways: det.pathways.join('; ') || null,
    enrollment_required_proof: det.requiredProof,
    enrollment_categorical_eligibility: det.pathways.join('; ') || 'None detected — verify',
    enrollment_determination_date: new Date().toISOString().slice(0, 10),
    enrollment_total_units: det.totalUnits,
    enrollment_assisted_units: det.assistedUnits,
    enrollment_subsidized_share_pct: det.subsidizedSharePct,
    // Unpack the resolved HUD/property/site identity onto the record so a run
    // fully populates the enrollment (not just the determination). Only write
    // values that resolved, so an existing populated field is never blanked.
    enrollment_hud_property_id: r.property_id || undefined,
    enrollment_property_name: r.name || undefined,
    enrollment_site_address: r.address || undefined,
    enrollment_city: r.city || undefined,
    enrollment_state: r.state || undefined,
    enrollment_zip: r.zip || undefined,
    enrollment_county: r.county || undefined,
    enrollment_property_category: r.category || undefined,
    enrollment_is_202_811: r.is_202_811 === 'Y' ? true : undefined,
    enrollment_is_opportunity_zone: r.is_opp_zone === 'Y' ? true : undefined,
    enrollment_owner_organization: r.owner_org || undefined,
    enrollment_owner_type: r.owner_type || undefined,
    enrollment_owner_address: r.owner_addr || undefined,
    enrollment_owner_phone: r.owner_phone || undefined,
    enrollment_owner_email: r.owner_email || undefined,
    enrollment_management_agent: r.mgmt_org || undefined,
    enrollment_management_phone: r.mgmt_phone || undefined,
    enrollment_management_email: r.mgmt_email || undefined,
    enrollment_hud_program: (r.contracts?.[0]?.program) || undefined,
    enrollment_hud_contract_number: (r.contracts?.[0]?.contract_number) || undefined,
    enrollment_hud_tracs_status: (r.contracts?.[0]?.tracs_status) || undefined,
    enrollment_hud_contract_expiration: (r.contracts?.[0]?.expiration) || undefined,
    enrollment_br_studio: r.br_total?.[0] ?? undefined,
    enrollment_br_1: r.br_total?.[1] ?? undefined,
    enrollment_br_2: r.br_total?.[2] ?? undefined,
    enrollment_br_3: r.br_total?.[3] ?? undefined,
    enrollment_br_4: r.br_total?.[4] ?? undefined,
    enrollment_br_5plus: r.br_total?.[5] ?? undefined,
    enrollment_updated_by: userId,
    enrollment_updated_at: new Date().toISOString(),
  }
  // Strip undefined so PostgREST doesn't null-overwrite unresolved fields.
  for (const k of Object.keys(updateRow)) if (updateRow[k] === undefined) delete updateRow[k]
  const { data: enrRow, error: updErr } = await supabase
    .from('enrollments')
    .update(updateRow)
    .eq('id', enrollmentId)
    .select()
    .single()
  if (updErr) throw new Error(`Enrollment determination update failed: ${updErr.message}`)

  return { determination: det, pdfDocument: pdfDoc, xlsxDocument: xlsxDoc, enrollment: enrRow }
}

// ─── Public: documents (PDF + XLSX) attached to the enrollment ─────────────

export async function listIncomeQualificationDocuments(enrollmentId) {
  if (!enrollmentId) return []
  const docs = await listDocuments('enrollments', enrollmentId)
  const iqDocs = docs.filter(d =>
    d.document_type === 'income_qualification_application' ||
    d.document_type === 'income_qualification_tenant_sheet')
  return hydrateDocumentUrls(iqDocs)
}
