// Geographic (state) record access — pure-logic fixture.
//
// The rule that actually governs access lives in the database (a RESTRICTIVE
// policy per object, generated from record_state_scope_sources). What is
// tested here is how the CLIENT reads a set of grants, where one mistake is
// genuinely dangerous:
//
//   an empty grant list means UNRESTRICTED, not "no access".
//
// Every existing LEAP user holds zero grants. If this module ever reported
// that as "no states" or as a restriction, the Users list would tell an
// administrator that the whole company is locked down when nothing changed —
// or worse, invite them to "fix" it by granting a state, which would silently
// restrict a user who previously saw everything.

import {
  normalizeStateCode,
  isStateScoped,
  describeStateAccess,
} from '../src/lib/stateScope.js'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures += 1
    console.error(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

// ─── normalizeStateCode ────────────────────────────────────────────────────
check('plain code', normalizeStateCode('NC'), 'NC')
check('lowercase is corrected', normalizeStateCode('nc'), 'NC')
check('surrounding space is trimmed', normalizeStateCode('  wi '), 'WI')
check('mixed case', normalizeStateCode('Mi'), 'MI')

// Anything that is not exactly two letters is rejected rather than guessed at.
check('full state name rejected', normalizeStateCode('North Carolina'), null)
check('punctuated form rejected', normalizeStateCode('N.C.'), null)
check('one letter rejected', normalizeStateCode('N'), null)
check('three letters rejected', normalizeStateCode('NCX'), null)
check('digits rejected', normalizeStateCode('37'), null)
check('empty string rejected', normalizeStateCode(''), null)
check('null rejected', normalizeStateCode(null), null)
check('undefined rejected', normalizeStateCode(undefined), null)
check('whitespace only rejected', normalizeStateCode('   '), null)

// ─── isStateScoped — the dangerous one ─────────────────────────────────────
check('no grants is NOT scoped', isStateScoped([]), false)
check('undefined is NOT scoped', isStateScoped(undefined), false)
check('null is NOT scoped', isStateScoped(null), false)
check('not-yet-loaded is NOT scoped', isStateScoped(), false)
check('one grant is scoped', isStateScoped([{ uss_state_code: 'NC' }]), true)
check('two grants are scoped', isStateScoped([{ uss_state_code: 'NC' }, { uss_state_code: 'WI' }]), true)

// ─── describeStateAccess ───────────────────────────────────────────────────
check('no grants reads as All states', describeStateAccess([]), 'All states')
check('undefined reads as All states', describeStateAccess(undefined), 'All states')
check('single grant', describeStateAccess([{ uss_state_code: 'NC' }]), 'NC')
check('several grants are sorted',
  describeStateAccess([{ uss_state_code: 'WI' }, { uss_state_code: 'NC' }, { uss_state_code: 'MI' }]),
  'MI, NC, WI')
check('accepts bare strings too', describeStateAccess(['nc', 'WI']), 'NC, WI')
check('a malformed grant is dropped, not rendered',
  describeStateAccess([{ uss_state_code: 'NC' }, { uss_state_code: 'bogus' }]), 'NC')
check('a row missing its code is dropped',
  describeStateAccess([{ uss_state_code: 'NC' }, {}]), 'NC')

if (failures) {
  console.error(`state-scope fixture: ${failures} of ${checks} checks FAILED`)
  process.exit(1)
}
console.log(`state-scope fixture: ${checks} checks passed`)
