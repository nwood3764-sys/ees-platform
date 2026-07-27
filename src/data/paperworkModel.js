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
async function buildDocumentContext(m, kind) {
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
    gross, foeAmt, iraAmt, credits }
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
    const { W, M, CW, C, st, font, t, tc, wrap, need, stroke, d, text, isAudit, isInv } = x
    head_(x, cfg.heading || 'Acknowledgment & Acceptance')
    const ack = (isAudit || isInv) ? text('acknowledgment.invoice') : text('acknowledgment.proposal')
    const al = wrap(ack, CW); need(al.length * 10 + 6); tc(C.ink); font(9)
    al.forEach((ln, k) => t(M, st.y + 9 + k * 10, ln)); st.y += al.length * 10 + 4
    need(46); st.y += 28; stroke([68, 88, 110]); d.setLineWidth(1)
    d.line(M, st.y, M + 280, st.y); d.line(W - M - 150, st.y, W - M, st.y)
    tc(C.mut); font(8.5); t(M, st.y + 10, cfg.signer_label || 'Property Owner / Authorized Representative')
    t(W - M - 150, st.y + 10, 'Date')
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
})

/**
 * Render an EES submittal document. `sections` overrides the built-in list —
 * that is how a stored template drives the output. Returns a Blob.
 */
export async function buildEesPdf(m, kind, sections) {
  const x = await buildDocumentContext(m, kind)
  const list = sections && sections.length ? sections : DEFAULT_DOCUMENT_SECTIONS[kind]
  if (!list) throw new Error(`Unknown document kind: ${kind}`)
  for (const s of list) {
    const render = SECTION_RENDERERS[s.type]
    if (!render) throw new Error(`Unknown document section type: ${s.type}`)
    render(x, s.config || {})
  }
  return x.d.output('blob')
}

// ---------------------------------------------------------------------------
// Sealed-style documents — 'proposal' | 'invoice'. Sealed, Inc. is the
// primary contractor; EES is the line-item contractor. Keeps Sealed's own
// look (including red amounts — the EES no-red rule applies to EES documents
// only). Returns a Blob.
// ---------------------------------------------------------------------------
export async function buildSealedPdf(m, kind) {
  const F = m.fields
  const isInv = kind === 'invoice'
  const P = await pdfCanvas()
  const { d, W, H, M, CW, C, st, font, t, wrap, need, fill, stroke, tc } = P
  const bh = (txt, x, yy) => { tc(C.sealBlue); font(9.5, 'bold'); t(x, yy, txt.toUpperCase()) }
  const lines9 = (arr, x, yy) => { tc(C.ink); font(9); arr.filter(v => v).forEach((ln, k) => t(x, yy + k * 11.5, String(ln))); return yy + arr.filter(v => v).length * 11.5 }
  st.y = M + 4
  bh('Primary Contractor:', M, st.y)
  let yA = lines9(['Sealed, Inc.', '200 E Verona Ave', 'Verona, WI 53593', '(949) 832-6798'], M, st.y + 15)
  const RX = W / 2 + 20
  bh(isInv ? 'Invoice Details:' : 'Project Details:', RX, st.y)
  const det = isInv
    ? ['Invoice No.: ' + (F.projectInvoiceNumber || ''), 'Invoice Date: ' + (F.invoiceDate || ''), 'Due Date: 30 days', 'IQ Number: ' + (F.iqNumber || ''), 'Start Date: ' + (F.startDate || ''), 'Completion Date: ' + (F.endDate || '')]
    : ['Date: ' + (F.invoiceDate || ''), 'Valid for: 30 days', 'IQ Number: ' + (F.iqNumber || ''), 'Estimated Start Date: ' + (F.estimatedStartDate || ''), 'Estimated Completion Date: ' + (F.estimatedEndDate || '')]
  let yB = lines9(det, RX, st.y + 15)
  st.y = Math.max(yA, yB) + 12
  bh('Bill To:', M, st.y)
  yA = lines9([F.ownerName, F.contactName, F.ownerAddress, F.ownerCityStateZip, F.contactPhone, F.contactEmail], M, st.y + 15)
  bh('Project Address:', RX, st.y)
  yB = lines9([F.propertyName, F.installationAddress, F.installationCityStateZip, 'Multifamily', isInv ? '' : F.iqNumber], RX, st.y + 15)
  st.y = Math.max(yA, yB) + 12
  tc(C.sealBlue); font(14, 'bold'); t(M, st.y + 11, isInv ? 'INVOICE' : 'PROPOSAL'); st.y += 17
  /* items table */
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
  /* rebate sections */
  const sect = (title, desc, name, amt) => { need(46); st.y += 12; bh(title, M, st.y)
    st.y += 5; stroke([188, 214, 242]); d.setLineWidth(1); d.line(M, st.y, W - M, st.y)
    const dl = wrap(desc, 270), h = Math.max(dl.length * 9.5, 19) + 10; need(h)
    tc(C.ink); font(8); dl.forEach((ln, k) => t(M, st.y + 12 + k * 9.5, ln))
    wrap(name, 150).forEach((ln, k) => t(M + 300, st.y + 12 + k * 9.5, ln))
    tc(C.red); font(9, 'bold'); t(W - M, st.y + 12, _money(amt), { align: 'right' })
    st.y += h; stroke([188, 214, 242]); d.line(M, st.y, W - M, st.y) }
  sect('IRA Rebates', 'Incentive Description: ' + (m.tier ? m.tier.desc : '') + '. Notes: ' + (m.tier ? m.tier.note : '') + '.',
    'IRA HOMES ' + (isInv ? 'Incentive ' : '') + '- Instant Discount', m.homesAmt)
  if (m.foe) sect('Other Non-IRA Rebates', 'Incentive Description: ' + m.foe.desc + '. Notes: ' + m.foe.note + '.',
    'Focus on Energy - Instant Discount', m.foeAmt)
  /* totals */
  need(90); st.y += 12; bh('Totals', M, st.y); st.y += 5
  stroke([188, 214, 242]); d.setLineWidth(1); d.line(M, st.y, W - M, st.y); st.y += 4
  const trows = [['Total Cost', _money(m.total), false], ['Total Rebates', _money(m.total), false],
    ['Total Deposits', '$0.00', false], [isInv ? 'Total Due' : 'Total Final', '$0.00', true]]
  for (const [lbl, val, strong] of trows) {
    tc(C.ink); font(9, strong ? 'bold' : 'normal')
    t(M, st.y + 12, lbl); t(W - M, st.y + 12, val, { align: 'right' })
    stroke(C.line); d.setLineWidth(.5); d.line(M, st.y + 17, W - M, st.y + 17); st.y += 18 }
  /* signature */
  need(64); st.y += 40; stroke([68, 68, 68]); d.setLineWidth(1)
  d.line(M, st.y, M + 300, st.y); d.line(W - M - 160, st.y, W - M, st.y)
  tc(C.mut); font(8.5); t(M, st.y + 11, 'Customer Signature'); t(W - M - 160, st.y + 11, 'Date')
  return d.output('blob')
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
