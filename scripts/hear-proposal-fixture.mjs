// Fixture — the IRA Multifamily HEAR proposal's scope and its money.
//
// The HEAR proposal is built from the opportunity's LINE ITEMS rather than from
// a parsed Asset Score, so two things have to hold or the document is wrong in
// a way nobody can see by reading it:
//
//   1. every HEAR product in the catalog reaches the page, and a line that is
//      NOT a programme measure is reported rather than silently dropped;
//   2. the arithmetic is exact — the per-line labor/material split must sum
//      back to the line total to the cent, and the rebate must cover 100% of
//      the cost so the balance due is $0.00.
//
// Every scope below is a real opportunity on prod, read on 2026-09-02.

import {
  HEAR_MEASURES, computeHearModel, hearRowsFromLineItems,
  hearMeasureForProductCode, hearDefaultDesc,
  layoutScopeCols, _hearScopeCols, loadJsPdf,
  HEAR_ACCEPTANCE, generateHearProposalBlob,
} from '../src/lib/hearProposal.js'
import { newProposalPdf, money } from '../src/lib/proposalPdfKit.js'

let checks = 0, failures = 0
const eq = (label, actual, expected) => {
  checks += 1
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) return
  failures += 1
  console.log(`FAIL  ${label}\n      expected ${e}\n      got      ${a}`)
}
const ok = (label, cond) => eq(label, !!cond, true)

// ── 1. Every HEAR product in the catalog is a measure ─────────────────────
// These seven codes are the HEAR products seeded in `products`. A code that
// resolves to nothing is a line item that would vanish from the proposal.
const CATALOG = {
  'HEAR-PANEL':               'panel',
  'HEAR-STOVE':               'cooking',
  'HEAR-WIRING':              'wiring',
  'HEAR-DRYER':               'dryer',
  'HEAR-HP-SPACE-HEAT-COOL':  'heat_pump',
  'HEAR-HPWH':                'hpwh',
  'HEAR-VENT':                'weatherization',
}
for (const [code, key] of Object.entries(CATALOG)) {
  eq(`product ${code} is the ${key} measure`, hearMeasureForProductCode(code), key)
}
eq('every measure is reachable from at least one product code',
  HEAR_MEASURES.filter(m => !(m.productCodes || []).length).map(m => m.key), [])
eq('measure keys are unique', HEAR_MEASURES.length, new Set(HEAR_MEASURES.map(m => m.key)).size)
eq('a product code maps to exactly one measure',
  Object.values(CATALOG).length, new Set(Object.values(CATALOG)).size)
eq('the code match ignores case and padding', hearMeasureForProductCode('  hear-hpwh '), 'hpwh')

// ── 2. A line that is not a programme measure is REPORTED, not dropped ────
// An Energy Audit on a HEAR opportunity belongs to the audit programme. The
// danger is not that it is excluded — it is that it is excluded silently.
{
  const { rows, unmapped } = hearRowsFromLineItems([
    { productCode: 'HEAR-VENT', productName: 'ENERGY STAR Ventilation', quantity: 11, unitPrice: 1600 },
    { productCode: 'SVC-ENERGY-AUDIT', productName: 'Energy Audit', quantity: 1, unitPrice: 2000 },
    { productCode: '', productName: 'Exhaust fan', quantity: 3, unitPrice: 400 },
  ])
  eq('only the HEAR line becomes scope', rows.map(r => r.measure), ['weatherization'])
  eq('the other two are named back to the user', unmapped, ['Energy Audit', 'Exhaust fan'])
}

// ── 3. ENR-00068 / OPP "3002 West Darling Street" — 11 × $1,600 ───────────
{
  const { rows } = hearRowsFromLineItems([{
    productCode: 'HEAR-VENT', productName: 'ENERGY STAR Ventilation',
    quantity: 11, unitPrice: 1600, lineDescription: 'ENERGY STAR ventilation',
  }])
  const m = computeHearModel({ rows, units: 11, fields: { pjCsz: 'Appleton, WI 54914' } })
  eq('line total is per-unit x quantity', m.rows[0].cost, 17600)
  eq('total project cost', m.totalCost, 17600)
  eq('the rebate covers 100% of the cost', m.totalRebate, 17600)
  eq('the balance due is always zero', m.totalDue, 0)
  eq('state comes off the city/state/zip line', m.state, 'WI')
  eq('labor + material sum back to the line total',
    Math.round((m.rows[0].labor + m.rows[0].material) * 100) / 100, m.rows[0].cost)
  // Ventilation is the one measure whose description is programme-critical:
  // the $1,600 incentive is only eligible paired with air sealing, and the
  // reviewer needs to see that stated.
  ok('the ventilation line states the companion air-sealing project',
    /air sealing/i.test(m.rows[0].desc))
  ok('the line item’s own wording rides the sub-line', m.rows[0].lineNote === 'ENERGY STAR ventilation')
}

