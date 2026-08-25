// Fixture test for list-view filter logic.
//
// The rule (Nicholas, 2026-08-25): "I need to be able to say, and when I have
// filters, not a combination. I need to have properties owned by Lutheran and
// properties managed by Lutheran." Two filters ANDed answer neither half of
// that question — the list has to be able to say OR.
//
// Run with: node scripts/list-filter-logic-fixture.mjs

import {
  numberFilters, recordMatchesFilters, compileFilterLogic, logicAfterRemoval,
  validateFilterLogic, isMatchAll, MATCH_ALL,
} from '../src/lib/listFilterLogic.js'

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

// ── Numbering: what the user counted is what the expression refers to ───────
{
  const flat = [
    { field: 'state', label: 'State', op: 'equals', value: 'WI' },
    { field: 'state', label: 'State', op: 'equals', value: 'NC' },
    { field: 'owner', label: 'Owner', op: 'contains', value: 'Lutheran' },
  ]
  const entries = numberFilters(flat)
  check('three header rows on two fields are two numbered filters', entries.length, 2)
  check('the multi-select collapses into one entry', entries[0].value, ['WI', 'NC'])
  check('the collapsed entry remembers the rows it stands for', entries[0].rows.length, 2)
  check('the second filter is the one the user would call 2', entries[1].field, 'owner')
}
check('an empty filter set numbers to nothing', numberFilters([]).length, 0)
check('a null filter set is tolerated', numberFilters(null).length, 0)
check('a malformed row without a field is skipped',
  numberFilters([{ op: 'equals', value: 'x' }, { field: 'a', op: 'contains', value: 'y' }]).length, 1)
{
  // Two DIFFERENT operators on the same field stay two filters — they are two
  // constraints the user wrote, and AND-ing them is the old behavior.
  const entries = numberFilters([
    { field: 'name', op: 'contains', value: 'a' },
    { field: 'name', op: 'not_contains', value: 'b' },
  ])
  check('two operators on one field are two numbered filters', entries.length, 2)
}
{
  // Non-adjacent equals rows on one field still collapse — the header dropdown
  // does not guarantee they arrive together once other filters are added.
  const entries = numberFilters([
    { field: 'state', op: 'equals', value: 'WI' },
    { field: 'owner', op: 'contains', value: 'x' },
    { field: 'state', op: 'equals', value: 'NC' },
  ])
  check('separated equals rows on one field still collapse', entries.length, 2)
  check('and keep both values', entries[0].value, ['WI', 'NC'])
}

// ── Match-all is the default and the legacy meaning ─────────────────────────
check('an empty expression means match all', isMatchAll(''), true)
check('"all" means match all', isMatchAll('all'), true)
check('null means match all', isMatchAll(null), true)
check('"1 OR 2" does not mean match all', isMatchAll('1 OR 2'), false)

// ── The question that could not be asked before ─────────────────────────────
{
  // properties owned by Lutheran OR managed by Lutheran, in WI.
  const entries = numberFilters([
    { field: 'state', op: 'equals', value: 'WI' },
    { field: 'owner', op: 'contains', value: 'Lutheran' },
    { field: 'manager', op: 'contains', value: 'Lutheran' },
  ])
  const rows = [
    { state: 'WI', owner: 'Lutheran Social Services', manager: 'Oakbrook Corp' },
    { state: 'WI', owner: 'Gorman & Company',         manager: 'Lutheran Social Services' },
    { state: 'WI', owner: 'Gorman & Company',         manager: 'Oakbrook Corp' },
    { state: 'NC', owner: 'Lutheran Social Services', manager: 'Lutheran Social Services' },
  ]
  const matcher = (row) => (entry) => {
    const v = String(row[entry.field] ?? '')
    if (entry.op === 'equals') return (Array.isArray(entry.value) ? entry.value : [entry.value]).some(x => v === x)
    if (entry.op === 'contains') return v.toLowerCase().includes(String(entry.value).toLowerCase())
    return true
  }
  const run = (logic) => rows.filter(r => recordMatchesFilters(entries, logic, matcher(r))).length

  check('ANDing all three finds only the company that is both', run(MATCH_ALL), 0)
  check('1 AND (2 OR 3) finds owned-or-managed, in WI', run('1 AND (2 OR 3)'), 2)
  // Salesforce parity: an expression that silently ignores a filter the user
  // added is REJECTED, not honored — so "2 OR 3" with three filters is not a
  // way to drop the state filter. The unparseable-expression fallback is
  // match-every-filter, which is the pre-logic behavior, never zero rows.
  check('an expression that ignores filter 1 is rejected, and falls back to AND',
    run('2 OR 3'), 0)
  check('NOT excludes', run('1 AND NOT 2 AND NOT 3'), 1)
}

