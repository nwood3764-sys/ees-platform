// dashboard-filter-fields fixture — one filter, the right column per object.
//
// A dashboard filter used to carry ONE column name, and a widget whose object
// lacked that column was silently skipped: State = NC filtered the property
// widgets and left the opportunity widgets showing every state, side by side,
// with nothing saying so. These are the rules that stop that.

import {
  filterColumnForObject, fieldMeaning, proposeEquivalentColumn, filterCoverage, buildFieldMap,
} from '../src/lib/dashboardFilterFields.js'

let pass = 0, fail = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else { fail++; console.error(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`) }
}
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error(`  ✗ ${name}`) } }

const stateFilter = {
  field_name: 'property_state',
  field_map: { opportunities: 'opportunity_state', enrollments: 'enrollment_state' },
}

// ── Which column a widget uses ────────────────────────────────────────────
check('the mapped column wins on a mapped object',
  filterColumnForObject(stateFilter, 'opportunities'), 'opportunity_state')
check('an unmapped object falls back to the filter\'s own field',
  filterColumnForObject(stateFilter, 'properties'), 'property_state')
check('an object nobody mapped still falls back rather than returning nothing',
  filterColumnForObject(stateFilter, 'work_orders'), 'property_state')
check('the DB spellings work too',
  filterColumnForObject({ dfilt_field_name: 'x', dfilt_field_map: { a: 'y' } }, 'a'), 'y')
ok('no filter, no column', filterColumnForObject(null, 'properties') === null)

// ── Meaning, stripped of the object's prefix ──────────────────────────────
check('a property column means its suffix', fieldMeaning('property_state', 'properties'), 'state')
check('an opportunity column likewise', fieldMeaning('opportunity_state', 'opportunities'), 'state')
check('an initials prefix is understood', fieldMeaning('ia_status', 'incentive_applications'), 'status')
check('an unprefixed column means itself', fieldMeaning('state', 'properties'), 'state')
// The trap: stripping at the first underscore would make this 'territory_id'
// and propose a column that means something else entirely.
check('a prefix that is not the object\'s is left alone',
  fieldMeaning('service_territory_id', 'opportunities'), 'service_territory_id')

// ── Proposing the equivalent ──────────────────────────────────────────────
check('same meaning under the target\'s own prefix',
  proposeEquivalentColumn('property_state', 'properties', 'opportunities',
    ['id', 'opportunity_state', 'opportunity_name']), 'opportunity_state')
check('a shared column name is taken as-is',
  proposeEquivalentColumn('state', 'properties', 'opportunities', ['id', 'state']), 'state')
check('an unprefixed equivalent is found',
  proposeEquivalentColumn('property_state', 'properties', 'sites', ['id', 'state']), 'state')
ok('no equivalent proposes NOTHING rather than a column that does not exist',
  proposeEquivalentColumn('property_state', 'properties', 'vehicles', ['id', 'vehicle_name']) === null)
ok('a proposal is never a column absent from the target',
  proposeEquivalentColumn('property_hud_id', 'properties', 'opportunities', ['id', 'opportunity_state']) === null)

// ── Coverage: what the editor must be able to SAY ─────────────────────────
{
  const objects = [
    { table: 'properties',    columns: ['id', 'property_state'] },
    { table: 'opportunities', columns: ['id', 'opportunity_state'] },
    { table: 'work_orders',   columns: ['id', 'wo_status'] },
  ]
  const { covered, uncovered } = filterCoverage(stateFilter, objects)
  check('covered objects name the column each will filter on', covered,
    [{ table: 'properties', column: 'property_state' },
     { table: 'opportunities', column: 'opportunity_state' }])
  check('an object with no such column is reported, not silently skipped', uncovered, ['work_orders'])
}
{
  // The old behaviour, stated as a test: without a map, everything but the
  // source object is uncovered.
  const objects = [
    { table: 'properties',    columns: ['id', 'property_state'] },
    { table: 'opportunities', columns: ['id', 'opportunity_state'] },
  ]
  const { uncovered } = filterCoverage({ field_name: 'property_state' }, objects)
  check('an unmapped filter reaches only its own object', uncovered, ['opportunities'])
}

// ── Building the map ──────────────────────────────────────────────────────
{
  const objects = [
    { table: 'properties',    columns: ['id', 'property_state'] },
    { table: 'opportunities', columns: ['id', 'opportunity_state'] },
    { table: 'enrollments',   columns: ['id', 'enrollment_state'] },
    { table: 'vehicles',      columns: ['id', 'vehicle_name'] },
  ]
  const map = buildFieldMap('property_state', 'properties', objects)
  check('every object with an equivalent is mapped', map,
    { opportunities: 'opportunity_state', enrollments: 'enrollment_state' })
  ok('the source object is not mapped to itself', !('properties' in map))
  ok('an object with no equivalent is left out entirely', !('vehicles' in map))
}
check('no objects, no map', buildFieldMap('property_state', 'properties', []), {})

console.log(`dashboard-filter-fields fixture: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
