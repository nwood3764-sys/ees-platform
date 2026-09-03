// ---------------------------------------------------------------------------
// hearProposal — the IRA Multifamily HEAR Project Reservation proposal, ported
// from the approved standalone Audit Builder
// (audit-template-builder/frontend/index.html: hearModel, buildHearPdfBlob,
// buildHearSealedPdfBlob, _hearScopeCols).
//
// One difference from the standalone builder, and it is the point of this file:
// there, the equipment scope is typed by hand into a form and kept in
// localStorage. In LEAP the scope is already a record — the opportunity's LINE
// ITEMS, drawn from the HEAR products in the catalog — so nobody retypes what
// the platform already knows, and the proposal, the project cost and the
// programme rebate all read the same rows.
//
// The page furniture (letter page, palette, footers, money/phone formatting)
// comes from proposalPdfKit, shared with the HOMES proposal.
//
// HEAR is a low-income (<=80% AMI) programme: the rebate covers 100% of the
// install cost up to the federal per-measure caps and $14,000 per dwelling
// unit, so the balance due is always $0.00.
// ---------------------------------------------------------------------------

/* eslint-disable */

import {
  stateFullName, contactWithTitle, newProposalPdf,
  money as _money, phone as _phone,
  stampEesFooters as _stampEesFooters, stampSealedFooters as _stampSealedFooters,
} from './proposalPdfKit.js'

// --- ported: HEAR_MEASURES (index.html 3318,3348) ---
// Official North Carolina HEAR "Upgrade Type" names + the programme's
// product-category rebate caps (Nicholas, 2026-08-29). Keys stay stable.
//
// `productCodes` is the LEAP half: which product in the catalog IS this
// measure. It is the ONLY place the two vocabularies meet — a HEAR product
// added later joins the proposal by listing its code here, never by a second
// mapping somewhere else.
const M1 = [{ key: 'model', label: 'Make / Model #', short: '' }]   // single-unit default
export const HEAR_MEASURES = [
  { key:'panel', label:'Electrical Panel', cap:4000, models:M1, metrics:['Amps'],
    productCodes:['HEAR-PANEL'],
    types:['200A Service','150A Service','100A Service','Subpanel'],
    desc:'Upgrade of the dwelling’s electrical service panel to the capacity required to support the qualified electric equipment installed under the IRA Home Electrification and Appliance Rebate (HEAR) program.' },
  { key:'cooking', label:'Electric Cooking Appliance', cap:840, models:M1, metrics:[],
    productCodes:['HEAR-STOVE'],
    types:['Induction Range','Induction Cooktop','Electric Cooktop','Electric Range / Stove','Electric Oven'],
    desc:'Installation of a qualified ENERGY STAR electric cooking appliance, replacing the existing non-qualifying unit, under the IRA HEAR program.' },
  { key:'wiring', label:'Electric Wiring', cap:2500, models:[], metrics:[],
    productCodes:['HEAR-WIRING'],
    types:['Branch Circuit','Service Upgrade','Whole-Unit Rewire'],
    desc:'Electrical wiring improvements required to safely support the installation of qualified electric equipment under the IRA HEAR program.' },
  { key:'dryer', label:'Heat Pump Clothes Dryer', cap:840, models:M1, metrics:['CEF'],
    productCodes:['HEAR-DRYER'],
    types:['Ventless Heat Pump Dryer','Combo Washer/Dryer'],
    desc:'Installation of a qualified ENERGY STAR heat pump clothes dryer, replacing the existing non-qualifying unit, under the IRA HEAR program.' },
  { key:'heat_pump', label:'Heat Pump for Space Heating/Cooling', cap:8000,
    productCodes:['HEAR-HP-SPACE-HEAT-COOL'],
    models:[{ key:'outdoor', label:'Outdoor Unit (Heat Pump) Model #', short:'Outdoor' },
            { key:'indoor',  label:'Indoor Unit (Air Handler / Coil) Model #', short:'Indoor' }],
    metrics:['HSPF2','SEER2','EER2'],
    types:['Ducted Central Heat Pump','Ductless Mini-Split','Multi-Zone Mini-Split','Packaged Terminal (PTHP)','Ground-Source (Geothermal)','Air-to-Water Heat Pump'],
    desc:'Installation of a qualified high-efficiency electric heat pump for space heating and cooling under the IRA HEAR program.' },
  { key:'hpwh', label:'Heat Pump Water Heater', cap:1750, models:M1, metrics:['UEF'],
    productCodes:['HEAR-HPWH'],
    types:['50 gallon','65 gallon','80 gallon','Split-System'],
    desc:'Installation of a qualified ENERGY STAR heat pump water heater, replacing the existing non-qualifying unit, under the IRA HEAR program.' },
  { key:'weatherization', label:'Insulation, Air Sealing, and Ventilation', cap:1600, models:[], metrics:[],
    productCodes:['HEAR-VENT'],
    types:['Attic Insulation','Wall Insulation','Air Sealing','Mechanical Ventilation'],
    desc:'Installation of insulation, air sealing, and/or qualified mechanical ventilation improvements to the dwelling under the IRA HEAR program.' },
]
const HEAR_BY_KEY = Object.fromEntries(HEAR_MEASURES.map(m => [m.key, m]))

