// Fixture test for object navigation — the registry and the URL grammar.
//
// The rule Nicholas set (2026-08-24): "You have to retain the navigation, the
// breadcrumbs, URLs for every single object and sub-object, child, parent,
// everything." Back and Forward must work like Salesforce.
//
// What kept breaking: the URL layer decided whether "/<table>/<uuid>" was a
// record by consulting a hand-maintained allowlist. 51 of the 103 objects with
// a record page were missing from it, so their URLs were written to the
// address bar by an in-app click but could never be read back — browser Back,
// browser Forward, a reload and a shared link all fell through to the Home
// screen. Nothing tested it, so every object added to LEAP quietly joined the
// broken set.
//
// These checks pin the mechanism, not a list: an object nobody has registered
// still resolves to a record. That is what makes the failure impossible to
// reintroduce rather than merely fixed once.
//
//   node scripts/object-nav-fixture.mjs

import {
  objectNavFor, humanizeObjectLabel, isObjectTableSegment, objectModuleFor,
  objectListUrlFor, tableForSectionId, registeredObjectTables,
} from '../src/lib/objectNav.js'
import { parsePath, buildPath, getTableListUrl, getTableForSection, isUrlAddressableTable, buildScopedListUrl } from '../src/lib/urlGrammar.js'

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

const U = 'bfa25793-8089-4cbe-b71c-ff7c01f83eaa'
const rec = (path, search = '') => {
  const p = parsePath(path, search)
  return p.selectedRecord ? { table: p.selectedRecord.table, mode: p.selectedRecord.mode, module: p.activeModule } : null
}

// ── The regression itself ───────────────────────────────────────────────────
// The exact record Nicholas was on when it dropped him on Home.
check('work step URL resolves to the record', rec(`/work_steps/${U}`),
  { table: 'work_steps', mode: 'view', module: 'field' })

// The rest of the objects that had no URL at all.
for (const t of ['work_plans', 'photos', 'documents', 'activities', 'price_books',
                 'service_territories', 'occurrences', 'income_qualifications',
                 'opportunity_line_items', 'project_reservations', 'work_step_templates']) {
  check(`${t} URL resolves to the record`, rec(`/${t}/${U}`)?.table, t)
  check(`${t} does not fall through to Home`, parsePath(`/${t}/${U}`).activeModule === 'home', false)
}

// An object nobody has registered — the case that made this keep breaking.
// It must still be a record, not a trip to the Home screen.
check('an unregistered object still resolves to a record',
  rec(`/some_object_built_next_year/${U}`),
  { table: 'some_object_built_next_year', mode: 'view', module: 'field' })
check('an unregistered object is URL-addressable', isUrlAddressableTable('some_object_built_next_year'), true)

// Round trip: what we read back is what we write out. This is what makes
// browser Back/Forward land on the same screen.
for (const t of ['work_steps', 'projects', 'photos', 'accounts', 'some_new_object']) {
  check(`${t} path round-trips`, buildPath(parsePath(`/${t}/${U}`)), `/${t}/${U}`)
}

// ── Routes must not be mistaken for objects ─────────────────────────────────
check('/ is home', parsePath('/').activeModule, 'home')
check('/m/field/workorders is a module section', rec('/m/field/workorders'), null)
check('/search is the search page', parsePath('/search', '?q=x').activeModule, 'search')
check('/help/<slug> is the help center', parsePath('/help/creating-records').helpSlug, 'creating-records')
check('/sign/<num> is not an object', rec('/sign/ENV-00002'), null)
check('reserved segment m is not a table', isObjectTableSegment('m'), false)
check('reserved segment auth is not a table', isObjectTableSegment('auth'), false)
check('a non-table segment is rejected', isObjectTableSegment('Work-Steps!'), false)
check('a bad id is not a record', rec(`/work_steps/not-a-uuid`), null)
check('/<table>/new is a create', rec('/work_orders/new'), { table: 'work_orders', mode: 'create', module: 'field' })

// ── Labels: never show a user a raw table name ──────────────────────────────
check('work_steps label', humanizeObjectLabel('work_steps'), 'Work Steps')
check('efr_reports label keeps the acronym', humanizeObjectLabel('efr_reports'), 'EFR Reports')
check('ahri_certificates label keeps the acronym', humanizeObjectLabel('ahri_certificates'), 'AHRI Certificates')
check('gps_points label keeps the acronym', humanizeObjectLabel('gps_points'), 'GPS Points')
check('single-word label', humanizeObjectLabel('accounts'), 'Accounts')
check('an unregistered object still gets a readable label',
  objectNavFor('brand_new_widgets').label, 'Brand New Widgets')
