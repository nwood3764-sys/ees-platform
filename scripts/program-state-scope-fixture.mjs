// Fixture test for state-scoped record types.
//
// The rule: a record type scoped to a state is offered only on records in that
// state; a nationwide record type is offered everywhere; and an UNKNOWN state
// narrows to the nationwide types and asks the user, rather than widening to
// every program in the platform. Run with:
//   node scripts/program-state-scope-fixture.mjs
//
// Cases are drawn from the live opportunity record types and from the failure
// Nicholas hit on 2026-08-23: BLD-00153 in Rocky Mount, North Carolina offering
// FOE-2024-WI and the whole Michigan set.

import {
  scopedToState, statesInRecordTypes, needsStateChoice,
  programStateFromSeed, normalizeStateCode,
} from '../src/lib/programStateScope.js'

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

const rt = (label, state) => ({ id: label, value: label, label, state })

// The live opportunity record types after the 2026-08-23 retirement.
const OPPORTUNITY_TYPES = [
  rt('Field Operations', null),
  rt('FOE-2024-WI', 'WI'), rt('FOE-2025-WI', 'WI'), rt('FOE-2026-WI', 'WI'),
  rt('MI-IRA-MF-HEAR', 'MI'), rt('MI-IRA-MF-HOMES', 'MI'), rt('MI-IRA-MF-HOMES-AUDIT', 'MI'),
  rt('NC-IRA-MF-HEAR', 'NC'), rt('NC-IRA-MF-HOMES', 'NC'), rt('NC-IRA-MF-HOMES-AUDIT', 'NC'),
  rt('NC-IRA-SF-HEAR', 'NC'), rt('NC-IRA-SF-HOMES', 'NC'), rt('NC-IRA-SF-HOMES-AUDIT', 'NC'),
  rt('WI-IRA-MF-HOMES', 'WI'), rt('WI-IRA-SF-HOMES', 'WI'),
]
const labels = list => list.map(r => r.label)

// ── Scoping ─────────────────────────────────────────────────────────────────
check('NC offers its own programs plus the nationwide type',
  labels(scopedToState(OPPORTUNITY_TYPES, 'NC')),
  ['Field Operations', 'NC-IRA-MF-HEAR', 'NC-IRA-MF-HOMES', 'NC-IRA-MF-HOMES-AUDIT',
   'NC-IRA-SF-HEAR', 'NC-IRA-SF-HOMES', 'NC-IRA-SF-HOMES-AUDIT'])
check('NC never offers a Wisconsin program',
  labels(scopedToState(OPPORTUNITY_TYPES, 'NC')).filter(l => l.includes('WI')), [])
check('NC never offers a Michigan program',
  labels(scopedToState(OPPORTUNITY_TYPES, 'NC')).filter(l => l.startsWith('MI-')), [])
check('a state with no programs still offers the nationwide type',
  labels(scopedToState(OPPORTUNITY_TYPES, 'TX')), ['Field Operations'])
check('lower-case state codes still match',
  labels(scopedToState(OPPORTUNITY_TYPES, 'nc')).length, 7)
check('an unknown state narrows to nationwide, never to everything',
  labels(scopedToState(OPPORTUNITY_TYPES, null)), ['Field Operations'])
check('a blank state narrows to nationwide',
  labels(scopedToState(OPPORTUNITY_TYPES, '   ')), ['Field Operations'])
check('an empty record-type list stays empty', scopedToState([], 'NC'), [])
check('a null record-type list is tolerated', scopedToState(null, 'NC'), [])

// ── Which states are configured ─────────────────────────────────────────────
check('states are read off the record types, sorted',
  statesInRecordTypes(OPPORTUNITY_TYPES), ['MI', 'NC', 'WI'])
check('nationwide-only object has no states',
  statesInRecordTypes([rt('Standard', null), rt('Other', null)]), [])

// ── When to ask the user ────────────────────────────────────────────────────
check('a record that knows its state is never asked',
  needsStateChoice('NC', OPPORTUNITY_TYPES), false)
check('a record with no state IS asked when programs span states',
  needsStateChoice(null, OPPORTUNITY_TYPES), true)
check('a blank state is treated as unknown',
  needsStateChoice('  ', OPPORTUNITY_TYPES), true)
check('an object with only nationwide types never asks',
  needsStateChoice(null, [rt('Standard', null), rt('Other', null)]), false)
check('an object with a single state never asks',
  needsStateChoice(null, [rt('Standard', null), rt('WI-IRA-MF-HOMES', 'WI')]), false)

// ── The seed fallback ───────────────────────────────────────────────────────
check('reads a state column off the seed',
  programStateFromSeed({ property_id: 'x', building_state: 'NC' }), 'NC')
check('a blank state column is not a state',
  programStateFromSeed({ building_state: '   ' }), null)
check('a null state column is not a state',
  programStateFromSeed({ building_state: null, property_id: 'x' }), null)
check('a seed with no state column resolves to unknown',
  programStateFromSeed({ property_id: 'x', building_id: 'y' }), null)
check('a non-object seed resolves to unknown', programStateFromSeed(null), null)
check('a stage column is not a state column',
  programStateFromSeed({ opportunity_stage: 'NC HOMES Phase 1' }), null)

// ── Normalization ───────────────────────────────────────────────────────────
check('codes are upper-cased and trimmed', normalizeStateCode(' nc '), 'NC')
check('a non-string is not a code', normalizeStateCode(42), null)

console.log(failures === 0
  ? `program-state-scope fixture: ${checks} checks passed`
  : `program-state-scope fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
