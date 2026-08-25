// ===========================================================================
// paperworkModel.js — HOMES Project Paperwork: program rules + document builders
//
// Ported from the standalone Audit Template Builder
// (audit-template-builder/frontend/index.html, build 61) per
// docs/leap-project-paperwork-port.md. The program rules (§3) and every
// layout decision (§5) in that doc are settled — do not redesign them here.
//
// This module is PURE with respect to the app: no supabase, no DOM reads at
// module level, no LEAP imports. Heavy libraries (jspdf, jszip) load via
// dynamic import inside the builder functions so this file stays out of the
// record-open path and is directly testable under Node.
//
// Documents produced:
//   - Energy Audit Invoice            (EES vector PDF, always one page)
//   - WI IRA HOMES Program Project Proposal (EES vector PDF)
//   - HOMES Project Invoice           (EES vector PDF)
//   - Sealed Proposal / Sealed Invoice (Sealed, Inc. primary-contractor style)
//   - Paperwork Workbook (.xlsx)      (template fill — styles preserved)
//   - Energy Assessment Report        (the AUDIT's own deliverable — not a
//                                      program submittal; see the engine below)
// ===========================================================================

// ---------------------------------------------------------------------------
// Document wording.
//
// The authoritative copy lives in the `submittal_document_text_blocks` table
// so it is editable through LEAP Admin without a deploy, and can be overridden
// per program (per opportunity record type). The constants below are the
// built-in FALLBACK used when a block is missing — they are byte-identical to
// the seeded defaults, so behaviour is unchanged if the table is unreachable.
//
// Bodies may carry {{baseline_r}} / {{improved_r}} tokens, substituted from
// the Asset Score reports at render time.
// ---------------------------------------------------------------------------
export const DEFAULT_TEXT_BLOCKS = Object.freeze({
  'measure.attic_insulation': [
`Upgrade existing attic insulation levels from approximately R-{{baseline_r}} to R-{{improved_r}} in accordance with applicable PNNL building science standards and program requirements to improve thermal performance, reduce energy consumption, and enhance occupant comfort. Work will include preparation of attic areas to support proper airflow, insulation depth consistency, and long-term system performance.`,
`Install eave baffles with 48-inch extensions in each accessible attic bay to maintain ventilation pathways and allow full insulation coverage above exterior wall top plates.`,
`Install insulation rulers in each attic bay on both sides to verify uniform insulation depth and ensure consistent installed R-values throughout the attic plane.`,
`Install blown-in fiberglass insulation to achieve a minimum final attic insulation value of R-{{improved_r}} across all accessible attic areas.`,
`Custom build and install insulated attic access hatches including insulation damming, insulated access covers, and weatherstripping to minimize thermal bypass and air leakage.`,
`All insulation materials and installation methods will comply with applicable code requirements, manufacturer specifications, and accepted energy efficiency best practices.`].join('\n\n'),
  'measure.attic_air_sealing': [
`Perform attic air sealing to reduce uncontrolled air leakage between conditioned spaces and unconditioned attic areas in accordance with PNNL air barrier and weatherization best practices. Removal and disposal of existing R-{{baseline_r}} insulation material will prepare the attic space for proper air sealing. Air sealing work will be completed prior to insulation installation to maximize thermal effectiveness and moisture control performance.`,
`Scope of work includes identification and sealing of accessible air leakage pathways including, but not limited to:`,
`Plumbing penetrations\nElectrical penetrations\nTop plates\nMechanical and duct penetrations\nSoffits and open chases\nAttic access openings\nMiscellaneous bypasses and framing gaps\nFabricated isolation boxes for exhaust fans and recessed lights`,
`Approved sealants, foam products, sheet materials, and weatherstripping will be utilized as appropriate for each application to improve building envelope tightness, reduce heating and cooling loads, and improve overall occupant comfort and building durability.`].join('\n\n'),
  'measure.bath_aerators': 'Installation of low flow faucet aerators in tenant bathrooms for water and energy savings. Model: Niagara 0.5 GPM Aerator N3205N',
  'measure.kitchen_aerators': 'Installation of low flow faucet aerators in tenant kitchens for water and energy savings. Model: Niagara 0.5 GPM Aerator N3205N',
  'measure.showerheads': 'Installation of low flow handheld showerheads in tenant bathrooms for water and energy savings. Model: Niagara Earth Handheld Showerhead N2945CH',
  'acknowledgment.invoice': 'Receipt of this invoice constitutes acknowledgment of the services delivered. The property owner confirms the work performed and authorizes EES-WI to submit for and receive the corresponding program incentive on their behalf.',
  'acknowledgment.proposal': 'Signed receipt of this proposal constitutes acceptance of the proposed scope of work. The property owner authorizes EES-WI to submit the project for rebate/incentive program preapproval and to begin project planning activities.',
  'title.proposal': 'Wisconsin Inflation Reduction Act HOMES Program Project Proposal',
  'header.company_name': 'ENERGY EFFICIENCY SERVICES of WISCONSIN',
  'footer.company_line': 'Energy Efficiency Services of Wisconsin  |  112 Owen Rd. PO Box 6141, Monona, WI 53716',
  'footer.contact_line': 'ira@ees-wi.org  |  608-460-7419',
})

/**
 * Resolve one wording block: the loaded table row if present, otherwise the
 * built-in default, with {{token}} substitution applied.
 */
export function resolveTextBlock(textBlocks, key, tokens) {
  const raw = (textBlocks && textBlocks[key]) || DEFAULT_TEXT_BLOCKS[key] || ''
  if (!tokens) return raw
  return String(raw).replace(/\{\{(\w+)\}\}/g, (m, t) =>
    (tokens[t] != null ? String(tokens[t]) : m))
}

// ---------------------------------------------------------------------------
// Asset Score report text parser — extracts the fields the paperwork math
// needs from the raw text of a DOE Asset Score report PDF. The text itself
// is produced by pdf.js extraction in paperworkService (browser only).
// ---------------------------------------------------------------------------
function num(re, t, d) { const m = t.match(re); return m ? parseFloat(m[1].replace(/,/g, '')) : d }

export function parseAssetScoreText(t) {
  const d = {}
  const bi = t.split('BUILDING INFORMATION')[1] || t
  const lines = bi.split('\n').map(l => l.trim()).filter(Boolean)
  // name: first line, cut at the first 2+ space gap (separates from the
  // Building Type column). The name may wrap to a 2nd line.
  let nm = (lines[0] || '').split(/\s{2,}/)[0].trim()
  if (lines[1]) {
    let cont = lines[1].split(/\s{2,}/)[0].trim()
    cont = cont.replace(/\s*\((fewer|four|more)\b.*$/i, '').replace(/\s*floors\).*$/i, '')
               .replace(/\s*(Multi-family|Multifamily|Office|Mixed).*$/i, '').trim()
    if (cont && !/:/.test(cont) && !/^\d/.test(cont) &&
        !/^(Building Type|Milwaukee|WI |Gross|Climate|Year|Score)/i.test(cont) &&
        /Project|Baseline|Improved|HOMES/i.test(cont))
      nm += ' ' + cont
  }
  d.name = nm
  for (let i = 0; i < lines.length; i++) {
    if (/,\s*[A-Z]{2}\s*\d{5}/.test(lines[i])) {
      d.cityStateZip = lines[i].split(/\s{2,}|\s+(?:Climate|Building|Gross|Year|Score)\b/)[0].trim()
      d.street = (lines[i - 1] || '').split(/\s+(?:Gross Floor Area|Building Type|Climate|Building ID|Year)\b/)[0]
                                     .split(/\s{2,}/)[0].trim()
      const z = d.cityStateZip.match(/(.+),\s*([A-Z]{2})\s*(\d{5})/)
      if (z) {
        d.city = z[1].trim(); d.state = z[2]; d.zip = z[3]
        // Some reports print the street as "1837 Alden Road - Janesville" —
        // strip a trailing " - <city>" so the street is just the street.
        if (d.city && d.street && d.street.toLowerCase().endsWith((' - ' + d.city).toLowerCase()))
          d.street = d.street.slice(0, -((' - ' + d.city).length)).trim()
      }
      break
    }
  }
  const cur = t.match(/Current\s+(\d+)\s+([\d.]+)/), upg = t.match(/Upgraded\s+(\d+)\s+([\d.]+)/)
  d.euiCurrent = cur ? parseInt(cur[1]) : null
  d.euiUpgraded = upg ? parseInt(upg[1]) : null
  // Per-fuel EUI table keeps the decimal the page-1 headline rounds away.
  // When the per-fuel sum is the headline just rounded (within 1 kBtu/ft²),
  // use its precision; when they genuinely diverge, the headline stays
  // authoritative.
  const gEui = t.match(/Natural Gas\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/i)
  const eEui = t.match(/Electricity\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/i)
  const gasCur = gEui ? parseFloat(gEui[1]) : null, gasUpg = gEui ? parseFloat(gEui[2]) : null
  const elecCur = eEui ? parseFloat(eEui[1]) : null, elecUpg = eEui ? parseFloat(eEui[2]) : null
  const perFuel = (e, g) => ((e != null || g != null) ? ((e || 0) + (g || 0)) : null)
  const refine = (head, sum) => (head != null && sum != null && sum > 0 && Math.abs(sum - head) < 1) ? +sum.toFixed(1) : head
  d.euiCurrent = refine(d.euiCurrent, perFuel(elecCur, gasCur))
  d.euiUpgraded = refine(d.euiUpgraded, perFuel(elecUpg, gasUpg))
  d.savingsPct = num(/site energy savings:\s*([\d.]+)%/, t)
  // Footnote-tolerant: the summary prints superscript digits, so require the
  // decimal-bearing number and skip a stray footnote digit.
  d.roofArea = num(/Total Gross Roof Area[\s\d]*?([\d,]+\.\d+)\s*ft/, t)
  // ALL distinct roof R-values on the report (each block prints its own roof).
  d.roofRs = [...new Set([...t.matchAll(/Roof R-Value\s+([\d.]+)/g)].map(m => parseFloat(m[1])))]
  return d
}

