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

console.log(`${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