// ── 4. ENR-00056 / OPP "779 Maple Avenue" — heat pump + wiring, 25 units ──
{
  const { rows } = hearRowsFromLineItems([
    { productCode: 'HEAR-HP-SPACE-HEAT-COOL', productName: 'ENERGY STAR Electric Heat Pump for Space Heating and Cooling',
      quantity: 25, unitPrice: 8000, manufacturer: 'Mitsubishi', modelNumber: 'MXZ-8C48NAHZ',
      seer2: 18.5, hspf2: 9.2, lineDescription: 'ENERGY STAR electric heat pump for space heating and cooling' },
    { productCode: 'HEAR-WIRING', productName: 'Electrical Wiring',
      quantity: 25, unitPrice: 2500, lineDescription: 'Electrical Wiring' },
  ])
  const m = computeHearModel({ rows, units: 25, fields: { pjCsz: 'Columbus, WI 53925' } })
  eq('two scope lines', m.rows.length, 2)
  eq('heat pump line total', m.rows[0].cost, 200000)
  eq('wiring line total', m.rows[1].cost, 62500)
  eq('total project cost', m.totalCost, 262500)
  eq('rebate equals cost', m.totalRebate, 262500)
  eq('per-unit incentive on the rebate line', Math.round(m.totalRebate / m.units * 100) / 100, 10500)
  // The model/efficiency sub-line is built from the PRODUCT, so nobody retypes
  // what the catalog already knows.
  ok('the heat pump prints its make and model', /Mitsubishi MXZ-8C48NAHZ/.test(m.rows[0].modelStr))
  ok('the heat pump prints its efficiencies', /9\.2 HSPF2/.test(m.rows[0].effStr) && /18\.5 SEER2/.test(m.rows[0].effStr))
  // Wiring has no model fields and no metrics — it must print neither, rather
  // than an empty separator.
  eq('wiring prints no model string', m.rows[1].modelStr, '')
  eq('wiring prints no efficiency string', m.rows[1].effStr, '')
}

// ── 5. The labor/material split is exact on an ODD total ──────────────────
// Control: rounding BOTH halves is the obvious implementation and it is wrong —
// on an odd cent it produces two halves that sum to a cent more than the line.
{
  const { rows } = hearRowsFromLineItems([
    { productCode: 'HEAR-HPWH', productName: 'ENERGY STAR Electric Heat Pump Water Heater',
      quantity: 3, unitPrice: 1234.57 },
  ])
  const m = computeHearModel({ rows, units: 3, fields: {} })
  const line = m.rows[0]
  eq('odd line total', line.cost, 3703.71)
  eq('labor + material is exact', Math.round((line.labor + line.material) * 100) / 100, line.cost)
  const naive = Math.round(line.cost / 2 * 100) / 100
  ok('CONTROL: rounding both halves would overshoot by a cent',
    Math.round((naive * 2) * 100) / 100 !== line.cost)
}

// ── 6. Quantity and price are read defensively ───────────────────────────
{
  const { rows } = hearRowsFromLineItems([
    // PostgREST returns numerics as strings; a blank quantity must not zero the line.
    { productCode: 'HEAR-PANEL', productName: 'Electrical Panel', quantity: '4', unitPrice: '4000.00' },
    { productCode: 'HEAR-STOVE', productName: 'Electric Stove', quantity: null, unitPrice: '840' },
  ])
  const m = computeHearModel({ rows, units: 4, fields: {} })
  eq('a numeric-as-string quantity multiplies', m.rows[0].cost, 16000)
  eq('a missing quantity counts as one, never zero', m.rows[1].qty, 1)
  eq('total across both lines', m.totalCost, 16840)
}

// ── 7. An empty scope produces no proposal, and says so ──────────────────
{
  const m = computeHearModel({ rows: [], units: 12, fields: {} })
  eq('no rows', m.rows.length, 0)
  eq('no cost', m.totalCost, 0)
  eq('no rebate', m.totalRebate, 0)
  eq('still no balance due', m.totalDue, 0)
}

