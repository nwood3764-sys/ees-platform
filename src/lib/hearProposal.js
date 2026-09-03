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

// --- Acceptance & Authorization — ONE definition, both HEAR proposals -------
// This is the one part of the proposal a person is asked to act on, so it is
// centred: the paragraph sits in its own narrower measure under the centred
// heading, and the signature lines are a centred block rather than a rule
// running the full width of the page.
//
// Drawn once for the EES (blue) and Sealed (green) documents. Two hand-rolled
// copies of one signature block is two chances for one of them to drift — the
// lesson `pinnedTableHeader.js` and `dateDisplay.js` already record. Only the
// ink colour and the heading differ, so only those are passed in.
//
// The geometry is exported because it is the thing that can be wrong without
// looking wrong: a caption wider than its own rule, a block that is not
// actually centred, or a signature line with no room above it to sign in.
export const HEAR_ACCEPTANCE = {
  // The paragraph runs nearly the full width of the page (Nicholas, 2026-09-03:
  // "the margins a lot less"), inset only enough that the centred text does not
  // touch the rules above it, and set larger than the document's small print
  // because it is the sentence being agreed to.
  TEXT_INSET: 12,
  // Largest first. THE BLOCK NEVER SPILLS ONTO A SECOND PAGE (Nicholas: "there
  // is no way this can spill onto two pages with one measure record") — so the
  // size is not a constant but the largest of these that still fits in the room
  // left on the page. A longer sentence (the Sealed proposal names two
  // companies) or a longer state name costs a line and steps the size down
  // instead of pushing a signature page out.
  FONT_SIZES: [10, 9.5, 9, 8.5],
  // …and if even the smallest size will not fit, the writing gaps tighten
  // before a second page is spent. 0.7 still leaves 28pt to print a name in and
  // 29pt to sign in.
  GAP_SCALES: [1, 0.85, 0.7],
  LINE_RATIO: 1.3,          // line height as a multiple of the size
  // The signature block is LEFT justified on the page margin, and the Date
  // follows the signature rather than sitting at the far right edge: the two
  // are one act, so they read as one row.
  SIGNATURE_WIDTH: 290,
  DATE_WIDTH: 150,
  COLUMN_GAP: 24,           // between the signature rule and the date rule
  PARAGRAPH_TO_RULE: 40,    // paragraph down to the printed-name rule — this is
                            // the room a person WRITES their name in, so it is
                            // sized like the signing gap below it, not like a
                            // paragraph margin (Nicholas, 2026-09-03: "there's
                            // no room for the printed name to be entered")
  NAME_TO_SIGNATURE: 42,    // rule to rule — a signature needs room above its line
  CAPTION_DROP: 11,         // caption baseline below its rule
  // Air between the last caption and the page footer rule. Two lines' worth
  // (Nicholas, 2026-09-03: "it can't be all the way at the bottom, maybe leave
  // it like two lines from the bottom") — the block reads as sitting at the
  // foot of the page rather than falling off it.
  FOOTER_CLEARANCE: 38,
  CAPTIONS: {
    name: 'Printed Name',
    title: 'Title',
    signature: 'Property Owner / Authorized Representative — Signature',
    date: 'Date',
  },
}

// How much vertical room the whole block needs, heading included, measured from
// the cursor down to the last caption's baseline. `headingHeight` is what the
// caller's own section heading costs, because the two documents draw theirs
// differently — measured, not guessed: leaving the heading out of this sum once
// put the Sealed proposal's Date caption 0.4pt above the page footer.
//
// The footer clearance is NOT in here. It belongs to the page (the caller's
// floorY), not to the block, and counting it twice is what made the block
// shorter than the room it was actually given.
export function hearAcceptanceHeight(lineCount, size, headingHeight, gapScale = 1) {
  const A = HEAR_ACCEPTANCE
  return headingHeight + lineCount * (size * A.LINE_RATIO)
    + A.PARAGRAPH_TO_RULE * gapScale + A.NAME_TO_SIGNATURE * gapScale + A.CAPTION_DROP
}

