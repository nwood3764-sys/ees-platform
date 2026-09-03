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
  HEAR_ACCEPTANCE, hearAcceptanceGeometry, hearAcceptanceHeight, generateHearProposalBlob,
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
// Four things can go wrong without looking wrong in the source: the proposal
// spills a signature page it should never need; the paragraph is not centred;
// a caption is wider than the rule it names; or the block runs into the page
// footer.
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
      for (let mt; (mt = tRe.exec(body));) text.push({ x: +mt[1], y: +mt[2], s: mt[3] })
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

  const W = 612, PAGE_H = 792, MARGIN = 20
  const measure = (txt, size) => { const p = newProposalPdf(jsPDF, MARGIN)
    p.font(size, 'normal'); return p.d.getTextWidth(txt) }

  const FIELDS = st => ({ pjInstallAddr: '570 South Clark Street', pjCsz: 'Whitewater, WI 53190',
    pjOwner: 'Lutheran Social Services of Wisconsin and Upper Michigan, Inc.',
    pjContact: 'Dennis Hanson', pjContactTitle: 'Vice President- Housing & Residential',
    pjState: st, pjInvDate: '2026-09-03' })
  const { rows } = hearRowsFromLineItems([
    { productCode: 'HEAR-HP-SPACE-HEAT-COOL', quantity: 11, unitPrice: 8000 },
    { productCode: 'HEAR-HPWH', quantity: 11, unitPrice: 1750 },
    { productCode: 'HEAR-VENT', quantity: 11, unitPrice: 1600 },
  ])

  // Both documents, and both the shortest and the longest state name — the
  // paragraph names the state, so its length decides how many lines the block
  // is and therefore how much room it needs.
  for (const contractor of ['EES', 'Sealed, Inc.']) {
    for (const state of ['WI', 'NC']) {
      const who = `${contractor.startsWith('Sealed') ? 'Sealed' : 'EES'} ${state}`
      const blob = await generateHearProposalBlob({ rows, units: 11, contractor,
        fields: FIELDS(state) })
      const pages = readPages(await blob.arrayBuffer())

      // (a) A THREE-MEASURE PROPOSAL IS ONE PAGE. Nicholas, 2026-09-03: "there
      //     is no way this can spill onto two pages with one measure record."
      //     The acceptance block is what pushed it over, so this is the check
      //     that must never regress — the block steps its own text size down to
      //     fit rather than taking a page of its own.
      eq(`${who}: a three-measure proposal is one page`, pages.length, 1)

      const pi = pages.findIndex(p => find(p, A.CAPTIONS.name))
      ok(`${who}: the block is drawn`, pi >= 0)
      const page = pages[pi]

      // (b) nothing in the block is split across a page break
      for (const [what, s] of [['heading', 'ACCEPTANCE & AUTH'], ['paragraph', 'By signing below'],
        ['signature caption', A.CAPTIONS.signature], ['date caption', A.CAPTIONS.date]]) {
        ok(`${who}: the ${what} is on the same page as Printed Name`, !!find(page, s))
      }

      // (b2) The block SITS ON THE FOOT OF THE PAGE (Nicholas, 2026-09-03:
      //      "there's a ton of room at the bottom, you just need to move that
      //      whole section down"). A fixed lead below the Project Summary can
      //      only ever be as generous as the fullest page allows; anchoring the
      //      block to the page's floor spends whatever the page has left on the
      //      gap above it. So the check is not "is the gap big" — it is "is the
      //      block on the floor", which makes the gap as big as it can be.
      {
        const headText = find(page, 'ACCEPTANCE & AUTH')
        const above = page.rules.filter(r => r.y > headText.y + 6)
          .reduce((lo, r) => (lo == null || r.y < lo.y ? r : lo), null)
        if (above) {
          ok(`${who}: the heading clears the section above it (${Math.round(above.y - headText.y)}pt)`,
            above.y - headText.y >= 20)
        }
        const dateCapY = find(page, A.CAPTIONS.date).y
        const footerRule = page.rules.filter(r => r.x1 < 25 && r.x2 > W - 25)
          .reduce((lo, r) => (lo == null || r.y < lo ? r.y : lo), null)
        // The block sits ON the page's floor — never past it, and never far
        // above it. It lands exactly on the clearance whenever the page has the
        // room; the Sealed proposal, whose paragraph runs a line longer under a
        // taller scope table, can come up a few points short of the floor
        // rather than take a second page. Both are correct; drifting far above
        // the floor is what is not.
        const air = Math.round(dateCapY - footerRule)
        ok(`${who}: the block sits on the page floor (${air}pt of air)`,
          air <= A.FOOTER_CLEARANCE + 1 && air >= A.FOOTER_CLEARANCE - 10)
      }

      const nameCap = find(page, A.CAPTIONS.name)
      const sigCap = find(page, A.CAPTIONS.signature)
      const dateCap = find(page, A.CAPTIONS.date)
      const nameRow = rowAt(page, nameCap.y + A.CAPTION_DROP)
      const sigRow = rowAt(page, sigCap.y + A.CAPTION_DROP)

      // (c) LEFT JUSTIFIED on the page margin, and the Date follows the
      //     signature rather than sitting on the right page edge.
      eq(`${who}: the printed-name rule is one rule`, nameRow.length, 1)
      eq(`${who}: the signature row is a signature rule and a date rule`, sigRow.length, 2)
      eq(`${who}: printed name starts on the page margin`, Math.round(nameRow[0].x1), MARGIN)
      eq(`${who}: the signature starts on the page margin`, Math.round(sigRow[0].x1), MARGIN)
      eq(`${who}: printed name and signature are the same rule`,
        Math.round(nameRow[0].x2), Math.round(sigRow[0].x2))
      eq(`${who}: the date rule follows the signature`,
        Math.round(sigRow[1].x1 - sigRow[0].x2), A.COLUMN_GAP)
      ok(`${who}: the date rule stays inside the right margin`, sigRow[1].x2 <= W - MARGIN + 0.5)
      ok(`${who}: the block does not run the full width of the page`,
        sigRow[1].x2 < W - MARGIN - 20)

      // (d) Room to actually sign, and to print a name. Both gaps give way
      //     before the page does (GAP_SCALES), so the check is the FLOOR each
      //     one may fall to — the tightest scale must still leave a person
      //     somewhere to write. The Sealed proposal names two companies, so its
      //     paragraph runs a line longer and it is the document that tightens.
      const tightest = A.GAP_SCALES[A.GAP_SCALES.length - 1]
      const ruleGap = Math.round(nameRow[0].y - sigRow[0].y)
      ok(`${who}: printed name to signature is a declared gap (${ruleGap}pt)`,
        A.GAP_SCALES.some(sc => Math.round(A.NAME_TO_SIGNATURE * sc) === ruleGap))
      ok(`${who}: the signature line has room above it (${ruleGap - A.CAPTION_DROP}pt clear)`,
        ruleGap - A.CAPTION_DROP >= 18)
      ok('even the tightest signing gap leaves room to sign',
        A.NAME_TO_SIGNATURE * tightest - A.CAPTION_DROP >= 18)
      ok('even the tightest name gap leaves room to write a name',
        A.PARAGRAPH_TO_RULE * tightest >= 24)
      // CONTROL: the 20pt this used to be is NOT room to write a name in —
      // which is what Nicholas hit ("there's no room for the printed name to be
      // entered"). Every declared gap must beat it.
      ok('CONTROL: the previous 20pt name gap is below the floor', 20 < 24)

      // (e) every caption starts at the left end of the rule it names, and fits
      for (const [cap, row, src] of [[nameCap, nameRow[0], A.CAPTIONS.name],
        [sigCap, sigRow[0], A.CAPTIONS.signature], [dateCap, sigRow[1], A.CAPTIONS.date]]) {
        eq(`${who}: "${src.slice(0, 18)}" starts at its rule`, Math.round(cap.x), Math.round(row.x1))
        ok(`${who}: "${src.slice(0, 18)}" fits its rule`, measure(src, 8) <= (row.x2 - row.x1) + 4)
      }

      // (f) the paragraph is CENTRED on the page, in a measure much wider than
      //     the signature block, and set larger than the document's small print
      // The signer's own name and title are pre-printed ON the name rule, so
      // they sit in the same band as the paragraph and must not be mistaken
      // for it.
      const SIGNER = 'Dennis Hanson', SIGNER_TITLE = 'Vice President- Housing & Residential'
      const para = page.text.filter(o => o.y > nameCap.y && o.y < nameCap.y + 70
        && o.s.startsWith('By signing') === false && o.s.length > 25
        && !o.s.startsWith('Property Owner')
        && o.s !== SIGNER && o.s !== SIGNER_TITLE)
      const first = find(page, 'By signing below')
      ok(`${who}: the paragraph is drawn`, !!first)
      const paraLines = [first, ...para]
      const size = A.FONT_SIZES.find(sz =>
        Math.abs((first.x + measure(first.s, sz) / 2) - W / 2) < 1.5)
      ok(`${who}: the paragraph is centred at one of the declared sizes`, !!size)
      ok(`${who}: the paragraph is larger than the 8.5pt it used to be`, (size || 0) >= 8.5)
      for (const ln of paraLines) {
        const w = measure(ln.s, size || 10)
        ok(`${who}: paragraph line is centred on the page`, Math.abs((ln.x + w / 2) - W / 2) < 2)
        ok(`${who}: paragraph line stays inside its measure`,
          w <= (W - 2 * MARGIN) - 2 * A.TEXT_INSET + 1)
      }
      ok(`${who}: the paragraph measure is much wider than the signature block`,
        (W - 2 * MARGIN) - 2 * A.TEXT_INSET > (sigRow[1].x2 - sigRow[0].x1) + 60)

      // (f2) The name line is PRE-POPULATED from the record: the signer's name
      //      sits on the rule and the title at the right-hand end of the same
      //      line, so all that is left to do is sign.
      {
        const nm = page.text.find(o => o.s === SIGNER)
        const ti = page.text.find(o => o.s === SIGNER_TITLE)
        ok(`${who}: the signer's name is printed on the line`, !!nm)
        ok(`${who}: the signer's title is printed on the line`, !!ti)
        if (nm && ti) {
          eq(`${who}: name and title share one line`, Math.round(nm.y), Math.round(ti.y))
          ok(`${who}: the name sits above its own rule`, nm.y > nameRow[0].y)
          ok(`${who}: the name starts at the rule`, Math.abs(nm.x - nameRow[0].x1) <= 3)
          ok(`${who}: the title is right of the name's rule`, ti.x > nameRow[0].x2)
          ok(`${who}: the title stays inside the block`,
            ti.x + measure(SIGNER_TITLE, 9) <= sigRow[1].x2 + 1)
        }
      }

      // (g) the block clears the page footer
      const footer = page.rules.filter(r => r.x1 < 25 && r.x2 > W - 25)
        .reduce((lo, r) => (lo == null || r.y < lo ? r.y : lo), null)
      ok(`${who}: the footer rule is on the page`, footer != null)
      ok(`${who}: the last caption clears the footer (${Math.round(dateCap.y - footer)}pt)`,
        dateCap.y - footer >= 6)

      // (h) the three header columns are EVEN and all read from their own left
      //     edge — the customer column used to be right-aligned on the page
      //     edge, so it was ragged down the side the other two are read from.
      const p1 = pages[0]
      const heads = ['PRIMARY IRA CONTRACTOR', 'PROJECT INFORMATION', 'CUSTOMER INFORMATION']
        .map(h => find(p1, h) || p1.text.find(o => o.s.toUpperCase().startsWith(h.slice(0, 12))))
      if (heads.every(Boolean)) {
        const gaps = [heads[1].x - heads[0].x, heads[2].x - heads[1].x]
        ok(`${who}: the three header columns are evenly spaced`, Math.abs(gaps[0] - gaps[1]) < 1)
        eq(`${who}: the first column starts on the page margin`, Math.round(heads[0].x), MARGIN)
        ok(`${who}: the customer column is not pushed to the right edge`,
          heads[2].x + measure(heads[2].s, 9) < W - MARGIN - 20)
      }
    }
  }

  // CONTROL — the geometry this replaced, on the same run.
  {
    const P = newProposalPdf(jsPDF, MARGIN)
    const g = hearAcceptanceGeometry(P)
    // 1. The signature block used to be CENTRED, so it started 80pt in from the
    //    page margin. Left justified means it starts ON the margin.
    const centredBlockX = MARGIN + ((W - 2 * MARGIN) - 452) / 2
    ok('CONTROL: the previous centred block did not start on the margin', centredBlockX > MARGIN + 40)
    eq('the block now starts on the margin', g.blockX, MARGIN)
    // 2. The paragraph measure used to be 440pt inside a 572pt page — 66pt of
    //    air each side, which is the margin Nicholas asked to cut.
    ok('CONTROL: the previous 440pt measure left a wide margin', (W - 2 * MARGIN) - 440 > 100)
    ok('the paragraph measure now runs nearly the full page', g.textWidth >= (W - 2 * MARGIN) - 30)
    // 3. A block that cannot fit steps its size down instead of taking a page:
    //    the smallest declared size must need less room than the largest.
    const big = hearAcceptanceHeight(3, A.FONT_SIZES[0], 32)
    const small = hearAcceptanceHeight(3, A.FONT_SIZES[A.FONT_SIZES.length - 1], 32)
    // The footer clearance belongs to the PAGE, not to the block: counting it
    // inside the height as well as in the floor made the block shorter than the
    // room it had, which is part of why it sat too high.
    ok('CONTROL: the block height does not include the footer clearance',
      hearAcceptanceHeight(1, 10, 0) === 10 * A.LINE_RATIO + A.PARAGRAPH_TO_RULE
        + A.NAME_TO_SIGNATURE + A.CAPTION_DROP)
    ok('a smaller size needs less room than the largest', small < big)
    ok('the ladder starts at the largest size',
      A.FONT_SIZES[0] === Math.max(...A.FONT_SIZES))
  }
}

console.log(`${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
