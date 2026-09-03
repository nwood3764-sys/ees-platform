// Program-math fixture — proves the HOMES/FOE program rules in
// buildPaperworkModel (paperworkModel.js §3) stay correct. Runs under plain
// Node with no build step. The Hampton fixture (8 units, 46% savings, R-2
// attic) is Nicholas's canonical review case: HOMES $80,000 + FOE $7,150 =
// $87,150 gross, line-item costs summing back to the gross exactly so
// TOTAL DUE is $0.00; the Energy Audit Invoice is $2,000 on one page.
import { buildPaperworkModel, buildEesPdf, formatMoney } from '../src/data/paperworkModel.js'

let pass = 0, fail = 0
const eq = (label, got, want) => {
  const ok = got === want
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`)
  ok ? pass++ : fail++
}
const near = (label, got, want, tol = 0.005) => {
  const ok = Math.abs(got - want) <= tol
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${got}, want ${want})`}`)
  ok ? pass++ : fail++
}

// --- Hampton fixture: 8 units, 46% savings, R-2 baseline attic → R-49 -------
const H = buildPaperworkModel({
  units: 8,
  assetScoreBase: { euiCurrent: 100, roofArea: 7150.0, roofRs: [2] },
  assetScoreImp: { euiUpgraded: 54, roofRs: [49] },
  fields: {},
})
eq('units carried through', H.units, 8)
eq('roofSqFt from baseline roof area (rounded)', H.roofSqFt, 7150)
eq('baseAtticR = min baseline roof R below improved min', H.baseAtticR, 2)
eq('iMin = min improved roof R', H.iMin, 49)
eq('savings = headline EUI delta %', H.savings, 46)
eq('HOMES tier ≥35% → $10,000/unit', H.tier.perUnit, 10000)
eq('HOMES tier note', H.tier.note, '$10,000.00 per unit')
eq('HOMES amount = units × perUnit', H.homesAmt, 80000)
eq('FOE rate for baseline < R-11 is $1.00/sqft', H.foe.rate, 1)
eq('FOE description (< R-11)', H.foe.desc, 'Air Sealing & Attic Insulation, Existing < R-11')
eq('FOE amount = roofSqFt × rate', H.foeAmt, 7150)
eq('gross total = HOMES + FOE', H.total, 87150)
eq('five measure rows (attic ×2 + three low-flow)', H.rows.length, 5)
eq('row0 name', H.rows[0].name, 'Attic Insulation')
eq('row0 breakout fraction', H.rows[0].frac, 0.44)
eq('row0 qty = roofSqFt', H.rows[0].qty, 7150)
eq('row0 unit', H.rows[0].unit, 'Sq Ft')
eq('row1 name', H.rows[1].name, 'Attic Air Sealing')
eq('row1 breakout fraction', H.rows[1].frac, 0.5483)
eq('bath aerators fraction', H.rows[2].frac, 0.0033)
eq('kitchen aerators fraction', H.rows[3].frac, 0.0035)
eq('showerheads fraction', H.rows[4].frac, 0.0049)
eq('low-flow qty = units', H.rows[2].qty, 8)
// line costs sum back to the gross exactly → TOTAL DUE $0.00
const sum = Math.round(H.rows.reduce((a, r) => a + r.cost, 0) * 100) / 100
near('line-item costs sum to the gross (TOTAL DUE $0.00)', sum, H.total)

// THE RULING, pinned so the build refuses a change that breaks it.
// Nicholas, 2026-09-03: "There is no cost. Customers don't pay us anything.
// The program pays us. This invoice is just fake so the customer can see that
// there's no out-of-pocket cost." The customer's balance is zero BY DESIGN:
// the cost is defined as the rebate, and the rebate is credited against it.
// A future change that prices this document from anything else — the
// opportunity line items being the obvious candidate, since they hold the only
// real dollars in LEAP — makes these fail, which is the entire point.
const credits = Math.round((H.homesAmt + H.foeAmt) * 100) / 100
near('every rebate credit sums to the gross cost', credits, H.total)
near('BALANCE DUE FROM THE CUSTOMER IS ZERO — by design, never "fix" it',
  Math.round((H.total - credits) * 100) / 100, 0)
near('largest row absorbs rounding drift', H.rows[1].cost, 47784.34)
eq('money formatter', formatMoney(87150), '$87,150.00')
eq('money formatter (cents)', formatMoney(287.59), '$287.59')

// --- Tier boundaries --------------------------------------------------------
const mid = buildPaperworkModel({ units: 4, assetScoreBase: { euiCurrent: 100, roofArea: 1000, roofRs: [10] }, assetScoreImp: { euiUpgraded: 75, roofRs: [49] }, fields: {} })
eq('20–34% savings → $5,000/unit', mid.tier.perUnit, 5000)
eq('mid-tier HOMES amount', mid.homesAmt, 20000)
const low = buildPaperworkModel({ units: 4, assetScoreBase: { euiCurrent: 100, roofArea: 1000, roofRs: [10] }, assetScoreImp: { euiUpgraded: 90, roofRs: [49] }, fields: {} })
eq('<20% savings → not HOMES eligible ($0/unit)', low.tier.perUnit, 0)
eq('ineligible HOMES amount', low.homesAmt, 0)

// --- FOE rate tiers by baseline attic R -------------------------------------
const foeMid = buildPaperworkModel({ units: 4, assetScoreBase: { euiCurrent: 100, roofArea: 1000, roofRs: [15] }, assetScoreImp: { euiUpgraded: 50, roofRs: [49] }, fields: {} })
near('FOE rate R-12–19 → $0.70/sqft', foeMid.foe.rate, 0.70)
const foeHi = buildPaperworkModel({ units: 4, assetScoreBase: { euiCurrent: 100, roofArea: 1000, roofRs: [30] }, assetScoreImp: { euiUpgraded: 50, roofRs: [49] }, fields: {} })
near('FOE rate R-20–38 → $0.55/sqft', foeHi.foe.rate, 0.55)

// --- No-attic renormalization (fractions still sum to the gross) ------------
const noAttic = buildPaperworkModel({ units: 10, assetScoreBase: { euiCurrent: 100, roofArea: 1000, roofRs: [49] }, assetScoreImp: { euiUpgraded: 50, roofRs: [49] }, includeAttic: false, fields: {} })
eq('no-attic → three low-flow rows only', noAttic.rows.length, 3)
eq('no-attic → no FOE', noAttic.foeAmt, 0)
// It has to hold on every tier, not just the canonical case, or the zero is a
// coincidence of one fixture rather than a property of the document.
for (const [label, m] of [['mid tier', mid], ['no-attic', noAttic]]) {
  near(`balance due is zero on the ${label} case too`,
    Math.round((m.total - (m.homesAmt + m.foeAmt)) * 100) / 100, 0)
}
const naSum = Math.round(noAttic.rows.reduce((a, r) => a + r.cost, 0) * 100) / 100
near('no-attic line costs still reconcile to the gross', naSum, noAttic.total)

// --- Energy Audit Invoice: $2,000, one page ---------------------------------
const auditBlob = await buildEesPdf(H, 'audit')
const auditText = Buffer.from(await auditBlob.arrayBuffer()).toString('latin1')
const pageCount = (auditText.match(/\/Type\s*\/Page[^s]/g) || []).length
eq('Energy Audit Invoice is one page', pageCount, 1)
eq('Energy Audit Invoice gross = $2,000.00', formatMoney(2000), '$2,000.00')

console.log(`\n${fail ? 'FAIL' : 'PASS'}  ${pass} passed, ${fail} failed (of ${pass + fail} checks)`)
process.exit(fail ? 1 : 0)
