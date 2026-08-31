// field-tiers fixture — a saved report cannot leak a field the runner may not see.
//
// The report engine drops restricted columns at run time as well as hiding them
// from the picker, because those are two different leaks: an Admin BUILDS a
// report with the agreed payout on it, and a technician RUNS it. The picker
// never saw the field; the saved report still names it.

import {
  isOwnObjectField, applyFieldRestrictions, describeRestrictedFields,
} from '../src/lib/fieldTiers.js'

let pass = 0, fail = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else { fail++; console.error(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`) }
}
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error(`  ✗ ${name}`) } }

const parts = {
  fields: [
    { name: 'work_order_name' },
    { name: 'work_order_agreed_payout_amount' },       // tier 3
    { name: 'property_name', via_path: ['property_id'] },
  ],
  filters: [
    { rfilt_field_name: 'work_order_status' },
    { rfilt_field_name: 'work_order_agreed_payout_amount' },
    { rfilt_is_cross_filter: true },
  ],
  groupings: [
    { rgr_field_name: 'work_order_status' },
    { rgr_field_name: 'work_order_agreed_payout_amount' },
  ],
}
const deny = new Set(['work_order_agreed_payout_amount'])

// ── The leak this closes ──────────────────────────────────────────────────
{
  const r = applyFieldRestrictions(parts, deny)
  check('the restricted column is gone from the field list',
    r.fields.map(f => f.name), ['work_order_name', 'property_name'])
  check('and from the filters — a filter would narrow rows by a hidden value',
    r.filters.length, 2)
  check('and from the groupings — a group header would print it',
    r.groupings.map(g => g.rgr_field_name), ['work_order_status'])
  check('and it is named, once', r.dropped, ['work_order_agreed_payout_amount'])
}

// ── What must NOT be dropped ──────────────────────────────────────────────
{
  const r = applyFieldRestrictions(parts, deny)
  ok('a cross-filter survives — it carries no field of its own',
    r.filters.some(f => f.rfilt_is_cross_filter))
  ok('a field on a RELATED object is left to that object\'s own pass',
    r.fields.some(f => f.name === 'property_name'))
}
{
  // The related-field trap stated directly: a property column that happens to
  // share a name with a restricted opportunity column must not be dropped by
  // the opportunity's pass.
  const p = { fields: [{ name: 'amount', via_path: ['property_id'] }, { name: 'amount' }] }
  const r = applyFieldRestrictions(p, new Set(['amount']))
  check('only the own-object one goes', r.fields.length, 1)
  ok('and the survivor is the related one', r.fields[0].via_path.length === 1)
}

// ── Nothing restricted: the report is untouched ───────────────────────────
{
  const r = applyFieldRestrictions(parts, new Set())
  check('every field survives', r.fields.length, 3)
  check('every filter survives', r.filters.length, 3)
  check('every grouping survives', r.groupings.length, 2)
  check('and nothing is reported', r.dropped, [])
}
check('a missing restricted set is not an error', applyFieldRestrictions(parts, null).fields.length, 3)
check('an empty report is not an error', applyFieldRestrictions({}, deny).fields, [])
check('nothing at all is not an error', applyFieldRestrictions(null, deny).dropped, [])

// ── Own vs related ────────────────────────────────────────────────────────
ok('a bare column is own-object', isOwnObjectField({ name: 'x' }))
ok('an empty via_path is still own-object', isOwnObjectField({ name: 'x', via_path: [] }))
ok('a one-hop field is not', !isOwnObjectField({ via_path: ['property_id'] }))
ok('a missing descriptor is treated as own-object', isOwnObjectField(undefined))

// ── Saying so ─────────────────────────────────────────────────────────────
ok('nothing dropped, nothing said', describeRestrictedFields([]) === null)
ok('null is silent too', describeRestrictedFields(null) === null)
{
  const m = describeRestrictedFields(['work_order_agreed_payout_amount'])
  ok('one column reads as singular', m.startsWith('One column is'))
  ok('and names it', m.includes('work_order_agreed_payout_amount'))
  ok('and says why, not just that', m.includes('financial access level'))
}
{
  const m = describeRestrictedFields(['a', 'b'], { a: 'Agreed Payout', b: 'Expected Revenue' })
  ok('labels are preferred over raw column names', m.includes('Agreed Payout') && !m.includes('"a"'))
  ok('two columns read as plural', m.startsWith('2 columns are'))
}
{
  const m = describeRestrictedFields(['a', 'b', 'c', 'd', 'e'])
  ok('a long list is trimmed', m.includes('and 2 more'))
  ok('but the count is honest', m.startsWith('5 columns are'))
}

console.log(`field-tiers fixture: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
