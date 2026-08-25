// Record-type seeding — pure-logic fixture.
//
// What is pinned here is the mistake that shipped a portal user nobody could
// let in: the create form seeded the picked record type's UUID into
// portal_users.record_type, which is a TEXT column holding the picklist VALUE.
// The record saved cleanly and then failed every gate that reads it — the three
// portal RPCs, program-portal-file, and the Manage Shared Records action all
// compare record_type to 'Program Manager User'.
//
// The rule is: seed what the COLUMN can hold, decided from the column's own
// data type. Never from a list of table exceptions.

import { recordTypeSeedValue, recordTypeColumnStoresValue } from '../src/lib/recordTypeSeed.js'

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

const PROGRAM_MANAGER = {
  id: '11111111-2222-4333-8444-555555555555',
  value: 'Program Manager User',
  label: 'Program Manager User',
}
const MF_ASSESSMENT = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  value: 'MULTIFAMILY-ENERGY-ASSESSMENT',
  label: 'Multifamily Energy Assessment',
}

// ─── uuid columns: the platform convention ─────────────────────────────────
check('a uuid column takes the id', recordTypeSeedValue(MF_ASSESSMENT, 'uuid'), MF_ASSESSMENT.id)
check('data type case does not matter', recordTypeSeedValue(MF_ASSESSMENT, 'UUID'), MF_ASSESSMENT.id)
check('an unknown data type is treated as uuid — the convention',
  recordTypeSeedValue(MF_ASSESSMENT, null), MF_ASSESSMENT.id)
check('an undeclared data type is treated as uuid',
  recordTypeSeedValue(MF_ASSESSMENT, undefined), MF_ASSESSMENT.id)

// ─── text columns: portal_users.record_type ────────────────────────────────
// The whole point. A uuid here is a portal user no portal recognises.
check('a text column takes the picklist value',
  recordTypeSeedValue(PROGRAM_MANAGER, 'text'), 'Program Manager User')
check('the value is never the id on a text column',
  recordTypeSeedValue(PROGRAM_MANAGER, 'text') === PROGRAM_MANAGER.id, false)
check('character varying is a text column too',
  recordTypeSeedValue(PROGRAM_MANAGER, 'character varying'), 'Program Manager User')
check('the picklist_value spelling is accepted',
  recordTypeSeedValue({ id: 'x', picklist_value: 'Provider User' }, 'text'), 'Provider User')
check('label is the last resort, never the id',
  recordTypeSeedValue({ id: 'x', label: 'Property Owner User' }, 'text'), 'Property Owner User')

// ─── nothing to seed ───────────────────────────────────────────────────────
check('no record type seeds nothing', recordTypeSeedValue(null, 'uuid'), null)
check('no record type seeds nothing on text either', recordTypeSeedValue(null, 'text'), null)
check('the picker having decided no pick is needed seeds nothing',
  recordTypeSeedValue(false, 'uuid'), null)
check('a record type with no id on a uuid column seeds nothing rather than a label',
  recordTypeSeedValue({ value: 'Program Manager User' }, 'uuid'), null)

// ─── recordTypeColumnStoresValue ───────────────────────────────────────────
check('uuid stores the id', recordTypeColumnStoresValue('uuid'), false)
check('text stores the value', recordTypeColumnStoresValue('text'), true)
check('unknown falls back to the convention', recordTypeColumnStoresValue(null), false)

if (failures) {
  console.error(`record-type-seed fixture: ${failures} of ${checks} checks FAILED`)
  process.exit(1)
}
console.log(`record-type-seed fixture: ${checks} checks passed`)