// ── 8. hearDefaultDesc: every measure carries programme wording ──────────
for (const meas of HEAR_MEASURES) {
  ok(`${meas.key} has a default programme description`, hearDefaultDesc(meas.key, '').length > 40)
}
ok('mechanical ventilation overrides with the air-sealing pairing',
  hearDefaultDesc('weatherization', 'Mechanical Ventilation') !== hearDefaultDesc('weatherization', ''))

// ── 9. The money columns are sized to the money in them ──────────────────
// jsPDF does not clip: a figure wider than its column overprints its neighbour.
// The standalone builder's widths were fixed at the size of its own example
// figures ($8,800.00), so a real 25-unit heat pump line ($200,000.00) printed
// "$100,000.00$100,000.00$200,000.00" as one unreadable string.
{
  const jsPDF = await loadJsPdf()
  const P = newProposalPdf(jsPDF, 20)
  const { d, W, M, font } = P
  const { rows } = hearRowsFromLineItems([
    { productCode:'HEAR-HP-SPACE-HEAT-COOL', quantity:25, unitPrice:8000 },
    { productCode:'HEAR-WIRING', quantity:25, unitPrice:2500 },
  ])
  const m = computeHearModel({ rows, units:25, fields:{} })
  const cols = layoutScopeCols(P, _hearScopeCols(money), m.rows, W - M, M, 210)

  // A figure is drawn CENTRED in its column, so the column has to carry the
  // figure AND a gutter — abutting figures read as one number even though
  // nothing is clipped or overprinted.
  const GUTTER = 10
  font(9.5, 'bold')
  const widest = lbl => Math.max(...m.rows.map(r =>
    d.getTextWidth(String(cols.find(c => c[0] === lbl)[1](r)))))
  for (const lbl of ['LABOR', 'MATERIAL', 'TOTAL']) {
    const col = cols.find(c => c[0] === lbl)
    ok(`${lbl} column holds its widest figure with a gutter`, col[2] >= widest(lbl) + GUTTER)
  }
  // CONTROL: the standalone builder's FIXED Sealed widths (54/54/56pt) leave
  // "$100,000.00" (52.3pt) barely 1.7pt of gutter — which is what printed
  // "$100,000.00$100,000.00$200,000.00" on the real 25-unit scope. This must
  // stay failing, or the checks above prove nothing.
  const SEALED_FIXED = { LABOR: 54, MATERIAL: 54, TOTAL: 56 }
  ok('CONTROL: the original fixed Sealed widths leave no legible gutter',
    ['LABOR','MATERIAL','TOTAL'].every(lbl => SEALED_FIXED[lbl] - widest(lbl) < 4))

  // ...and the fitted Sealed columns do fit them.
  const sealedCols = layoutScopeCols(P, [['QTY', r => String(r.qty), 38],
    ['LABOR', r => money(r.labor), 54], ['MATERIAL', r => money(r.material), 54],
    ['TOTAL', r => money(r.cost), 56]], m.rows, W - M, M + 76, 180)
  font(9.5, 'bold')
  for (const col of sealedCols.slice(1)) {
    const need = Math.max(...m.rows.map(r => d.getTextWidth(String(col[1](r)))))
    ok(`Sealed ${col[0]} column holds its widest figure with a gutter`, col[2] >= need + GUTTER)
  }

  // Columns are contiguous and end exactly on the right margin — a gap or an
  // overlap between them is what the rule sheet would draw through.
  eq('the last column ends on the right margin', cols[cols.length - 1][3], W - M)
  for (let i = 1; i < cols.length; i++) {
    eq(`column ${i} starts where column ${i - 1} ends`, cols[i][3] - cols[i][2], cols[i - 1][3])
  }
  // The MEASURE column keeps its floor even when the figures are enormous.
  const huge = computeHearModel({ rows: hearRowsFromLineItems([
    { productCode:'HEAR-HP-SPACE-HEAT-COOL', quantity:9999, unitPrice:99999 }]).rows, units:1, fields:{} })
  const wide = layoutScopeCols(P, _hearScopeCols(money), huge.rows, W - M, M, 210)
  const block = wide.reduce((a, c) => a + c[2], 0)
  ok('the measure column never falls below its floor', (W - M) - M - block >= 210)
}