// Which product code means which measure, and (where the product itself says so)
// which system type it is. HEAR-VENT is ventilation equipment, which is what
// makes the companion air-sealing note below apply.
const MEASURE_BY_PRODUCT_CODE = {}
for (const m of HEAR_MEASURES) for (const code of (m.productCodes || [])) MEASURE_BY_PRODUCT_CODE[code] = m.key
const SYSTEM_TYPE_BY_PRODUCT_CODE = { 'HEAR-VENT': 'Mechanical Ventilation' }

/** Is this product one of the HEAR measures? */
export function hearMeasureForProductCode(code) {
  return MEASURE_BY_PRODUCT_CODE[String(code || '').trim().toUpperCase()] || null
}

// --- ported: HEAR_VENT_MODEL + hearModelsFor (index.html 3354,3359) ---
const HEAR_VENT_MODEL = [{ key: 'model', label: 'Equipment Model #', short: '' }]
function hearModelsFor(meas, systemType) {
  if (!meas) return []
  if (meas.key === 'weatherization') return systemType === 'Mechanical Ventilation' ? HEAR_VENT_MODEL : []
  return meas.models || []
}

// --- ported: hearDefaultDesc (index.html 3366,3370) ---
// Mechanical ventilation must tell the reviewer that a companion air-sealing
// project accompanies it — that pairing is what makes the $1,600 ventilation
// incentive eligible.
export function hearDefaultDesc(measureKey, systemType) {
  if (systemType === 'Mechanical Ventilation')
    return 'ENERGY STAR mechanical ventilation installed in combination with a whole-home air sealing project on this dwelling. The accompanying air sealing has been (or will be) completed as part of this project’s scope of work, satisfying the program requirement that mechanical ventilation be paired with air sealing. Noted here so the program reviewer can confirm the companion air-sealing project supporting the HEAR ventilation incentive.'
  return (HEAR_BY_KEY[measureKey] || {}).desc || ''
}

const _num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : 0 }

/**
 * Opportunity line items -> HEAR scope rows.
 *
 * Each item is `{ productCode, productName, manufacturer, modelNumber, seer2,
 * eer2, hspf2, quantity, unitPrice, lineDescription }`. A line whose product is
 * not one of the seven HEAR measures is NOT HEAR scope (an Energy Audit belongs
 * to the audit programme) — it is returned in `unmapped` rather than dropped
 * silently, so a mis-coded line is visible instead of quietly missing from the
 * proposal.
 */
export function hearRowsFromLineItems(items) {
  const rows = [], unmapped = []
  for (const it of (items || [])) {
    const code = String(it.productCode || '').trim().toUpperCase()
    const key = MEASURE_BY_PRODUCT_CODE[code]
    if (!key) { unmapped.push(it.productName || it.lineDescription || code || 'Line item'); continue }
    const systemType = SYSTEM_TYPE_BY_PRODUCT_CODE[code] || ''
    const models = {}
    const modelText = [it.manufacturer, it.modelNumber].filter(v => v && String(v).trim()).join(' ').trim()
    if (modelText) for (const md of hearModelsFor(HEAR_BY_KEY[key], systemType)) models[md.key] = modelText
    const effs = {}
    if (it.hspf2 != null && it.hspf2 !== '') effs.HSPF2 = String(it.hspf2)
    if (it.seer2 != null && it.seer2 !== '') effs.SEER2 = String(it.seer2)
    if (it.eer2  != null && it.eer2  !== '') effs.EER2  = String(it.eer2)
    rows.push({
      measure: key, systemType, models, effs,
      qty: it.quantity, cost: it.unitPrice,          // `cost` is PER UNIT, as in the builder
      // The programme description is what the reviewer reads; the line's own
      // wording is a specific, and rides the sub-line with the model/efficiency.
      desc: hearDefaultDesc(key, systemType),
      lineNote: String(it.lineDescription || '').trim(),
    })
  }
  return { rows, unmapped }
}

// --- ported: buildingState (index.html 3559,3567), without the Asset Score half ---
// The HEAR proposal reads no Asset Score, so the state comes from the record's
// own city/state/zip line.
function stateFromFields(F) {
  const m = /,\s*([A-Za-z]{2})\s+\d{5}/.exec(String(F.pjCsz || F.pjOwnerCsz || ''))
  return (m ? m[1] : '').toUpperCase()
}

/**
 * --- ported: hearModel (index.html 4106,4139) ---
 * Compute the proposal model. Input: `{ fields, units, rows, state }`.
 * Rendering is separate so the action can gate on the numbers first.
 */
