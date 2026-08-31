// report-child-rollups fixture — reporting on children without breaking rows.
//
// A building with twelve units is not twelve buildings. A roll-up is the
// aggregate that keeps one row per parent, and the rules that make it safe are
// pinned here: the key that keeps two roll-ups apart, the aggregates a column
// can actually carry, and the difference between a parent with NO children
// (count 0) and an aggregate that has nothing to measure (blank).

import {
  ROLLUP_AGGREGATES, childRollupKey, isChildRollupField, childRollupValue,
  aggregatesForColumnType, childRollupLabel, isRelationshipFk,
  isChildDetailField, childFieldKey, isChildDetailReport, expandChildRows,
} from '../src/lib/reportChildRollups.js'

let pass = 0, fail = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else { fail++; console.error(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`) }
}
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error(`  ✗ ${name}`) } }

const units    = { child_table: 'units', child_fk: 'building_id', agg: 'count', value_column: null }
const unitArea = { child_table: 'units', child_fk: 'building_id', agg: 'sum', value_column: 'unit_square_feet' }

// ── Keys keep roll-ups apart ──────────────────────────────────────────────
ok('count and sum over the same child are different columns',
  childRollupKey(units) !== childRollupKey(unitArea))
ok('the same aggregate on two different child columns differs',
  childRollupKey(unitArea) !== childRollupKey({ ...unitArea, value_column: 'unit_bedrooms' }))
ok('the same child reached through a different foreign key differs',
  childRollupKey({ child_table: 'work_orders', child_fk: 'building_id', agg: 'count' }) !==
  childRollupKey({ child_table: 'work_orders', child_fk: 'property_id', agg: 'count' }))
ok('a key is stable for the same roll-up', childRollupKey(units) === childRollupKey({ ...units }))
ok('a key cannot collide with a real column name', childRollupKey(units).startsWith('__child__'))

// ── Identifying the field ─────────────────────────────────────────────────
ok('a roll-up field is recognised', isChildRollupField({ kind: 'child_rollup' }))
ok('an ordinary column is not', !isChildRollupField({ name: 'property_name' }))
ok('nothing is not', !isChildRollupField(null))

// ── No children vs nothing to measure ─────────────────────────────────────
check('a parent with no children counts zero', childRollupValue({ agg: 'count' }, null), 0)
check('a real count passes through', childRollupValue({ agg: 'count' }, 7), 7)
check('a count of zero stays zero', childRollupValue({ agg: 'count' }, 0), 0)
check('the SUM of no rows is blank, not zero', childRollupValue({ agg: 'sum' }, null), null)
check('the AVERAGE of no rows is blank', childRollupValue({ agg: 'avg' }, null), null)
check('the LATEST of no rows is blank', childRollupValue({ agg: 'max' }, null), null)
check('a real sum passes through', childRollupValue({ agg: 'sum' }, 1200), 1200)
check('a summed zero is not mistaken for missing', childRollupValue({ agg: 'sum' }, 0), 0)

// ── Which aggregates a column can carry ───────────────────────────────────
check('a number totals and averages', aggregatesForColumnType('numeric'), ['sum', 'avg', 'min', 'max'])
check('an integer likewise', aggregatesForColumnType('integer'), ['sum', 'avg', 'min', 'max'])
check('a date takes only earliest and latest', aggregatesForColumnType('date'), ['min', 'max'])
check('a timestamp likewise', aggregatesForColumnType('timestamp with time zone'), ['min', 'max'])
ok('text carries no aggregate — SUM of a name is an error', aggregatesForColumnType('text') === null)
ok('a boolean carries none', aggregatesForColumnType('boolean') === null)
ok('a uuid carries none', aggregatesForColumnType('uuid') === null)
ok('an unknown type carries none', aggregatesForColumnType(undefined) === null)
ok('every offered aggregate is one the server accepts',
  ['numeric', 'date'].every(t => (aggregatesForColumnType(t) || []).every(a => ROLLUP_AGGREGATES.includes(a))))

// ── Headers ───────────────────────────────────────────────────────────────
check('a count is headed with the child object itself', childRollupLabel('Units', 'count'), 'Units')
check('a sum says what it sums', childRollupLabel('Units', 'sum', 'Square Feet'), 'Sum of Square Feet')
check('avg reads as Average', childRollupLabel('Units', 'avg', 'Square Feet'), 'Average of Square Feet')
check('min keeps its word', childRollupLabel('Assessments', 'min', 'Assessment Date'), 'Min of Assessment Date')

// ── Audit stamps are not relationships ────────────────────────────────────
ok('created_by is not a child relationship', !isRelationshipFk('created_by'))
ok('updated_by is not', !isRelationshipFk('ia_updated_by'))
ok('deleted_by is not', !isRelationshipFk('deleted_by'))
ok('a real parent key is', isRelationshipFk('building_id'))
ok('a missing column name is not', !isRelationshipFk(null))

// ── One row per child ("A with B") ────────────────────────────────────────
const parents = [{ id: 'p1', building_name: 'Alden Road' }, { id: 'p2', building_name: 'Empty' }]
const kids = [
  { id: 'k1', building_id: 'p1', unit_name: '1A', unit_square_feet: 700 },
  { id: 'k2', building_id: 'p1', unit_name: '1B', unit_square_feet: 800 },
]
const detail = (join) => ({ child_table: 'units', child_fk: 'building_id', join })
const names = (rows) => rows.map(r => `${r.building_name}/${r[childFieldKey('unit_name')] ?? '—'}`)

check('inner keeps one row per child and drops the childless parent',
  names(expandChildRows(parents, kids, detail('inner'))), ['Alden Road/1A', 'Alden Road/1B'])
check('outer keeps the childless parent, once, with no child values',
  names(expandChildRows(parents, kids, detail('outer'))), ['Alden Road/1A', 'Alden Road/1B', 'Empty/—'])
check('no child detail leaves the rows exactly as they were',
  expandChildRows(parents, kids, null).length, 2)
check('an unconfigured child detail is ignored',
  expandChildRows(parents, kids, { join: 'inner' }).length, 2)
check('no children at all: inner returns nothing',
  expandChildRows(parents, [], detail('inner')).length, 0)
check('no children at all: outer returns every parent',
  expandChildRows(parents, [], detail('outer')).length, 2)
{
  const rows = expandChildRows(parents, kids, detail('inner'))
  ok('the parent fields are repeated on every child row',
    rows.every(r => r.building_name === 'Alden Road'))
  ok('each row carries its own child id', rows[0].__child_id === 'k1' && rows[1].__child_id === 'k2')
  ok('every child column is namespaced', rows[0][childFieldKey('unit_square_feet')] === 700)
  // Two rows from one parent must not share an object, or a later pass writing
  // a roll-up or a picklist label onto one writes it onto both.
  rows[0].__marker = 'x'
  ok('sibling rows are not the same object', rows[1].__marker === undefined)
  ok('the source parent row is not mutated', parents[0].__marker === undefined)
}
{
  // A child column can share a name with a parent column — id, name, created_at
  // are on both — and must not overwrite it.
  const p = [{ id: 'p1', name: 'Building A' }]
  const k = [{ id: 'k1', building_id: 'p1', name: 'Unit 1' }]
  const row = expandChildRows(p, k, detail('inner'))[0]
  check('the parent keeps its own name', row.name, 'Building A')
  check('the child name is reachable under its own key', row[childFieldKey('name')], 'Unit 1')
  check('the row id stays the parent id, so roll-ups still key correctly', row.id, 'p1')
}
{
  // A child row whose foreign key is empty belongs to no parent and is dropped
  // rather than attached to whichever row came first.
  const orphan = [{ id: 'k9', building_id: null, unit_name: 'Nowhere' }]
  check('an orphan child is not attached to anything',
    expandChildRows(parents, orphan, detail('inner')).length, 0)
}
ok('a child-detail field is recognised', isChildDetailField({ kind: 'child_field' }))
ok('a roll-up is not a child-detail field', !isChildDetailField({ kind: 'child_rollup' }))
ok('a configured child detail is recognised', isChildDetailReport(detail('inner')))
ok('null is not', !isChildDetailReport(null))
ok('a half-configured one is not', !isChildDetailReport({ child_table: 'units' }))
ok('a child field key cannot collide with a real column', childFieldKey('name').startsWith('__childrow__'))

console.log(`report-child-rollups fixture: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