// ── 10. The Acceptance & Authorization block ─────────────────────────────
// The block a person actually signs, checked against the REAL rendered PDF
// rather than against the code that draws it: every earlier version of this
// block read correctly and printed badly.
//
// Three things can go wrong without looking wrong in the source: the block is
// not actually centred; a caption is wider than the rule it names; or the
// block is drawn past the bottom of the page and lands on the footer, which is
// what the shipped version did on the Sealed proposal — its Date caption
// cleared the footer rule by 0.4pt.
{
  const jsPDF = await loadJsPdf()
  const A = HEAR_ACCEPTANCE

  // --- read a jsPDF document back: text with its baseline, and every rule ---
  const readPages = (bytes) => {
    const raw = Buffer.from(bytes).toString('latin1')
    return raw.split('endstream').slice(0, -1).map(chunk => {
      const body = chunk.slice(chunk.indexOf('stream') + 6)
      const text = [], rules = []
      const tRe = /([-\d.]+) ([-\d.]+) Td\s*\((.*?)\) Tj/g
      for (let mt; (mt = tRe.exec(body));) {
        text.push({ x: +mt[1], y: +mt[2], s: mt[3] })
      }
      const lRe = /([-\d.]+) ([-\d.]+) m\s*\n\s*([-\d.]+) ([-\d.]+) l/g
      for (let ml; (ml = lRe.exec(body));) {
        if (+ml[2] === +ml[4]) rules.push({ x1: +ml[1], x2: +ml[3], y: +ml[2] })
      }
      return { text, rules }
    })
  }
  // The em dash reaches the content stream as one WinAnsi byte, so captions are
  // matched on the half that is plain ASCII.
  const find = (page, s) => page.text.find(o => o.s.startsWith(s.slice(0, 12)))
  const rowAt = (page, y) => page.rules.filter(r => Math.abs(r.y - y) < 0.5)
    .sort((a, b) => a.x1 - b.x1)

  const W = 612, PAGE_H = 792
  const measure = (txt, size) => { const p = newProposalPdf(jsPDF, 20)
    p.font(size, 'normal'); return p.d.getTextWidth(txt) }

  const FIELDS = st => ({ pjInstallAddr: '3002 West Darling Street', pjCsz: 'Appleton, WI 54914',
    pjOwner: 'Westminster Company', pjState: st, pjInvDate: '2026-09-03' })
  const { rows } = hearRowsFromLineItems([
    { productCode: 'HEAR-HP-SPACE-HEAT-COOL', quantity: 11, unitPrice: 8000 },
    { productCode: 'HEAR-HPWH', quantity: 11, unitPrice: 1750 },
    { productCode: 'HEAR-VENT', quantity: 11, unitPrice: 1600 },
  ])

  // Both documents, and both the shortest and the longest state name — the
  // paragraph names the state, so its length decides how many lines the block
  // is and therefore whether it still fits above the footer.
  for (const contractor of ['EES', 'Sealed, Inc.']) {
    for (const state of ['WI', 'NC']) {
      const who = `${contractor.startsWith('Sealed') ? 'Sealed' : 'EES'} ${state}`
      const blob = await generateHearProposalBlob({ rows, units: 11, contractor,
        fields: FIELDS(state) })
      const pages = readPages(await blob.arrayBuffer())

      const pi = pages.findIndex(p => find(p, A.CAPTIONS.name))
      ok(`${who}: the block is drawn`, pi >= 0)
      const page = pages[pi]

      // (a) nothing in the block is split across a page break
      for (const [what, s] of [['heading', 'ACCEPTANCE & AUTH'], ['paragraph', 'By signing below'],
        ['signature caption', A.CAPTIONS.signature], ['date caption', A.CAPTIONS.date]]) {
        ok(`${who}: the ${what} is on the same page as Printed Name`, !!find(page, s))
      }

      const nameCap = find(page, A.CAPTIONS.name)
      const sigCap = find(page, A.CAPTIONS.signature)
      const dateCap = find(page, A.CAPTIONS.date)
      const nameRow = rowAt(page, nameCap.y + A.CAPTION_DROP)
      const sigRow = rowAt(page, sigCap.y + A.CAPTION_DROP)

      // (b) both rows are centred on the page — equal air either side
      eq(`${who}: the printed-name rule is one centred rule`, nameRow.length, 1)
      eq(`${who}: the signature row is a signature rule and a date rule`, sigRow.length, 2)
      for (const [what, row] of [['printed-name', nameRow], ['signature', sigRow]]) {
        const left = row[0].x1, right = row[row.length - 1].x2
        ok(`${who}: the ${what} row is centred (${left} / ${W - right})`,
          Math.abs(left - (W - right)) < 0.5)
      }
      eq(`${who}: the signature and date rules keep their gap`,
        Math.round(sigRow[1].x1 - sigRow[0].x2), A.COLUMN_GAP)

      // (c) room to actually sign: rule to rule, PDF y counts up from the foot
      eq(`${who}: printed name to signature`, Math.round(nameRow[0].y - sigRow[0].y),
        A.NAME_TO_SIGNATURE)
      ok(`${who}: the signature line has room above it`,
        A.NAME_TO_SIGNATURE - A.CAPTION_DROP >= 30)

      // (d) every caption fits inside the rule it names, and is centred on it
      // Measured from the SOURCE string, not the parsed one: the em dash
      // reaches the stream as one WinAnsi byte and would measure differently.
      for (const [cap, row, src] of [[nameCap, nameRow[0], A.CAPTIONS.name],
        [sigCap, sigRow[0], A.CAPTIONS.signature], [dateCap, sigRow[1], A.CAPTIONS.date]]) {
        const w = measure(src, 8), ruleW = row.x2 - row.x1
        ok(`${who}: "${src.slice(0, 18)}" fits its rule (${Math.round(w)} of ${Math.round(ruleW)})`,
          w <= ruleW - 8)
        ok(`${who}: "${src.slice(0, 18)}" is centred on its rule`,
          Math.abs((cap.x + w / 2) - (row.x1 + ruleW / 2)) < 1.5)
      }

      // (e) the paragraph is centred, and in its own narrower measure
      const para = page.text.filter(o => o.y >= nameCap.y && o.y <= nameCap.y + 80
        && o.s.length > 20 && !o.s.startsWith('Property Owner'))
      ok(`${who}: the paragraph wrapped to more than one line`, para.length > 1)
      for (const ln of para) {
        const w = measure(ln.s, 8.5)
        ok(`${who}: paragraph line is centred on the page`, Math.abs((ln.x + w / 2) - W / 2) < 1.5)
        ok(`${who}: paragraph line stays inside its measure`, w <= A.TEXT_WIDTH + 1)
      }

      // (f) the block clears the page footer
      const footer = page.rules.filter(r => r.x1 < 25 && r.x2 > W - 25)
        .reduce((lo, r) => (lo == null || r.y < lo ? r.y : lo), null)
      ok(`${who}: the footer rule is on the page`, footer != null)
      ok(`${who}: the last caption clears the footer (${Math.round(dateCap.y - footer)}pt)`,
        dateCap.y - footer >= 8)
    }
  }

  // CONTROL — the two things that were wrong, on the same run.
  //
  // 1. The block used to leave 28pt between the printed-name rule and the
  //    signature rule, and the caption takes 11 of them: 17pt to sign in.
  ok('CONTROL: the previous 28pt gap left under 20pt to sign in',
    28 - A.CAPTION_DROP < 20)
  // 2. The reservation used to leave out the heading. On the Sealed proposal
  //    that is the difference between the block moving to a fresh page and the
  //    block being drawn straight through the footer: page 1 ends where it
  //    ends, the short reservation says the block fits, and the block's real
  //    bottom lands below the footer rule.
  {
    const blob = await generateHearProposalBlob({ rows, units: 11, contractor: 'Sealed, Inc.',
      fields: FIELDS('WI') })
    const pages = readPages(await blob.arrayBuffer())
    ok('CONTROL: the Sealed block needed a page of its own', pages.length === 2)
    const p1 = pages[0]
    // where page 1's own content ends, in the builder's top-down cursor
    const lastY = Math.min(...p1.rules.filter(r => r.y > 40).map(r => r.y))
    const top = PAGE_H - lastY
    const lines = 4                     // the Sealed paragraph, Wisconsin
    const full = A.HEADING_HEIGHT + lines * A.LINE_HEIGHT + 26 + A.NAME_TO_SIGNATURE
      + A.CAPTION_DROP + A.FOOTER_CLEARANCE
    const short = full - A.HEADING_HEIGHT          // the reservation that shipped
    const THRESHOLD = PAGE_H - 20 - 16             // buildHearSealedPdfBlob's needH
    ok('CONTROL: without the heading the block "fits" on page 1', top + short <= THRESHOLD)
    ok('CONTROL: and its real bottom is below the Sealed footer rule',
      PAGE_H - (top + full) < 24)
    ok('with the heading reserved, the block is moved off page 1', top + full > THRESHOLD)
  }
}

console.log(`${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