// ---------------------------------------------------------------------------
// The business-rule core — HOMES tier, Focus on Energy tier, breakout
// fractions, rounding reconciliation. Ported verbatim from invoiceModel();
// DOM reads replaced by the input object.
//
// Input:
//   units           — dwelling units (number)
//   assetScoreBase  — parseAssetScoreText() output for the Baseline report
//   assetScoreImp   — parseAssetScoreText() output for the Improved report
//   includeAttic    — optional override; default: attic rows included when
//                     the baseline reports an attic below the improved
//                     minimum R (i.e. an attic is actually being upgraded)
//   fields          — document text fields (owner/property/contact/dates);
//                     carried through untouched onto the model
// ---------------------------------------------------------------------------
export function buildPaperworkModel({ units, assetScoreBase, assetScoreImp, includeAttic, fields, textBlocks }) {
  const asB = assetScoreBase, asI = assetScoreImp
  // Attic sq ft: straight from the Asset Score report's roof area — the audit
  // reports are the source of record for every quantity; no manual inputs.
  const roofSqFt = asB && asB.roofArea != null ? Math.round(asB.roofArea) : null
  const iMin = (asI && asI.roofRs && asI.roofRs.length) ? Math.min(...asI.roofRs) : 49
  const bRs = (asB && asB.roofRs) ? asB.roofRs.filter(r => r < iMin) : []
  const baseAtticR = bRs.length ? Math.min(...bRs) : null
  const fmtR = r => (r % 1 ? r : Math.round(r))
  const savings = (asB && asI && asB.euiCurrent && asI.euiUpgraded != null)
    ? (asB.euiCurrent - asI.euiUpgraded) / asB.euiCurrent * 100 : null
  // HOMES tier (Wisconsin): 35%+ → $10k/unit ; 20–34% → $5k/unit ; <20% → not eligible
  const tier = savings == null ? null : (savings >= 35
    ? { perUnit: 10000, desc: 'IQ at <80% AMI and modeled energy savings of 35% or greater', note: '$10,000.00 per unit' }
    : savings >= 20
      ? { perUnit: 5000, desc: 'IQ at <80% AMI and modeled energy savings of 20-34%', note: '$5,000.00 per unit' }
      : { perUnit: 0, desc: 'Modeled savings below 20% — not HOMES eligible', note: '' })
  const homesAmt = (units && tier) ? units * tier.perUnit : 0
  // FOE tier from the BASELINE attic R (published multifamily guidelines).
  const hasAttic = includeAttic != null
    ? !!includeAttic
    : (roofSqFt != null && baseAtticR != null)
  let foe = null
  if (hasAttic && roofSqFt && baseAtticR != null) {
    if (baseAtticR < 11)       foe = { rate: 1.00, desc: 'Air Sealing & Attic Insulation, Existing < R-11', note: '$1.00 per Sq. Ft.' }
    else if (baseAtticR <= 19) foe = { rate: 0.70, desc: 'Air Sealing & Attic Insulation, Existing R-12 to R-19', note: '$0.70 per Sq. Ft.' }
    else if (baseAtticR <= 38) foe = { rate: 0.55, desc: 'Insulation & Air Sealing, Existing R20-R38', note: '$0.55 per Sq. Ft.' }
    if (foe) foe.amt = Math.round(roofSqFt * foe.rate * 100) / 100
  }
  const foeAmt = foe ? foe.amt : 0
  const total = Math.round((homesAmt + foeAmt) * 100) / 100
  // Measure lines: breakout fractions × total, largest row absorbs the drift.
  // Descriptions come from the text-block table (program-overridable), falling
  // back to the built-in defaults.
  const rTokens = {
    baseline_r: fmtR(baseAtticR != null ? baseAtticR : 0),
    improved_r: fmtR(iMin),
  }
  const text = (key) => resolveTextBlock(textBlocks, key, rTokens)
  const rows = []
  const push = (name, frac, qty, unit, desc) =>
    rows.push({ name, frac, qty, unit, desc, cost: Math.round(total * frac * 100) / 100 })
  if (hasAttic) {
    push('Attic Insulation', 0.44, roofSqFt, 'Sq Ft', text('measure.attic_insulation'))
    push('Attic Air Sealing', 0.5483, roofSqFt, 'Sq Ft', text('measure.attic_air_sealing'))
  }
  push('Low Flow Devices: Bath Aerators', 0.0033, units, 'Unit', text('measure.bath_aerators'))
  push('Low Flow Devices: Kitchen Aerators', 0.0035, units, 'Unit', text('measure.kitchen_aerators'))
  push('Low Flow Devices: Showerheads', 0.0049, units, 'Unit', text('measure.showerheads'))
  // renormalize when attic rows are absent, then reconcile to the exact total
  const fracSum = rows.reduce((a, r) => a + r.frac, 0)
  if (Math.abs(fracSum - 1) > 1e-6 && fracSum > 0)
    rows.forEach(r => { r.cost = Math.round(total * r.frac / fracSum * 100) / 100 })
  const drift = Math.round((total - rows.reduce((a, r) => a + r.cost, 0)) * 100) / 100
  if (drift && rows.length) {
    let mx = 0
    rows.forEach((r, i) => { if (r.cost > rows[mx].cost) mx = i })
    rows[mx].cost = Math.round((rows[mx].cost + drift) * 100) / 100
  }
  return { units, roofSqFt, baseAtticR, iMin, savings, tier, homesAmt, foe, foeAmt, total, rows,
    fields: fields || {}, textBlocks: textBlocks || null }
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
export function formatMoney(v) {
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function _money(v) { return formatMoney(v) }
function _qty(q) { return q != null ? Number(q).toLocaleString('en-US') : '' }

// ---------------------------------------------------------------------------
// jsPDF letter canvas helper (612×792pt). Hard-won rule from the standalone
// tool: always set the font BEFORE splitTextToSize — measuring at the wrong
// size makes text overflow its cell.
// ---------------------------------------------------------------------------
async function pdfCanvas(margin) {
  const jspdfModule = await import('jspdf')
  const jsPDF = jspdfModule.jsPDF || jspdfModule.default
  const d = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = 612, H = 792, M = margin || 40, CW = W - 2 * M
  const C = { navy: [28, 61, 94], line: [217, 224, 232], ink: [34, 43, 53], mut: [122, 135, 152],
    red: [192, 57, 43], sealBlue: [47, 128, 214], zebra: [242, 247, 253] }
  const st = { y: M }
  const font = (sz, style) => { d.setFont('helvetica', style || 'normal'); d.setFontSize(sz) }
  const t = (x, yy, txt, o) => d.text(String(txt), x, yy, o || {})
  const wrap = (txt, w) => d.splitTextToSize(String(txt), w)
  const need = h => { if (st.y + h > H - M - 16) { d.addPage(); st.y = M } }
  return { d, W, H, M, CW, C, st, font, t, wrap, need,
    fill: c => d.setFillColor(c[0], c[1], c[2]),
    stroke: c => d.setDrawColor(c[0], c[1], c[2]),
    tc: c => d.setTextColor(c[0], c[1], c[2]) }
}

// ---------------------------------------------------------------------------
// EES documents — 'audit' | 'proposal' | 'invoice'. True vector PDFs; every
// layout decision here was a Nicholas review round (port doc §5). Returns a
// Blob.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Document sections.
//
// The EES submittal documents are composed of named sections drawn in order.
// Splitting the renderer this way is what makes a document a TEMPLATE: a
// template is an ordered list of {type, config}, and the pixels stay
// high-quality because each section is real vector-drawing code rather than a
// lossy HTML/docx conversion.
//
// DEFAULT_DOCUMENT_SECTIONS reproduces the three EES documents exactly as they
// shipped, so behaviour is unchanged until a template overrides the list.
// ---------------------------------------------------------------------------

/** Shared drawing context handed to every section renderer. */
async function buildDocumentContext(m, kind, opts = {}) {
  const F = m.fields
  const isAudit = kind === 'audit', isInv = kind === 'invoice'
  const P = await pdfCanvas(34)
  const { d, W, H, M, CW, C, st, font, t, wrap, need, fill, stroke, tc } = P
  const pv = v => (v != null && String(v).trim() !== '') ? String(v) : '—'
  const GL = [203, 210, 219], HB = [240, 243, 247]       // grid line + header fill
  const AMT = W - M - 6                                   // every dollar figure shares this right edge
  // Wording from the text-block table (program-overridable), default fallback.
  const text = (key) => resolveTextBlock(m.textBlocks, key)

  const head = (txt, gap) => { need(24); st.y += (gap != null ? gap : 10); tc([104, 116, 132]); font(8.5, 'bold')
    t(M, st.y + 8, txt.toUpperCase()); st.y += 12 }
  const gridHeader = (cols) => { // cols: [{x0,x1,lbl,align}]
    const h = 16; need(h + 4)
    fill(HB); d.rect(M, st.y, CW, h, 'F')
    stroke(GL); d.setLineWidth(.6); d.rect(M, st.y, CW, h)
    for (const c of cols) d.line(c.x0, st.y, c.x0, st.y + h)
    tc([70, 82, 98]); font(7.5, 'bold')
    for (const c of cols)
      t(c.align === 'right' ? c.x1 - 5 : c.x0 + 5, st.y + 11, c.lbl, c.align === 'right' ? { align: 'right' } : {})
    st.y += h }
  const gridBorders = (cols, h) => { stroke(GL); d.setLineWidth(.6)
    d.line(M, st.y, M, st.y + h); d.line(W - M, st.y, W - M, st.y + h)
    for (const c of cols) d.line(c.x0, st.y, c.x0, st.y + h)
    d.line(M, st.y + h, W - M, st.y + h) }

  // Money shared between the credits table and the totals box.
  const gross = isAudit ? 2000 : m.total
  const foeAmt = isAudit ? 0 : m.foeAmt
  const iraAmt = isAudit ? 2000 : m.homesAmt
  const credits = []
  if (isAudit) credits.push(['IRA HOMES Incentive — Instant Discount', 'IQ MF Audit Rebate / Building', iraAmt])
  else {
    if (m.foe && foeAmt) credits.push(['Focus on Energy — Instant Discount', m.foe.desc + ' (' + m.foe.note + ')', foeAmt])
    if (m.tier && iraAmt) credits.push(['IRA HOMES — Instant Discount', m.tier.desc + ' (' + m.tier.note + ')', iraAmt])
  }

  return { m, F, kind, isAudit, isInv, d, W, H, M, CW, C, st, font, t, wrap, need,
    fill, stroke, tc, pv, GL, HB, AMT, text, head, gridHeader, gridBorders,
    gross, foeAmt, iraAmt, credits,
    // Signature-tab capture (opt-in). When collectTabs is set, the
    // acknowledgment/signature section records the signature + date tab
    // positions in PDF coordinates (origin bottom-left, letter H=792) so the
    // e-signature pipeline can place a property-owner signature on this
    // generated PDF — which has no discoverable text anchors.
    collectTabs: !!opts.collectTabs, signatureTabs: [] }
}

export const SECTION_RENDERERS = {
  /* Company name, the INVOICE word or the centred proposal title, hairline rule. */
  company_header(x) {
    const { W, M, C, st, font, t, tc, stroke, d, text, isAudit, isInv } = x
    tc(C.navy); font(10.5, 'bold'); t(M, st.y + 15, text('header.company_name'))
    if (isAudit || isInv) {
      tc([150, 160, 174]); font(10.5, 'bold'); t(W - M, st.y + 15, 'INVOICE', { align: 'right' })
      st.y += 21
    } else {
      st.y += 21
      tc([104, 116, 132]); font(10.5, 'bold')
      t(W / 2, st.y + 11, text('title.proposal'), { align: 'center' })
      st.y += 16
    }
    stroke([150, 160, 174]); d.setLineWidth(.75); d.line(M, st.y, W - M, st.y); st.y += 12
  },

  /* Meta stack top-right + PROPERTY/INSTALLATION and BILL TO columns. */
  document_meta_and_parties(x) {
    const { F, W, M, C, st, font, t, tc, wrap, pv, isAudit, isInv } = x
    const noLbl = (isAudit || isInv) ? 'Invoice No.:' : 'Proposal No.:'
    const dateLbl = (isAudit || isInv) ? 'Invoice Date:' : 'Date:'
    const termLbl = 'Due Date:'
    const docNo = isAudit ? (F.invoiceNumber || 'INV-WI-') : (isInv ? (F.projectInvoiceNumber || '') : '')
    const metaRows = []
    if (isAudit || isInv) metaRows.push([noLbl, pv(docNo)])
    metaRows.push([dateLbl, pv(F.invoiceDate)])
    if (isAudit) metaRows.push([termLbl, 'N/A'])
    else if (isInv) metaRows.push([termLbl, 'Net 30'])
    if (!isAudit) {
      const sD = isInv ? F.startDate : F.estimatedStartDate
      const eD = isInv ? F.endDate : F.estimatedEndDate
      if (sD) metaRows.push([isInv ? 'Start Date:' : 'Est. Start:', sD])
      if (eD) metaRows.push([isInv ? 'Completion Date:' : 'Est. Completion:', eD])
    }
    const topY = st.y
    let my = topY
    for (const [lb, v] of metaRows) {
      font(8.5, 'bold'); tc([60, 76, 94]); t(W - M - 95, my + 9, lb, { align: 'right' })
      tc(C.ink); font(9.5); t(W - M, my + 9, String(v), { align: 'right' })
      my += 13
    }
    // skip the property name when it just repeats the street address
    const _addr = String(F.installationAddress || '').trim().toLowerCase()
    const _pn = String(F.propertyName || '').trim()
    const showName = _pn && !(_addr && _pn.toLowerCase().startsWith(_addr))
    const lLines = [showName ? _pn : '', F.installationAddress, F.installationCityStateZip,
      'Property Type: Multifamily', F.iqNumber ? ('IQ Number: ' + F.iqNumber) : ''].filter(v => v && String(v).trim())
    const rLines = [F.ownerName, F.ownerAddress, F.ownerCityStateZip, F.contactName, F.contactEmail, F.contactPhone]
      .filter(v => v && String(v).trim())
    const BX = M + 210
    tc(C.navy); font(8.5, 'bold')
    t(M, topY + 9, 'PROPERTY / INSTALLATION'); t(BX, topY + 9, 'BILL TO')
    let ly = topY + 22, ry = topY + 22; tc(C.ink); font(9)
    for (const v of lLines) for (const ln of wrap(v, 190)) { t(M, ly, ln); ly += 11 }
    for (const v of rLines) for (const ln of wrap(v, 150)) { t(BX, ry, ln); ry += 11 }
    st.y = Math.max(my, ly, ry) + 4
  },

  /* Fixed four-row audit services table (Energy Audit Invoice only). */
  audit_services_table(x, cfg = {}) {
    const { W, H, M, C, st, font, t, tc, d, AMT, head, gridHeader, gridBorders } = x
    head(cfg.heading || 'Audit Services', 12)
    const CA = [{ x0: M + 22, x1: M + 300, lbl: 'SERVICE DESCRIPTION' }, { x0: M + 300, x1: M + 340, lbl: 'QTY', align: 'right' },
      { x0: M + 340, x1: M + 400, lbl: 'UNIT' }, { x0: M + 400, x1: M + 466, lbl: 'RATE', align: 'right' },
      { x0: M + 466, x1: W - M, lbl: 'AMOUNT', align: 'right' }]
    gridHeader(CA)
    tc([70, 82, 98]); font(7.5, 'bold'); t(M + 5, st.y - 5, '#')
    const rows = cfg.rows || [['1', 'Whole-Building Energy Audit — Multifamily', '1', 'Building', '$2,000.00', '$2,000.00'],
      ['2', 'Per-Unit Blower Door and Diagnostic Testing', '', 'Unit', '', 'Included'],
      ['3', 'Common Area and Building Envelope Assessment', '1', 'Lump Sum', '', 'Included'],
      ['4', 'Mechanical Systems Survey', '1', 'Lump Sum', '', 'Included']]
    rows.forEach(r => { const h = 16
      if (st.y + h > H - M - 20) { d.addPage(); st.y = M }
      gridBorders(CA, h)
      tc(C.mut); font(8.5); t(M + 5, st.y + 11, r[0])
      tc(C.ink); t(M + 27, st.y + 11, r[1])
      if (r[2]) t(M + 335, st.y + 11, r[2], { align: 'right' })
      t(M + 345, st.y + 11, r[3])
      if (r[4]) t(M + 461, st.y + 11, r[4], { align: 'right' })
      t(AMT, st.y + 11, r[5], { align: 'right' })
      st.y += h })
  },

  /* Variable-length measure table: columns size to content, rows never split,
     header repeats on continuation. */
  measure_line_items_table(x, cfg = {}) {
    const { m, W, H, M, C, st, font, t, tc, wrap, d, AMT, head, gridHeader, gridBorders, isInv } = x
    head(cfg.heading || (isInv ? 'Installed Scope of Work — HOMES Project' : 'Proposed Scope of Work — HOMES Project'), 12)
    font(9); const qw = Math.max(24, ...m.rows.map(r => d.getTextWidth(_qty(r.qty)))) + 14
    const uw = Math.max(24, ...m.rows.map(r => d.getTextWidth(String(r.unit || '')))) + 14
    font(9.5, 'bold'); const aw = Math.max(46, ...m.rows.map(r => d.getTextWidth(_money(r.cost)))) + 16
    const AX0 = W - M - aw, UX0 = AX0 - uw, DX = UX0 - qw
    const CM = [{ x0: M + 22, x1: DX, lbl: 'MEASURE LINE ITEM' }, { x0: DX, x1: UX0, lbl: 'QTY', align: 'right' },
      { x0: UX0, x1: AX0, lbl: 'UNIT' }, { x0: AX0, x1: W - M, lbl: 'AMOUNT', align: 'right' }]
    gridHeader(CM)
    tc([70, 82, 98]); font(7.5, 'bold'); t(M + 5, st.y - 5, '#')
    const descW = DX - (M + 28) - 10
    const contHeader = () => { gridHeader(CM); tc([70, 82, 98]); font(7.5, 'bold'); t(M + 5, st.y - 5, '#') }
    m.rows.forEach((r, i) => {
      font(9, 'bold'); const nameLines = wrap(r.name, descW)
      font(8); const dl = wrap(r.desc, descW)
      const h = 5 + nameLines.length * 11 + (dl.length ? dl.length * 9 + 4 : 0) + 5
      if (st.y + h > H - M - 20) { d.addPage(); st.y = M; contHeader() }  // rows never split; header repeats
      gridBorders(CM, h)
      const vc = st.y + h / 2 + 3      // vertically centered baseline for the cell values
      tc(C.mut); font(8.5); t(M + 5, vc, String(i + 1))
      tc(C.ink); font(9, 'bold'); nameLines.forEach((ln, k) => t(M + 28, st.y + 12 + k * 11, ln))
      font(8.5); t(UX0 - 5, vc, _qty(r.qty), { align: 'right' })
      t(UX0 + 6, vc, r.unit)
      font(9, 'bold'); t(AMT, vc, _money(r.cost), { align: 'right' })
      font(8); tc([57, 67, 77])
      const dy = st.y + 12 + nameLines.length * 11 + 1
      dl.forEach((ln, k) => t(M + 28, dy + k * 9, ln))
      st.y += h
    })
  },

  /* Rebates rendered as credit lines feeding the totals. */
  rebate_credits_table(x, cfg = {}) {
    const { credits, W, H, M, C, st, font, t, tc, wrap, d, AMT, head, gridHeader, gridBorders, isAudit } = x
    head(cfg.heading || (isAudit ? 'Rebates & Incentives Applied' : 'Applicable Rebates & Incentives'), 10)
    font(8.5, 'bold')
    const pw = Math.max(60, ...credits.map(c => d.getTextWidth(c[0]))) + 12
    font(9, 'bold')
    const aw2 = Math.max(50, ...credits.map(c => d.getTextWidth('(' + _money(c[2]) + ')'))) + 16
    const PX = Math.min(M + pw, M + 240), AX = W - M - aw2
    const CR = [{ x0: PX, x1: AX, lbl: 'INCENTIVE DESCRIPTION' }, { x0: AX, x1: W - M, lbl: 'AMOUNT', align: 'right' }]
    gridHeader(CR)
    tc([70, 82, 98]); font(7.5, 'bold'); t(M + 5, st.y - 5, 'PROGRAM')
    credits.forEach(([nm, desc, amt]) => {
      font(8.5, 'bold'); const nl = wrap(nm, PX - M - 12)
      font(8.5); const dl = wrap(desc, AX - PX - 12)
      const h = Math.max(nl.length, dl.length) * 9.5 + 8
      if (st.y + h > H - M - 20) { d.addPage(); st.y = M }
      gridBorders(CR, h)
      tc(C.ink); font(8.5, 'bold'); nl.forEach((ln, k) => t(M + 5, st.y + 11 + k * 9.5, ln))
      font(8.5); tc([70, 82, 98]); dl.forEach((ln, k) => t(PX + 5, st.y + 11 + k * 9.5, ln))
      tc(C.ink); font(9, 'bold'); t(AMT, st.y + h / 2 + 3.2, '(' + _money(amt) + ')', { align: 'right' })
      st.y += h })
  },

  /* Subtotal / Total Rebates / TOTAL DUE, sharing the one money edge. */
  totals_box(x) {
    const { gross, foeAmt, iraAmt, W, M, C, st, font, t, tc, fill, stroke, d, need, GL, HB, AMT } = x
    const reb = foeAmt + iraAmt, due = gross - reb
    const rows = [['Subtotal', _money(gross), 0], ['Total Rebates', '(' + _money(reb) + ')', 0],
      ['TOTAL DUE', _money(Math.abs(due) < 0.005 ? 0 : due), 1]]
    const TX = W - M - 250, TW = 250, hh = [16, 16, 18]
    const boxH = hh.reduce((a, b) => a + b, 0)
    need(boxH + 14); st.y += 8
    let yy = st.y
    rows.forEach(([lbl, val, strong], i) => { const h = hh[i]
      if (strong) { fill(HB); d.rect(TX, yy, TW, h, 'F') }
      stroke(GL); d.setLineWidth(.6); d.rect(TX, yy, TW, h)
      tc(strong ? C.ink : [60, 76, 94]); font(strong ? 9 : 8.5, 'bold'); t(TX + 8, yy + h - 5, lbl)
      tc(C.ink); font(strong ? 9 : 8.5, strong ? 'bold' : 'normal'); t(AMT, yy + h - 5, val, { align: 'right' })
      yy += h })
    st.y = yy
  },

  /* Bulleted deliverables list (Energy Audit Invoice only). */
  deliverables_list(x, cfg = {}) {
    const { M, C, st, font, t, tc, need, head } = x
    head(cfg.heading || 'Deliverables', 10)
    const items = cfg.items || ['Whole-Building Energy Audit Report (ASHRAE Level II equivalent)',
      'HPXML v4 / BuildingSync file from Asset Score',
      'Customer Report / Building Assessment Tool Report']
    items.forEach(item => {
      need(12); tc(C.ink); font(8.5); t(M + 5, st.y + 9, '–  ' + item); st.y += 12 })
  },

  /* Acknowledgment paragraph + the two signature rules. */
  acknowledgment_and_signature(x, cfg = {}) {
    const { W, H, M, CW, C, st, font, t, tc, wrap, need, stroke, d, text, isAudit, isInv } = x
    head_(x, cfg.heading || 'Acknowledgment & Acceptance')
    const ack = (isAudit || isInv) ? text('acknowledgment.invoice') : text('acknowledgment.proposal')
    const al = wrap(ack, CW); need(al.length * 10 + 6); tc(C.ink); font(9)
    al.forEach((ln, k) => t(M, st.y + 9 + k * 10, ln)); st.y += al.length * 10 + 4
    need(46); st.y += 28; stroke([68, 88, 110]); d.setLineWidth(1)
    d.line(M, st.y, M + 280, st.y); d.line(W - M - 150, st.y, W - M, st.y)
    tc(C.mut); font(8.5); t(M, st.y + 10, cfg.signer_label || 'Property Owner / Authorized Representative')
    t(W - M - 150, st.y + 10, 'Date')
    // Record the property-owner signature + date tabs (order 1) for the
    // e-signature route. jsPDF y is top-origin; the signing pipeline stores
    // tab_y bottom-origin (pdf-lib / htmlToPdf convention). The signature and
    // date sit ABOVE their rules: box bottom edge on the rule line at st.y.
    if (x.collectTabs) {
      const page = d.getNumberOfPages()
      const boxH = 26
      x.signatureTabs.push(
        { recipient_order: 1, tab_type: 'sig',  page, x: M,          y: H - st.y, width: 280, height: boxH },
        { recipient_order: 1, tab_type: 'date', page, x: W - M - 150, y: H - st.y, width: 150, height: boxH },
      )
    }
  },

  /* Footer pinned to the bottom of the last page. */
  page_footer(x) {
    const { W, H, M, C, st, font, t, tc, stroke, d, text } = x
    const fy = H - 44
    if (st.y > fy - 10) d.addPage()
    stroke(C.line); d.setLineWidth(.5); d.line(M, fy, W - M, fy)
    tc(C.mut); font(8.5)
    t(W / 2, fy + 12, text('footer.company_line'), { align: 'center' })
    font(8, 'italic'); t(W / 2, fy + 23, text('footer.contact_line'), { align: 'center' })
  },
}

// `head` lives on the context; this thin helper keeps the section bodies tidy.
function head_(x, txt, gap) { x.head(txt, gap) }

/**
 * The section list for each built-in document, reproducing exactly what
 * shipped. A stored template supplies its own list of {type, config}.
 */
export const DEFAULT_DOCUMENT_SECTIONS = Object.freeze({
  audit: [
    { type: 'company_header' },
    { type: 'document_meta_and_parties' },
    { type: 'audit_services_table' },
    { type: 'rebate_credits_table' },
    { type: 'totals_box' },
    { type: 'deliverables_list' },
    { type: 'acknowledgment_and_signature' },
    { type: 'page_footer' },
  ],
  proposal: [
    { type: 'company_header' },
    { type: 'document_meta_and_parties' },
    { type: 'measure_line_items_table' },
    { type: 'rebate_credits_table' },
    { type: 'totals_box' },
    { type: 'acknowledgment_and_signature' },
    { type: 'page_footer' },
  ],
  invoice: [
    { type: 'company_header' },
    { type: 'document_meta_and_parties' },
    { type: 'measure_line_items_table' },
    { type: 'rebate_credits_table' },
    { type: 'totals_box' },
    { type: 'acknowledgment_and_signature' },
    { type: 'page_footer' },
  ],
  // Sealed-style documents (Sealed, Inc. primary contractor). A different
  // layout that shares none of the nine EES sections — its own section types.
  sealedProposal: [
    { type: 'sealed_primary_contractor_block' },
    { type: 'sealed_document_details_block' },
    { type: 'sealed_bill_to_block' },
    { type: 'sealed_project_address_block' },
    { type: 'sealed_title' },
    { type: 'sealed_line_items_table' },
    { type: 'sealed_rebate_section', config: { variant: 'ira' } },
    { type: 'sealed_rebate_section', config: { variant: 'foe' } },
    { type: 'sealed_totals_list' },
    { type: 'sealed_signature_block' },
  ],
  sealedInvoice: [
    { type: 'sealed_primary_contractor_block' },
    { type: 'sealed_document_details_block' },
    { type: 'sealed_bill_to_block' },
    { type: 'sealed_project_address_block' },
    { type: 'sealed_title' },
    { type: 'sealed_line_items_table' },
    { type: 'sealed_rebate_section', config: { variant: 'ira' } },
    { type: 'sealed_rebate_section', config: { variant: 'foe' } },
    { type: 'sealed_totals_list' },
    { type: 'sealed_signature_block' },
  ],
  // Energy Assessment Report.
  //
  // This report carries the TAGGED PHOTOGRAPHS of an assessment, grouped under
  // the system each one documents, in the order and under the headings of the
  // DOE Audit Template report — so the two are read side by side and the
  // systems photos line up with the same systems in both.
  //
  // That is the whole document. It identifies the building and it shows the
  // photographs. It carries no narrative, no deliverables list, no findings
  // section and no signature block: an assessment report is a record of what
  // was seen, and anything else on the page is an assertion nobody made.
  //
  // A section appears only when it has photographs, and prints only the
  // questions that were actually answered — a heading over nothing, or a
  // column of em dashes, is filler.
  //
  // Note the order: Audit Template puts Windows before Foundation Types and
  // Lighting before HVAC, which is why this is not the work plan's walk order.
  energyAssessmentReport: [
    { type: 'assessment_cover' },
    { type: 'assessment_building_summary', config: { heading: 'Building Summary' } },
    { type: 'assessment_field_data', config: { step: 'Building Geometry & Use',         heading: 'Building Characteristics and Use Types', photos: 'step' } },
    { type: 'assessment_field_data', config: { step: 'Roof / Ceiling',                  heading: 'Roofs', photos: 'step' } },
    { type: 'assessment_field_data', config: { step: 'Walls',                           heading: 'Walls', photos: 'step' } },
    { type: 'assessment_field_data', config: { step: 'Windows & Doors',                 heading: 'Windows', photos: 'step' } },
    { type: 'assessment_field_data', config: { step: 'Foundation / Floor',              heading: 'Foundation Types', photos: 'step' } },
    { type: 'assessment_field_data', config: { step: 'Common-Area Lighting',            heading: 'Lighting', photos: 'step' } },
    { type: 'assessment_field_data', config: { step: 'Heating Systems',                 heading: 'HVAC Systems: Heating', photos: 'step' } },
    { type: 'assessment_field_data', config: { step: 'Cooling Systems',                 heading: 'HVAC Systems: Cooling', photos: 'step' } },
    { type: 'assessment_field_data', config: { step: 'Distribution & Ventilation',      heading: 'Distribution Equipment and Zone Controls', photos: 'step' } },
    { type: 'assessment_field_data', config: { step: 'Service Hot Water',               heading: 'Service Hot Water Systems', photos: 'step' } },
    { type: 'assessment_field_data', config: { step: 'Building Diagnostics',            heading: 'Enclosure Tightness and Diagnostics', photos: 'step' } },
    { type: 'assessment_field_data', config: { step: 'Utility & Energy Data',           heading: 'Utility Data and Benchmarking', photos: 'step' } },
    { type: 'assessment_field_data', config: { step: 'Occupancy & Operating Schedules', heading: 'Occupancy and Operating Schedules', photos: 'step' } },
    // Catches any tagged photograph none of the sections above showed, so no
    // tagged photo is ever silently dropped. Prints nothing when there is none.
    { type: 'assessment_photo_documentation', config: {
      heading: 'Additional Photographs', columns: 2, group_by_step: true, exclude_printed: true } },
    // The documents the user chose at generate time. Prints nothing when none
    // were chosen.
    { type: 'assessment_documents', config: { heading: 'Documents' } },
    { type: 'assessment_footer' },
  ],
  // Combustion Safety Notification (Large Multifamily 5+ Units) — its own engine.
  combustionSafety: [
    { type: 'combustion_intro' },
    { type: 'combustion_common_area' },
    { type: 'combustion_unit_samples' },
    { type: 'combustion_ventilation' },
    { type: 'combustion_property_owner' },
    { type: 'combustion_signature' },
    { type: 'combustion_footer' },
  ],
})

/**
 * Render an EES submittal document. `sections` overrides the built-in list —
 * that is how a stored template drives the output. Returns a Blob.
 */
export async function buildEesPdf(m, kind, sections, opts = {}) {
  const x = await buildDocumentContext(m, kind, opts)
  const list = sections && sections.length ? sections : DEFAULT_DOCUMENT_SECTIONS[kind]
  if (!list) throw new Error(`Unknown document kind: ${kind}`)
  for (const s of list) {
    const render = SECTION_RENDERERS[s.type]
    if (!render) throw new Error(`Unknown document section type: ${s.type}`)
    render(x, s.config || {})
  }
  if (opts.collectTabs) return { blob: x.d.output('blob'), tabs: x.signatureTabs }
  return x.d.output('blob')
}

/**
 * Render an EES submittal document AND return the signature/date tab positions
 * for the e-signature route. Returns { blob, tabs } where each tab is
 * { recipient_order, tab_type ('sig'|'date'), page, x, y, width, height } in
 * PDF coordinates (origin bottom-left). Only documents whose section list
 * includes acknowledgment_and_signature yield tabs.
 */
export async function buildSubmittalPdfWithSignatureTabs(m, kind, sections) {
  // Sealed documents route through the Sealed engine and carry no captured
  // signature tab. The EES documents and the Combustion Safety Notification
  // both record a property-owner / customer signature tab.
  const engine = DOCUMENT_KIND_ENGINE[kind]
  if (engine === 'sealed')
    throw new Error('Signature capture is not implemented for Sealed documents')
  if (engine === 'combustion_safety')
    return buildCombustionPdf(m, kind, sections, { collectTabs: true })
  if (engine === 'energy_assessment')
    return buildAssessmentReportPdf(m, kind, sections, { collectTabs: true })
  return buildEesPdf(m, kind, sections, { collectTabs: true })
}

// ---------------------------------------------------------------------------
// Sealed-style documents — 'proposal' | 'invoice'. Sealed, Inc. is the
// primary contractor; EES is the line-item contractor. Keeps Sealed's own
// look (including red amounts — the EES no-red rule applies to EES documents
// only, not to Sealed's own format).
//
// Like the EES documents, a Sealed document is an ordered list of named
// sections drawn against a shared context. This is a genuinely different
// layout — two-column party header, a contractor/name/description items table
// with zebra-striped rows, red rebate amounts, and a totals *list* rather than
// a bordered box — so it has its own section types and its own context helpers
// (bh, lines9, zebra fill, the reusable rebate `sect`) rather than the EES grid
// helpers. DEFAULT_DOCUMENT_SECTIONS.sealedProposal / .sealedInvoice reproduce
// the two documents exactly as they shipped.
//
// Column layout: the header is two columns drawn at the same y. Left-column
// sections (primary contractor, bill to) draw at st.y and record their bottom
// in ctx.leftBottom WITHOUT advancing st.y; the paired right-column section
// (document details, project address) draws at the same st.y, then advances
// st.y past the taller of the two columns.
// ---------------------------------------------------------------------------

/** Shared drawing context handed to every Sealed section renderer. */
async function buildSealedContext(m, kind) {
  const F = m.fields
  const isInv = /invoice/.test(kind)   // 'invoice' or 'sealed_invoice'
  const P = await pdfCanvas()
  const { d, W, H, M, CW, C, st, font, t, wrap, need, fill, stroke, tc } = P
  const bh = (txt, x, yy) => { tc(C.sealBlue); font(9.5, 'bold'); t(x, yy, txt.toUpperCase()) }
  const lines9 = (arr, x, yy) => { tc(C.ink); font(9); arr.filter(v => v).forEach((ln, k) => t(x, yy + k * 11.5, String(ln))); return yy + arr.filter(v => v).length * 11.5 }
  st.y = M + 4
  const RX = W / 2 + 20
  // The reusable rebate block (used for both the IRA and non-IRA rebate rows).
  const sect = (title, desc, name, amt) => { need(46); st.y += 12; bh(title, M, st.y)
    st.y += 5; stroke([188, 214, 242]); d.setLineWidth(1); d.line(M, st.y, W - M, st.y)
    const dl = wrap(desc, 270), h = Math.max(dl.length * 9.5, 19) + 10; need(h)
    tc(C.ink); font(8); dl.forEach((ln, k) => t(M, st.y + 12 + k * 9.5, ln))
    wrap(name, 150).forEach((ln, k) => t(M + 300, st.y + 12 + k * 9.5, ln))
    tc(C.red); font(9, 'bold'); t(W - M, st.y + 12, _money(amt), { align: 'right' })
    st.y += h; stroke([188, 214, 242]); d.line(M, st.y, W - M, st.y) }
  return { m, F, kind, isInv, d, W, H, M, CW, C, st, font, t, wrap, need, fill, stroke, tc,
    bh, lines9, sect, RX, leftBottom: null }
}

export const SEALED_SECTION_RENDERERS = {
  /* Left column, row 1: the fixed Sealed, Inc. contractor block. */
  sealed_primary_contractor_block(x, cfg = {}) {
    const { M, st, bh, lines9 } = x
    bh(cfg.heading || 'Primary Contractor:', M, st.y)
    x.leftBottom = lines9(cfg.lines || ['Sealed, Inc.', '200 E Verona Ave', 'Verona, WI 53593', '(949) 832-6798'], M, st.y + 15)
  },

  /* Right column, row 1: invoice/project details; advances past the taller column. */
  sealed_document_details_block(x, cfg = {}) {
    const { F, st, bh, lines9, RX, isInv } = x
    bh(cfg.heading || (isInv ? 'Invoice Details:' : 'Project Details:'), RX, st.y)
    const det = isInv
      ? ['Invoice No.: ' + (F.projectInvoiceNumber || ''), 'Invoice Date: ' + (F.invoiceDate || ''), 'Due Date: 30 days', 'IQ Number: ' + (F.iqNumber || ''), 'Start Date: ' + (F.startDate || ''), 'Completion Date: ' + (F.endDate || '')]
      : ['Date: ' + (F.invoiceDate || ''), 'Valid for: 30 days', 'IQ Number: ' + (F.iqNumber || ''), 'Estimated Start Date: ' + (F.estimatedStartDate || ''), 'Estimated Completion Date: ' + (F.estimatedEndDate || '')]
    const yB = lines9(det, RX, st.y + 15)
    st.y = Math.max(x.leftBottom != null ? x.leftBottom : st.y, yB) + 12
    x.leftBottom = null
  },

  /* Left column, row 2: the Bill To party block. */
  sealed_bill_to_block(x, cfg = {}) {
    const { F, M, st, bh, lines9 } = x
    bh(cfg.heading || 'Bill To:', M, st.y)
    x.leftBottom = lines9([F.ownerName, F.contactName, F.ownerAddress, F.ownerCityStateZip, F.contactPhone, F.contactEmail], M, st.y + 15)
  },

  /* Right column, row 2: the project address block; advances past the taller column. */
  sealed_project_address_block(x, cfg = {}) {
    const { F, st, bh, lines9, RX, isInv } = x
    bh(cfg.heading || 'Project Address:', RX, st.y)
    const yB = lines9([F.propertyName, F.installationAddress, F.installationCityStateZip, 'Multifamily', isInv ? '' : F.iqNumber], RX, st.y + 15)
    st.y = Math.max(x.leftBottom != null ? x.leftBottom : st.y, yB) + 12
    x.leftBottom = null
  },

  /* The big INVOICE / PROPOSAL title. */
  sealed_title(x, cfg = {}) {
    const { M, C, st, font, t, tc, isInv } = x
    tc(C.sealBlue); font(14, 'bold'); t(M, st.y + 11, cfg.text || (isInv ? 'INVOICE' : 'PROPOSAL')); st.y += 17
  },

  /* Contractor / Name / Description / Total table, zebra-striped, EES per line. */
  sealed_line_items_table(x) {
    const { m, W, H, M, CW, C, st, font, t, wrap, d, fill, stroke, tc } = x
    stroke(C.sealBlue); d.setLineWidth(1); d.line(M, st.y, W - M, st.y)
    tc(C.sealBlue); font(8, 'bold')
    t(M, st.y + 13, 'CONTRACTOR'); t(M + 92, st.y + 13, 'NAME'); t(M + 185, st.y + 13, 'DESCRIPTION'); t(W - M, st.y + 13, 'TOTAL', { align: 'right' })
    st.y += 17; stroke([188, 214, 242]); d.setLineWidth(1.2); d.line(M, st.y, W - M, st.y); st.y += 2
    const descW = CW - 185 - 80
    m.rows.forEach((r, i) => {
      const desc = 'Qty: ' + _qty(r.qty) + ' ' + (r.unit === 'Sq Ft' ? 'Sq Ft.' : 'Units.') + ' ' + r.desc.replace(/\n/g, ' ')
      const dl = wrap(desc, descW), cl = wrap('Energy Efficiency Services of Wisconsin', 82), nml = wrap(r.name, 85)
      let i0 = 0, firstSeg = true
      while (i0 < dl.length) {
        const fit = Math.max(3, Math.floor((H - M - 20 - st.y) / 9.5))
        const seg = dl.slice(i0, i0 + fit)
        const h = Math.max(seg.length, firstSeg ? Math.max(cl.length, nml.length) : 0) * 9.5 + 8
        if (st.y + h > H - M - 16 && !firstSeg) { d.addPage(); st.y = M }
        if (i % 2 === 1) { fill(C.zebra); d.rect(M, st.y, CW, h, 'F') }
        tc(C.ink); font(8)
        if (firstSeg) { cl.forEach((ln, k) => t(M, st.y + 10 + k * 9.5, ln)); nml.forEach((ln, k) => t(M + 92, st.y + 10 + k * 9.5, ln))
          font(8, 'bold'); t(W - M, st.y + 10, _money(r.cost), { align: 'right' }); font(8) }
        seg.forEach((ln, k) => { if (firstSeg && i0 + (k === 0) && i0 === 0 && k === 0) { font(8, 'bold'); t(M + 185, st.y + 10, ln); font(8) }
          else t(M + 185, st.y + 10 + k * 9.5, ln) })
        st.y += h; i0 += fit; firstSeg = false
        if (i0 < dl.length) { d.addPage(); st.y = M }
      }
      stroke(C.line); d.setLineWidth(.5); d.line(M, st.y, W - M, st.y); st.y += 2
    })
  },

  /* A rebate block. Parameterised via config.variant: 'ira' (always) or 'foe'
     (only when the model has a Focus on Energy rebate). Red amount preserved. */
  sealed_rebate_section(x, cfg = {}) {
    const { m, sect, isInv } = x
    const variant = cfg.variant || 'ira'
    if (variant === 'foe') {
      if (!m.foe) return
      sect(cfg.heading || 'Other Non-IRA Rebates',
        'Incentive Description: ' + m.foe.desc + '. Notes: ' + m.foe.note + '.',
        'Focus on Energy - Instant Discount', m.foeAmt)
    } else {
      sect(cfg.heading || 'IRA Rebates',
        'Incentive Description: ' + (m.tier ? m.tier.desc : '') + '. Notes: ' + (m.tier ? m.tier.note : '') + '.',
        'IRA HOMES ' + (isInv ? 'Incentive ' : '') + '- Instant Discount', m.homesAmt)
    }
  },

  /* Total Cost / Total Rebates / Total Deposits / Total Due (or Total Final). */
  sealed_totals_list(x, cfg = {}) {
    const { m, W, M, C, st, font, t, tc, stroke, d, need, bh, isInv } = x
    need(90); st.y += 12; bh(cfg.heading || 'Totals', M, st.y); st.y += 5
    stroke([188, 214, 242]); d.setLineWidth(1); d.line(M, st.y, W - M, st.y); st.y += 4
    const trows = [['Total Cost', _money(m.total), false], ['Total Rebates', _money(m.total), false],
      ['Total Deposits', '$0.00', false], [isInv ? 'Total Due' : 'Total Final', '$0.00', true]]
    for (const [lbl, val, strong] of trows) {
      tc(C.ink); font(9, strong ? 'bold' : 'normal')
      t(M, st.y + 12, lbl); t(W - M, st.y + 12, val, { align: 'right' })
      stroke(C.line); d.setLineWidth(.5); d.line(M, st.y + 17, W - M, st.y + 17); st.y += 18 }
  },

  /* Customer signature + date rules. */
  sealed_signature_block(x, cfg = {}) {
    const { W, M, C, st, font, t, tc, stroke, d, need } = x
    need(64); st.y += 40; stroke([68, 68, 68]); d.setLineWidth(1)
    d.line(M, st.y, M + 300, st.y); d.line(W - M - 160, st.y, W - M, st.y)
    tc(C.mut); font(8.5); t(M, st.y + 11, cfg.signer_label || 'Customer Signature'); t(W - M - 160, st.y + 11, 'Date')
  },
}

/**
 * Render a Sealed-style document. `sections` overrides the built-in list —
 * that is how a stored template drives the output. Returns a Blob.
 */
export async function buildSealedPdf(m, kind, sections) {
  const x = await buildSealedContext(m, kind)
  const defaultKey = /invoice/.test(kind) ? 'sealedInvoice' : 'sealedProposal'
  const list = sections && sections.length ? sections : DEFAULT_DOCUMENT_SECTIONS[defaultKey]
  if (!list) throw new Error(`Unknown Sealed document kind: ${kind}`)
  for (const s of list) {
    const render = SEALED_SECTION_RENDERERS[s.type]
    if (!render) throw new Error(`Unknown Sealed document section type: ${s.type}`)
    render(x, s.config || {})
  }
  return x.d.output('blob')
}

// ===========================================================================
// Combustion Safety Notification engine — 'combustion_safety_notification'.
//
// A purpose-built engine for the Focus on Energy IRA Multifamily "Notification
// of Combustion Safety (Large Multifamily 5+ Units)" form. Unlike the EES /
// Sealed documents (which are COMPUTED from records), this is a CAPTURE form:
// the model carries inspection results a person filled in, per building and per
// sampled unit. It shares none of the EES/Sealed sections — its own checkbox
// grid, per-unit repeating blocks, and its own context helpers.
//
// Model shape (assembled in paperworkService.loadCombustionContext):
//   { building:{name}, property:{name,street,cityStateZip},
//     owner:{name,address,cityStateZip},
//     ventilation:{status,cfm,notes},
//     common:{gas_leak_result,gas_leak_location,gas_detector_installed,
//             ambient_co_result,co_detector_installed,co_detector_location,
//             heating_plant_co_status,heating_plant_spillage,
//             water_heater_co_status,water_heater_spillage,notes},
//     samples:[{unit_number, ...gas/ambient..., furnace_co_status,
//               furnace_spillage, water_heater_co_status, water_heater_spillage,
//               stove_co_status, notes}],
//     totalUnits, sampleCount }
// ===========================================================================

// Sampling rate per the form's table (Total units in building → units to sample).
export function combustionSampleCount(totalUnits) {
  const n = Number(totalUnits) || 0
  if (n >= 100) return 20
  if (n >= 50) return 15
  if (n >= 30) return 10
  if (n >= 10) return 7
  if (n >= 5) return 4
  return n
}

const CO_STATUS_OPTS   = ['Not Tested / Not Applicable', 'Acceptable', 'Unacceptable']
const SPILLAGE_OPTS    = ['Not Tested / Not Applicable', 'None Found', 'Found']
const GAS_LEAK_OPTS    = ['Not Tested / Not Applicable', 'Found', 'None Found']
const AMBIENT_CO_OPTS  = ['Not Tested / Not Applicable', '0-8 ppm', '9-35 ppm', '36-69 ppm', '70+ ppm']

/** Shared drawing context for the combustion notification. */
async function buildCombustionContext(m, kind, opts = {}) {
  const P = await pdfCanvas(40)
  const { d, W, H, M, CW, C, st, font, t, wrap, need, fill, stroke, tc } = P
  const INK = C.ink, MUT = C.mut, NAVY = C.navy
  const boxL = [90, 104, 122]

  // A checkbox: 8pt square; an X when checked.
  const checkbox = (px, py, on) => {
    stroke(boxL); d.setLineWidth(.8); d.rect(px, py - 7, 8, 8)
    if (on) { d.setLineWidth(1.1); tc(NAVY); stroke(NAVY)
      d.line(px + 1, py - 6, px + 7, py); d.line(px + 7, py - 6, px + 1, py); stroke(boxL) }
  }
  // Section band: navy uppercase heading on a light rule.
  const band = (txt, gap = 12) => { need(26); st.y += gap
    tc(NAVY); font(9.5, 'bold'); t(M, st.y + 9, String(txt).toUpperCase())
    st.y += 13; stroke([150, 160, 174]); d.setLineWidth(.75); d.line(M, st.y, W - M, st.y); st.y += 6 }
  const subHead = (txt) => { need(16); tc([60, 76, 94]); font(8.5, 'bold'); t(M, st.y + 9, txt); st.y += 12 }
  const para = (txt, sz = 8.5) => { tc(INK); font(sz)
    const ls = wrap(txt, CW); need(ls.length * (sz + 2.5) + 4)
    ls.forEach((ln, k) => t(M, st.y + 8 + k * (sz + 2.5), ln)); st.y += ls.length * (sz + 2.5) + 2 }

  // A labelled row of checkbox options that flows across the width and wraps.
  // `selected` is the chosen value; every option is shown, the chosen one is X'd.
  const choices = (label, options, selected, indent = 12) => {
    tc([60, 76, 94]); font(8, 'bold'); need(13)
    const labW = label ? d.getTextWidth(label) + 8 : 0
    if (label) { t(M, st.y + 8, label) }
    font(8.5); tc(INK)
    let px = M + (label ? labW : indent), rowY = st.y + 8
    const rightEdge = W - M
    for (const opt of options) {
      const on = selected != null && String(selected).trim().toLowerCase() === String(opt).trim().toLowerCase()
      const w = 8 + 4 + d.getTextWidth(opt) + 14
      if (px + w > rightEdge) { st.y += 12; rowY = st.y + 8; px = M + indent }
      checkbox(px, rowY, on); tc(INK); t(px + 12, rowY, opt)
      px += w
    }
    st.y += 12
  }
  // A single check + label (for booleans like "Gas detector(s) installed").
  const flag = (label, on, indent = 12) => { need(13); const py = st.y + 8
    checkbox(M + indent, py, !!on); tc(INK); font(8.5); t(M + indent + 12, py, label); st.y += 12 }
  // Inline "field: value" line (blank underline when empty).
  const fieldLine = (label, value) => { need(13); tc([60, 76, 94]); font(8, 'bold')
    t(M + 12, st.y + 8, label); const lx = M + 12 + d.getTextWidth(label) + 6
    tc(INK); font(8.5)
    if (value != null && String(value).trim() !== '') t(lx, st.y + 8, String(value))
    else { stroke(boxL); d.setLineWidth(.5); d.line(lx, st.y + 9, W - M, st.y + 9) }
    st.y += 12 }

  // One appliance's CO + spillage rows (spillage optional — e.g. Stove is CO only).
  const appliance = (name, coStatus, spillage) => {
    subHead(name)
    choices('CO Levels:', CO_STATUS_OPTS, coStatus)
    if (spillage !== false) choices('Spillage:', SPILLAGE_OPTS, spillage)
  }
  // The gas-leak + ambient-CO + detector block shared by common area and units.
  const gasAndAmbient = (r) => {
    subHead('Gas Leak')
    choices('', GAS_LEAK_OPTS, r.gas_leak_result)
    if (r.gas_leak_location) fieldLine('Location(s): ', r.gas_leak_location)
    flag('Gas detector(s) installed', r.gas_detector_installed)
    subHead('Ambient Carbon Monoxide Levels')
    choices('', AMBIENT_CO_OPTS, r.ambient_co_result)
    flag('Carbon monoxide detector(s) installed', r.co_detector_installed)
    if (r.co_detector_location) fieldLine('Location(s): ', r.co_detector_location)
  }
  const notes = (txt) => { subHead('Notes / Comments / Reason(s) for not testing:')
    if (txt && String(txt).trim()) para(txt, 8.5)
    else { need(14); stroke(boxL); d.setLineWidth(.5); d.line(M, st.y + 6, W - M, st.y + 6); st.y += 12 } }

  return { m, d, W, H, M, CW, C, st, font, t, wrap, need, fill, stroke, tc,
    checkbox, band, subHead, para, choices, flag, fieldLine, appliance, gasAndAmbient, notes,
    collectTabs: !!opts.collectTabs, signatureTabs: [] }
}

export const COMBUSTION_SECTION_RENDERERS = {
  /* Title + the combustion-safety educational preamble. */
  combustion_intro(x, cfg = {}) {
    const { W, M, C, st, font, t, tc, para, d, stroke } = x
    tc(C.navy); font(13, 'bold'); t(M, st.y + 12, cfg.title || 'NOTIFICATION OF COMBUSTION SAFETY')
    st.y += 16; tc([104, 116, 132]); font(10, 'bold'); t(M, st.y + 10, cfg.subtitle || 'Large Multifamily (5+ Units)')
    st.y += 14; stroke([150, 160, 174]); d.setLineWidth(.75); d.line(M, st.y, W - M, st.y); st.y += 8
    para(cfg.body || 'The building’s testing was conducted in accordance with the protocols approved by the U.S. Department of Energy Home Performance with ENERGY STAR® Program. Combustion safety inspections and tests are performed to identify potential health and safety conditions. These issues can be potential life-threatening or hazardous situations. Until these issues have been resolved, you are not eligible for IRA Home Energy Rebates.')
    para(cfg.body2 || 'Carbon monoxide is a toxic, colorless, odorless gas produced when insufficient combustion air is supplied, the burner is improperly tuned, and/or the appliance is malfunctioning. Maintain equipment per the manufacturer’s instructions, change filters regularly, schedule annual tune-ups for space- and water-heating equipment, keep intake and exhaust ports clear, and test CO alarms monthly (replace units every three to five years).')
    x.subHead('A separate Combustion Safety Notification form is completed for each building being tested.')
  },

  /* COMMON AREAS / SHARED EQUIPMENT block. */
  combustion_common_area(x) {
    const { m, band, gasAndAmbient, appliance, notes } = x
    const c = m.common || {}
    band('Common Areas / Shared Equipment')
    gasAndAmbient(c)
    x.subHead('Equipment Carbon Monoxide Levels')
    appliance('Heating Plant (Furnace, Boiler, Etc.)', c.heating_plant_co_status, c.heating_plant_spillage)
    appliance('Water Heater(s)', c.water_heater_co_status, c.water_heater_spillage)
    notes(c.notes)
  },

  /* IN-UNIT EQUIPMENT — sampling table + one block per sampled unit. */
  combustion_unit_samples(x) {
    const { m, W, M, st, font, t, tc, d, stroke, fill, band, subHead, gasAndAmbient, appliance, notes, need, fieldLine } = x
    band('In-Unit Equipment')
    subHead('IRA Multifamily Combustion Safety Sampling Rate')
    // sampling reference table
    const rows = [['Total Units in Building', 'Units to Sample'], ['5-9', '4'], ['10-29', '7'],
      ['30-49', '10'], ['50-99', '15'], ['100+', '20']]
    const tw = 300, cx = M + 150, rh = 14
    need(rows.length * rh + 6)
    rows.forEach((r, i) => {
      if (i === 0) { fill([240, 243, 247]); d.rect(M, st.y, tw, rh, 'F') }
      stroke([203, 210, 219]); d.setLineWidth(.5); d.rect(M, st.y, tw, rh); d.line(cx, st.y, cx, st.y + rh)
      tc([34, 43, 53]); font(8, i === 0 ? 'bold' : 'normal')
      t(M + 6, st.y + 10, r[0]); t(cx + 6, st.y + 10, r[1]); st.y += rh
    })
    st.y += 6
    fieldLine('Total number of units in the building: ', m.totalUnits != null ? String(m.totalUnits) : '')
    fieldLine('Number of units to sample: ', m.sampleCount != null ? String(m.sampleCount) : '')
    const samples = m.samples || []
    samples.forEach((u, i) => {
      // keep each unit block's header with its first rows
      need(40); st.y += 8
      tc(x.C.navy); font(9, 'bold')
      t(M, st.y + 9, `Sample #${i + 1}` + (u.unit_number ? `  —  Unit ${u.unit_number}` : '  —  Unit #: ____________'))
      st.y += 13; stroke([203, 210, 219]); d.setLineWidth(.5); d.line(M, st.y, W - M, st.y); st.y += 4
      gasAndAmbient(u)
      subHead('Equipment Carbon Monoxide Levels')
      appliance('Furnace / Boiler(s)', u.furnace_co_status, u.furnace_spillage)
      appliance('Water Heater(s)', u.water_heater_co_status, u.water_heater_spillage)
      appliance('Stove(s)', u.stove_co_status, false)
      notes(u.notes)
    })
    if (!samples.length) { subHead('No sampled units recorded.') }
  },

  /* Mechanical ventilation. */
  combustion_ventilation(x) {
    const { m, band, para, choices, fieldLine, notes } = x
    const v = m.ventilation || {}
    band('Mechanical Ventilation')
    para('Size and type of mechanical ventilation required is based on occupancy, number of units, air change rate of the building, and existence of combustion equipment. By confirming below you indicate that the building and individual units have adequate ventilation according to the appropriate code.')
    choices('Ventilation:', ['Not Tested', 'Tested'], v.status)
    fieldLine('Existing total CFM: ', v.cfm != null && String(v.cfm) !== '' ? String(v.cfm) : '')
    notes(v.notes)
  },

  /* Property / owner information. */
  combustion_property_owner(x) {
    const { m, band, fieldLine } = x
    const o = m.owner || {}, p = m.property || {}
    band('Property Information')
    fieldLine('Owner/Management Company Name: ', o.name)
    fieldLine('Owner/Management Company Address: ', o.address)
    fieldLine('City / State / ZIP: ', o.cityStateZip)
    fieldLine('Property / Building: ', [p.name, m.building && m.building.name].filter(Boolean).join(' — '))
  },

  /* Acknowledgment paragraph + customer signature & date rules (+ sig tabs). */
  combustion_signature(x, cfg = {}) {
    const { W, H, M, CW, C, st, font, t, tc, wrap, need, stroke, d, para } = x
    x.band('Signature')
    para(cfg.acknowledgment || 'By signing below, you acknowledge that you have been informed of the combustion safety and ventilation recommendation(s), and you agree to correct any issue prior to submitting for a rebate. This notice does not constitute an endorsement or warranty regarding the presence or absence of other real or potential health and safety hazards that may exist at this address or on the premises.')
    need(50); st.y += 26; stroke([68, 88, 110]); d.setLineWidth(1)
    d.line(M, st.y, M + 300, st.y); d.line(W - M - 150, st.y, W - M, st.y)
    tc(C.mut); font(8.5); t(M, st.y + 10, cfg.signer_label || 'Customer Signature'); t(W - M - 150, st.y + 10, 'Date')
    if (x.collectTabs) {
      const page = d.getNumberOfPages(), boxH = 26
      x.signatureTabs.push(
        { recipient_order: 1, tab_type: 'sig',  page, x: M,           y: H - st.y, width: 300, height: boxH },
        { recipient_order: 1, tab_type: 'date', page, x: W - M - 150,  y: H - st.y, width: 150, height: boxH },
      )
    }
  },

  /* Focus on Energy program footer. */
  combustion_footer(x) {
    const { W, H, M, C, st, font, t, tc, stroke, d } = x
    const fy = H - 52
    if (st.y > fy - 10) d.addPage()
    stroke(C.line); d.setLineWidth(.5); d.line(M, fy, W - M, fy)
    tc(C.mut); font(7.5)
    const l1 = 'Focus on Energy, Wisconsin utilities’ statewide program for energy efficiency and renewable energy, helps eligible'
    const l2 = 'residents and businesses save energy and money. Funding for the Wisconsin IRA Home Energy Rebate programs is'
    const l3 = 'provided by the U.S. Department of Energy pursuant to the Inflation Reduction Act of 2022.   ©2025 Wisconsin Focus on Energy'
    t(W / 2, fy + 11, l1, { align: 'center' }); t(W / 2, fy + 20, l2, { align: 'center' })
    font(7, 'italic'); t(W / 2, fy + 30, l3, { align: 'center' })
  },
}

/**
 * Render the Combustion Safety Notification. `sections` overrides the built-in
 * list. Returns a Blob, or { blob, tabs } when opts.collectTabs is set.
 */
export async function buildCombustionPdf(m, kind, sections, opts = {}) {
  const x = await buildCombustionContext(m, kind, opts)
  const list = sections && sections.length ? sections : DEFAULT_DOCUMENT_SECTIONS.combustionSafety
  if (!list) throw new Error(`Unknown combustion document kind: ${kind}`)
  for (const s of list) {
    const render = COMBUSTION_SECTION_RENDERERS[s.type]
    if (!render) throw new Error(`Unknown combustion section type: ${s.type}`)
    render(x, s.config || {})
  }
  if (opts.collectTabs) return { blob: x.d.output('blob'), tabs: x.signatureTabs }
  return x.d.output('blob')
}

// ===========================================================================
// ENERGY ASSESSMENT REPORT — its own engine.
//
// This is NOT a submittal to a program administering body at an incentive
// application stage (that is paperworkSubmittals.js: Project Reservation and
// Final Project Payment Request). An energy assessment report is the
// DELIVERABLE OF THE AUDIT ITSELF — the write-up of what the auditor found on
// the building, produced from the assessment work order that captured it.
// It has its own kind ('energy_assessment_report'), its own document keys
// (one per assessment work order record type), its own section types, and its
// own templates. Nothing here is shared with the invoice/proposal engines.
//
// The model is assembled by assessmentReportService.loadAssessmentReportModel:
//
//   m = {
//     title, subtitle,
//     program:   { label, name },
//     property:  { name, addressLines[], cityStateZip },
//     building:  { name, label },
//     workOrder: { number, name, status },
//     preparedFor: { name, lines[] },
//     auditor:   { name, role },
//     assessedOn, generatedOn,
//     summaryRows: [[label, value], …],       // building facts from the record
//     steps: [{ key, name, notApplicable, notApplicableReason,
//               fields: [{ label, value, unit }], photoCount }],
//     photos: [{ group, label, caption, takenAt, gps, dataUrl, w, h }],
//     textBlocks,
//   }
//
// Photos arrive as ALREADY-ENCODED JPEG data URLs. Decoding, HEIC rendition
// resolution and downscaling all happen in the service (they need the DOM and
// the network); this module stays pure and node-testable like the rest of the
// file.
// ===========================================================================

/** Shared drawing context for the energy assessment report. */
async function buildAssessmentContext(m, kind, opts = {}) {
  const P = await pdfCanvas(48)
  const { d, W, H, M, CW, C, st, font, t, wrap, need, fill, stroke, tc } = P
  const INK = C.ink, MUT = C.mut, NAVY = C.navy
  const RULE = [208, 216, 232]
  const EMERALD = [42, 171, 114]
  const text = (key) => resolveTextBlock(m.textBlocks, key)
  const pv = v => (v != null && String(v).trim() !== '') ? String(v) : '—'

  // Name the document inside the PDF as well as on disk, so a viewer tab and
  // any downstream system show the building rather than a blob id.
  try {
    d.setProperties({
      title: [m.building?.label || m.building?.name, m.title].filter(Boolean).join(' — '),
      subject: m.workOrder?.number ? `Work Order ${m.workOrder.number}` : '',
      author: m.company?.name || 'Energy Efficiency Services',
    })
  } catch { /* metadata is a nicety; never fail a report over it */ }

  // Numbered section band: emerald tick, navy uppercase heading, hairline.
  const band = (txt, gap = 16) => {
    need(34); st.y += gap
    fill(EMERALD); d.rect(M, st.y + 1, 3, 12, 'F')
    tc(NAVY); font(10.5, 'bold'); t(M + 10, st.y + 11, String(txt).toUpperCase())
    st.y += 16; stroke(RULE); d.setLineWidth(.75); d.line(M, st.y, W - M, st.y); st.y += 8
  }
  const subHead = (txt) => { need(16); tc([60, 76, 94]); font(9, 'bold'); t(M, st.y + 9, txt); st.y += 13 }
  const para = (txt, sz = 9) => {
    if (txt == null || String(txt).trim() === '') return
    tc(INK); font(sz)
    for (const block of String(txt).split('\n')) {
      if (!block.trim()) { st.y += sz * 0.6; continue }
      const ls = wrap(block, CW)
      for (const ln of ls) { need(sz + 4); t(M, st.y + sz, ln); st.y += sz + 3.5 }
    }
    st.y += 4
  }
  const bullets = (items, sz = 9) => {
    tc(INK); font(sz)
    for (const item of (items || [])) {
      const ls = wrap(String(item), CW - 14)
      ls.forEach((ln, i) => {
        need(sz + 4)
        if (i === 0) { fill([122, 135, 152]); d.circle(M + 3, st.y + sz - 3, 1.6, 'F') }
        tc(INK); font(sz); t(M + 14, st.y + sz, ln); st.y += sz + 3.5
      })
      st.y += 2
    }
    st.y += 3
  }

  // Two-column label/value table. Rows that carry no value still print with an
  // em dash: a blank line in an audit report means "asked and not answered",
  // which the reviewer must be able to see.
  const kvTable = (rows, opts2 = {}) => {
    const list = (rows || []).filter(Boolean)
    if (!list.length) { subHead(opts2.emptyLabel || 'Not captured on this assessment.'); return }
    const labW = opts2.labelWidth || Math.round(CW * 0.44)
    const valX = M + labW + 10
    const valW = W - M - valX
    let zebra = 0
    for (const [label, value] of list) {
      tc(INK); font(8.5)
      const vls = wrap(pv(value), valW)
      const lls = wrap(String(label ?? ''), labW)
      const h = Math.max(lls.length, vls.length) * 11 + 6
      need(h)
      if (zebra % 2 === 1) { fill([247, 249, 252]); d.rect(M, st.y, CW, h, 'F') }
      tc([70, 82, 98]); font(8.5, 'bold')
      lls.forEach((ln, i) => t(M + 4, st.y + 11 + i * 11, ln))
      tc(INK); font(8.5)
      vls.forEach((ln, i) => t(valX, st.y + 11 + i * 11, ln))
      st.y += h; zebra++
    }
    stroke(RULE); d.setLineWidth(.5); d.line(M, st.y, W - M, st.y); st.y += 2
  }

  // One photo cell: bordered box, image centred inside it, caption beneath.
  const PH_GAP = 16
  const photoCell = (photo, col, cellW, boxH) => {
    const x = M + col * (cellW + PH_GAP)
    const linked = !!photo.linkUrl
    stroke(RULE); d.setLineWidth(.6); d.rect(x, st.y, cellW, boxH)
    if (photo.dataUrl && photo.w && photo.h) {
      const scale = Math.min(cellW / photo.w, boxH / photo.h)
      const dw = Math.max(1, photo.w * scale), dh = Math.max(1, photo.h * scale)
      try {
        d.addImage(photo.dataUrl, 'JPEG', x + (cellW - dw) / 2, st.y + (boxH - dh) / 2, dw, dh)
      } catch { /* leave the empty box — a missing image never sinks the report */ }
    } else {
      tc(MUT); font(8); t(x + cellW / 2, st.y + boxH / 2, 'Image unavailable', { align: 'center' })
    }
    // The whole cell links to the ORIGINAL capture, so a reader of the PDF can
    // open or save the full-resolution photo with its EXIF intact. It is a
    // read-only object link — it exposes the photo, never the record.
    tc(linked ? [42, 110, 178] : NAVY); font(8, 'bold')
    const label = wrap(photo.label || 'Photo', cellW).slice(0, 1)
    t(x, st.y + boxH + 10, label[0] || '')
    if (linked) {
      const labelW = Math.min(cellW, d.getTextWidth(label[0] || ''))
      stroke([42, 110, 178]); d.setLineWidth(.5)
      d.line(x, st.y + boxH + 12, x + labelW, st.y + boxH + 12)
      d.link(x, st.y, cellW, boxH + 14, { url: photo.linkUrl })
    }
    tc(MUT); font(7.5)
    const cap = wrap(photo.caption || '', cellW).slice(0, 2)
    cap.forEach((ln, i) => t(x, st.y + boxH + 20 + i * 9, ln))
  }

  const x = {
    m, kind, d, W, H, M, CW, C, st, font, t, wrap, need, fill, stroke, tc,
    INK, MUT, NAVY, RULE, EMERALD, text, pv,
    band, subHead, para, bullets, kvTable, photoCell, PH_GAP,
    // Every photo drawn so far, so a trailing Photo Documentation section can
    // print only what the system sections did not already show.
    printedPhotoIds: new Set(),
    collectTabs: !!opts.collectTabs, signatureTabs: [],
  }

  /**
   * Draw a grid of photos, optionally banded by the step that captured them.
   * Shared by the system sections (photos printed beside the data they
   * document) and the standalone Photo Documentation section.
   */
  x.photoGrid = (photos, cfg = {}) => {
    const list = (photos || []).filter(Boolean)
    if (!list.length) return 0
    const cols = Math.max(1, Math.min(3, Number(cfg.columns) || 2))
    const cellW = (CW - PH_GAP * (cols - 1)) / cols
    const boxH = Math.round(cellW * (Number(cfg.aspect) || 0.72))
    const rowH = boxH + 34

    const groups = []
    for (const p of list) {
      const key = cfg.group_by_step ? (p.group || '') : ''
      let g = groups.find(gg => gg.key === key)
      if (!g) { g = { key, photos: [] }; groups.push(g) }
      g.photos.push(p)
    }
    for (const g of groups) {
      if (g.key) {
        need(26 + rowH)
        fill([240, 243, 248]); d.rect(M, st.y, CW, 20, 'F')
        fill(EMERALD); d.rect(M, st.y, 3, 20, 'F')
        tc(NAVY); font(9, 'bold'); t(M + 10, st.y + 14, g.key)
        tc(MUT); font(7.5)
        t(W - M - 4, st.y + 14, g.photos.length === 1 ? '1 photo' : `${g.photos.length} photos`, { align: 'right' })
        st.y += 26
      }
      for (let i = 0; i < g.photos.length; i += cols) {
        need(rowH)
        g.photos.slice(i, i + cols).forEach((p, c) => photoCell(p, c, cellW, boxH))
        st.y += rowH
      }
      st.y += 4
    }
    for (const p of list) if (p.id != null) x.printedPhotoIds.add(p.id)
    return list.length
  }

  return x
}

/** The report photos captured on one named work step. */
function assessmentStepPhotos(m, stepName) {
  if (!stepName) return []
  const want = String(stepName).trim().toLowerCase()
  return (m.photos || []).filter(p => String(p.group || '').trim().toLowerCase() === want)
}

/** Find one captured work step in the model by its template name. */
function assessmentStep(m, name) {
  if (!name) return null
  const want = String(name).trim().toLowerCase()
  return (m.steps || []).find(s =>
    String(s.name || '').trim().toLowerCase() === want ||
    String(s.key || '').trim().toLowerCase() === want) || null
}

export const ASSESSMENT_SECTION_RENDERERS = {
  /* Cover block: report title, program, the building it is about, and who
     prepared it for whom. Always the first page. */
  assessment_cover(x, cfg = {}) {
    const { m, W, M, CW, C, st, font, t, tc, wrap, d, fill, stroke, RULE, NAVY, MUT, INK, EMERALD, text, pv } = x
    fill([13, 26, 46]); d.rect(0, 0, W, 4, 'F')
    tc(MUT); font(8.5, 'bold')
    // The company is named for the state the BUILDING is in; a template may
    // still override it outright.
    t(M, st.y + 10, String(cfg.eyebrow || m.company?.name || text('assessment.header.company_name') || 'Energy Efficiency Services').toUpperCase())
    st.y += 26
    tc(NAVY); font(19, 'bold')
    for (const ln of wrap(cfg.title || m.title || 'Building Energy Assessment Report', CW)) {
      t(M, st.y + 18, ln); st.y += 23
    }
    if (cfg.subtitle || m.subtitle) {
      tc([74, 94, 122]); font(11)
      for (const ln of wrap(cfg.subtitle || m.subtitle, CW)) { t(M, st.y + 11, ln); st.y += 15 }
    }
    st.y += 6
    fill(EMERALD); d.rect(M, st.y, 54, 3, 'F'); st.y += 16

    // Two facing columns: the subject building, and the report's provenance.
    const colW = (CW - 24) / 2
    const leftX = M, rightX = M + colW + 24
    const yStart = st.y
    const stack = (px, heading, lines) => {
      let yy = yStart
      tc(MUT); font(7.5, 'bold'); t(px, yy + 8, heading.toUpperCase()); yy += 14
      tc(INK); font(9)
      for (const ln of (lines || []).filter(Boolean)) {
        for (const w of wrap(String(ln), colW)) { t(px, yy + 9, w); yy += 12 }
      }
      return yy
    }
    const p = m.property || {}, b = m.building || {}
    const yL = stack(leftX, cfg.subject_heading || 'Building Assessed', [
      b.label || b.name, p.name, ...(p.addressLines || []), p.cityStateZip,
    ])
    const yR = stack(rightX, cfg.provenance_heading || 'Report Details', [
      m.program?.label ? `Program: ${m.program.label}` : null,
      m.workOrder?.number ? `Work Order: ${m.workOrder.number}` : null,
      m.assessedOn ? `Assessment Date: ${m.assessedOn}` : null,
      m.auditor?.name ? `Assessed By: ${m.auditor.name}` : null,
      m.generatedOn ? `Report Generated: ${m.generatedOn}` : null,
    ])
    st.y = Math.max(yL, yR) + 8
    if ((m.preparedFor?.lines || []).length || m.preparedFor?.name) {
      tc(MUT); font(7.5, 'bold'); t(M, st.y + 8, (cfg.prepared_for_heading || 'Prepared For').toUpperCase()); st.y += 14
      tc(INK); font(9)
      for (const ln of [m.preparedFor.name, ...(m.preparedFor.lines || [])].filter(Boolean)) {
        for (const w of wrap(String(ln), CW)) { t(M, st.y + 9, w); st.y += 12 }
      }
    }
    st.y += 6; stroke(RULE); d.setLineWidth(.75); d.line(M, st.y, W - M, st.y); st.y += 2
  },

  /* Scope & methodology narrative. Wording is template config, so it is
     edited in LEAP without a deploy. */
  assessment_narrative(x, cfg = {}) {
    const { band, para, bullets } = x
    band(cfg.heading || 'Scope & Methodology')
    para(cfg.body)
    if ((cfg.items || []).length) bullets(cfg.items)
  },

  /* Building facts pulled off the property/building records (not the field
     capture) — the reviewer's orientation table. */
  assessment_building_summary(x, cfg = {}) {
    const { m, band, kvTable } = x
    if (!(m.summaryRows || []).length && cfg.omit_when_empty !== false) return
    band(cfg.heading || 'Building Summary')
    kvTable(m.summaryRows, { emptyLabel: 'No building record data available.' })
  },

  /* ONE captured work-step section, rendered as a label/value table.
     config.step names the work step template ('Roof / Ceiling'). This is the
     section type that makes every capture section printable: the template
     carries one of these per section, so they reorder, rename and drop
     without code. */
  assessment_field_data(x, cfg = {}) {
    const { m, band, kvTable, subHead, para } = x
    const step = assessmentStep(m, cfg.step)
    const withPhotos = cfg.photos === 'step'
    const stepPhotos = (withPhotos && step) ? assessmentStepPhotos(m, step.name) : []
    const answered = step ? (step.fields || []).filter(f => f.value != null && String(f.value).trim() !== '') : []

    // A section with no photographs is not in the report (Nicholas,
    // 2026-08-24: "get rid of the fucking sections if there are no pictures").
    // The photographs are the evidence this report exists to carry; a heading
    // with none behind it is a heading over nothing.
    //
    // require_photos: false on a section keeps it whenever it has captured
    // data, for a program that wants the written record with or without
    // photographs.
    const requirePhotos = cfg.require_photos !== false
    if (!step) return
    if (requirePhotos && !stepPhotos.length) return
    if (!requirePhotos && !answered.length && !stepPhotos.length && !step.notApplicable) return

    band(cfg.heading || cfg.step || 'Field Data')
    if (cfg.body) para(cfg.body)
    // Not Applicable is a NOTE, never a gate: the section still prints whatever
    // was captured. Status must never suppress evidence (Nicholas, 2026-08-24:
    // "if you're looking at the status of the work order or work steps, that
    // shouldn't be a trigger") — a photo that was taken is a fact regardless of
    // what state anybody left the step in.
    if (step.notApplicable) {
      subHead('Marked Not Applicable' + (step.notApplicableReason ? ` — ${step.notApplicableReason}` : ''))
    }

    // Only ANSWERED fields are printed. A row of em dashes is not information,
    // it is filler (Nicholas, 2026-08-24: "you're just putting blanks in
    // sections, so it makes it look like crap. If there's not a photo, get rid
    // of the line item"). A section with no answered field simply carries its
    // photographs.
    const rows = answered.map(f => [
      f.label, String(f.value) + (f.unit ? ` ${f.unit}` : ''),
    ])
    if (rows.length) kvTable(rows)

    // Photos captured on THIS step, printed with the data they document, so
    // the report reads beside the Audit Template section of the same name.
    // config.photos: 'step' to include, 'none' to leave them to the standalone
    // Photo Documentation section.
    if (stepPhotos.length) {
      if (rows.length) x.subHead(cfg.photo_heading || 'Photo Documentation')
      x.photoGrid(stepPhotos, { columns: cfg.photo_columns || 2, aspect: cfg.photo_aspect, group_by_step: false })
    }
  },

  /* Photo documentation — the photos an internal reviewer flagged with
     "Include in final report" on the work order's Photos card. Grouped by the
     work step that captured them, two to a row. */
  assessment_photo_documentation(x, cfg = {}) {
    const { m, band, subHead, para, photoGrid, printedPhotoIds } = x
    let photos = m.photos || []
    // Only the named steps, when the template scopes this block to some.
    if (Array.isArray(cfg.steps) && cfg.steps.length) {
      const want = new Set(cfg.steps.map(v => String(v).trim().toLowerCase()))
      photos = photos.filter(p => want.has(String(p.group || '').trim().toLowerCase()))
    }
    // Skip anything a system section already printed, so a template that puts
    // photos beside their data can still carry a catch-all block at the end.
    if (cfg.exclude_printed) photos = photos.filter(p => !printedPhotoIds.has(p.id))
    if (!photos.length) {
      if (cfg.omit_when_empty === false) {
        band(cfg.heading || 'Photo Documentation')
        subHead(cfg.empty_label || 'No photos have been marked “Include in final report” on this work order.')
      }
      return
    }
    band(cfg.heading || 'Photo Documentation')
    if (cfg.body) para(cfg.body)
    photoGrid(photos, {
      columns: cfg.columns, aspect: cfg.aspect,
      group_by_step: cfg.group_by_step !== false,
    })
  },

  /* Documents attached to the assessment — the ones the user chose to include.
     Anything that can be shown IS shown (an image, a PDF's first page);
     anything that cannot still gets a row and a link, so the reader can fetch
     it later rather than being told it exists somewhere out of reach. */
  assessment_documents(x, cfg = {}) {
    const { m, W, M, CW, st, d, font, t, tc, wrap, need, stroke, fill, band, para, subHead, RULE, NAVY, MUT, INK } = x
    const docs = (m.documents || []).filter(Boolean)
    if (!docs.length && cfg.omit_when_empty !== false) return
    band(cfg.heading || 'Documents')
    if (cfg.body) para(cfg.body)
    if (!docs.length) {
      subHead(cfg.empty_label || 'No documents were included.')
      return
    }

    const LINK = [42, 110, 178]
    const thumbW = Math.max(60, Math.min(160, Number(cfg.preview_width) || 108))
    for (const doc of docs) {
      const hasPreview = !!(doc.previewDataUrl && doc.previewW && doc.previewH)
      const thumbH = hasPreview
        ? Math.min(Number(cfg.preview_max_height) || 140,
                   Math.round(thumbW * (doc.previewH / doc.previewW)))
        : 0
      const textX = hasPreview ? M + thumbW + 12 : M
      const textW = W - M - textX
      const nameLines = wrap(String(doc.name || 'Document'), textW)
      const metaBits = [doc.typeLabel, doc.size, doc.date].filter(v => v != null && String(v).trim() !== '')
      const textH = nameLines.length * 12 + (metaBits.length ? 12 : 0) + (doc.linkUrl ? 11 : 0)
      const rowH = Math.max(thumbH, textH) + 12
      need(rowH)

      const top = st.y
      if (hasPreview) {
        stroke(RULE); d.setLineWidth(.6); d.rect(M, top, thumbW, thumbH)
        try { d.addImage(doc.previewDataUrl, 'JPEG', M, top, thumbW, thumbH) }
        catch { /* an unreadable preview leaves the box — never sinks the report */ }
      }

      let ty = top
      tc(doc.linkUrl ? LINK : NAVY); font(9, 'bold')
      nameLines.forEach(ln => { ty += 11; t(textX, ty, ln) })
      if (doc.linkUrl) {
        const lw = Math.min(textW, d.getTextWidth(nameLines[nameLines.length - 1] || ''))
        stroke(LINK); d.setLineWidth(.5); d.line(textX, ty + 2, textX + lw, ty + 2)
        d.link(textX, top, textW, Math.max(textH, 14), { url: doc.linkUrl })
      }
      if (metaBits.length) {
        tc(MUT); font(7.5); ty += 11; t(textX, ty, metaBits.join('  ·  '))
      }
      if (doc.linkUrl) {
        tc(MUT); font(7.5); ty += 10
        t(textX, ty, cfg.link_hint || 'Click the name to open or download this file.')
      }

      st.y = top + rowH
      stroke(RULE); d.setLineWidth(.4); d.line(M, st.y - 4, W - M, st.y - 4)
    }
  },

  /* Findings / recommended energy efficiency measures. Deliberately narrative
     + list, authored in the template or per report: the savings analysis is
     modelled downstream (Snugg Pro / Asset Score), not computed here. */
  assessment_recommendations(x, cfg = {}) {
    const { m, band, para, bullets, subHead } = x
    const items = (m.recommendations && m.recommendations.length) ? m.recommendations : (cfg.items || [])
    if (!items.length && cfg.omit_when_empty !== false) return
    band(cfg.heading || 'Findings & Recommended Measures')
    para(cfg.body)
    if (items.length) bullets(items)
    else subHead(cfg.empty_label || 'No measures recorded.')
  },

  /* Deliverables this report accompanies. */
  assessment_deliverables(x, cfg = {}) {
    const { band, bullets, para } = x
    band(cfg.heading || 'Deliverables')
    if (cfg.body) para(cfg.body)
    bullets(cfg.items || [])
  },

  /* Acknowledgment + signature rules, with optional e-signature tab capture
     (same contract as the other engines). */
  assessment_signature(x, cfg = {}) {
    const { W, H, M, C, st, font, t, tc, need, stroke, d, band, para, MUT } = x
    band(cfg.heading || 'Acknowledgment')
    para(cfg.acknowledgment || 'This report presents the conditions observed at the building on the date of the assessment. It is a record of the assessor’s field observations and the data collected; it does not constitute a warranty or guarantee of the condition or performance of any building component or system.')
    need(52); st.y += 26; stroke([68, 88, 110]); d.setLineWidth(1)
    d.line(M, st.y, M + 300, st.y); d.line(W - M - 150, st.y, W - M, st.y)
    tc(MUT); font(8.5)
    t(M, st.y + 10, cfg.signer_label || 'Property Owner / Authorized Representative')
    t(W - M - 150, st.y + 10, 'Date')
    if (x.collectTabs) {
      const page = d.getNumberOfPages(), boxH = 26
      x.signatureTabs.push(
        { recipient_order: 1, tab_type: 'sig',  page, x: M,          y: H - st.y, width: 300, height: boxH },
        { recipient_order: 1, tab_type: 'date', page, x: W - M - 150, y: H - st.y, width: 150, height: boxH },
      )
    }
    st.y += 16
  },

  /* Page footer, stamped on every page with "Page N of M". */
  assessment_footer(x, cfg = {}) {
    const { m, W, H, M, d, font, t, tc, stroke, C } = x
    const total = d.getNumberOfPages()
    // The company that performed the assessment, named for the state the
    // building is in — and nothing else. EES's own street address and its
    // Wisconsin contact line have no business on a report about somebody
    // else's building in another state (Nicholas, 2026-08-25: "You don't need
    // our address on this stuff"). The address that matters is the building's,
    // and that is on the cover.
    const company = cfg.company_line || m.company?.name || 'Energy Efficiency Services'
    const ref = [m.workOrder?.number, m.building?.label || m.building?.name].filter(Boolean).join('  ·  ')
    for (let pg = 1; pg <= total; pg++) {
      d.setPage(pg)
      const fy = H - 40
      stroke(C.line); d.setLineWidth(.5); d.line(M, fy, W - M, fy)
      tc(C.mut); font(7.5)
      if (company) t(M, fy + 12, String(company))
      if (ref) t(W / 2, fy + 12, ref, { align: 'center' })
      t(W - M, fy + 12, `Page ${pg} of ${total}`, { align: 'right' })
    }
  },
}

/**
 * Render an energy assessment report. `sections` overrides the built-in list
 * (that is how a stored template drives the output). Returns a Blob, or
 * { blob, tabs } when opts.collectTabs is set.
 */
export async function buildAssessmentReportPdf(m, kind, sections, opts = {}) {
  const x = await buildAssessmentContext(m, kind, opts)
  const list = sections && sections.length ? sections : DEFAULT_DOCUMENT_SECTIONS.energyAssessmentReport
  if (!list) throw new Error(`Unknown assessment document kind: ${kind}`)
  for (const s of list) {
    const render = ASSESSMENT_SECTION_RENDERERS[s.type]
    if (!render) throw new Error(`Unknown assessment section type: ${s.type}`)
    render(x, s.config || {})
  }
  if (opts.collectTabs) return { blob: x.d.output('blob'), tabs: x.signatureTabs }
  return x.d.output('blob')
}

// ---------------------------------------------------------------------------
// Kind → rendering engine, and a single dispatch used by the modal, the
// template editor, and the live preview. EES kinds render through
// SECTION_RENDERERS; Sealed kinds through SEALED_SECTION_RENDERERS; the
// combustion notification through COMBUSTION_SECTION_RENDERERS. Keeping the
// map here means callers never branch on the kind themselves.
// ---------------------------------------------------------------------------
export const DOCUMENT_KIND_ENGINE = Object.freeze({
  audit: 'ees', proposal: 'ees', invoice: 'ees',
  sealed_proposal: 'sealed', sealed_invoice: 'sealed',
  combustion_safety_notification: 'combustion_safety',
  energy_assessment_report: 'energy_assessment',
})

/** Section-type catalogue per engine — the source of truth for the editor palette. */
export const SECTION_TYPES_BY_ENGINE = Object.freeze({
  ees: Object.keys(SECTION_RENDERERS),
  sealed: Object.keys(SEALED_SECTION_RENDERERS),
  combustion_safety: Object.keys(COMBUSTION_SECTION_RENDERERS),
  energy_assessment: Object.keys(ASSESSMENT_SECTION_RENDERERS),
})

/** Render any submittal document by kind, dispatching to the right engine. */
export async function buildSubmittalPdf(m, kind, sections) {
  const engine = DOCUMENT_KIND_ENGINE[kind]
  if (engine === 'sealed') return buildSealedPdf(m, kind, sections)
  if (engine === 'combustion_safety') return buildCombustionPdf(m, kind, sections)
  if (engine === 'energy_assessment') return buildAssessmentReportPdf(m, kind, sections)
  return buildEesPdf(m, kind, sections)
}

// ---------------------------------------------------------------------------
// Workbook fill — xlsx cell surgery. Rewrites cell values inside the template
// zip, preserving every style/merge/formula byte-for-byte. The template
// binary is the styling source of truth: copy it, never rebuild it.
// ---------------------------------------------------------------------------
function _xesc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
function _colOf(ref) { return ref.match(/^[A-Z]+/)[0] }
function _colNum(c) { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n }
// Set a cell to a literal (string or number), preserving its style; insert if absent.
function xlsSet(xml, ref, val) {
  const isNum = typeof val === 'number' && isFinite(val)
  const inner = isNum ? `<v>${val}</v>` : (val === '' ? '' : `<is><t xml:space="preserve">${_xesc(val)}</t></is>`)
  const tAttr = isNum ? '' : ' t="inlineStr"'
  const re = new RegExp(`<c r="${ref}"([^>/]*?)(/>|>.*?</c>)`)
  if (re.test(xml))
    return xml.replace(re, (m, attrs) => { const s = (attrs.match(/ s="\d+"/) || [''])[0]
      return `<c r="${ref}"${s}${tAttr}>${inner}</c>` })
  // cell absent: insert into its row in column order
  const rowN = ref.match(/\d+$/)[0]
  const rowRe = new RegExp(`(<row r="${rowN}"[^>]*>)([\\s\\S]*?)(</row>)`)
  return xml.replace(rowRe, (m, open, cells, close) => {
    const target = _colNum(_colOf(ref)); let out = '', done = false
    const parts = cells.match(/<c r="[A-Z]+\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) || []
    for (const p of parts) {
      const c = _colNum(p.match(/<c r="([A-Z]+)/)[1])
      if (!done && c > target) { out += `<c r="${ref}"${tAttr}>${inner}</c>`; done = true }
      out += p
    }
    if (!done) out += `<c r="${ref}"${tAttr}>${inner}</c>`
    return open + out + close })
}
// Replace a formula cell's formula and cached value (style preserved).
function xlsSetFormula(xml, ref, formula, cached) {
  const re = new RegExp(`<c r="${ref}"([^>/]*?)>.*?</c>`)
  return xml.replace(re, (m, attrs) => { const s = (attrs.match(/ s="\d+"/) || [''])[0]
    return `<c r="${ref}"${s}><f>${_xesc(formula)}</f><v>${cached}</v></c>` })
}
// Update only the cached <v> of an existing (possibly shared) formula cell.
function xlsSetCached(xml, ref, cached) {
  const re = new RegExp(`(<c r="${ref}"[^>]*>)(.*?)(</c>)`)
  return xml.replace(re, (m, open, body, close) => {
    const f = (body.match(/<f[\s\S]*?(?:\/>|<\/f>)/) || [''])[0]
    return open + f + `<v>${cached}</v>` + close })
}

/**
 * Fill the three sheets of the paperwork workbook template (Energy Audit
 * Invoice / HOMES Proposal-Contract / HOMES Project Invoice; the HEAR sheet
 * is untouched). Takes the template as an ArrayBuffer so callers own where
 * it comes from (app asset in the browser, file read in tests).
 * Returns a Blob.
 */
export async function fillPaperworkWorkbook(m, templateArrayBuffer) {
  const F = m.fields
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(templateArrayBuffer)
  const get = async p => await zip.file(p).async('string')
  let s1 = await get('xl/worksheets/sheet1.xml')
  let s2 = await get('xl/worksheets/sheet2.xml')
  let s3 = await get('xl/worksheets/sheet3.xml')
  /* --- Sheet 1: Energy Audit Invoice --- */
  s1 = xlsSet(s1, 'C4', F.invoiceNumber || 'INV-WI-')
  s1 = xlsSet(s1, 'G4', F.invoiceDate || '')
  s1 = xlsSet(s1, 'C11', F.ownerName); s1 = xlsSet(s1, 'C12', F.ownerAddress); s1 = xlsSet(s1, 'C13', F.ownerCityStateZip)
  s1 = xlsSet(s1, 'C14', F.contactName); s1 = xlsSet(s1, 'C15', F.contactEmail); s1 = xlsSet(s1, 'C16', F.contactPhone)
  s1 = xlsSet(s1, 'I11', F.propertyName); s1 = xlsSet(s1, 'I12', F.installationAddress); s1 = xlsSet(s1, 'I13', F.installationCityStateZip)
  s1 = xlsSet(s1, 'I15', F.iqNumber)
  /* --- Sheets 2 (Proposal) & 3 (Project Invoice): shared fill --- */
  const fillScope = (x, { docNo, docDate, startRef, endRef, startVal, endVal }) => {
    x = xlsSet(x, 'C4', docNo); x = xlsSet(x, 'G4', docDate)
    x = xlsSet(x, startRef, startVal); x = xlsSet(x, endRef, endVal)
    // customer block: literals (same text as the audit tab) — robust in previewers
    for (const [ref, v] of [['C11', F.ownerName], ['C12', F.ownerAddress], ['C13', F.ownerCityStateZip],
      ['C14', F.contactName], ['C15', F.contactEmail], ['C16', F.contactPhone],
      ['I11', F.propertyName], ['I12', F.installationAddress], ['I13', F.installationCityStateZip],
      ['I15', F.iqNumber]]) x = xlsSet(x, ref, v)
    // helper block: units, tier formula, cached rebate math
    x = xlsSet(x, 'P17', m.units || 0)
    x = xlsSetFormula(x, 'P18', 'P17*' + (m.tier ? m.tier.perUnit : 10000), m.homesAmt)
    x = xlsSetCached(x, 'P19', m.foeAmt); x = xlsSetCached(x, 'P20', m.total)
    // measure rows 22–29 (5 known lines; extras cleared)
    const rowRefs = [22, 23, 24, 25, 26, 27, 28, 29]
    m.rows.forEach((r, i) => { const n = rowRefs[i]
      x = xlsSet(x, 'B' + n, r.name); x = xlsSet(x, 'D' + n, r.desc)
      x = xlsSet(x, 'I' + n, r.qty != null ? r.qty : ''); x = xlsSet(x, 'K' + n, r.unit)
      x = xlsSetFormula(x, 'L' + n, 'P' + n, r.cost)
      x = xlsSet(x, 'O' + n, r.frac); x = xlsSetFormula(x, 'P' + n, '$P$20*O' + n, r.cost)
    })
    for (let i = m.rows.length; i < rowRefs.length; i++) { const n = rowRefs[i]
      for (const col of ['B', 'D', 'I', 'K']) x = xlsSet(x, col + n, '')
      x = xlsSet(x, 'O' + n, 0); x = xlsSetCached(x, 'L' + n, 0); x = xlsSetCached(x, 'P' + n, 0)
    }
    // FOE + HOMES rebate rows
    if (m.foe) { x = xlsSet(x, 'J40', m.foeAmt); x = xlsSet(x, 'D40', m.foe.desc); x = xlsSet(x, 'K40', m.foe.note) }
    else { x = xlsSet(x, 'J40', ''); x = xlsSet(x, 'D40', ''); x = xlsSet(x, 'K40', '') }
    if (m.tier) { x = xlsSet(x, 'D44', m.tier.desc); x = xlsSet(x, 'K44', m.tier.note) }
    x = xlsSetCached(x, 'J44', m.homesAmt)
    // cached totals so any previewer shows the right numbers pre-recalc
    x = xlsSetCached(x, 'L30', m.total); x = xlsSetCached(x, 'O30', 1); x = xlsSetCached(x, 'P30', m.total)
    x = xlsSetCached(x, 'K31', m.foeAmt); x = xlsSetCached(x, 'K32', m.homesAmt)
    x = xlsSetCached(x, 'L33', -m.total); x = xlsSetCached(x, 'L34', 0)
    return x
  }
  s2 = fillScope(s2, { docNo: '', docDate: F.invoiceDate || '',
    startRef: 'C19', endRef: 'I19', startVal: F.estimatedStartDate || '', endVal: F.estimatedEndDate || '' })
  s3 = fillScope(s3, { docNo: F.projectInvoiceNumber || '', docDate: F.invoiceDate || '',
    startRef: 'C19', endRef: 'I19', startVal: F.startDate || '', endVal: F.endDate || '' })
  zip.file('xl/worksheets/sheet1.xml', s1)
  zip.file('xl/worksheets/sheet2.xml', s2)
  zip.file('xl/worksheets/sheet3.xml', s3)
  return await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
