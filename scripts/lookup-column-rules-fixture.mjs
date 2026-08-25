// Fixture test for id-column rules in list views.
//
// The rule: a filter compares the value in the row, so any column holding a
// record id must either resolve to a NAME or not be offered as a field at all.
// Cases mirror the real failure (Nicholas, 2026-08-25): "Property Management
// Company contains Lutheran" on the Opportunities list matched nothing while
// ten matching opportunities existed, because the column it filtered holds a
// uuid.
//
// Run with: node scripts/lookup-column-rules-fixture.mjs

import {
  isIdColumn, idColumnKind, isOpaqueIdColumn, stripTablePrefix,
  defaultTablePrefix, parentLookupNameField, isParentLookupNameField,
  parentLookupColumnOf,
  qualifiedFieldLabel,
} from '../src/lib/lookupColumnRules.js'

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

const col = (name, extra = {}) => ({ column_name: name, data_type: 'text', is_foreign_key: false, ...extra })
const uuidCol = (name, extra = {}) => col(name, { data_type: 'uuid', ...extra })
const fk = (name, table) => uuidCol(name, { is_foreign_key: true, references_table: table })

// ── What counts as an id column ────────────────────────────────────────────
check('a uuid column is an id column', isIdColumn(uuidCol('x')), true)
check('a text column is not', isIdColumn(col('property_name')), false)
check('a date column is not', isIdColumn(col('close_date', { data_type: 'date' })), false)
check('nothing is not', isIdColumn(null), false)

// ── The three kinds ────────────────────────────────────────────────────────
const never = () => false
check('an FK to an object is a table lookup',
  idColumnKind(fk('property_id', 'properties'), { table: 'opportunities', hasPicklistDefinition: never }), 'table_lookup')
check('an FK to picklist_values is a picklist',
  idColumnKind(fk('opportunity_record_type', 'picklist_values'), { table: 'opportunities', hasPicklistDefinition: never }), 'picklist')
check('an FK to users is a user',
  idColumnKind(fk('opportunity_owner', 'users'), { table: 'opportunities', hasPicklistDefinition: never }), 'user')
check('a plain column has no id kind',
  idColumnKind(col('opportunity_name'), { table: 'opportunities', hasPicklistDefinition: never }), null)

// ── The 165 unconstrained uuids ────────────────────────────────────────────
// The exact column from the report: uuid, no FK, no picklist behind it.
const mgmtCo = uuidCol('opportunity_property_management_company')
check('the column that broke the Opportunities filter is opaque',
  idColumnKind(mgmtCo, { table: 'opportunities', prefix: 'opportunity', hasPicklistDefinition: never }), 'opaque')
check('and is therefore kept out of the picker and the filter sidebar',
  isOpaqueIdColumn(mgmtCo, { table: 'opportunities', prefix: 'opportunity', hasPicklistDefinition: never }), true)

// An unconstrained uuid the platform CAN name stays, as a picklist.
const definitions = new Set(['enrollments.building_type'])
const hasDef = (table, field) => definitions.has(`${table}.${field}`)
check('an unconstrained uuid backed by a picklist definition is a picklist',
  idColumnKind(uuidCol('enrollment_building_type'), { table: 'enrollments', prefix: 'enrollment', hasPicklistDefinition: hasDef }), 'picklist')
check('and is not treated as opaque',
  isOpaqueIdColumn(uuidCol('enrollment_building_type'), { table: 'enrollments', prefix: 'enrollment', hasPicklistDefinition: hasDef }), false)
check('the same column name on an object with no such definition IS opaque',
  idColumnKind(uuidCol('project_building_type'), { table: 'projects', prefix: 'project', hasPicklistDefinition: hasDef }), 'opaque')

// An FK with no reference table recorded can name nothing either.
check('an FK whose target is unknown is opaque',
  idColumnKind(uuidCol('x', { is_foreign_key: true }), { table: 't', hasPicklistDefinition: never }), 'opaque')

// A plain text column is never suppressed, however uuid-ish its name.
check('a text column named like an id is still a field',
  isOpaqueIdColumn(col('property_hud_property_id'), { table: 'properties', prefix: 'property', hasPicklistDefinition: never }), false)

// ── Prefix stripping ───────────────────────────────────────────────────────
check('the table prefix comes off', stripTablePrefix('enrollments', 'enrollment_building_type'), 'building_type')
check('a column that does not carry the prefix is untouched',
  stripTablePrefix('opportunities', 'property_state'), 'property_state')
check('an explicit prefix wins over the naive one',
  stripTablePrefix('incentive_applications', 'ia_heating_type', 'ia'), 'heating_type')
check('the naive prefix handles -ies', defaultTablePrefix('properties'), 'property')
check('and plain -s', defaultTablePrefix('accounts'), 'account')
check('and a table needing neither', defaultTablePrefix('equipment'), 'equipment')

// ── Two-hop lookup naming ──────────────────────────────────────────────────
check('a parent lookup resolves under a name field',
  parentLookupNameField('property_management_company_id'), 'property_management_company_id__name')
check('the name field is recognizable', isParentLookupNameField('property_management_company_id__name'), true)
check('a plain parent column is not one', isParentLookupNameField('property_city'), false)
check('and the underlying column is recoverable',
  parentLookupColumnOf('property_management_company_id__name'), 'property_management_company_id')
check('recovering from a plain column returns it unchanged',
  parentLookupColumnOf('property_city'), 'property_city')

// ── Field labels name their object ─────────────────────────────────────────
// "Name" is not a field name: an opportunities list showing its own name beside
// the account's name rendered two columns both headed NAME, and a filter chip
// read "State: WI" without saying whose state.
check('a related field is qualified by its relationship',
  qualifiedFieldLabel('Property', 'State'), 'Property State')
check('the parent name column says which object',
  qualifiedFieldLabel('Account', 'Name'), 'Account Name')
check('the field asked for by name comes out with that name',
  qualifiedFieldLabel('Property', 'Management Company'), 'Property Management Company')
check('a relationship group carrying its object in parentheses does not repeat it',
  qualifiedFieldLabel('Managing Account (Account)', 'Name'), 'Managing Account Name')
check('a label that already leads with the relationship does not stutter',
  qualifiedFieldLabel('Property', 'Property Owner'), 'Property Owner')
check('a label identical to the relationship stands alone',
  qualifiedFieldLabel('Account', 'Account'), 'Account')
check('no group leaves the label untouched', qualifiedFieldLabel('', 'State'), 'State')
check('no label leaves the relationship', qualifiedFieldLabel('Property', ''), 'Property')
check('matching is case-insensitive, and the authored casing wins',
  qualifiedFieldLabel('Property', 'property state'), 'property state')

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) { console.error(`${failures} failing`); process.exit(1) }
