// Fixture: a list view can ask a date question, and a saved view can mean
// "today" tomorrow.
//
// Nicholas, 2026-09-02, on the Field module's Service Appointments tab: "Why
// can't I ever see past service appointments? It just gives me a dropdown for
// future."
//
// The tab was a future-only inbox rather than the object's list view. Making it
// the list view is most of that fix — but a list view could only compare dates
// as TEXT, and a saved list view could only name a FIXED calendar date. Both
// had to be true before "Today's Service Appointments" or "Past Service
// Appointments" could exist as views that stay honest.
//
// Two things are pinned here.
//
//  1. The lexical comparison the list used to do is WRONG on a timestamp
//     column, in both directions, and both are run below as CONTROLS that must
//     produce the wrong answer:
//       equals '2026-08-12' never matched "2026-08-12T13:00:00+00:00"
//       on-or-before '2026-08-12' EXCLUDED that whole day
//     A filter that silently matches nothing reads as "there are no such
//     records", which is exactly the complaint.
//
//  2. Relative literals resolve against ONE clock, and the list's operator
//     vocabulary (from/to) maps onto the platform's existing date kernel in
//     reportFilters.js. There is no second definition of "before today".
//
// Run with:  node scripts/list-view-date-filter-fixture.mjs
//
// TZ is forced: "today" is a local-calendar question, and a fixture that means
// something different in CI than on a laptop pins nothing.

process.env.TZ = 'America/Chicago'

const { readFileSync } = await import('node:fs')
const { isDateFilterRow, evaluateDateFilter, LIST_DATE_OPERATORS, isDateComparableOperator } =
  await import('../src/lib/listFilterDates.js')