check('an unregistered object still gets an app name',
  objectNavFor('brand_new_widgets').moduleLabel.length > 0, true)

// ── List URLs must point at sections the module actually declares ───────────
// Building a list URL from the table name landed on section ids that do not
// exist, which rendered as the module's Home tab — the breadcrumb that "takes
// me home". These are the ids the modules really declare.
check('work orders list', getTableListUrl('work_orders'), '/m/field/workorders')
check('enrollments list', getTableListUrl('enrollments'), '/m/enrollment/enrollment')
check('opportunities list', getTableListUrl('opportunities'), '/m/enrollment/opps')
check('vehicle activities list', getTableListUrl('vehicle_activities'), '/m/fleet/activities')
check('inventory list', getTableListUrl('product_items'), '/m/stock/inventory')
check('materials requests list', getTableListUrl('materials_requests'), '/m/stock/requests')
check('vehicle kits list', getTableListUrl('equipment_containers'), '/m/fleet/kits')
check('report folders list', getTableListUrl('report_folders'), '/m/reports/folders')
check('scheduled reports list', getTableListUrl('scheduled_reports'), '/m/reports/scheduled')
check('credentials list', getTableListUrl('contact_skills'), '/m/field/credentials')
check('tasks list', getTableListUrl('tasks'), '/m/tasks/all')
check('time sheets list', getTableListUrl('time_sheets'), '/m/field/timesheets')
check('absences list', getTableListUrl('resource_absences'), '/m/field/absences')
check('payment requests list', getTableListUrl('project_payment_requests'), '/m/incentives/requests')
check('applications list', getTableListUrl('incentive_applications'), '/m/qualification/applications')

// Work plans and work steps DO have a list as of 2026-09-03. They are a work
// order's own children and the Work Steps card counts 22 of them, so "View All"
// has to open something -- with no list URL the widget rendered a greyed-out
// label instead of a link (Nicholas: "I'm trying to view all the work steps,
// and I can't see them. It's just a grayed-out thing").
check('work steps list', getTableListUrl('work_steps'), '/m/field/work_steps')
check('work plans list', getTableListUrl('work_plans'), '/m/field/work_plans')
check('...so a scoped View All from a work order builds a real URL',
  typeof buildScopedListUrl({
    table: 'work_steps', fk: 'work_order_id',
    parentId: '11111111-2222-3333-4444-555555555555', label: 'WO-00244',
  }), 'string')

// An object reached only through its parent still has no list, and returning
// null is the point: the breadcrumb renders plain text instead of a link to a
// module Home, and the widget shows a label rather than a dead link.
check('photos have no list view', getTableListUrl('photos'), null)
check('CONTROL: with no list URL a scoped View All cannot be built',
  buildScopedListUrl({
    table: 'photos', fk: 'work_step_id',
    parentId: '11111111-2222-3333-4444-555555555555', label: 'WS-1',
  }), null)
check('an unregistered object has no list view', getTableListUrl('mystery_objects'), null)
check('no table, no list', getTableListUrl(null), null)

// Every registered list URL must be well-formed.
for (const t of registeredObjectTables()) {
  const url = objectListUrlFor(t)
  if (url !== null) check(`${t} list url shape`, /^\/m\/[a-z_]+\/[a-z_]+$/.test(url), true)
  check(`${t} has a host module`, typeof objectModuleFor(t) === 'string' && objectModuleFor(t).length > 0, true)
}

// ── Section → table, for the Setup gear and the assistant ───────────────────
check('workorders section', getTableForSection('field', 'workorders'), 'work_orders')
check('opps section', getTableForSection('enrollment', 'opps'), 'opportunities')
check('activities section resolves within its own module',
  tableForSectionId('fleet', 'activities'), 'vehicle_activities')
check('projects section resolves in a module that borrows the list',
  getTableForSection('implementation', 'projects'), 'projects')
check('a module Home tab is not an object', getTableForSection('field', 'home'), null)
check('the Outreach map is not an object', getTableForSection('outreach', 'map'), null)
check('no section, no table', getTableForSection('field', null), null)

console.log(`${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`\n${failures} object-nav check(s) failed.`)
  process.exit(1)
}
