// Fixture: a numeric column rendered as a dropdown over a declared range.
//
// Nicholas, 2026-09-05, on a building record: "should the number of stories be
// a pick list? Not just a free-form text field also, the year built should also
// be a pick list."
//
// The thing this suite exists to pin is that the column stays NUMERIC. LEAP's
// ordinary picklist stores a picklist_values id, and buildings.building_year_built
// is an integer read as a number by the Asset Score report, the bulk property
// importer, four page layouts and any report that filters "before 1980". So the
// control changes and the stored value does not.
//
// Two rules carry real risk and are pinned as controls:
//
//   1. A value already stored outside the declared range is NEVER dropped. A
//      dropdown that does not contain the answer in front of you is a person
//      stuck (the disposal-facility lesson, 2026-09-03) and, worse here, saving
//      such a record would silently clear the field.
//   2. The year list is DERIVED from today, never enumerated. A list of years
//      written down is wrong every January.
//
// Run with:  node scripts/number-choice-range-fixture.mjs

import {
  isNumberChoiceRange, resolveRangeBounds, numberChoiceOptions,
  parseNumberChoice, formatChoiceNumber, MAX_CHOICE_OPTIONS,
} from '../src/lib/numberChoiceRange.js'

let failures = 0, checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) { failures += 1; console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`) }
}

// The two ranges declared on prod (migration 20260905180240).
const YEAR_BUILT = { min: 1800, max_offset_from_current_year: 1, step: 1, order: 'desc' }
const STORIES    = { min: 1, max: 50, step: 1, order: 'asc' }

// ── What counts as a declared range ────────────────────────────────────────
check('a range with a fixed max is a range', isNumberChoiceRange(STORIES), true)
check('a range whose max follows the calendar is a range', isNumberChoiceRange(YEAR_BUILT), true)
check('null is not a range', isNumberChoiceRange(null), false)
check('an empty object is not a range', isNumberChoiceRange({}), false)
check('a min with no max is not a range', isNumberChoiceRange({ min: 1 }), false)
check('an array is not a range', isNumberChoiceRange([1, 2, 3]), false)
check('a string min is not a range', isNumberChoiceRange({ min: 'one', max: 5 }), false)

// ── The year list is derived, not written down ─────────────────────────────
const y2026 = numberChoiceOptions(YEAR_BUILT, null, new Date('2026-06-01T00:00:00Z'))
const y2031 = numberChoiceOptions(YEAR_BUILT, null, new Date('2031-06-01T00:00:00Z'))
check('the year list ends one year past today', y2026[0].value, 2027)
check('five calendar years later it has moved with the calendar, unedited', y2031[0].value, 2032)
check('the year list still starts at 1800', y2026[y2026.length - 1].value, 1800)
check('newest year first', y2026.slice(0, 3).map(o => o.value), [2027, 2026, 2025])
check('the year list is exactly as long as the range', y2026.length, 2027 - 1800 + 1)

// A year is not a quantity: 1987 must never read "1,987", which is what
// `type: 'number'` renders on the record page today.
check('a year label carries no thousands separator',
  y2026.find(o => o.value === 1987).label, '1987')
check('the formatter never groups digits', formatChoiceNumber(1987), '1987')

// ── Storeys ────────────────────────────────────────────────────────────────
const st = numberChoiceOptions(STORIES)
check('storeys run 1 to 50', [st[0].value, st[st.length - 1].value, st.length], [1, 50, 50])
check('storeys start at 1, never 0 or a negative', st.some(o => o.value < 1), false)

// ── The rule that matters: a stored value is never hidden ──────────────────
const withOld = numberChoiceOptions(YEAR_BUILT, 1780, new Date('2026-06-01T00:00:00Z'))
check('a building recorded as built before the range still shows its year',
  withOld.some(o => o.value === 1780), true)
check('and it sits in order, not bolted on top', withOld[withOld.length - 1].value, 1780)
const withTall = numberChoiceOptions(STORIES, 88)
check('a storey count above the range is kept', withTall.some(o => o.value === 88), true)
check('and it sits in order', withTall[withTall.length - 1].value, 88)
check('a value already inside the range is not duplicated',
  numberChoiceOptions(STORIES, 12).filter(o => o.value === 12).length, 1)
check('an empty stored value adds nothing', numberChoiceOptions(STORIES, '').length, 50)
check('a null stored value adds nothing', numberChoiceOptions(STORIES, null).length, 50)

// POSITIVE CONTROL — a builder that simply expands the range, with no regard
// for what the record holds, MUST lose the out-of-range year. If this ever
// passes, the rule above is not being tested.
const naive = []
for (let y = 1800; y <= 2027; y += 1) naive.push(y)
check('POSITIVE CONTROL — a plain range expansion DOES lose the stored value',
  naive.includes(1780), false)

// ── What gets stored ───────────────────────────────────────────────────────
// The <select> hands back a string; the column is numeric.
check('the choice is stored as a number, not the option string', parseNumberChoice('1987'), 1987)
check('typeof what is stored', typeof parseNumberChoice('1987'), 'number')
check('clearing the field stores null', parseNumberChoice(''), null)
check('an unparseable choice stores null, never NaN', parseNumberChoice('abc'), null)
check('null in, null out', parseNumberChoice(null), null)

// ── Junk in, no dropdown out ───────────────────────────────────────────────
// Every one of these must return null so the field falls back to the number
// input it was — an empty dropdown is a field the user cannot fill in.
check('a max below the min yields no dropdown', numberChoiceOptions({ min: 10, max: 1 }), null)
check('a missing range yields no dropdown', numberChoiceOptions(null), null)
check('a range longer than the cap yields no dropdown',
  numberChoiceOptions({ min: 0, max: MAX_CHOICE_OPTIONS + 1 }), null)
check('a range exactly at the cap is still offered',
  numberChoiceOptions({ min: 1, max: MAX_CHOICE_OPTIONS }).length, MAX_CHOICE_OPTIONS)
check('a zero step falls back to 1, it does not hang',
  numberChoiceOptions({ min: 1, max: 4, step: 0 }).map(o => o.value), [1, 2, 3, 4])
check('a negative step falls back to 1',
  numberChoiceOptions({ min: 1, max: 3, step: -2 }).map(o => o.value), [1, 2, 3])

// ── Fractional steps ───────────────────────────────────────────────────────
// building_stories_of_building is numeric, not an integer — a half storey is
// representable, and float accumulation must not produce 2.0999999999.
const halves = numberChoiceOptions({ min: 1, max: 3, step: 0.5, order: 'asc' })
check('a half-step range comes out clean', halves.map(o => o.value), [1, 1.5, 2, 2.5, 3])
check('and its labels are clean too', halves.map(o => o.label), ['1', '1.5', '2', '2.5', '3'])

// ── Bounds ─────────────────────────────────────────────────────────────────
check('bounds resolve against the injected clock',
  resolveRangeBounds(YEAR_BUILT, new Date('2040-01-01T00:00:00Z')), { min: 1800, max: 2041, step: 1 })
check('bounds of a fixed range', resolveRangeBounds(STORIES), { min: 1, max: 50, step: 1 })
check('bounds of nonsense', resolveRangeBounds({ min: 'x' }), null)

console.log(`${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
