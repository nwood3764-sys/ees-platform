// report-column-widths fixture — a report's column widths are what someone set,
// and nothing else changes them.
//
// Nicholas, 2026-08-29: "I need a way to adjust the column widths and never have
// them change again... It shouldn't change unless the user changes the widths."
// The rules that keep that promise are here: every column gets an explicit
// width (a column with none is sized from leftover space, which IS the
// auto-scaling), a saved width always wins over the default, and the key a
// width is stored under distinguishes two columns that share a name.

import {
  reportColumnKey, defaultReportColumnWidth, resolveReportColumnWidths,
  totalWidth, withColumnWidth, withoutColumnWidth,
} from '../src/lib/reportColumnWidths.js'
import { clampWidth, COL_MIN_WIDTH, COL_MAX_WIDTH } from '../src/lib/columnWidths.js'

let pass = 0, fail = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else { fail++; console.error(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`) }
}
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error(`  ✗ ${name}`) } }

// ── Keys ──────────────────────────────────────────────────────────────────
check('a own-object column keys on its name',
  reportColumnKey({ name: 'ia_status', via_path: null }), 'ia_status')
check('a related column carries its hop path',
  reportColumnKey({ name: 'account_name', via_path: ['opportunity_id', 'opportunity_account_id'] }),
  'opportunity_id>opportunity_account_id>account_name')
ok('the same column reached two ways does not share one width',
  reportColumnKey({ name: 'account_name', via_path: ['property_id'] }) !==
  reportColumnKey({ name: 'account_name', via_path: ['opportunity_id'] }))
check('a calculated field keys on its label',
  reportColumnKey({ _calc: true, label: '% of Total' }), 'calc:% of Total')
ok('a calc key cannot collide with a column name',
  reportColumnKey({ _calc: true, label: 'ia_status' }) !== reportColumnKey({ name: 'ia_status' }))

// ── Defaults ──────────────────────────────────────────────────────────────
ok('a name column is wider than a date column',
  defaultReportColumnWidth({ name: 'property_name', type: 'text' }) >
  defaultReportColumnWidth({ name: 'ia_submission_date', type: 'date' }))
ok('a boolean is the narrowest of them',
  defaultReportColumnWidth({ name: 'is_active', type: 'boolean' }) <
  defaultReportColumnWidth({ name: 'anything', type: 'text' }))
ok('every default is a usable width', [
  { name: 'x', type: 'text' }, { name: 'd', type: 'date' }, { _calc: true, label: 'f' },
  { name: 'n', type: 'numeric' }, { name: 'b', type: 'boolean' },
].every(c => {
  const w = defaultReportColumnWidth(c)
  return Number.isFinite(w) && w >= COL_MIN_WIDTH && w <= COL_MAX_WIDTH
}))
ok('an unknown column still gets a number', Number.isFinite(defaultReportColumnWidth(undefined)))

// ── Resolution: EVERY column gets an explicit width ───────────────────────
{
  const columns = [
    { name: 'ia_status', type: 'uuid', label: 'Status' },
    { name: 'ia_requested_incentive_amount', type: 'numeric', label: 'Requested Incentive Amount' },
    { name: 'ia_submission_date', type: 'date', label: 'Submission Date' },
  ]
  const widths = resolveReportColumnWidths(columns, { ia_status: 320 })
  ok('a saved width wins', widths[0] === 320)
  ok('an unsaved column takes its default', widths[1] === defaultReportColumnWidth(columns[1]))
  ok('no column is left without a width', widths.every(w => Number.isFinite(w) && w > 0))
  check('the table width is the sum of its columns', totalWidth(widths),
    320 + widths[1] + widths[2])
}
{
  const columns = [{ name: 'a', type: 'text' }, { name: 'b', type: 'text' }]
  check('no saved widths at all still yields two explicit widths',
    resolveReportColumnWidths(columns, null).length, 2)
  check('a junk saved value falls back to the default',
    resolveReportColumnWidths(columns, { a: 0, b: 'wide' }),
    [defaultReportColumnWidth(columns[0]), defaultReportColumnWidth(columns[1])])
}
{
  // The promise: nothing about the DATA moves a column. Same columns, wildly
  // different content, identical widths.
  const columns = [{ name: 'property_name', type: 'text' }, { name: 'n', type: 'numeric' }]
  const saved = { property_name: 300 }
  check('widths do not depend on the rows',
    resolveReportColumnWidths(columns, saved), resolveReportColumnWidths(columns, saved))
}

// ── Editing the map ───────────────────────────────────────────────────────
check('setting a width returns a new map with it', withColumnWidth({ a: 100 }, 'b', 240), { a: 100, b: 240 })
check('setting an existing width replaces it', withColumnWidth({ a: 100 }, 'a', 260), { a: 260 })
check('a fractional drag is stored whole', withColumnWidth({}, 'a', 187.6), { a: 188 })
{
  const before = { a: 100 }
  withColumnWidth(before, 'b', 200)
  check('the original map is not mutated', before, { a: 100 })
}
check('a width for a column the report no longer shows is kept',
  withColumnWidth({ removed_column: 400 }, 'a', 100), { removed_column: 400, a: 100 })
check('reset drops just that column', withoutColumnWidth({ a: 100, b: 200 }, 'a'), { b: 200 })
check('resetting a column that has no saved width is a no-op',
  withoutColumnWidth({ b: 200 }, 'a'), { b: 200 })
check('an empty key is refused rather than stored', withColumnWidth({ a: 1 }, '', 200), { a: 1 })

// ── Clamp ─────────────────────────────────────────────────────────────────
check('a drag past the left edge stops at the minimum', clampWidth(-40), COL_MIN_WIDTH)
check('a drag past the right edge stops at the maximum', clampWidth(99999), COL_MAX_WIDTH)
check('an ordinary drag is kept as a whole number', clampWidth(243.4), 243)

console.log(`report-column-widths fixture: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
