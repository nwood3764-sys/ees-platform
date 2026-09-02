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
import { viewVisibleOnModule, filterViewsForModule } from '../src/lib/savedViewScope.js'

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


// ── Saved views are scoped to their module ──────────────────────────────────
// The Technicians tab's own views ("Crew Leads") must not appear in
// Setup > Users, which lists every user and where the name means nothing.
// saved_list_views.list_view_module has existed since the baseline and nothing
// read it until now — so the rule must be one-directional, or existing views
// would move.
{
  const techView   = { list_view_name: 'Crew Leads',  list_view_module: 'field' }
  const objectWide = { list_view_name: 'All Accounts', list_view_module: null }

  check('a field-scoped view shows on the field module',
    viewVisibleOnModule(techView, 'field'), true)
  check('and NOT on setup', viewVisibleOnModule(techView, 'setup'), false)
  check('and NOT on any other module', viewVisibleOnModule(techView, 'dispatch'), false)

  check('a view naming no module is object-wide: shows on field',
    viewVisibleOnModule(objectWide, 'field'), true)
  check('...and on setup', viewVisibleOnModule(objectWide, 'setup'), true)
  check('...and when the caller names no module',
    viewVisibleOnModule(objectWide, null), true)

  // The safety direction: an unscoped CALLER still sees everything, so no
  // existing screen loses a view it has today.
  check('a caller that does not scope still sees a module-scoped view',
    viewVisibleOnModule(techView, null), true)

  check('a view row missing the field entirely is treated as object-wide',
    viewVisibleOnModule({ list_view_name: 'Legacy' }, 'field'), true)

  check('filterViewsForModule keeps object-wide and this module only',
    filterViewsForModule(
      [techView, objectWide, { list_view_name: 'Setup Only', list_view_module: 'setup' }],
      'field',
    ).map(v => v.list_view_name),
    ['Crew Leads', 'All Accounts'])

  check('a non-array view list is empty, never a throw',
    filterViewsForModule(null, 'field'), [])

  // POSITIVE CONTROL: the pre-fix rule ignored list_view_module entirely, so
  // the technician views WOULD have shown up in Setup > Users.
  check('CONTROL: ignoring the module shows a field view on setup',
    [techView, objectWide].filter(() => true).map(v => v.list_view_name),
    ['Crew Leads', 'All Accounts'])
}

console.log(`object-section-scopes-fixture: ${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exit(1)