// ── Compiled form gives the same answers ───────────────────────────────────
{
  const entries = numberFilters([
    { field: 'a', op: 'contains', value: 'x' },
    { field: 'b', op: 'contains', value: 'y' },
  ])
  const row = { a: 'xxx', b: 'zzz' }
  const matchAt = (entry) => String(row[entry.field]).includes(String(entry.value))
  check('compiled: OR matches on the first', compileFilterLogic(entries, '1 OR 2')(matchAt), true)
  check('compiled: AND does not', compileFilterLogic(entries, '1 AND 2')(matchAt), false)
  check('compiled: match-all behaves as AND', compileFilterLogic(entries, MATCH_ALL)(matchAt), false)
  check('compiled: no filters means every record matches',
    compileFilterLogic([], '1 OR 2')(matchAt), true)
}

// ── An unparseable expression must never empty the list ────────────────────
{
  const entries = numberFilters([{ field: 'a', op: 'contains', value: 'x' }])
  const matchAt = () => true
  check('a broken expression falls back to matching all filters, not nothing',
    recordMatchesFilters(entries, '1 OR', matchAt), true)
  check('an expression referencing a filter that is gone falls back too',
    recordMatchesFilters(entries, '1 OR 7', matchAt), true)
}

// ── Removing a filter renumbers the rest ───────────────────────────────────
// Removing 2 from "1 AND (2 OR 3)" leaves "1 AND 2" — which says nothing more
// than match-all, so the sidebar returns to its simple mode rather than showing
// the user an expression they never wrote.
check('removing 2 from "1 AND (2 OR 3)" renumbers and returns to match-all',
  logicAfterRemoval('1 AND (2 OR 3)', 3, 1), MATCH_ALL)
check('removing 3 from "1 AND (2 OR 3)" also returns to match-all',
  logicAfterRemoval('1 AND (2 OR 3)', 3, 2), MATCH_ALL)
check('removing 1 from "1 OR (2 AND 3)" keeps the OR-free remainder plain',
  logicAfterRemoval('1 OR (2 AND 3)', 3, 0), MATCH_ALL)
check('removing 3 from "(1 OR 2) AND 3" keeps the OR',
  logicAfterRemoval('(1 OR 2) AND 3', 3, 2), '1 OR 2')
check('removing the first of "1 OR 2" leaves one filter and no logic to state',
  logicAfterRemoval('1 OR 2', 2, 0), MATCH_ALL)
check('removing from match-all stays match-all',
  logicAfterRemoval(MATCH_ALL, 3, 1), MATCH_ALL)
check('removing the only filter stays match-all',
  logicAfterRemoval('1', 1, 0), MATCH_ALL)
check('a rewrite that lands on a plain AND chain returns to match-all',
  logicAfterRemoval('(1 OR 2) AND 3', 3, 0), MATCH_ALL)

// ── Validation messages ────────────────────────────────────────────────────
check('match-all always validates', validateFilterLogic(MATCH_ALL, 0).ok, true)
check('a reference beyond the filter count is rejected',
  validateFilterLogic('1 AND 4', 2).ok, false)
check('logic that skips a filter is rejected (Salesforce parity)',
  validateFilterLogic('1 AND 2', 3).ok, false)
check('a valid expression passes', validateFilterLogic('1 AND (2 OR 3)', 3).ok, true)
check('the rejection explains itself',
  /doesn't exist/.test(validateFilterLogic('1 AND 4', 2).error || ''), true)

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) { console.error(`${failures} failing`); process.exit(1) }
