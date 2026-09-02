// Fixture test for whether a picklist value may belong to more than one record
// type, and therefore whether Object Manager should offer it.
//
// The gap this covers (Nicholas, 2026-09-02): configuring enrollment_status on
// WI-IRA-MF-HOMES-Project-Reservation was impossible. Available Values showed
// 0 with "Every value is in Selected", Selected showed empty, and there was
// nothing to drag. The editor hid every value already assigned to another
// record type -- correct for opportunity stages, which are never shared, and
// fatal for a shared lifecycle whose eight values already served seven record
// types.
//
// The positive control below is the real opportunity-stage shape: that case
// MUST still hide, or the rule has been loosened into uselessness.
//
// Run with:  node scripts/picklist-value-sharing-fixture.mjs

import {
  fieldValuesAreShared,
  valuesScopedElsewhere,
  availableEmptyMessage,
} from '../src/lib/picklistValueSharing.js'

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
const sorted = set => [...set].sort()

// ── The real enrollment_status shape: 8 values across 7 record types ────────
const ENROLLMENT_STATUS = {}
const STATUSES = ['prepared', 'to-verify', 'verified', 'submitted',
                  'approved', 'corrections', 'denied', 'withdrawn']
for (const rt of ['MI-MF', 'MI-SF', 'NC-MF', 'NC-SF', 'WI-MF', 'WI-SF', 'WI-PREAPP'])
  ENROLLMENT_STATUS[rt] = new Set(STATUSES)

check('a lifecycle serving many record types is shared',
  fieldValuesAreShared(ENROLLMENT_STATUS), true)
// The defect itself: an unconfigured record type must be offered every value.
check('...so nothing is hidden from an unconfigured record type',
  sorted(valuesScopedElsewhere(ENROLLMENT_STATUS, 'WI-RESERVATION')), [])
check('...nor from one already in the set',
  sorted(valuesScopedElsewhere(ENROLLMENT_STATUS, 'WI-MF')), [])

// ── POSITIVE CONTROL: opportunity stages are 1:1 and must still hide ────────
// LEAP's hard rule -- every opportunity record type has its own never-shared
// stage picklist. If this stops hiding, the fix has broken the case the
// original rule existed for.
const OPPORTUNITY_STAGES = {
  'WI-HOMES': new Set(['wi-1', 'wi-2', 'wi-3']),
  'NC-HOMES': new Set(['nc-1', 'nc-2']),
  'WI-FOE':   new Set(['foe-1']),
}
check('never-shared stages are exclusive', fieldValuesAreShared(OPPORTUNITY_STAGES), false)
check('...and another record type’s stages are hidden',
  sorted(valuesScopedElsewhere(OPPORTUNITY_STAGES, 'WI-HOMES')), ['foe-1', 'nc-1', 'nc-2'])
check('...the active record type’s own stages are never hidden',
  [...valuesScopedElsewhere(OPPORTUNITY_STAGES, 'WI-HOMES')].some(v => v.startsWith('wi-')), false)
check('...and a record type with no stages yet sees all of them hidden',
  sorted(valuesScopedElsewhere(OPPORTUNITY_STAGES, 'MI-HOMES')),
  ['foe-1', 'nc-1', 'nc-2', 'wi-1', 'wi-2', 'wi-3'])

// One value shared by exactly two record types is enough to make a field
// shared -- sharing is not a majority vote.
check('a single shared value makes the whole field shared',
  fieldValuesAreShared({ a: new Set(['x', 'y']), b: new Set(['y']) }), true)
check('...and then nothing is hidden',
  sorted(valuesScopedElsewhere({ a: new Set(['x', 'y']), b: new Set(['y']) }, 'c')), [])

// ── Degenerate shapes: a screen must never crash on them ───────────────────
check('no assignments at all is exclusive (nothing to hide anyway)',
  fieldValuesAreShared({}), false)
check('...and hides nothing', sorted(valuesScopedElsewhere({}, 'rt')), [])
check('null is survived', fieldValuesAreShared(null), false)
check('null hides nothing', sorted(valuesScopedElsewhere(null, 'rt')), [])
check('a record type with an empty set is survived',
  fieldValuesAreShared({ a: new Set(), b: new Set() }), false)
// Arrays, not Sets — the editor holds Sets, but a caller may hand over arrays.
check('arrays work as well as Sets',
  fieldValuesAreShared({ a: ['x'], b: ['x'] }), true)
check('one record type holding one value is exclusive',
  fieldValuesAreShared({ a: new Set(['x']) }), false)

// ── The empty-state message ───────────────────────────────────────────────
// The old text said "Every value is in Selected" while Selected was ALSO
// empty. Two panes each blaming the other is how a broken screen reads as a
// deliberate configuration choice.
check('searching says so',
  availableEmptyMessage({ searching: true, selectedCount: 0, totalActiveValues: 8 }),
  'No matches.')
check('a field with no values says to create one',
  availableEmptyMessage({ searching: false, selectedCount: 0, totalActiveValues: 0 }),
  'This field has no active values yet. Use + New Value to add one.')
check('genuinely all-selected says so',
  availableEmptyMessage({ searching: false, selectedCount: 8, totalActiveValues: 8 }),
  'Every value is in Selected.')
check('the defect case no longer lies about being all-selected',
  availableEmptyMessage({ searching: false, selectedCount: 0, totalActiveValues: 8 }),
  'No values available to add. Other record types have claimed them because this field’s values are not shared.')

if (failures > 0) {
  console.error(`\npicklist-value-sharing fixture: ${failures} of ${checks} checks FAILED`)
  process.exit(1)
}
console.log(`picklist-value-sharing fixture: ${checks} checks passed`)
