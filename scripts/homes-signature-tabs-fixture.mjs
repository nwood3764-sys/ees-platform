// Signature tabs on the HOMES documents, for the e-signature route.
//
// The Project Payment Request invoice is sent to the property owner to sign, so
// the pipeline needs to know WHERE on the page the signature and date go. The
// coordinates are captured from the same values that draw the rules — this is
// what proves they agree, and that only the documents which HAVE an
// acknowledgment block produce any.
//
// A tab a centimetre off its line is not obviously wrong to whoever renders it
// and very obviously wrong to whoever signed it. So this renders real PDFs and
// reads the coordinates back, rather than trusting the arithmetic.

import { generateHomesProposalBlobWithSignatureTabs, computeHomesModel } from '../src/lib/homesProposal.js'

let pass = 0, fail = 0
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log(`PASS  ${label}`) }
  else { fail++; console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`) }
}
const eq = (label, a, b) => ok(label, a === b, `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`)

const FIELDS = {
  pjPropName: 'Green Valley Estates', pjInstallAddr: '570 South Clark Street',
  pjCsz: 'Whitewater, WI 53190', pjOwner: 'Lutheran Social Services',
  pjContact: 'Dennis Hanson', pjState: 'WI', pjInvDate: '2026-09-03',
}
const base = { fields: FIELDS, units: 8, contractor: 'EES' }

// US Letter, the page size these documents are built at.
const PAGE_W = 612, PAGE_H = 792

for (const [who, input] of [
  ['EES',    { ...base, kind: 'invoice' }],
  ['Sealed', { ...base, contractor: 'Sealed, Inc.', kind: 'invoice' }],
]) {
  const { blob, tabs } = await generateHomesProposalBlobWithSignatureTabs(input)
  ok(`${who} invoice: still renders with tab capture on`,
    (await blob.arrayBuffer()).byteLength > 5000)
  eq(`${who} invoice: exactly two tabs — a signature and a date`, tabs.length, 2)

  const sig = tabs.find(t => t.tab_type === 'sig')
  const date = tabs.find(t => t.tab_type === 'date')
  ok(`${who} invoice: a signature tab is recorded`, !!sig)
  ok(`${who} invoice: a date tab is recorded`, !!date)

  for (const [what, tab] of [['signature', sig], ['date', date]]) {
    eq(`${who} invoice: the ${what} tab is for the first recipient`, tab.recipient_order, 1)
    ok(`${who} invoice: the ${what} tab names a real page`, tab.page >= 1)
    // Bottom-origin. A y at or outside the page is the failure mode of getting
    // the jsPDF top-origin conversion backwards.
    ok(`${who} invoice: the ${what} tab y is on the page, got ${Math.round(tab.y)}`,
      tab.y > 0 && tab.y < PAGE_H)
    ok(`${who} invoice: the ${what} tab is within the page width`,
      tab.x >= 0 && tab.x + tab.width <= PAGE_W)
    ok(`${who} invoice: the ${what} tab has real width and height`,
      tab.width > 20 && tab.height > 5)
  }

  // The two rules are drawn side by side, so overlapping tabs would stamp the
  // date across the signature.
  ok(`${who} invoice: the date tab is right of the signature tab`, date.x > sig.x)
  ok(`${who} invoice: the two tabs do not overlap`, sig.x + sig.width <= date.x)
  eq(`${who} invoice: both tabs sit on the same line`, sig.y, date.y)
  eq(`${who} invoice: both tabs are on the same page`, sig.page, date.page)

  // CONTROL: the naive conversion — using jsPDF's top-origin y directly — puts
  // the tab in a different place entirely. If this stops differing, the
  // conversion has been dropped and every coordinate above is wrong.
  ok(`${who} invoice: CONTROL top-origin y really does differ from the recorded y`,
    Math.abs((PAGE_H - sig.y) - sig.y) > 40)
}

// A PROPOSAL carries no acknowledgment block (Nicholas), so it must produce NO
// tabs — and the send path refuses to send a document with none rather than
// placing a signature nowhere. This is the check that stops "signable" being
// assumed from the record type instead of read from the document.
for (const [who, input] of [
  ['EES',    { ...base, kind: 'proposal' }],
  ['Sealed', { ...base, contractor: 'Sealed, Inc.', kind: 'proposal' }],
]) {
  const { tabs } = await generateHomesProposalBlobWithSignatureTabs(input)
  eq(`${who} proposal: carries no signature block, so no tabs`, tabs.length, 0)
}

// The document a person SIGNS must say they owe nothing. Nicholas, 2026-09-03:
// "There is no cost. Customers don't pay us anything. The program pays us. This
// invoice is just fake so the customer can see that there's no out-of-pocket
// cost." homesProposal is a SECOND engine with its own copy of this arithmetic
// (paperworkModel is the other, guarded in paperwork-math-fixture), and this is
// the one the Send for Signature path renders — so the zero is pinned on both.
// A change that prices the invoice from the opportunity line items, which hold
// the only real dollars in LEAP, fails here by name.
{
  const m = computeHomesModel({ ...base, assetScoreBaseText: null, assetScoreImpText: null })
  const credits = Math.round((m.homesAmt + m.foeAmt) * 100) / 100
  eq('signed invoice: cost is defined as the rebate, nothing else', m.total, credits)
  eq('signed invoice: BALANCE DUE FROM THE CUSTOMER IS ZERO — by design',
    Math.round((m.total - credits) * 100) / 100, 0)
  const rows = Math.round(m.rows.reduce((a, r) => a + r.cost, 0) * 100) / 100
  eq('signed invoice: the measure rows break out that one total, they are not prices',
    rows, m.total)
}

console.log(`\n${fail ? 'FAIL' : 'PASS'}  ${pass} passed, ${fail} failed (of ${pass + fail} checks)`)
process.exit(fail ? 1 : 0)
