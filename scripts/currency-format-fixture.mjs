// currency-format fixture — money reads as money, and nothing else does.
//
// Nicholas, on the Incentive Applications list: "Why aren't my fields coming in
// like currency?" The column showed 110000. The line this pins is between a
// column DECLARED as money (format it) and a number that merely has a
// money-sounding name (leave it alone) — project_incentive_processing_time is a
// count of days and would print as dollars under any name heuristic.

import { isCurrencyColumn, formatCurrency, formatIfCurrency } from '../src/lib/currencyFormat.js'

let pass = 0, fail = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else { fail++; console.error(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`) }
}
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error(`  ✗ ${name}`) } }

// ── The value Nicholas was looking at ─────────────────────────────────────
check('the column he photographed', formatCurrency(110000), '$110,000')
check('and its neighbour', formatCurrency(60010), '$60,010')
check('and the audit amount', formatCurrency(2000), '$2,000')

// ── Whole dollars unless there are real cents ─────────────────────────────
check('cents are kept when they exist', formatCurrency(1234.56), '$1,234.56')
check('a trailing zero cent is still cents', formatCurrency(1234.5), '$1,234.50')
check('whole dollars carry no .00', formatCurrency(1234), '$1,234')
check('a big round number', formatCurrency(1500000), '$1,500,000')

// ── Zero is an answer; blank is not ───────────────────────────────────────
check('zero is money, not missing', formatCurrency(0), '$0')
check('null is missing', formatCurrency(null), '—')
check('undefined is missing', formatCurrency(undefined), '—')
check('empty string is missing', formatCurrency(''), '—')
check('the blank marker is configurable', formatCurrency(null, { blank: '' }), '')

// ── Strings off the wire ──────────────────────────────────────────────────
check('a numeric string formats', formatCurrency('110000'), '$110,000')
check('an already-formatted value is not double-formatted', formatCurrency('$110,000'), '$110,000')
check('a decimal string keeps its cents', formatCurrency('99.99'), '$99.99')

// ── Not a number: pass it through, never "$NaN" ───────────────────────────
check('text is returned as-is', formatCurrency('Not applicable'), 'Not applicable')
check('a stray dash survives', formatCurrency('—'), '—')

// ── Negatives ─────────────────────────────────────────────────────────────
ok('a negative amount is still money', formatCurrency(-500).includes('500'))

// ── Which columns are money: the DECLARATION, never the name ──────────────
ok('a declared currency column is money', isCurrencyColumn({ display_type: 'currency' }))
ok('the camelCase spelling works too', isCurrencyColumn({ displayType: 'currency' }))
ok('a list column carries it as valueType', isCurrencyColumn({ valueType: 'currency' }))
ok('a report column carries it as type', isCurrencyColumn({ type: 'currency' }))
ok('a plain number column is not money', !isCurrencyColumn({ display_type: 'number', type: 'number' }))
ok('nothing is not money', !isCurrencyColumn(null))
{
  // The trap the name heuristic falls into, stated as a test. Both of these
  // match any pattern over "incentive" or "cost" and neither is money.
  const days  = { columnName: 'project_incentive_processing_time', type: 'number' }
  const ratio = { columnName: 'opportunity_h_s_to_ee_cost_ratio',  type: 'number' }
  ok('a processing time is not money however it is named', !isCurrencyColumn(days))
  ok('nor is a cost RATIO', !isCurrencyColumn(ratio))
  check('so they are left exactly as they are', formatIfCurrency(45, days), 45)
  check('and the ratio too', formatIfCurrency(0.82, ratio), 0.82)
}
check('a money column is formatted', formatIfCurrency(110000, { display_type: 'currency' }), '$110,000')

console.log(`currency-format fixture: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
