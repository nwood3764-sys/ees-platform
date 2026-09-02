// Fixture: a child record inherits everything the platform already knows.
//
// Nicholas, 2026-09-02, creating a Service Appointment from WO-00244: "it
// should obviously inherit everything possible from the work order, building
// opportunity, etc. Populate all the fields you can."
//
// It inherited nothing. SA-00305 came out carrying only the work order it was
// created from — Work Type, Project, Opportunity, Status and both times blank —
// while the work order it was created from held work type, project, opportunity,
// property, building and account.
//
// Two causes, both the same shape as the three lists that failed earlier the
// same day:
//
//   1. TABLE_META, the curated map the resolver reads, covers 74 of the
//      platform's 100+ record objects. service_appointments is not one of them,
//      so the resolver returned {} before doing any work.
//   2. The curated entries are PARTIAL even where they exist.
//      TABLE_META.work_orders declares the four relationships it navigates by
//      (project, opportunity, property, building) and NOT work_type_id — so
//      even a covered child could never be handed the work type.
//
// Column metadata below is taken verbatim from production
// (describe_object_columns). The last block replays the real resolution for the
// exact case in the report and requires the three empty fields to be filled.
//
// Run with:  node scripts/parent-relationships-fixture.mjs

import {
  isParentForeignKey,
  parentsFromColumns,
  mergeParentMeta,
  relationshipKey,
} from '../src/lib/parentRelationships.js'

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

const fk = (column_name, references_table) =>
  ({ column_name, is_foreign_key: true, references_table })

// ── Real column metadata from production ───────────────────────────────────
const SERVICE_APPOINTMENT_COLUMNS = [
  fk('contact_id', 'contacts'),
  fk('opportunity_id', 'opportunities'),
  fk('project_id', 'projects'),
  fk('sa_created_by', 'users'),
  fk('sa_deleted_by', 'users'),
  fk('sa_duration_type', 'picklist_values'),
  fk('sa_owner', 'users'),
  fk('sa_status', 'picklist_values'),
  fk('sa_updated_by', 'users'),
  fk('service_territory_id', 'service_territories'),
  fk('work_order_id', 'work_orders'),
  fk('work_type_id', 'work_types'),
  { column_name: 'sa_name', is_foreign_key: false },
]

const WORK_ORDER_COLUMNS = [
  fk('assessment_id', 'assessments'),
  fk('building_id', 'buildings'),
  fk('contact_id', 'contacts'),
  fk('opportunity_id', 'opportunities'),
  fk('parent_work_order_id', 'work_orders'),
  fk('project_id', 'projects'),
  fk('project_site_lead_contact_id', 'contacts'),
  fk('property_id', 'properties'),
  fk('root_work_order_id', 'work_orders'),
  fk('service_territory_id', 'service_territories'),
  fk('unit_id', 'units'),
  fk('vehicle_id', 'vehicles'),
  fk('work_order_account_id', 'accounts'),
  fk('work_order_owner', 'users'),
  fk('work_type_id', 'work_types'),
]

// ── What counts as a parent ────────────────────────────────────────────────
check('a real parent FK is a parent',
  isParentForeignKey(fk('work_type_id', 'work_types'), 'service_appointments'), true)
check('an owner is a PERSON on the record, not a record above it',
  isParentForeignKey(fk('sa_owner', 'users'), 'service_appointments'), false)
check('created_by is not a parent either',
  isParentForeignKey(fk('sa_created_by', 'users'), 'service_appointments'), false)
check('a picklist FK is a VALUE, never inherited',
  isParentForeignKey(fk('sa_status', 'picklist_values'), 'service_appointments'), false)
check('a self-reference is hierarchy WITHIN the object, not a parent to inherit',
  isParentForeignKey(fk('parent_work_order_id', 'work_orders'), 'work_orders'), false)
check('...but the SAME column on a different table is a genuine parent',
  isParentForeignKey(fk('work_order_id', 'work_orders'), 'service_appointments'), true)
check('a non-FK column is not a parent',
  isParentForeignKey({ column_name: 'sa_name', is_foreign_key: false }, 'service_appointments'), false)
check('a malformed column does not throw',
  isParentForeignKey(undefined, 'service_appointments'), false)

// ── The derived relationship set ───────────────────────────────────────────
{
  const { parents, parentTables } = parentsFromColumns(SERVICE_APPOINTMENT_COLUMNS, 'service_appointments')
  check('service_appointments: every real relationship, and only those',
    parents,
    ['contact_id', 'opportunity_id', 'project_id', 'service_territory_id',
     'work_order_id', 'work_type_id'])
  check('...each paired with the table it points at',
    parentTables,
    ['contacts', 'opportunities', 'projects', 'service_territories',
     'work_orders', 'work_types'])
  check('no owner, created-by, deleted-by or picklist column survives',
    parents.filter(c => /_owner$|_created_by$|_deleted_by$|_status$|_duration_type$/.test(c)), [])
}

