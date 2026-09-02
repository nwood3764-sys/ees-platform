// Fixture test for scoped object sections (src/lib/objectSectionScopes.js).
//
// The defect this pins: the Field module's Technicians tab rendered the
// generic CONTACTS list with no filter, so it showed every contact in LEAP and
// could never show a technician — a technician is a USER
// (work_orders.assigned_technician_id is an FK to users). Nicholas, 2026-09-02:
// "if it's on the field module, it can only show the technicians. That's it.
// There's no other way anyone can change a filter to see anyone else."
//
// That last sentence is the requirement being pinned: a SCOPE, applied to the
// fetch, not a filter or a default view that a person can clear.
//
// Run with: node scripts/object-section-scopes-fixture.mjs

import { OBJECT_SECTION_SCOPES, scopeForSection } from '../src/lib/objectSectionScopes.js'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { failures += 1; console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`) }
}

// ── The reported case ───────────────────────────────────────────────────────
{
  const scope = scopeForSection('field', 'technicians', 'users')
  check('Field > Technicians is scoped', !!scope, true)
  check('and it scopes the USERS object, never contacts', scope.table, 'users')
  check('on the stored field-technician fact', scope.column, 'user_is_field_technician')
  check('matching true', scope.value, true)
}

// ── The scope is not a filter ───────────────────────────────────────────────
// A filter is a thing a person can clear. This must be reachable only through
// scopeForSection, never as a filter row the ListView would render — so it
// carries no `op` and no shape the filter kernel would accept.
{
  const scope = scopeForSection('field', 'technicians', 'users')
  check('carries no filter operator', scope.op, undefined)
  check('carries no filter `field` key the ListView would hydrate', scope.field, undefined)
  check('the exported map is keyed module.section, not by table',
    Object.keys(OBJECT_SECTION_SCOPES), ['field.technicians'])
}

// ── The table must match, or the scope does not apply ───────────────────────
// A scope names a COLUMN. Applying it to the wrong object would filter on a
// column that object does not have — an empty list that reads as "no records"
// rather than an error. Returning null leaves the section behaving as any
// unscoped section does.
{
  check('the old wiring (contacts) gets NO scope, it does not silently apply',
    scopeForSection('field', 'technicians', 'contacts'), null)
  check('nor does an unrelated object', scopeForSection('field', 'technicians', 'work_orders'), null)
}

// ── Other sections and modules are untouched ────────────────────────────────
// The same object is legitimately unscoped elsewhere: Setup's Users list must
// show every user, including Keegan, James and Brittin.
{
  check('Setup > Users is not scoped', scopeForSection('setup', 'users', 'users'), null)
  check('Admin listing users is not scoped', scopeForSection('admin', 'users', 'users'), null)
  check('Field > Work Orders is not scoped', scopeForSection('field', 'workorders', 'work_orders'), null)
  check('Field > Projects is not scoped', scopeForSection('field', 'projects', 'projects'), null)
  check('a technicians section on ANOTHER module is not scoped by accident',
    scopeForSection('dispatch', 'technicians', 'users'), null)
}

// ── Missing arguments never throw ───────────────────────────────────────────
// The section id is optional on ObjectListSection, so every existing caller
// passes undefined. That must be a no-op, not a crash on every list in LEAP.
{
  for (const [label, args] of [
    ['no section id', ['field', undefined, 'users']],
    ['no module id',  [undefined, 'technicians', 'users']],
    ['no table',      ['field', 'technicians', undefined]],
    ['nothing',       [undefined, undefined, undefined]],
    ['nulls',         [null, null, null]],
  ]) {
    check(`${label} -> null, no throw`, scopeForSection(...args), null)
  }
}

// ── POSITIVE CONTROL: the pre-fix wiring must produce no scope ──────────────
// This is what shipped — the Technicians tab asking for `contacts` with no
// scope of any kind. If this ever returns a scope, the control is broken.
{
  const preFix = scopeForSection('field', 'technicians', 'contacts')
  check('CONTROL: the contacts-backed tab was unscoped, hence every contact', preFix, null)
}

console.log(`object-section-scopes-fixture: ${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exit(1)