export function hearAcceptanceGeometry(P) {
  const { W, M, CW } = P
  const A = HEAR_ACCEPTANCE
  const textWidth = CW - 2 * A.TEXT_INSET
  // Left justified: the block starts on the page margin. It is sized to its two
  // rules rather than to the page, so it never runs past the right margin on a
  // narrower page.
  const blockX = M
  const available = CW - A.COLUMN_GAP
  const signatureWidth = Math.min(A.SIGNATURE_WIDTH, available * 0.66)
  const dateWidth = Math.min(A.DATE_WIDTH, available - signatureWidth)
  const blockWidth = signatureWidth + A.COLUMN_GAP + dateWidth
  return { textWidth, blockWidth, blockX, dateWidth, signatureWidth,
    dateX: blockX + signatureWidth + A.COLUMN_GAP, centerX: W / 2 }
}

function drawHearAcceptance(P, { text, rule, drawHeading, headingHeight, floorY, needH,
                                signerName, signerTitle }) {
  const { d, st, font, t, wrap, stroke, tc } = P
  const A = HEAR_ACCEPTANCE
  const g = hearAcceptanceGeometry(P)
  const CAPTION = [70, 82, 98]

  // Largest size that still fits in the room left on this page. Ends on the
  // smallest size if none of them fit, and needH then moves the whole block to
  // a fresh page rather than letting it run through the footer — that is the
  // only case where a second page is correct.
  //
  // The writing gaps give way before the page does. A block that will not fit
  // tries the next size down and, failing that, tighter gaps — the Sealed
  // proposal names two companies, so its paragraph is a line longer and the
  // full 40/42pt of writing room does not fit under its own scope table. A
  // slightly tighter signing space on one document is worth far more than a
  // second page on it.
  let fit = null
  outer:
  for (const scale of A.GAP_SCALES) {
    for (const size of A.FONT_SIZES) {
      font(size)
      const lines = wrap(text, g.textWidth)
      fit = { size, scale, lines, height: hearAcceptanceHeight(lines.length, size, headingHeight, scale) }
      if (st.y + fit.height <= floorY) break outer
    }
  }
  if (st.y + fit.height > floorY) {
    needH(fit.height)                 // genuinely no room: a fresh page, whole
  } else {
    // ANCHORED TO THE FOOT OF THE PAGE (Nicholas, 2026-09-03: "move the
    // acceptance and authorization section down more"). A fixed lead below the
    // Project Summary can only ever be as generous as the emptiest page allows;
    // sitting the block on the page's floor instead spends every point the page
    // has left on the gap above it, and spends it automatically — a fuller
    // proposal keeps the block where it lands, a lighter one pushes it right
    // down. The separation is a RESULT of the page, not a number somebody has
    // to re-tune each time a section grows.
    st.y = floorY - fit.height
  }
  drawHeading()

  const lineHeight = fit.size * A.LINE_RATIO
  tc([34, 43, 53]); font(fit.size)
  fit.lines.forEach((ln, k) => t(g.centerX, st.y + fit.size + k * lineHeight, ln, { align: 'center' }))
  st.y += fit.lines.length * lineHeight

  // Captions sit under the LEFT end of their own rule, where the writing starts.
  const caption = (x, txt) => { tc(CAPTION); font(8); t(x, st.y + A.CAPTION_DROP, txt) }

  st.y += A.PARAGRAPH_TO_RULE * fit.scale                      // Printed Name on top
  // The name is already known, so it is already there (Nicholas, 2026-09-03:
  // "put printed name, his name, then on the right-hand side of that same line
  // put his title... let's make this kind of pre-populated"). It is the same
  // contact the header names as the customer, so the person signing is not
  // asked to re-type what the record already says — all that is left is the
  // signature. A record with no contact leaves the line empty to be written on.
  const who = String(signerName || '').trim()
  const role = String(signerTitle || '').trim()
  let titleX = null
  let nameRuleWidth = g.signatureWidth
  if (who) {
    font(10)
    const nameWidth = d.getTextWidth(who)
    if (role) {
      // Four spaces after the name, on the SAME line — the title belongs to the
      // person, so it reads straight on from their name. Right-aligning it put
      // it over the Date column, where it read as the date's label.
      titleX = g.blockX + 2 + nameWidth + d.getTextWidth('    ')
      font(9)
      // The rule has to be long enough to hold both, and no shorter than the
      // signature rule below it — a long title lengthens the line rather than
      // running off the end of it.
      nameRuleWidth = Math.min(g.blockWidth,
        Math.max(g.signatureWidth, titleX + d.getTextWidth(role) + 4 - g.blockX))
    }
    tc([34, 43, 53]); font(10)
    t(g.blockX + 2, st.y - 4, who)
    if (titleX != null) { tc([34, 43, 53]); font(9); t(titleX, st.y - 4, role) }
  }
  stroke(rule); d.setLineWidth(1); d.line(g.blockX, st.y, g.blockX + nameRuleWidth, st.y)
  caption(g.blockX, A.CAPTIONS.name)
  // The title gets its own caption under the line, in line with its own value —
  // the same way Printed Name sits under the name.
  if (titleX != null) caption(titleX, A.CAPTIONS.title)

  st.y += A.NAME_TO_SIGNATURE * fit.scale                      // then Signature + Date
  stroke(rule); d.setLineWidth(1)
  d.line(g.blockX, st.y, g.blockX + g.signatureWidth, st.y)
  d.line(g.dateX, st.y, g.dateX + g.dateWidth, st.y)
  caption(g.blockX, A.CAPTIONS.signature)
  caption(g.dateX, A.CAPTIONS.date)
  st.y += A.CAPTION_DROP + 4
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
  // Three EVEN columns, each read from its own left edge (Nicholas, 2026-09-03:
  // "they're not aligned properly, they're all pushed to the right and left").
  // The customer column used to be right-aligned on the page edge, so it was
  // ragged down its left side while its two neighbours were ragged down their
  // right — three columns, three different reading edges. A wrapped value (a
  // long contact title) now indents under its own column instead of drifting
  // away from the two beside it.
  const drawParties = () => {
    const pT = st.y, colW = CW / 3, wCol = colW - 14
    const colX = [M, M + colW, M + 2 * colW]
    tc(BLUE); font(8.5, 'bold')
    t(colX[0], pT + 8, 'PRIMARY IRA CONTRACTOR')
    t(colX[1], pT + 8, 'PROJECT INFORMATION')
    t(colX[2], pT + 8, 'CUSTOMER INFORMATION')
    const ys = [pT + 21, pT + 21, pT + 21]; tc(C.ink); font(9)
    const cols = [cLines, lLines, rLines]
    cols.forEach((lines, i) => {
      for (const v of lines) for (const ln of wrap(v, wCol)) { t(colX[i], ys[i], ln); ys[i] += 11.5 }
    })
    st.y = Math.max(...ys) + 6; stroke(BLUE); d.setLineWidth(.8); d.line(M, st.y, W - M, st.y); st.y += 2
  }
  const drawHead = withParties => {
    st.y = 18   // a little room above the title so it isn't squished against the top
    tc(BLUE);        font(15, 'bold');   t(W / 2, st.y, 'Project Proposal', { align: 'center' })
    tc([70, 82, 98]); font(10.5, 'bold'); t(W / 2, st.y + 15, _state + ' IRA Multifamily HEAR Program', { align: 'center' })
    // A clear line's worth of air under the programme name before the rule
    // (Nicholas, 2026-09-03) — it was sitting 8pt under a 10.5pt line, which
    // reads as the rule underlining the text rather than closing the header.
    st.y += 29; stroke(BLUE); d.setLineWidth(1); d.line(M, st.y, W - M, st.y)
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
  /* Acceptance & Authorization — centred signature block (shared with Sealed) */
  drawHearAcceptance(P, {
    text: 'By signing below, the property owner accepts this proposal and authorizes Energy Efficiency Services of ' + _state + ' to submit the project information above to the Inflation Reduction Act program team for project reservation and pre-approval and, upon the program’s approval, to complete the work as specified in this proposal.',
    rule: [70, 82, 98],
    needH,
    signerName: F.pjContact,
    signerTitle: F.pjContactTitle,
    // head() costs its gap + 18pt of heading and rule. The 24pt lead is a
    // clear break from the Project Summary above it (Nicholas, 2026-09-03:
    // "move the acceptance and authorization down some, it's too close to the
    // total remaining amount") — the block buys it back out of its own text
    // size if a page ever runs short, never out of a second page.
    headingHeight: 24 + 18,
    // The page's floor for this block: its own footer rule (drawn 28pt up on
    // this document), less the air the last caption keeps above it.
    floorY: H - 28 - HEAR_ACCEPTANCE.FOOTER_CLEARANCE,
    drawHeading: () => head('Acceptance & Authorization', 24),
  })
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
    st.y += 40; stroke(GREEN); d.setLineWidth(1); d.line(M, st.y, W - M, st.y); st.y += 10   // same air under the programme name as the EES header
  }
  const contPage = () => { d.addPage(); st.y = M - 6; drawTitle() }
  const needH = h => { if (st.y + h > H - M - 16) contPage() }
  st.y = M - 6; drawTitle()
  // Three EVEN columns, each read from its own left edge — the same rule as the
  // EES header above; the customer column used to be right-aligned on the page
  // edge and read as a fourth alignment.
  const colW3 = CW / 3, CX2 = M + colW3, CX3 = M + 2 * colW3, wCol3 = colW3 - 14
  const projInfo = [F.pjInstallAddr, F.pjCsz, 'Multi-Family', (m.units ? ('Total Units: ' + m.units) : ''),
    (F.pjIQ ? ('IQ Number: ' + F.pjIQ) : '')].filter(v => v && String(v).trim())
  const ci = [F.pjOwner, contactWithTitle(F), F.pjOwnerAddr, F.pjOwnerCsz, _phone(F.pjPhone), F.pjEmail]
    .filter(v => v && String(v).trim()).flatMap(v => wrap(String(v), wCol3))
  bh('Primary IRA Contractor:', M, st.y); bh('Project Information:', CX2, st.y); bh('Customer Information:', CX3, st.y)
  const contractorLines = ['Sealed, Inc.', '200 E Verona Ave', 'Verona, WI 53593', _phone('(949) 832-6798'),
    ('Support Contractor: Energy Efficiency Services of ' + stateFullName(m.state))].filter(v => v && String(v).trim()).flatMap(v => wrap(String(v), wCol3))
  let y1 = lines9(contractorLines, M, st.y + 13)
  let y2 = lines9(projInfo.flatMap(v => wrap(String(v), wCol3)), CX2, st.y + 13)
  let y3 = lines9(ci, CX3, st.y + 13)
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
  /* Acceptance & Authorization — the same centred block as the EES proposal,
     in Sealed's ink. It also puts Printed Name above the signature, which the
     two documents used to disagree about. */
  drawHearAcceptance(P, {
    text: 'By signing below, the property owner accepts this proposal and authorizes Sealed, Inc. and its support contractor Energy Efficiency Services of ' + stateFullName(m.state) + ' to submit the project information above to the Inflation Reduction Act program team for project reservation and pre-approval and, upon the program’s approval, to complete the work as specified in this proposal.',
    rule: [68, 88, 110],
    needH,
    signerName: F.pjContact,
    signerTitle: F.pjContactTitle,
    headingHeight: 36,               // sh() leads 18pt and clears 18pt after its rule
    floorY: H - 24 - HEAR_ACCEPTANCE.FOOTER_CLEARANCE,   // Sealed draws its footer 24pt up
    drawHeading: () => sh('Acceptance & Authorization'),
  })
  _stampSealedFooters(P, 'Project Proposal', F.pjProjInvNo || F.pjIQ || '', F.pjInvDate)
  return d.output('blob')
}