export function computeHearModel(input) {
  const F = (input && input.fields) || {}
  const units = parseInt(input && input.units, 10) || 1
  const state = (input && input.state) || stateFromFields(F) || 'WI'
  const rows = ((input && input.rows) || [])
    .filter(r => r && (r.systemType || r.cost || (r.desc && r.desc.trim())
      || (r.models && Object.values(r.models).some(v => v))
      || (r.effs && Object.values(r.effs).some(v => v))))
    .map(r => {
      const meas = HEAR_BY_KEY[r.measure] || HEAR_MEASURES[0]
      const qty = Math.max(1, parseInt(r.qty, 10) || 1)
      const unitCost = Math.max(0, _num(r.cost))          // the Cost field is PER UNIT
      const cost = Math.round(unitCost * qty * 100) / 100 // total = per-unit x quantity
      const rebate = cost                                 // HEAR covers 100% of the install cost
      // Documents split each line 50/50 into labor + material (material takes
      // the clean floored half; labor carries any odd cent so the two sum).
      const material = Math.floor(cost * 50) / 100, labor = Math.round((cost - material) * 100) / 100
      const models = r.models || {}, effs = r.effs || {}
      const modelStr = hearModelsFor(meas, r.systemType || '').map(md => {
        const v = (models[md.key] || '').trim()
        return v ? ((md.short ? md.short + ' ' : '') + v) : ''
      }).filter(Boolean).join('  ·  ')
      const effStr = (meas.metrics || []).map(mtr => {
        const v = (effs[mtr] || '').trim()
        return v ? (v + ' ' + mtr) : ''
      }).filter(Boolean).join('  ·  ')
      return { key: meas.key, label: meas.label, cap: meas.cap, systemType: r.systemType || '',
        modelStr, effStr, desc: (r.desc || '').trim(), lineNote: (r.lineNote || '').trim(),
        qty, unitCost, cost, labor, material,
        rebate: Math.round(rebate * 100) / 100, due: Math.round((cost - rebate) * 100) / 100 }
    })
  const totalCost = Math.round(rows.reduce((a, r) => a + r.cost, 0) * 100) / 100
  const totalRebate = totalCost   // low-income HEAR: the rebate covers 100% of the install cost
  const totalDue = 0              // therefore the balance due is always $0.00
  return { units, state, rows, totalCost, totalRebate, totalDue, total: totalCost, fields: { ...F } }
}

// --- ported: _hearScopeCols (index.html 4140,4144) ---
// Quantity/Units · Labor · Material · Total, narrow so MEASURE gets the width.
// The widths here are MINIMUMS; layoutScopeCols grows any column whose figures
// do not fit.
export function _hearScopeCols(money) {
  return [['QTY / UNITS', r => String(r.qty), 54], ['LABOR', r => money(r.labor), 60],
    ['MATERIAL', r => money(r.material), 60], ['TOTAL', r => money(r.cost), 62]]
}

/**
 * Size the numeric columns to the figures they ACTUALLY carry, then anchor them
 * to the right edge — returning each as `[label, fn, width, rightX]`.
 *
 * This is the one deliberate departure from the standalone builder's layout,
 * and it is a defect fix rather than a preference. Those widths were fixed at
 * the size of that builder's own example figures, and the figures are drawn
 * CENTRED in their column, so what a column really needs is its widest figure
 * PLUS a gutter. A 25-unit heat pump line is $200,000.00 — 52.3pt in a 54pt
 * Sealed column, which leaves 1.7pt between one figure and the next and prints
 * "$100,000.00$100,000.00$200,000.00" as one unreadable string. (Nothing is
 * clipped or overprinted, which is exactly why reading the code did not show
 * it and rendering the page did.) Every column now takes the wider of its
 * heading and its widest value, plus a 12pt gutter.
 *
 * `minMeasureWidth` is the floor the MEASURE column keeps: if the figures are so
 * large that the numeric block would squeeze it, the numbers give the width back
 * proportionally — a cramped measure name is recoverable, overprinted money is
 * not.
 */
export function layoutScopeCols(P, defs, rows, rightEdge, blockLeft, minMeasureWidth) {
  const { d, font } = P
  const widths = defs.map(([lbl, fn, min]) => {
    font(8, 'bold'); let need = d.getTextWidth(lbl)
    font(9.5, 'bold')
    for (const r of rows) need = Math.max(need, d.getTextWidth(String(fn(r))))
    return Math.max(min, Math.ceil(need) + 12)
  })
  const maxBlock = (rightEdge - blockLeft) - (minMeasureWidth || 0)
  const total = widths.reduce((a, w) => a + w, 0)
  const scale = (maxBlock > 0 && total > maxBlock) ? maxBlock / total : 1
  const scaled = widths.map(w => Math.floor(w * scale))
  const cols = defs.map(([lbl, fn], i) => [lbl, fn, scaled[i], 0])
  let _rx = rightEdge; for (let c = cols.length - 1; c >= 0; c--) { cols[c][3] = _rx; _rx -= cols[c][2] }
  return cols
}

// The sub-line under a measure: what was installed, specifically.
const subLine = r => [r.systemType, r.modelStr, r.effStr, r.lineNote].filter(Boolean).join('  ·  ')

let _jspdf = null

/** Load jsPDF lazily — it is a heavy vendor chunk and must stay off the record-open path. */
export async function loadJsPdf() {
  if (!_jspdf) {
    const mod = await import('jspdf')
    _jspdf = mod.jsPDF || mod.default || (mod.jspdf && mod.jspdf.jsPDF)
  }
  return _jspdf
}

