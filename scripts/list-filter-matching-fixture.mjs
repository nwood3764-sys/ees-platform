// Fixture test for list-view filter MATCHING — every operator, every type.
//
// Nicholas, 2026-08-29: "you really need to go through this list view and all
// the filters and functionality to make sure it's accurate. I can't keep being
// a beta tester every single time there's a mistake you make in the code."
//
// So the operator semantics are pinned here, one case per operator per type,
// including the edges that quietly produce wrong rows: blank vs zero, numeric
// vs lexical comparison, case-insensitivity, and multi-value OR.
//
// matchFilter lives in ListView.jsx (a React module Node cannot import), so the
// contract is duplicated here deliberately and asserted to agree with it. If
// the two ever drift, this file is the specification and the drift is the bug.
//
// Run with: node scripts/list-filter-matching-fixture.mjs

import { readFileSync } from 'node:fs'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { failures += 1; console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`) }
}

// ── Extract matchFilter from the component and evaluate it in isolation ─────
// Reading the real source keeps this honest: it tests the shipped function, not
// a copy of it that can rot.
const src = readFileSync(new URL('../src/components/ListView.jsx', import.meta.url), 'utf8')
const start = src.indexOf('function matchFilter(')
if (start < 0) { console.error('FAIL  matchFilter not found in ListView.jsx'); process.exit(1) }
// Walk braces to the end of the function.
let depth = 0, i = src.indexOf('{', start), end = -1
for (; i < src.length; i++) {
  if (src[i] === '{') depth++
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
}
const body = src.slice(start, end)
const BLANK_FILTER_VALUE = '__BLANK__'
// eslint-disable-next-line no-new-func
const matchFilter = new Function('BLANK_FILTER_VALUE', `${body}; return matchFilter;`)(BLANK_FILTER_VALUE)

const m = (value, op, target) => matchFilter(value, { op, value: target })

// ── Text ───────────────────────────────────────────────────────────────────
check('contains matches a substring', m('Lutheran Social Services', 'contains', 'social'), true)
check('contains is case-insensitive', m('LUTHERAN', 'contains', 'lutheran'), true)
check('contains rejects a non-substring', m('Gorman & Company', 'contains', 'Lutheran'), false)
check('does not contain is the inverse', m('Gorman & Company', 'not_contains', 'Lutheran'), true)
check('equals is exact, not a substring', m('Lutheran Social Services', 'equals', 'Lutheran'), false)
check('equals matches exactly', m('WI', 'equals', 'WI'), true)
check('does not equal', m('WI', 'not_equals', 'NC'), true)
check('starts with', m('Lutheran Social Services', 'starts_with', 'luth'), true)
check('starts with rejects a middle match', m('The Lutheran Home', 'starts_with', 'luth'), false)
check('ends with', m('Grace Lutheran Foundation, Inc.', 'ends_with', 'inc.'), true)

// ── Blanks — the edge that silently empties a list ──────────────────────────
check('is blank on empty string', m('', 'is_blank', null), true)
check('is blank on null', m(null, 'is_blank', null), true)
check('is blank on undefined (an unresolved related field)', m(undefined, 'is_blank', null), true)
check('is blank on whitespace only', m('   ', 'is_blank', null), true)
check('is blank is false for a value', m('WI', 'is_blank', null), false)
check('is not blank', m('WI', 'is_not_blank', null), true)
check('is not blank is false for empty', m('', 'is_not_blank', null), false)
check('ZERO is not blank', m(0, 'is_not_blank', null), true)
check('the string "0" is not blank', m('0', 'is_blank', null), false)
check('false is not blank', m(false, 'is_not_blank', null), true)

// A missing value must never match a positive text test — this is what makes a
// filter on a dropped field return nothing instead of everything.
check('contains on a missing value does not match', m(undefined, 'contains', 'Lutheran'), false)
check('starts with on a missing value does not match', m(undefined, 'starts_with', 'L'), false)

// ── Multi-value (the pick-from-a-list pair) ────────────────────────────────
check('equals with several values ORs them', m('NC', 'equals', ['WI', 'NC']), true)
check('equals with several values rejects an outsider', m('CO', 'equals', ['WI', 'NC']), false)
check('does not equal with several values', m('CO', 'not_equals', ['WI', 'NC']), true)
check('does not equal rejects a member', m('WI', 'not_equals', ['WI', 'NC']), false)
check('the blank sentinel matches a blank cell', m('', 'equals', [BLANK_FILTER_VALUE]), true)
check('the blank sentinel does not match a value', m('WI', 'equals', [BLANK_FILTER_VALUE]), false)

// ── Numbers — numeric, not lexical ─────────────────────────────────────────
check('9 is greater than 10 LEXICALLY but must not be', m(9, 'gt', 10), false)
check('100 is greater than 20', m(100, 'gt', 20), true)
check('greater than or equal, at the boundary', m(20, 'gte', 20), true)
check('less than', m(5, 'lt', 20), true)
check('less than or equal, at the boundary', m(20, 'lte', 20), true)
check('between is inclusive of both bounds', m(20, 'between', [20, 30]), true)
check('between excludes below', m(19, 'between', [20, 30]), false)
check('between excludes above', m(31, 'between', [20, 30]), false)
check('a blank number is not greater than anything', m('', 'gt', 0), false)
check('a blank number is not in a range', m('', 'between', [0, 10]), false)
check('zero compares as a number, not as blank', m(0, 'lt', 1), true)

// ── Dates — ISO strings compare correctly as strings ───────────────────────
check('on or after, at the boundary', m('2026-08-25', 'from', '2026-08-25'), true)
check('on or after, later', m('2026-09-01', 'from', '2026-08-25'), true)
check('on or after rejects earlier', m('2026-08-01', 'from', '2026-08-25'), false)
check('on or before, at the boundary', m('2026-08-25', 'to', '2026-08-25'), true)
check('after is strict', m('2026-08-25', 'gt', '2026-08-25'), false)
check('before is strict', m('2026-08-25', 'lt', '2026-08-25'), false)
check('date between is inclusive', m('2026-08-25', 'between', ['2026-08-01', '2026-08-31']), true)
check('a blank date matches no range', m(null, 'between', ['2026-08-01', '2026-08-31']), false)

// ── An unknown operator must not silently drop records ─────────────────────
check('an unrecognised operator keeps the record rather than hiding it',
  m('anything', 'no_such_operator', 'x'), true)

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) { console.error(`${failures} failing`); process.exit(1) }
