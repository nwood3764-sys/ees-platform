// Fixture test for record-type derivation preselection
// (src/lib/recordTypeDerivation.js).
//
// Nicholas, 2026-09-02: "if I'm creating a contact on a property owner, it
// needs to be a property owner contact." The database fills the blank; this is
// the picker showing it. The rule pinned here is what must NOT be preselected:
// a derived type the picker is not actually offering.
//
// Run with: node scripts/record-type-derivation-fixture.mjs

import { derivedSelectableId } from '../src/lib/recordTypeDerivation.js'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { failures += 1; console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`) }
}

const OWNER   = { id: 'rt-owner',   label: 'Property Owner Contact' }
const STD     = { id: 'rt-std',     label: 'Standard Contact' }
const UTILITY = { id: 'rt-utility', label: 'Utility Contact' }
const OFFERED = [OWNER, STD, UTILITY]

// ── The reported case ───────────────────────────────────────────────────────
check('a contact on a Property Owner preselects Property Owner Contact',
  derivedSelectableId(OFFERED, 'rt-owner'), 'rt-owner')
check('a different parent preselects its own type',
  derivedSelectableId(OFFERED, 'rt-utility'), 'rt-utility')

// ── Never preselect something the picker is not offering ────────────────────
// A derivation rule can name a type scoped out by state or constrained away by
// eligibility. Preselecting it would show a choice that cannot be saved.
check('a derived type this picker does not offer preselects nothing',
  derivedSelectableId(OFFERED, 'rt-program'), null)
check('a derived type already TAKEN preselects nothing',
  derivedSelectableId([{ ...OWNER, taken: true }, STD], 'rt-owner'), null)

// ── No rule, no preselection ────────────────────────────────────────────────
for (const [label, arg] of [['null', null], ['undefined', undefined], ['empty string', '']]) {
  check(`no derivation rule (${label}) -> nothing preselected`,
    derivedSelectableId(OFFERED, arg), null)
}

// ── Never throws on junk ────────────────────────────────────────────────────
check('a non-array option list -> null', derivedSelectableId(null, 'rt-owner'), null)
check('an empty option list -> null', derivedSelectableId([], 'rt-owner'), null)
check('null entries in the option list are skipped',
  derivedSelectableId([null, undefined, OWNER], 'rt-owner'), 'rt-owner')

// ── POSITIVE CONTROL ────────────────────────────────────────────────────────
// The pre-fix behaviour: nothing was ever preselected, so the pop-up asked a
// question the platform already knew the answer to.
check('CONTROL: with no derivation the picker preselects nothing',
  derivedSelectableId(OFFERED, null), null)

console.log(`record-type-derivation-fixture: ${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exit(1)