/**
 * Render the HEAR proposal PDF. `contractor` selects the design: anything
 * matching "sealed" uses the green Sealed engine, otherwise the blue EES
 * engine — the same rule the HOMES proposal uses.
 * @returns {Promise<Blob>}
 */
export async function generateHearProposalBlob(input) {
  await loadJsPdf()
  const m = computeHearModel(input)
  const sealed = /sealed/i.test((input && input.contractor) || '')
  return sealed ? buildHearSealedPdfBlob(m) : buildHearPdfBlob(m)
}

// --- ported: buildHearPdfBlob (index.html 4145,4275) ---
function buildHearPdfBlob(m) {
  const F = m.fields
  const P = newProposalPdf(_jspdf, 20); const { d, W, H, M, CW, C, st, font, t, wrap, need, fill, stroke, tc } = P
  const pv = v => (v != null && String(v).trim() !== '') ? String(v) : '—'
  const _state = stateFullName(m.state)
  /* EES brand palette + header identical to the HOMES EES proposal: the three
     balanced party columns (contractor / project / customer). */
  const BLUE = [33, 102, 172]
  const NAVY = BLUE, PANEL = [246, 249, 252], HAIR = [223, 230, 238]
  const cLines = ['Energy Efficiency Services of ' + _state, '112 Owen Rd. PO Box 6141', 'Monona, WI 53716',
    _phone(m.state === 'NC' ? '7049905614' : '6084607419')].filter(v => v && String(v).trim())
  const lLines = [F.pjInstallAddr, F.pjCsz, 'Multi-Family', (m.units ? ('Total Units: ' + m.units) : ''),
    (F.pjIQ ? ('IQ Number: ' + F.pjIQ) : '')].filter(v => v && String(v).trim())
  const rLines = [F.pjOwner, contactWithTitle(F), F.pjOwnerAddr, F.pjOwnerCsz, _phone(F.pjPhone), F.pjEmail]
    .filter(v => v && String(v).trim())
  const drawParties = () => {
    const pT = st.y, colW = CW / 3, x2 = M + colW, wCol = colW - 12
    tc(BLUE); font(8.5, 'bold')
    t(M, pT + 8, 'PRIMARY IRA CONTRACTOR'); t(x2, pT + 8, 'PROJECT INFORMATION'); t(W - M, pT + 8, 'CUSTOMER INFORMATION', { align: 'right' })
    let cy = pT + 21, ly = pT + 21, ry = pT + 21; tc(C.ink); font(9)
    for (const v of cLines) for (const ln of wrap(v, wCol)) { t(M, cy, ln); cy += 11.5 }
    for (const v of lLines) for (const ln of wrap(v, wCol)) { t(x2, ly, ln); ly += 11.5 }
    for (const v of rLines) for (const ln of wrap(v, wCol)) { t(W - M, ry, ln, { align: 'right' }); ry += 11.5 }
    st.y = Math.max(cy, ly, ry) + 6; stroke(BLUE); d.setLineWidth(.8); d.line(M, st.y, W - M, st.y); st.y += 2
  }
  const drawHead = withParties => {
    st.y = 18   // a little room above the title so it isn't squished against the top
    tc(BLUE);        font(15, 'bold');   t(W / 2, st.y, 'Project Proposal', { align: 'center' })
    tc([70, 82, 98]); font(10.5, 'bold'); t(W / 2, st.y + 15, _state + ' IRA Multifamily HEAR Program', { align: 'center' })
    st.y += 23; stroke(BLUE); d.setLineWidth(1); d.line(M, st.y, W - M, st.y)
    if (withParties) { st.y += 8; drawParties() } else { st.y += 10 }
  }
  const contPage = () => { d.addPage(); st.y = M; drawHead(false) }
  const needH = h => { if (st.y + h > H - M - 24) contPage() }
  drawHead(true)
  const head = (txt, gap) => { need(30); st.y += (gap != null ? gap : 14); tc(BLUE); font(10.5, 'bold')
    t(W / 2, st.y + 9, txt.toUpperCase(), { align: 'center' }); st.y += 13; stroke(BLUE); d.setLineWidth(.9)
    d.line(M, st.y, W - M, st.y); st.y += 5 }
  // Section totals line up in two fixed columns; the label sits a tight, fixed
  // gap left of the value column, sized to the widest amount in this document —
  // so "Total Project Cost  $262,500.00" reads as a pair while every amount
  // still right-aligns in one column. (Audit Builder #764.)
  font(9, 'bold')
  const TOT_VALX = W - M, TOT_LBLX = W - M - Math.ceil(d.getTextWidth('(' + _money(m.totalCost) + ')')) - 14
  const rlineE = (lbl, val, bold) => { tc(C.ink); font(9, bold ? 'bold' : 'normal')
    t(TOT_VALX, st.y + 11, String(val), { align: 'right' }); t(TOT_LBLX, st.y + 11, lbl, { align: 'right' }) }
  /* scope table — always Quantity/Units · Labor · Material · Total */
  head('Proposed Scope of Work — HEAR Program', 10)
  const cols = layoutScopeCols(P, _hearScopeCols(_money), m.rows, W - M, M, 210)
  const descW = CW - cols.reduce((a, c) => a + c[2], 0)
  const colXs = [M].concat(cols.map(c => c[3] - c[2])).concat([W - M])
  const colRules = (yTop, yBot) => { stroke(HAIR); d.setLineWidth(.6); colXs.forEach(x => d.line(x, yTop, x, yBot)) }
  const headH = 20
  const tableHeader = () => { need(headH + 8)
    fill(PANEL); d.rect(M, st.y, CW, headH, 'F')
    stroke(BLUE); d.setLineWidth(1); d.line(M, st.y, W - M, st.y)
    tc(NAVY); font(8, 'bold'); t(M + 5, st.y + 13, 'MEASURE')
    cols.forEach(([lbl, , w, rx]) => t(rx - w / 2, st.y + 13, lbl, { align: 'center' }))
    colRules(st.y, st.y + headH)
    stroke(HAIR); d.setLineWidth(.8); d.line(M, st.y + headH, W - M, st.y + headH)
    st.y += headH }
  tableHeader()
  if (!m.rows.length) { tc(C.mut); font(9.5, 'italic'); t(M + 5, st.y + 16, 'No equipment entered yet.'); st.y += 26 }
  m.rows.forEach((r, i) => {
    const sub = subLine(r)
    font(10, 'bold'); const nameLines = wrap((i + 1) + '.  ' + r.label, descW - 10)
    font(8.5); const dl = sub ? wrap(sub, descW - 10) : []
    font(8.5); const desl = r.desc ? wrap(r.desc, descW - 10) : []
    const nameH = nameLines.length * 12, subH = dl.length ? dl.length * 10 : 0, descH = desl.length ? desl.length * 10 : 0
    const h = 5 + nameH + (subH ? 2 + subH : 0) + (descH ? 2 + descH : 0) + 5
    if (st.y + h > H - M - 24) { contPage(); tableHeader() }
    const y0 = st.y
    if (i % 2 === 1) { fill([244, 247, 251]); d.rect(M, y0, CW, h, 'F') }
    tc(C.ink); font(10, 'bold'); nameLines.forEach((ln, k) => t(M + 5, y0 + 5 + k * 12 + 9, ln))
    let dy = y0 + 5 + nameH
    if (dl.length) { dy += 2; font(8.5); tc([70, 82, 98]); dl.forEach((ln, k) => t(M + 5, dy + k * 10 + 8, ln)); dy += subH }
    if (desl.length) { dy += 2; font(8.5); tc([52, 64, 80]); desl.forEach((ln, k) => t(M + 5, dy + k * 10 + 8, ln)); dy += descH }
    const numY = y0 + h / 2 + 3   // numbers centered vertically; Measure stays top-aligned
    cols.forEach(([lbl, fn, w, rx]) => {
      const isTot = (lbl === 'TOTAL')
      font(9.5, isTot ? 'bold' : 'normal'); tc(isTot ? NAVY : [64, 78, 96])
      t(rx - w / 2, numY, fn(r), { align: 'center' })
    })
    st.y = y0 + h; colRules(y0, st.y)
    stroke(HAIR); d.setLineWidth(.6); d.line(M, st.y, W - M, st.y)
  })
  /* scope total */
  { needH(30); st.y += 6; stroke(HAIR); d.setLineWidth(.6); d.line(M, st.y, W - M, st.y); st.y += 2
    rlineE('Total Project Cost', _money(m.totalCost), true); st.y += 14; stroke(BLUE); d.setLineWidth(.9); d.line(M, st.y, W - M, st.y) }
  /* Available Rebates & Incentives — the IRA HEAR instant discount */
  const incentive = m.totalRebate, dueVal = Math.abs(m.totalDue) < 0.005 ? 0 : m.totalDue
  needH(96)
  head('Available Rebates & Incentives', 10)
  { stroke(BLUE); d.setLineWidth(1); d.line(M, st.y, W - M, st.y)
    tc(NAVY); font(8, 'bold'); t(M + 2, st.y + 12, 'PROGRAM'); t(W - M, st.y + 12, 'AMOUNT', { align: 'right' })
    st.y += 15; stroke(HAIR); d.setLineWidth(1.2); d.line(M, st.y, W - M, st.y); st.y += 3
    const nm = 'IRA HEAR — Instant Discount'
    const perUnit = m.units ? Math.round(incentive / m.units * 100) / 100 : incentive
    const desc = stateFullName(m.state) + ' HEAR  ·  ' + m.units + ' units × ' + _money(perUnit) + ' per unit = ' + _money(incentive)
    font(9.5, 'bold'); const nl = wrap(nm, CW - 160)
    font(8.5);         const dl = wrap(desc, CW - 160)
    const h = 6 + nl.length * 12 + (dl.length ? dl.length * 10 + 2 : 0) + 6; const y0 = st.y
    tc(C.ink); font(9.5, 'bold'); nl.forEach((ln, k) => t(M + 2, y0 + 6 + k * 12 + 9, ln))
    if (dl.length) { font(8.5); tc([70, 82, 98]); const dy = y0 + 6 + nl.length * 12 + 2; dl.forEach((ln, k) => t(M + 2, dy + k * 10 + 8, ln)) }
    tc(NAVY); font(10, 'bold'); t(W - M, y0 + h / 2 + 3, '(' + _money(incentive) + ')', { align: 'right' })
    st.y = y0 + h; stroke(C.line); d.setLineWidth(.5); d.line(M, st.y, W - M, st.y); st.y += 3 }
  { st.y += 3; stroke(HAIR); d.setLineWidth(.6); d.line(M, st.y, W - M, st.y); st.y += 2
    rlineE('Total Rebate Amount', _money(incentive), true); st.y += 13; stroke(BLUE); d.setLineWidth(.9); d.line(M, st.y, W - M, st.y) }
  /* Project Summary — right-aligned totals, matching the HOMES proposal */
  needH(92)                                     // keep the header + all three rows off the footer
  head('Project Summary', 10)
  { rlineE('Total Project Cost', _money(m.totalCost), false); st.y += 13; stroke(HAIR); d.setLineWidth(.6); d.line(M, st.y, W - M, st.y); st.y += 2
    rlineE('Total Rebate Amount Applied as Instant Discount', '(' + _money(incentive) + ')', false); st.y += 13; stroke(HAIR); d.setLineWidth(.6); d.line(M, st.y, W - M, st.y); st.y += 2
    rlineE('Total Remaining Amount', _money(dueVal), true); st.y += 14; stroke(BLUE); d.setLineWidth(.9); d.line(M, st.y, W - M, st.y) }
  /* Acceptance & Authorization — signature block */
  needH(48)
  head('Acceptance & Authorization', 24)                                       // clearly separated below the summary
  { const ack = 'By signing below, the property owner accepts this proposal and authorizes Energy Efficiency Services of ' + _state + ' to submit the project information above to the Inflation Reduction Act program team for project reservation and pre-approval and, upon the program’s approval, to complete the work as specified in this proposal.'
    // Left-aligned with natural word spacing. Justifying it (Audit Builder #763)
    // stretched the spaces badly on a paragraph this short, and #764 reverted it
    // there for the same reason.
    const al = wrap(ack, CW); tc(C.ink); font(8.5)
    al.forEach((ln, k) => t(M, st.y + 9 + k * 10.5, ln)); st.y += al.length * 10.5 + 2
    const sigW = 300, dateX = W - M - 150
    st.y += 22; stroke([70, 82, 98]); d.setLineWidth(1); d.line(M, st.y, M + sigW, st.y)   // Printed Name on top
    tc([70, 82, 98]); font(8.5); t(M, st.y + 11, 'Printed Name')
    st.y += 28; stroke([70, 82, 98]); d.setLineWidth(1)                                    // Signature + Date below, with room above the line to sign
    d.line(M, st.y, M + sigW, st.y); d.line(dateX, st.y, W - M, st.y)
    tc([70, 82, 98]); font(8.5); t(M, st.y + 11, 'Property Owner / Authorized Representative — Signature'); t(dateX, st.y + 11, 'Date') }
  _stampEesFooters(P, m.state, pv(F.pjInvDate), 28)
  return d.output('blob')
}