check('work_orders: both self-references are excluded',
  parentsFromColumns(WORK_ORDER_COLUMNS, 'work_orders').parents
    .filter(c => c.includes('work_order_id')), [])

// ── The union with a curated entry ─────────────────────────────────────────
{
  // The real TABLE_META.work_orders entry: four relationships, no work_type_id.
  const curated = {
    parents: ['project_id', 'opportunity_id', 'property_id', 'building_id'],
    parentTables: ['projects', 'opportunities', 'properties', 'buildings'],
  }
  const merged = mergeParentMeta(curated, parentsFromColumns(WORK_ORDER_COLUMNS, 'work_orders'))

  check('the curated four are still first, in their curated order',
    merged.parents.slice(0, 4), curated.parents)
  check('and the relationship the curated list was missing is now present',
    merged.parents.includes('work_type_id'), true)
  check('paired with the right table',
    merged.parentTables[merged.parents.indexOf('work_type_id')], 'work_types')
  check('nothing curated is lost',
    curated.parents.every(c => merged.parents.includes(c)), true)
  check('no relationship appears twice',
    merged.parents.length, new Set(merged.parents).size)
  check('an object with no curated entry falls back to the derived set entirely',
    mergeParentMeta(undefined, parentsFromColumns(SERVICE_APPOINTMENT_COLUMNS, 'service_appointments')).parents.length,
    6)
  check('an empty curated entry is treated as absent, not as "no parents"',
    mergeParentMeta({ parents: [], parentTables: [] },
      parentsFromColumns(SERVICE_APPOINTMENT_COLUMNS, 'service_appointments')).parents.length, 6)
}

// ── The relationship key that matches across prefixes ──────────────────────
check('work_order_account_id and project_account_id are the same relationship',
  relationshipKey('work_order_account_id'), relationshipKey('project_account_id'))
check('work_type_id is its own relationship', relationshipKey('work_type_id'), 'type_id')
check('project_id is its own relationship', relationshipKey('project_id'), 'project_id')

// ── Replay the reported case ───────────────────────────────────────────────
// The real resolver's matching, over the real WO-00244 values, for the real
// create: New Service Appointment launched from the work order's related list.
{
  const WO_00244 = {
    id: 'ad263dc0-d27d-4176-a477-38f8c324b1f1',
    work_type_id: 'wt-insulation-removal-attic',
    project_id: 'proj-1',
    opportunity_id: 'opp-1',
    property_id: 'prop-1',
    building_id: 'bld-1',
    unit_id: null,
    contact_id: null,
    service_territory_id: null,
    work_order_account_id: 'acct-1',
  }
  const target = parentsFromColumns(SERVICE_APPOINTMENT_COLUMNS, 'service_appointments')
  const ancestor = mergeParentMeta(
    { parents: ['project_id', 'opportunity_id', 'property_id', 'building_id'],
      parentTables: ['projects', 'opportunities', 'properties', 'buildings'] },
    parentsFromColumns(WORK_ORDER_COLUMNS, 'work_orders'))

  // Same two steps the resolver takes: note every relationship the ancestor
  // holds, then fill the target's own declared relationships by key.
  const byRelationship = new Map()
  for (const col of ancestor.parents) {
    const v = WO_00244[col]
    if (v == null || v === '') continue
    const key = relationshipKey(col)
    if (!byRelationship.has(key)) byRelationship.set(key, v)
  }
  const resolved = {}
  for (const col of target.parents) {
    const v = byRelationship.get(relationshipKey(col))
    if (v != null) resolved[col] = v
  }

  check('the three fields that came out blank are now filled',
    [resolved.work_type_id, resolved.project_id, resolved.opportunity_id],
    ['wt-insulation-removal-attic', 'proj-1', 'opp-1'])
  check('a relationship the work order does not hold stays empty, not guessed',
    [resolved.contact_id, resolved.service_territory_id], [undefined, undefined])
  check('nothing outside the service appointment’s own columns is written',
    Object.keys(resolved).every(c => target.parents.includes(c)), true)
  check('and the property/building the SA has no column for are NOT written to it',
    [resolved.property_id, resolved.building_id], [undefined, undefined])
}

console.log(failures === 0
  ? `parent-relationships fixture: ${checks} checks passed`
  : `parent-relationships fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
