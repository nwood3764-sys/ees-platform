// Pins src/lib/picklistStateScope.js — the rule that decides which values a
// state-scoped picklist offers. The dangerous cases are the ones that must
// NEVER blank a dropdown or silently hand back another state's utility.

import {
  recordStateValue,
  hasStateScopedValues,
  scopePicklistOptionsToState,
} from '../src/lib/picklistStateScope.js'

let checks = 0
let failures = 0

function check(name, actual, expected) {
  checks++
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures++
    console.error(`  FAIL ${name}\n    expected ${e}\n    actual   ${a}`)
  }
}

const opt = (label, state = null) => ({ id: label, value: label, label, state, sortOrder: 0 })
const labels = (list) => list.map(o => o.label)

// --- a value set with no states is left completely alone -------------------
// Every picklist that exists today is this case, so the mechanism must be a
// no-op for them whatever state is passed.
const plain = [opt('Natural Gas'), opt('Electric'), opt('Other')]
check('plain set, known state', labels(scopePicklistOptionsToState(plain, 'WI')), ['Natural Gas', 'Electric', 'Other'])
check('plain set, unknown state', labels(scopePicklistOptionsToState(plain, null)), ['Natural Gas', 'Electric', 'Other'])
check('plain set returns the same array', scopePicklistOptionsToState(plain, 'WI') === plain, true)
check('plain set is not state-scoped', hasStateScopedValues(plain), false)

// --- the real shape: utilities in five states plus two stateless escapes ---
const utilities = [
  opt('We Energies', 'WI'),
  opt('Madison Gas and Electric', 'WI'),
  opt('Xcel Energy', 'WI'),
  opt('Duke Energy Carolinas', 'NC'),
  opt('Piedmont Natural Gas', 'NC'),
  opt('Xcel Energy', 'CO'),
  opt('None - Building Has No Natural Gas Service'),
  opt('Other'),
]
check('utilities are state-scoped', hasStateScopedValues(utilities), true)

check('WI building sees WI utilities plus the stateless ones',
  labels(scopePicklistOptionsToState(utilities, 'WI')),
  ['We Energies', 'Madison Gas and Electric', 'Xcel Energy',
   'None - Building Has No Natural Gas Service', 'Other'])

check('NC building never sees a Wisconsin utility',
  labels(scopePicklistOptionsToState(utilities, 'NC')),
  ['Duke Energy Carolinas', 'Piedmont Natural Gas',
   'None - Building Has No Natural Gas Service', 'Other'])

check('a narrowed label is not decorated with its own state',
  scopePicklistOptionsToState(utilities, 'CO').map(o => o.label),
  ['Xcel Energy', 'None - Building Has No Natural Gas Service', 'Other'])

// --- state unknown: 38 of 101 buildings. Show everything, disambiguated. ----
const unknown = scopePicklistOptionsToState(utilities, null)
check('unknown state offers every value', unknown.length, 8)
check('unknown state labels the stated values so duplicates are distinguishable',
  labels(unknown),
  ['We Energies (WI)', 'Madison Gas and Electric (WI)', 'Xcel Energy (WI)',
   'Duke Energy Carolinas (NC)', 'Piedmont Natural Gas (NC)', 'Xcel Energy (CO)',
   'None - Building Has No Natural Gas Service', 'Other'])
check('unknown state leaves the stored value alone', unknown[0].value, 'We Energies')
check('blank string is an unknown state', labels(scopePicklistOptionsToState(utilities, '   ')).length, 8)

// --- a state nobody seeded must not produce an empty dropdown --------------
// One live building is in IA. Narrowing there yields only the two stateless
// values; a set with NO stateless members must fall back to the whole list.
const noEscapes = utilities.filter(o => o.state)
check('unseeded state falls back to the full labelled list rather than blanking',
  labels(scopePicklistOptionsToState(noEscapes, 'IA')),
  ['We Energies (WI)', 'Madison Gas and Electric (WI)', 'Xcel Energy (WI)',
   'Duke Energy Carolinas (NC)', 'Piedmont Natural Gas (NC)', 'Xcel Energy (CO)'])
check('unseeded state still keeps the stateless values when there are any',
  labels(scopePicklistOptionsToState(utilities, 'IA')),
  ['None - Building Has No Natural Gas Service', 'Other'])

// --- input robustness -------------------------------------------------------
check('lower-case record state matches', labels(scopePicklistOptionsToState(utilities, 'nc')).length, 4)
check('padded value state matches', labels(scopePicklistOptionsToState([opt('X', ' wi ')], 'WI')), ['X'])
check('null options', scopePicklistOptionsToState(null, 'WI'), [])
check('undefined options', scopePicklistOptionsToState(undefined, null), [])
check('hasStateScopedValues on a non-array', hasStateScopedValues(null), false)

// --- recordStateValue -------------------------------------------------------
check('prefixed state column', recordStateValue({ building_state: 'WI' }, 'building'), 'WI')
check('bare state column', recordStateValue({ state: 'nc' }, 'building'), 'NC')
check('prefixed wins over bare', recordStateValue({ building_state: 'WI', state: 'NC' }, 'building'), 'WI')
check('blank prefixed falls through to bare', recordStateValue({ building_state: '', state: 'MI' }, 'building'), 'MI')
check('no state column', recordStateValue({ building_name: '1837' }, 'building'), null)
check('null record', recordStateValue(null, 'building'), null)
check('no prefix given still reads the bare column', recordStateValue({ state: 'CO' }, null), 'CO')

if (failures > 0) {
  console.error(`picklist-state-scope-fixture: ${failures} of ${checks} checks FAILED`)
  process.exit(1)
}
console.log(`picklist-state-scope-fixture: ${checks} checks passed`)
