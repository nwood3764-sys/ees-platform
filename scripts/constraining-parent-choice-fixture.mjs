// Pins the rule that closed 2026-08-29: a create launched from a building that
// runs more than one program must ASK which program it belongs to, never guess.
// The guess was not a harmless default — the guessed opportunity narrowed the
// record-type picker to that one program, so the other program's application
// form was unreachable from the building.

import {
  resolveParentChoice, sortParentOptions, parentChoiceOutstanding, describeParentOption,
} from '../src/lib/constrainingParentChoice.js'

let checks = 0, failures = 0
const ok = (label, cond) => {
  checks += 1
  if (!cond) { failures += 1; console.error(`  FAIL  ${label}`) }
}
const eq = (label, actual, expected) => ok(`${label} (got ${JSON.stringify(actual)})`,
  JSON.stringify(actual) === JSON.stringify(expected))

// The real case: BLD-00075 "1837 Alden Road - Janesville" runs both
// WI-IRA-MF-HOMES (OPP-00066) and WI-IRA-MF-HOMES-AUDIT (OPP-00067), created in
// one transaction so their timestamps tie.
const HOMES = {
  id: '00000000-0000-4000-8000-000000000066',
  label: '1837 Alden Road - Janesville - 1837 - WI-IRA-MF-HOMES',
  recordTypeId: 'rt-homes', recordTypeLabel: 'WI-IRA-MF-HOMES',
}
const AUDIT = {
  id: '00000000-0000-4000-8000-000000000067',
  label: '1837 Alden Road - Janesville - 1837 - WI-IRA-MF-HOMES-AUDIT',
  recordTypeId: 'rt-audit', recordTypeLabel: 'WI-IRA-MF-HOMES-AUDIT',
}

// --- The defect itself -------------------------------------------------------
{
  const r = resolveParentChoice({ seededId: null, candidates: [HOMES, AUDIT] })
  ok('two opportunities on the building => the picker asks', r.needsChoice === true)
  ok('two opportunities => nothing is auto-derived', r.autoId === null)
  eq('both are offered', r.options.map(o => o.recordTypeLabel),
    ['WI-IRA-MF-HOMES', 'WI-IRA-MF-HOMES-AUDIT'])
}

// --- Created FROM the opportunity: settled, never asked -----------------------
{
  const r = resolveParentChoice({ seededId: AUDIT.id, candidates: [HOMES, AUDIT] })
  ok('an opportunity carried by the create is not a question', r.needsChoice === false)
  eq('and it is the one used', r.seededId, AUDIT.id)
  eq('no options are offered', r.options, [])
}

// --- One program on the building: derived, not asked -------------------------
{
  const r = resolveParentChoice({ seededId: null, candidates: [AUDIT] })
  ok('a lone opportunity is derived', r.needsChoice === false)
  eq('and seeded', r.autoId, AUDIT.id)
}

// --- No opportunity at all: still not a question -----------------------------
{
  const r = resolveParentChoice({ seededId: null, candidates: [] })
  ok('no candidates is not a choice', r.needsChoice === false)
  ok('no candidates derives nothing', r.autoId === null)
  eq('no candidates offers nothing', r.options, [])
}

// --- Defensive: missing / malformed input ------------------------------------
{
  const r = resolveParentChoice()
  ok('no argument is not a choice', r.needsChoice === false)
  const r2 = resolveParentChoice({ candidates: [null, { }, AUDIT] })
  ok('rows with no id are ignored, so one real row derives', r2.autoId === AUDIT.id)
}

// --- Order is stable, because the old bug WAS an unstable order ---------------
{
  const a = sortParentOptions([AUDIT, HOMES]).map(o => o.id)
  const b = sortParentOptions([HOMES, AUDIT]).map(o => o.id)
  eq('sort is independent of input order', a, b)
  const tied = [
    { id: 'b', label: 'Same Name', recordTypeLabel: 'WI-IRA-MF-HOMES' },
    { id: 'a', label: 'Same Name', recordTypeLabel: 'WI-IRA-MF-HOMES' },
  ]
  eq('a full tie still breaks deterministically, by id',
    sortParentOptions(tied).map(o => o.id), ['a', 'b'])
  const noLabel = [{ id: 'z' }, { id: 'a', recordTypeLabel: 'WI-IRA-MF-HOMES' }]
  eq('an unlabelled option sorts last, not first',
    sortParentOptions(noLabel).map(o => o.id), ['a', 'z'])
}

// --- Outstanding-question gate ------------------------------------------------
{
  const asking = { needsChoice: true, options: [HOMES, AUDIT] }
  ok('unanswered => outstanding', parentChoiceOutstanding(asking, null) === true)
  ok('answered => not outstanding', parentChoiceOutstanding(asking, AUDIT.id) === false)
  ok('no question => never outstanding', parentChoiceOutstanding(null, null) === false)
  ok('a resolved (non-asking) choice is not outstanding',
    parentChoiceOutstanding({ needsChoice: false, options: [] }, null) === false)
}

// --- How an option reads in the dropdown ---------------------------------------
{
  eq('the record name already ends with its program, so it is not repeated',
    describeParentOption(AUDIT),
    '1837 Alden Road - Janesville - 1837 - WI-IRA-MF-HOMES-AUDIT')
  eq('a name that does not name the program gets it appended',
    describeParentOption({ id: 'x', label: 'Alden Road', recordTypeLabel: 'WI-IRA-MF-HOMES' }),
    'Alden Road — WI-IRA-MF-HOMES')
  eq('program only', describeParentOption({ id: 'x', recordTypeLabel: 'WI-FOE' }), 'WI-FOE')
  eq('name only', describeParentOption({ id: 'x', label: 'Alden Road' }), 'Alden Road')
  eq('neither falls back to the id — never blank',
    describeParentOption({ id: 'opp-1' }), 'opp-1')
  eq('nothing at all', describeParentOption(null), '')
}

console.log(`constraining-parent-choice: ${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
