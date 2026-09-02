// report-calc-fields fixture — an empty calculated field is not a field.
//
// "+ Add Calculated Field" appends a blank row. Saved, it becomes a column with
// no name (the viewer's "(calc)" placeholder) and no formula, so every cell is
// an em dash — and it comes back on every save, because it is still in the
// editor. RPT-00045 collected twelve in one afternoon.
//
// The line this pins is between a row nobody typed in (drop it) and a row
// someone is part-way through (never drop it — refuse the save and say what is
// missing).

import { classifyCalcFields, describeIncompleteCalcFields, calcColumnDescriptor } from '../src/lib/reportCalcFields.js'

let pass = 0, fail = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else { fail++; console.error(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`) }
}
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error(`  ✗ ${name}`) } }

const blank = { label: '', scope: 'row', expression: '', data_type: 'number' }
const real  = { label: 'Margin', scope: 'row', expression: 'amount - cost', data_type: 'number' }

// ── The row that caused this ──────────────────────────────────────────────
{
  const { keep, dropped, incomplete } = classifyCalcFields([blank])
  check('a row added and never filled in is dropped', keep.length, 0)
  check('and it is counted as dropped, not as an error', [dropped.length, incomplete.length], [1, 0])
}
{
  const { keep, dropped } = classifyCalcFields([real, blank, real])
  check('blank rows are dropped without touching the real ones', keep.length, 2)
  check('both real rows survive', keep.map(c => c.label), ['Margin', 'Margin'])
  check('one row was dropped', dropped.length, 1)
}
{
  // Whitespace is not content — this is exactly what a click into the field
  // and back out leaves behind.
  const { keep, dropped } = classifyCalcFields([{ label: '   ', expression: '\n\t ' }])
  check('a row holding only whitespace is blank', [keep.length, dropped.length], [0, 1])
}

// ── Half-authored rows are someone's work ─────────────────────────────────
{
  const { keep, incomplete } = classifyCalcFields([{ label: 'Margin', expression: '' }])
  check('a label with no formula does not save', keep.length, 0)
  check('it is reported, naming what is missing', incomplete, [
    { index: 0, position: 1, missing: 'formula', label: 'Margin' },
  ])
}
{
  const { keep, incomplete } = classifyCalcFields([{ label: '', expression: 'amount - cost' }])
  check('a formula with no label does not save', keep.length, 0)
  check('it is reported as missing its label', incomplete[0].missing, 'label')
  ok('a half-authored row is never silently dropped',
    classifyCalcFields([{ label: '', expression: 'amount - cost' }]).dropped.length === 0)
}
{
  const { incomplete } = classifyCalcFields([real, { label: 'Payback', expression: '' }, blank])
  check('the position named is the row the editor shows', incomplete[0].position, 2)
}

// ── Kept rows are normalized ──────────────────────────────────────────────
{
  const { keep } = classifyCalcFields([{ label: '  Margin  ', expression: '  amount - cost  ', data_type: 'currency' }])
  check('a kept label is trimmed', keep[0].label, 'Margin')
  check('a kept formula is trimmed', keep[0].expression, 'amount - cost')
  check('everything else on the row is carried through', keep[0].data_type, 'currency')
}

// ── Nothing in, nothing out ───────────────────────────────────────────────
check('no calculated fields at all', classifyCalcFields([]), { keep: [], dropped: [], incomplete: [] })
check('a missing list is not an error', classifyCalcFields(undefined).keep, [])
check('a null row is treated as blank', classifyCalcFields([null]).dropped.length, 1)

// ── The message ───────────────────────────────────────────────────────────
ok('no message when nothing is incomplete', describeIncompleteCalcFields([]) === null)
{
  const msg = describeIncompleteCalcFields(classifyCalcFields([{ label: 'Margin', expression: '' }]).incomplete)
  ok('the message names the row by its label', msg.includes('"Margin"'))
  ok('the message says what is missing', msg.includes('no formula'))
  ok('the message says how to get rid of the row', msg.includes('×'))
}
{
  const msg = describeIncompleteCalcFields(classifyCalcFields([{ label: '', expression: 'a - b' }]).incomplete)
  ok('a row with no label is named by its position', msg.includes('calculated field 1'))
}
{
  const msg = describeIncompleteCalcFields(classifyCalcFields([
    { label: 'Margin', expression: '' }, { label: '', expression: 'a - b' },
  ]).incomplete)
  ok('two incomplete rows are both named', msg.includes('"Margin"') && msg.includes('calculated field 2'))
}

// ── A calculated column can carry a grand total ───────────────────────────
// It could not: the Total control lived only on selected fields, so a Margin
// column was the one column in a report with no bottom line.
{
  const col = calcColumnDescriptor({ label: 'Margin', expression: 'a - b', data_type: 'currency', summarize: 'sum' })
  check('the total mode reaches the viewer', col.summarize, 'sum')
  check('a currency formula totals AS currency', col.format, 'currency')
  ok('and it is marked as calculated', col._calc === true)
  check('the label survives', col.label, 'Margin')
  check('so does the expression, which is what the total is computed from', col.expression, 'a - b')
}
{
  const col = calcColumnDescriptor({ label: 'Rate', data_type: 'percent' })
  check('a percent formula totals as a percent', col.format, 'percent')
  ok('no total mode means no total', col.summarize === undefined)
}
{
  const col = calcColumnDescriptor({ label: 'Units', data_type: 'number' })
  ok('a plain number takes the default format, not a currency sign', col.format === undefined)
}
{
  const col = calcColumnDescriptor({ label: 'X', data_type: 'currency', format: 'compact' })
  check('an explicit format is never overridden by the data type', col.format, 'compact')
}
check('an unnamed calculated column still renders a header',
  calcColumnDescriptor({ expression: 'a' }).label, '(calc)')
ok('nothing in, no crash', calcColumnDescriptor(null)._calc === true)
{
  // The total mode must survive the save path, or it is set once and lost.
  const { keep } = classifyCalcFields([{ label: 'Margin', expression: 'a - b', summarize: 'sum' }])
  check('classify keeps the total mode', keep[0].summarize, 'sum')
}

console.log(`report-calc-fields fixture: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