const { isDateLiteral, dateLiteralLabel } = await import('../src/lib/reportFilters.js')

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures += 1
    console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`)
  }
}

// A fixed clock so every relative literal below means one known week.
// Wednesday 2026-09-02, 10:00 local.
const NOW = new Date(2026, 8, 2, 10, 0, 0)

// Real service-appointment instants, as the column stores them (timestamptz,
// rendered UTC). SA-00299 is 13:00Z = 8:00 AM in Appleton.
const AUG_12  = '2026-08-12T13:00:00+00:00'
const SEP_02  = '2026-09-02T14:30:00+00:00'   // today, 9:30 AM local
const SEP_09  = '2026-09-09T13:00:00+00:00'   // next week
const LAST_YR = '2025-11-04T16:00:00+00:00'

// ── 1. Which rows are date rows ────────────────────────────────────────────
check('a date column with a fixed date is a date row',
  isDateFilterRow('date', '2026-08-12', 'from'), true)
check('a datetime column is a date row too',
  isDateFilterRow('datetime', '2026-08-12', 'from'), true)
check('a literal makes it a date row whatever the column claims to be',
  isDateFilterRow('text', 'TODAY', 'equals'), true)
check('a literal inside a multi-value equals still counts',
  isDateFilterRow('text', ['TODAY', 'YESTERDAY'], 'equals'), true)
check('a text column with a text value is not a date row',
  isDateFilterRow('text', 'Scheduled', 'equals'), false)
check('a number column is not a date row',
  isDateFilterRow('number', '30', 'gt'), false)
// The blank operators mean the same thing on every type; routing them through
// a date range would ask the kernel a question it has no business answering.
check('"is blank" is never a date row', isDateFilterRow('date', '', 'is_blank'), false)
check('"is not blank" is never a date row', isDateFilterRow('date', '', 'is_not_blank'), false)
check('"contains" on a date column is left as text',
  isDateFilterRow('date', '2026', 'contains'), false)
check('and contains is not a date-comparable operator at all',
  isDateComparableOperator('contains'), false)

// ── 2. The defect, and the control that reproduces it ──────────────────────
// The old evaluation, verbatim in shape: String(cell) compared to String(value).
const lexical = (cell, op, value) => {
  const v = String(cell)
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  if (op === 'equals') return v === String(value)
  if (op === 'to')     return cmp(v, value) <= 0
  if (op === 'from')   return cmp(v, value) >= 0
  return true
}
check('CONTROL: lexically, "equals 2026-08-12" misses an appointment on 2026-08-12',
  lexical(AUG_12, 'equals', '2026-08-12'), false)
check('CONTROL: lexically, "on or before 2026-08-12" excludes that same day',
  lexical(AUG_12, 'to', '2026-08-12'), false)
check('equals a calendar date matches any instant that day',
  evaluateDateFilter(AUG_12, 'equals', '2026-08-12', NOW), true)
check('on or before that date includes the whole day',
  evaluateDateFilter(AUG_12, 'to', '2026-08-12', NOW), true)
check('on or after that date includes the whole day',
  evaluateDateFilter(AUG_12, 'from', '2026-08-12', NOW), true)
check('before that date excludes it',
  evaluateDateFilter(AUG_12, 'lt', '2026-08-12', NOW), false)
check('after that date excludes it',
  evaluateDateFilter(AUG_12, 'gt', '2026-08-12', NOW), false)

// ── 3. Past vs upcoming — the two views the complaint asks for ─────────────
check('a past appointment is before today',
  evaluateDateFilter(AUG_12, 'lt', 'TODAY', NOW), true)
check("today's appointment is NOT before today",
  evaluateDateFilter(SEP_02, 'lt', 'TODAY', NOW), false)
check("today's appointment is on or after today",
  evaluateDateFilter(SEP_02, 'from', 'TODAY', NOW), true)
check('a future appointment is on or after today',
  evaluateDateFilter(SEP_09, 'from', 'TODAY', NOW), true)
check('a past appointment is not on or after today',
  evaluateDateFilter(AUG_12, 'from', 'TODAY', NOW), false)
check("today's appointment equals TODAY",
  evaluateDateFilter(SEP_02, 'equals', 'TODAY', NOW), true)
check('yesterday-and-earlier does not equal TODAY',
  evaluateDateFilter(AUG_12, 'equals', 'TODAY', NOW), false)
check('a future appointment is after today',
  evaluateDateFilter(SEP_09, 'gt', 'TODAY', NOW), true)
check('this week catches today',
  evaluateDateFilter(SEP_02, 'equals', 'THIS_WEEK', NOW), true)
check('this week does not catch next week',
  evaluateDateFilter(SEP_09, 'equals', 'THIS_WEEK', NOW), false)
check('next 30 days catches next week',
  evaluateDateFilter(SEP_09, 'equals', 'NEXT_N_DAYS:30', NOW), true)
check('next 30 days does not reach back to August',
  evaluateDateFilter(AUG_12, 'equals', 'NEXT_N_DAYS:30', NOW), false)
check('last 90 days reaches back to August',
  evaluateDateFilter(AUG_12, 'equals', 'LAST_N_DAYS:90', NOW), true)
check('last 90 days does not reach back a year',
  evaluateDateFilter(LAST_YR, 'equals', 'LAST_N_DAYS:90', NOW), false)
check('this year excludes last year',
  evaluateDateFilter(LAST_YR, 'equals', 'THIS_YEAR', NOW), false)

// ── 4. A blank never answers a date question ───────────────────────────────
// Two of the 104 live service appointments carry no scheduled time. An
// unscheduled appointment is not "before today" — it is unscheduled, and
// saying otherwise files it under a date it does not have.
check('a null scheduled time is not before today',
  evaluateDateFilter(null, 'lt', 'TODAY', NOW), false)
check('a null scheduled time is not on or after today',
  evaluateDateFilter(null, 'from', 'TODAY', NOW), false)
check('an empty scheduled time is not before today',
  evaluateDateFilter('', 'lt', 'TODAY', NOW), false)
check('a null scheduled time does not equal any day',
  evaluateDateFilter(null, 'equals', '2026-08-12', NOW), false)

// ── 5. Between ─────────────────────────────────────────────────────────────
check('between two dates includes an instant inside the later day',
  evaluateDateFilter(AUG_12, 'between', ['2026-08-01', '2026-08-12'], NOW), true)
check('between two dates excludes an instant outside them',
  evaluateDateFilter(SEP_09, 'between', ['2026-08-01', '2026-08-12'], NOW), false)

// ── 6. The vocabulary maps onto the kernel, once ───────────────────────────
// `from`/`to` are the list's own spelling of "on or after"/"on or before" and
// must land on the same kernel operator as gte/lte, or the same question asked
// two ways gets two answers.
check('from and gte are the same kernel operator',
  LIST_DATE_OPERATORS.from, LIST_DATE_OPERATORS.gte)
check('to and lte are the same kernel operator',
  LIST_DATE_OPERATORS.to, LIST_DATE_OPERATORS.lte)
check('every list date operator maps to a kernel operator',
  Object.values(LIST_DATE_OPERATORS).every(Boolean), true)
check('a literal is recognised as one', isDateLiteral('LAST_N_DAYS:90'), true)
check('a calendar date is not a literal', isDateLiteral('2026-08-12'), false)
check('a literal reads as words, with its count filled in',
  dateLiteralLabel('LAST_N_DAYS:90'), 'Last 90 Days')

// ── 7. The list view actually uses all of this ─────────────────────────────
{
  const src = readFileSync(new URL('../src/components/ListView.jsx', import.meta.url), 'utf8')
  check('ListView routes date filters through the shared rule',
    /isDateFilterRow\(type, filter\.value, op\)/.test(src), true)
  check('and evaluates them with the shared kernel, not by string compare',
    /evaluateDateFilter\(rawValue, op, filter\.value, now\)/.test(src), true)
  check('the column type reaches matchFilter',
    /matchFilter\(r\[entryKeys\[i\]\], entry, entryTypes\[i\], now\)/.test(src), true)
  check('one clock is resolved per pass, not per row',
    /const now = new Date\(\);\s*\n\s*d = d\.filter/.test(src), true)
  check('the filter editor offers relative periods',
    /DATE_LITERALS\.map\(d => <option/.test(src), true)
  check('a saved literal is still editable as a literal',
    /if \(\(row\.type === 'date' \|\| literal\) && !isRange\)/.test(src), true)
  check('a filter chip names the period instead of printing its token',
    /dateLiteralLabel\(filter\.value\)/.test(src), true)
}

console.log(failures === 0
  ? `list-view-date-filter fixture: ${checks} checks passed`
  : `list-view-date-filter fixture: ${failures} of ${checks} FAILED`)
process.exit(failures === 0 ? 0 : 1)