// --- ported: buildHearSealedPdfBlob (index.html 4276,4404) ---
// Sealed (green) HEAR proposal — Sealed, Inc. as primary contractor in the
// header, EES as the line contractor, the Labor / Material / Total scope split,
// the HEAR instant discount, summary.
function buildHearSealedPdfBlob(m) {
  const F = m.fields
  const P = newProposalPdf(_jspdf, 20); const { d, W, H, M, CW, C, st, font, t, wrap, need, fill, stroke, tc } = P
  const GREEN = [33, 131, 82], HAIR = [223, 230, 238], PANEL = [246, 249, 252]
  const bh = (txt, x, yy, al) => { tc(GREEN); font(9, 'bold'); t(x, yy, txt.toUpperCase(), al ? { align: al } : {}) }
  const sh = txt => { st.y += 18; need(48); tc(GREEN); font(10.5, 'bold'); t(W / 2, st.y + 9, txt.toUpperCase(), { align: 'center' })
    stroke(GREEN); d.setLineWidth(1); d.line(M, st.y + 13, W - M, st.y + 13); st.y += 18 }
  const lines9 = (arr, x, yy, al) => { tc(C.ink); font(9); arr.filter(v => v).forEach((ln, k) => t(x, yy + k * 8.6, String(ln), al ? { align: al } : {})); return yy + arr.filter(v => v).length * 8.6 }
  const rline = (lbl, val, bold) => { tc(C.ink); font(9, bold ? 'bold' : 'normal')
    const vw = d.getTextWidth(String(val)); t(W - M, st.y + 10, val, { align: 'right' }); t(W - M - vw - 14, st.y + 10, lbl, { align: 'right' }) }
  const drawTitle = () => {
    tc(GREEN);        font(15, 'bold');   t(W / 2, st.y + 11, 'Project Proposal', { align: 'center' })   // no SEALED, INC. line — the name is in the Primary IRA Contractor column
    tc([70, 82, 98]); font(10.5, 'bold'); t(W / 2, st.y + 26, stateFullName(m.state) + ' IRA Multifamily HEAR Program - Project Reservation', { align: 'center' })
    st.y += 34; stroke(GREEN); d.setLineWidth(1); d.line(M, st.y, W - M, st.y); st.y += 10
  }
  const contPage = () => { d.addPage(); st.y = M - 6; drawTitle() }
  const needH = h => { if (st.y + h > H - M - 16) contPage() }
  st.y = M - 6; drawTitle()
  const CX2 = M + 200
  const projInfo = [F.pjInstallAddr, F.pjCsz, 'Multi-Family', (m.units ? ('Total Units: ' + m.units) : ''),
    (F.pjIQ ? ('IQ Number: ' + F.pjIQ) : '')].filter(v => v && String(v).trim())
  const ci = [F.pjOwner, contactWithTitle(F), F.pjOwnerAddr, F.pjOwnerCsz, _phone(F.pjPhone), F.pjEmail]
  bh('Primary IRA Contractor:', M, st.y); bh('Project Information:', CX2, st.y); bh('Customer Information:', W - M, st.y, 'right')
  const cW1 = CX2 - M - 8
  const contractorLines = ['Sealed, Inc.', '200 E Verona Ave', 'Verona, WI 53593', _phone('(949) 832-6798'),
    ('Support Contractor: Energy Efficiency Services of ' + stateFullName(m.state))].filter(v => v && String(v).trim()).flatMap(v => wrap(String(v), cW1))
  let y1 = lines9(contractorLines, M, st.y + 13)
  let y2 = lines9(projInfo, CX2, st.y + 13)
  let y3 = lines9(ci, W - M, st.y + 13, 'right')
  st.y = Math.max(y1, y2, y3)
  st.y += 8; stroke(GREEN); d.setLineWidth(.8); d.line(M, st.y, W - M, st.y); st.y += 2
  /* scope table — Contractor | Measure | Qty | Labor | Material | Total. EES is
     the support contractor performing the work under Sealed, Inc. */
  sh('Project Scope of Work')
  const contractor = 'Energy Efficiency Services of ' + stateFullName(m.state)
  const cW = 76                                          // contractor column (left)
  const numDefs = layoutScopeCols(P, [['QTY', r => String(r.qty), 38], ['LABOR', r => _money(r.labor), 54],
    ['MATERIAL', r => _money(r.material), 54], ['TOTAL', r => _money(r.cost), 56]], m.rows, W - M, M + cW, 180)
  const measX = M + cW, measRx = numDefs[0][3] - numDefs[0][2], measW = measRx - measX  // measure spans between contractor and the numeric block
  const colXs = [M, measX].concat(numDefs.map(c => c[3] - c[2])).concat([W - M])
  const colRules = (yTop, yBot) => { stroke(HAIR); d.setLineWidth(.6); colXs.forEach(x => d.line(x, yTop, x, yBot)) }
  const headH = 20
  const tableHeader = () => { need(headH + 8)
    fill(PANEL); d.rect(M, st.y, CW, headH, 'F')
    stroke(GREEN); d.setLineWidth(1); d.line(M, st.y, W - M, st.y)
    tc(GREEN); font(8, 'bold'); t(M + 5, st.y + 13, 'CONTRACTOR'); t(measX + 4, st.y + 13, 'MEASURE')
    numDefs.forEach(([lbl, , w, rx]) => t(rx - w / 2, st.y + 13, lbl, { align: 'center' }))
    colRules(st.y, st.y + headH)
    stroke(HAIR); d.setLineWidth(.8); d.line(M, st.y + headH, W - M, st.y + headH)
    st.y += headH }
  tableHeader()
  if (!m.rows.length) { tc(C.mut); font(9.5, 'italic'); t(measX + 4, st.y + 16, 'No equipment entered yet.'); st.y += 26 }
  m.rows.forEach((r, i) => {
    const sub = subLine(r)
    font(10, 'bold'); const nameLines = wrap((i + 1) + '.  ' + r.label, measW - 8)
    font(8.5); const dl = sub ? wrap(sub, measW - 8) : []
    font(8.5); const desl = r.desc ? wrap(r.desc, measW - 8) : []
    font(8);   const cl = wrap(contractor, cW - 8)
    const nameH = nameLines.length * 12, subH = dl.length ? dl.length * 10 : 0, descH = desl.length ? desl.length * 10 : 0
    const h = Math.max(6 + nameH + (subH ? 3 + subH : 0) + (descH ? 3 + descH : 0) + 6, 6 + cl.length * 10 + 6)
    if (st.y + h > H - M - 16) { contPage(); tableHeader() }
    const y0 = st.y
    if (i % 2 === 1) { fill(C.zebra); d.rect(M, y0, CW, h, 'F') }
    tc([64, 78, 96]); font(8); cl.forEach((ln, k) => t(M + 5, y0 + 6 + k * 10 + 8, ln))          // contractor (left)
    tc(C.ink); font(10, 'bold'); nameLines.forEach((ln, k) => t(measX + 4, y0 + 6 + k * 12 + 9, ln))
    let dy = y0 + 6 + nameH
    if (dl.length) { dy += 3; font(8.5); tc([70, 82, 98]); dl.forEach((ln, k) => t(measX + 4, dy + k * 10 + 8, ln)); dy += subH }
    if (desl.length) { dy += 3; font(8.5); tc([52, 64, 80]); desl.forEach((ln, k) => t(measX + 4, dy + k * 10 + 8, ln)); dy += descH }
    const numY = y0 + h / 2 + 3
    numDefs.forEach(([lbl, fn, w, rx]) => { const isTot = (lbl === 'TOTAL')
      font(9.5, isTot ? 'bold' : 'normal'); tc(isTot ? C.ink : [64, 78, 96]); t(rx - w / 2, numY, fn(r), { align: 'center' }) })
    st.y = y0 + h; colRules(y0, st.y)
    stroke(HAIR); d.setLineWidth(.6); d.line(M, st.y, W - M, st.y)
  })
  const incentive = m.totalRebate, dueVal = Math.abs(m.totalDue) < 0.005 ? 0 : m.totalDue
  { need(28); st.y += 6; stroke(C.line); d.setLineWidth(.6); d.line(M, st.y, W - M, st.y); st.y += 3
    rline('Total Project Cost', _money(m.totalCost), true); st.y += 13; stroke(C.line); d.setLineWidth(.6); d.line(M, st.y, W - M, st.y); st.y += 4 }
  needH(150)
  sh('Available Rebates & Incentives')
  { st.y += 4; bh('Inflation Reduction Act HEAR Rebate', M, st.y)
    const perUnit = m.units ? Math.round(incentive / m.units * 100) / 100 : incentive
    st.y += 4; stroke(C.line); d.setLineWidth(1); d.line(M, st.y, W - M, st.y)
    const desc = stateFullName(m.state) + ' HEAR  ·  ' + m.units + ' units × ' + _money(perUnit) + ' per unit'
    const dl = wrap(desc, 270), h = Math.max(dl.length * 9, 18) + 8; need(h)
    tc(C.ink); font(8); dl.forEach((ln, k) => t(M, st.y + 11 + k * 9, ln))
    wrap('IRA HEAR - Instant Discount', 150).forEach((ln, k) => t(M + 300, st.y + 11 + k * 9, ln))
    tc(C.ink); font(9, 'bold'); t(W - M, st.y + 11, _money(incentive), { align: 'right' })
    st.y += h; stroke(C.line); d.line(M, st.y, W - M, st.y) }
  { need(26); st.y += 8; stroke(C.line); d.setLineWidth(.6); d.line(M, st.y, W - M, st.y); st.y += 3
    rline('Total Rebate Amount', _money(incentive), true); st.y += 13; stroke(C.line); d.setLineWidth(.6); d.line(M, st.y, W - M, st.y); st.y += 4 }
  needH(96)                                    // keep the summary header + all three rows off the footer
  sh('Project Summary')
  const trows = [['Total Project Cost', _money(m.totalCost), false],
    ['Total Rebate Amount Applied as Instant Discount', '(' + _money(incentive) + ')', false],
    ['Total Remaining Amount', _money(dueVal), true]]
  for (const [lbl, val, strong] of trows) {
    if (strong) { rline(lbl, val, true) } else { tc(C.ink); font(9, 'normal'); t(M, st.y + 10, lbl); t(W - M, st.y + 10, val, { align: 'right' }) }
    stroke(C.line); d.setLineWidth(.5); d.line(M, st.y + 14, W - M, st.y + 14); st.y += 14 }
  /* Acceptance & Authorization — signature block */
  needH(118)
  sh('Acceptance & Authorization')
  { const ack = 'By signing below, the property owner accepts this proposal and authorizes Sealed, Inc. and its support contractor Energy Efficiency Services of ' + stateFullName(m.state) + ' to submit the project information above to the Inflation Reduction Act program team for project reservation and pre-approval and, upon the program’s approval, to complete the work as specified in this proposal.'
    const al = wrap(ack, CW); tc(C.ink); font(8.5); al.forEach((ln, k) => t(M, st.y + 9 + k * 10.5, ln)); st.y += al.length * 10.5 + 2   // full width, left-aligned
    const sigW = 300, dateX = W - M - 150
    st.y += 22; stroke([68, 88, 110]); d.setLineWidth(1)                                 // room above the line to actually sign
    d.line(M, st.y, M + sigW, st.y); d.line(dateX, st.y, W - M, st.y)
    tc(C.mut); font(8.5); t(M, st.y + 11, 'Property Owner / Authorized Representative — Signature'); t(dateX, st.y + 11, 'Date')
    st.y += 24; stroke([68, 88, 110]); d.setLineWidth(1)                                 // separate printed-name line
    d.line(M, st.y, M + sigW, st.y)
    tc(C.mut); font(8.5); t(M, st.y + 11, 'Printed Name') }
  _stampSealedFooters(P, 'Project Proposal', F.pjProjInvNo || F.pjIQ || '', F.pjInvDate)
  return d.output('blob')
}
