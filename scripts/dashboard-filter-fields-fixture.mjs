// dashboard-filter-fields fixture — one filter, the right column per object.
//
// A dashboard filter used to carry ONE column name, and a widget whose object
// lacked that column was silently skipped: State = NC filtered the property
// widgets and left the opportunity widgets showing every state, side by side,
// with nothing saying so. These are the rules that stop that.

import {
  filterColumnForObject, fieldMeaning, proposeEquivalentColumn, filterCoverage, buildFieldMap,
  resolveOverrideColumns, resolveExtraFilters, unappliedFilters,
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

// ── "Not on this object" is a real answer ─────────────────────────────────
{
  // The editor's per-object "not filtered" choice writes an empty entry. It
  // must not fall back to the filter's own column: an object that happens to
  // spell the column the same way would get filtered after someone explicitly
  // said not to.
  const f = { field_name: 'state', field_map: { properties: 'property_state', work_orders: null } }
  check('an explicitly excluded object resolves to nothing', filterColumnForObject(f, 'work_orders'), null)
  check('an empty string is excluded too',
    filterColumnForObject({ field_name: 'state', field_map: { work_orders: '' } }, 'work_orders'), null)
  check('an object the map never mentions still falls back',
    filterColumnForObject(f, 'opportunities'), 'state')
  check('a mapped object uses its own column', filterColumnForObject(f, 'properties'), 'property_state')
  const cov = filterCoverage(f, [
    { table: 'properties',  columns: ['property_state'] },
    { table: 'work_orders', columns: ['state'] },
  ])
  check('coverage reports an excluded object as uncovered', cov.uncovered, ['work_orders'])
}

// ── Which columns a dashboard's controls own, per object ──────────────────
{
  const filters = [
    { field_name: 'property_state', field_map: { opportunities: 'opportunity_state' } },
    { field_name: 'property_status' },
  ]
  const onProperties = resolveOverrideColumns(filters, 'properties')
  ok('a filter owns its own column on its own object', onProperties.has('property_state'))
  ok('and every other column it names there', onProperties.has('property_status'))
  const onOpps = resolveOverrideColumns(filters, 'opportunities')
  ok('on another object it owns the mapped column', onOpps.has('opportunity_state'))
  ok('and not the source object\'s column', !onOpps.has('property_state'))
}
{
  // On-canvas filter widgets name one column and arrive as plain strings.
  const set = resolveOverrideColumns(['property_state', null, undefined], 'anything')
  check('a bare column name is owned as-is', Array.from(set), ['property_state'])
}
{
  const excluded = resolveOverrideColumns(
    [{ field_name: 'state', field_map: { work_orders: null } }], 'work_orders')
  check('an excluded object has nothing overridden — the report keeps its own filter',
    excluded.size, 0)
}
check('no controls, nothing owned', resolveOverrideColumns(null, 'properties').size, 0)

// ── Which filters actually reach one object, and under which column ───────
{
  const extras = [
    { field_name: 'property_state', field_map: { opportunities: 'opportunity_state' }, operator: 'equals', value: 'NC' },
    { field_name: 'property_status', operator: 'equals', value: 'Active' },
  ]
  const onOpps = resolveExtraFilters(extras, 'opportunities', ['id', 'opportunity_state'])
  check('the filter is rewritten to the column it uses here',
    onOpps.map(f => f.field_name), ['opportunity_state'])
  check('and keeps its operator and value', [onOpps[0].operator, onOpps[0].value], ['equals', 'NC'])
  check('a filter with no equivalent here is dropped, not guessed at', onOpps.length, 1)
}
{
  // The regression this whole mechanism exists to stop: before the map, a
  // state filter simply was not a column on the opportunity report, so it was
  // skipped and that widget answered a different question from its neighbour.
  const extras = [{ field_name: 'property_state', operator: 'equals', value: 'NC' }]
  check('without a map the filter still misses the other object',
    resolveExtraFilters(extras, 'opportunities', ['opportunity_state']).length, 0)
  check('with one it lands', resolveExtraFilters(
    [{ ...extras[0], field_map: { opportunities: 'opportunity_state' } }],
    'opportunities', ['opportunity_state']).length, 1)
}
{
  const src = { field_name: 'property_state', field_map: { properties: 'property_state' }, value: 'NC' }
  const out = resolveExtraFilters([src], 'properties', ['property_state'])
  ok('the caller\'s filter object is not mutated', src.field_name === 'property_state' && out[0] !== src)
}
check('nothing in, nothing out', resolveExtraFilters(null, 'properties', []).length, 0)

// ── Columns arrive in two shapes, and both are real ───────────────────────
{
  // The editor and the service hand over field descriptors, not bare names.
  // Taking only the string form made every lookup miss, so a filter reported
  // itself as reaching nothing while the picker showed the field right there.
  // A browser check caught it; nothing written in one shape ever would.
  const objects = [
    { table: 'properties',    columns: [{ name: 'property_state', label: 'State', type: 'text' }] },
    { table: 'opportunities', columns: [{ name: 'opportunity_state', label: 'State', type: 'text' }] },
    { table: 'work_orders',   columns: [{ name: 'work_order_status', label: 'Status', type: 'uuid' }] },
  ]
  check('a map is built from field descriptors', buildFieldMap('property_state', 'properties', objects),
    { opportunities: 'opportunity_state' })
  check('an equivalent is proposed from descriptors',
    proposeEquivalentColumn('property_state', 'properties', 'opportunities', objects[1].columns),
    'opportunity_state')
  const cov = filterCoverage(
    { field_name: 'property_state', field_map: { properties: 'property_state', opportunities: 'opportunity_state' } },
    objects)
  check('coverage reads descriptors', cov.covered.map(c => c.table), ['properties', 'opportunities'])
  check('and still names the miss', cov.uncovered, ['work_orders'])
  check('extras resolve against descriptors', resolveExtraFilters(
    [{ field_name: 'property_state', field_map: { opportunities: 'opportunity_state' }, value: 'NC' }],
    'opportunities', objects[1].columns).map(f => f.field_name), ['opportunity_state'])
  check('unapplied reads descriptors too', unappliedFilters(
    [{ label: 'State', field_name: 'property_state' }], 'work_orders', objects[2].columns), ['State'])
}

// ── What a widget has to say when a filter cannot reach it ────────────────
{
  const extras = [
    { label: 'State', field_name: 'property_state', field_map: { opportunities: 'opportunity_state' } },
    { label: 'Status', field_name: 'property_status' },
  ]
  check('a filter that lands is not reported', unappliedFilters(extras, 'opportunities', ['opportunity_state']), ['Status'])
  check('both land, nothing reported', unappliedFilters(extras, 'properties', ['property_state', 'property_status']), [])
  check('a filter with no label is named by its column',
    unappliedFilters([{ field_name: 'property_state' }], 'work_orders', []), ['property_state'])
  check('nothing set, nothing reported', unappliedFilters(null, 'properties', []), [])
}

console.log(`dashboard-filter-fields fixture: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
