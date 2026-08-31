// chart-data-labels fixture — what a label says, and whether it can be read.
//
// A live pie printed "51%" in white on light emerald: about 1.9:1, invisible.
// And there was one boolean for labels, so a pie could only ever show a share.

import {
  dataLabelMode, dataLabelText, labelInkFor, labelIsLegible, categoryLabel,
  contrastRatio, relativeLuminance, DATA_LABEL_MODES,
} from '../src/lib/chartDataLabels.js'

let pass = 0, fail = 0
const check = (n, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++
  else { fail++; console.error(`  ✗ ${n}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`) }
}
const ok = (n, c) => { if (c) pass++; else { fail++; console.error(`  ✗ ${n}`) } }
const fmt = (v) => Number(v).toLocaleString()

// ── Reading the saved config ──────────────────────────────────────────────
check('an explicit mode wins', dataLabelMode({ data_label_mode: 'value' }), 'value')
check('the old boolean false still means off', dataLabelMode({ show_data_labels: false }), 'none')
check('the old boolean true keeps the chart\'s previous shape',
  dataLabelMode({ show_data_labels: true }, 'percent'), 'percent')
check('nothing saved means the chart\'s default', dataLabelMode({}, 'value'), 'value')
check('a junk mode is ignored rather than rendered', dataLabelMode({ data_label_mode: 'wat' }, 'value'), 'value')
ok('every offered mode is a known one',
  ['none','value','percent','value_percent','auto'].every(m => DATA_LABEL_MODES.includes(m)))

// ── What the label says ───────────────────────────────────────────────────
check('value', dataLabelText('value', { value: 1234, percent: 31.7, fmt }), '1,234')
check('percentage', dataLabelText('percent', { value: 1234, percent: 31.7, fmt }), '32%')
check('both', dataLabelText('value_percent', { value: 1234, percent: 31.7, fmt }), '1,234 · 32%')
check('none', dataLabelText('none', { value: 1234, percent: 31.7, fmt }), '')
check('auto follows the chart type it was given',
  dataLabelText('auto', { value: 12, percent: 50, fmt, autoMode: 'value' }), '12')
check('a form with no share falls back to the value',
  dataLabelText('percent', { value: 12, percent: null, fmt }), '12')
check('a slice too small for text gets no label',
  dataLabelText('percent', { value: 1, percent: 2.7, fmt, minPercent: 9 }), '')
check('a slice big enough keeps it',
  dataLabelText('percent', { value: 20, percent: 40, fmt, minPercent: 9 }), '40%')
check('the size floor applies to values too',
  dataLabelText('value', { value: 1, percent: 2.7, fmt, minPercent: 9 }), '')

// ── Ink that can be read ──────────────────────────────────────────────────
// The exact case from the screenshot: white on the platform's emerald.
ok('white on LEAP emerald is NOT legible', !labelIsLegible('#3ecf8e', '#ffffff'))
ok('white on LEAP sky is NOT legible', !labelIsLegible('#7eb3e8', '#ffffff'))
check('so emerald takes dark ink', labelInkFor('#3ecf8e'), '#0d1a2e')
check('and sky takes dark ink', labelInkFor('#7eb3e8'), '#0d1a2e')
ok('and the chosen ink IS legible on emerald', labelIsLegible('#3ecf8e', labelInkFor('#3ecf8e')))
ok('and on sky', labelIsLegible('#7eb3e8', labelInkFor('#7eb3e8')))
// The other side: LEAP's navy fill needs white, which a fixed dark would have
// made just as unreadable in the other direction.
check('navy takes white ink', labelInkFor('#1e466b'), '#ffffff')
ok('white on navy is legible', labelIsLegible('#1e466b', '#ffffff'))
ok('every palette colour ends up with legible ink',
  ['#3ecf8e','#7eb3e8','#1e466b','#a78bfa','#2aab72','#5eead4','#8fa0b8']
    .every(c => labelIsLegible(c, labelInkFor(c), 4.0)))
check('an unparseable fill falls back to dark rather than throwing', labelInkFor('nonsense'), '#0d1a2e')
check('a 3-digit hex works', labelInkFor('#fff'), '#0d1a2e')

// ── The arithmetic itself ─────────────────────────────────────────────────
ok('white on black is the maximum 21:1',
  Math.round(contrastRatio(relativeLuminance('#ffffff'), relativeLuminance('#000000'))) === 21)
ok('a colour against itself is 1:1',
  Math.round(contrastRatio(relativeLuminance('#3ecf8e'), relativeLuminance('#3ecf8e'))) === 1)

// ── Blank categories ──────────────────────────────────────────────────────
check('a null group is named blank', categoryLabel(null), '(blank)')
check('an empty string too', categoryLabel('   '), '(blank)')
check('an em dash is not a category name', categoryLabel('—'), '(blank)')
check('a real name is left alone', categoryLabel('Rocky Mount Housing Authority'), 'Rocky Mount Housing Authority')

console.log(`chart-data-labels fixture: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
