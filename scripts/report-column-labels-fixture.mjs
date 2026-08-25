// Fixture test for report column headers.
//
// The complaint this pins (Nicholas, 2026-08-25, RPT-00041 "Lutheran Social
// Services Opportunities"): three columns in a row headed "NAME" — the
// property's name, the building's name and the opportunity's name, every one
// of them reduced to "Name" by stripping the object's own column prefix.
//
// The rule: a field reached through a relationship is named for that
// relationship, a record's own identity field is named for its object, and
// no two columns in one report may share a header. A label a person wrote by
// hand is never overwritten.
//
// Run with:  node scripts/report-column-labels-fixture.mjs

import {
  humanizeWords,
  singularizeTable,
  objectSingularLabel,
  stripObjectPrefix,
  isIdentityColumn,
  bareFieldLabel,
  relationshipLabel,
  normalizeFieldDescriptor,
  deriveReportColumnLabel,
  isDerivedLabel,
  resolveReportColumnLabels,
} from '../src/lib/reportColumnLabels.js'

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

// The platform's column-prefix map, as the app passes it in. Only the entries
// these cases need — everything else falls back to the singularized table.
const prefixFor = (t) => ({
  properties: 'property', accounts: 'account', contacts: 'contact',
  opportunities: 'opportunity', buildings: 'building', units: 'unit',
  work_orders: 'work_order', projects: 'project',
  incentive_applications: 'ia', service_appointments: 'sa',
  efr_reports: 'efr',
}[t] || null)

const opts = (primaryObject) => ({ primaryObject, prefixFor })

// ── Humanizing ──────────────────────────────────────────────────────────────
check('humanize: plain words', humanizeWords('total_units'), 'Total Units')
check('humanize: acronyms are shouted', humanizeWords('hud_property_id'), 'HUD Property ID')
check('humanize: EFR stays EFR', humanizeWords('efr_reports'), 'EFR Reports')
check('humanize: empty', humanizeWords(''), '')

// ── Singularizing (the "Propertie" bug) ─────────────────────────────────────
check('singular: properties', singularizeTable('properties'), 'property')
check('singular: buildings', singularizeTable('buildings'), 'building')
check('singular: opportunities', singularizeTable('opportunities'), 'opportunity')
check('singular: addresses', singularizeTable('addresses'), 'address')
check('singular: already singular', singularizeTable('equipment'), 'equipment')
check('object label: work_orders', objectSingularLabel('work_orders'), 'Work Order')
check('object label: incentive_applications', objectSingularLabel('incentive_applications'), 'Incentive Application')

// ── Prefix stripping ────────────────────────────────────────────────────────
check('strip: mapped prefix', stripObjectPrefix('properties', 'property_name', { prefixFor }), 'name')
check('strip: short-code prefix', stripObjectPrefix('incentive_applications', 'ia_status', { prefixFor }), 'status')
check('strip: unmapped table falls back to the singular table name',
  stripObjectPrefix('work_steps', 'work_step_status', {}), 'status')
check('strip: column without the prefix is left alone',
  stripObjectPrefix('properties', 'created_at', { prefixFor }), 'created_at')
check('strip: a column that IS the prefix is left alone',
  stripObjectPrefix('properties', 'property', { prefixFor }), 'property')

// ── Identity columns ────────────────────────────────────────────────────────
check('identity: property_name', isIdentityColumn('properties', 'property_name', { prefixFor }), true)
check('identity: record number', isIdentityColumn('opportunities', 'opportunity_record_number', { prefixFor }), true)
check('identity: stage is not identity', isIdentityColumn('opportunities', 'opportunity_stage', { prefixFor }), false)
check('identity: a lookup is not identity', isIdentityColumn('properties', 'property_account_id', { prefixFor }), false)

// ── Short labels ────────────────────────────────────────────────────────────
check('bare: stage', bareFieldLabel('opportunities', 'opportunity_stage', { prefixFor }), 'Stage')
check('bare: lookup drops the _id', bareFieldLabel('properties', 'property_account_id', { prefixFor, type: 'uuid' }), 'Account')
check('bare: a text id keeps its ID', bareFieldLabel('properties', 'property_hud_property_id', { prefixFor, type: 'text' }), 'HUD Property ID')

// ── Relationship labels ─────────────────────────────────────────────────────
check('relationship: property_id', relationshipLabel('property_id', { sourceTable: 'opportunities', targetTable: 'properties', prefixFor }), 'Property')
check('relationship: prefixed FK', relationshipLabel('opportunity_account_id', { sourceTable: 'opportunities', targetTable: 'accounts', prefixFor }), 'Account')
check('relationship: two lookups onto accounts stay distinct',
  relationshipLabel('property_management_company_id', { sourceTable: 'properties', targetTable: 'accounts', prefixFor }),
  'Management Company')
check('relationship: unknown source table still reads',
  relationshipLabel('building_id', { targetTable: 'buildings', prefixFor }), 'Building')

// ── The report that started it: RPT-00041 ───────────────────────────────────
const rpt41 = [
  { name:'property_name',      table:'properties',    via_path:['property_id'], type:'text',    label:'Name' },
  { name:'building_name',      table:'buildings',     via_path:['building_id'], type:'text',    label:'Name' },
  { name:'opportunity_name',   table:'opportunities', via_path:null,            type:'text',    label:'Name' },
  { name:'opportunity_stage',  table:'opportunities', via_path:null,            type:'uuid',    label:'Stage' },
  { name:'opportunity_amount', table:'opportunities', via_path:null,            type:'numeric', label:'Amount' },
]
check('RPT-00041: every header names its own object',
  resolveReportColumnLabels(rpt41, opts('opportunities')).map(f => f.label),
  ['Property Name', 'Building Name', 'Opportunity Name', 'Stage', 'Amount'])

// A field that is NOT an identity field keeps the short label on the primary
// object, and is qualified when it comes from a related one.
check('primary non-identity field stays short',
  deriveReportColumnLabel({ name:'opportunity_stage', table:'opportunities', via_path:null }, opts('opportunities')),
  'Stage')
check('related non-identity field is named for the relationship',
  deriveReportColumnLabel({ name:'property_city', table:'properties', via_path:['property_id'] }, opts('opportunities')),
  'Property City')

// ── No stutter ──────────────────────────────────────────────────────────────
check('no stutter: label already starts with its object',
  deriveReportColumnLabel({ name:'account_account_type', table:'accounts', via_path:['property_account_id'] }, opts('properties')),
  'Account Type')
check('no stutter: a lookup whose label equals the relationship',
  deriveReportColumnLabel({ name:'property_id', table:'properties', via_path:null, type:'uuid' }, opts('opportunities')),
  'Property')

// ── Collisions widen, and only the columns that collide ─────────────────────
const twoAccounts = [
  { name:'account_name', table:'accounts', via_path:['property_account_id'], type:'text' },
  { name:'account_name', table:'accounts', via_path:['property_management_company_id'], type:'text' },
  { name:'property_name', table:'properties', via_path:null, type:'text' },
]
check('two lookups onto accounts read differently',
  resolveReportColumnLabels(twoAccounts, opts('properties')).map(f => f.label),
  ['Account Name', 'Management Company Name', 'Property Name'])

check('one "Name" column is not widened for a collision that does not exist',
  resolveReportColumnLabels([{ name:'property_name', table:'properties', via_path:null, type:'text' }], opts('properties'))
    .map(f => f.label),
  ['Property Name'])

// The same field selected twice — a header must never be a guess about which
// column it belongs to.
check('the same field twice is numbered',
  resolveReportColumnLabels([
    { name:'property_name', table:'properties', via_path:null, type:'text' },
    { name:'property_name', table:'properties', via_path:null, type:'text' },
  ], opts('properties')).map(f => f.label),
  ['Property Name', 'Property Name (2)'])

// ── Hand-written labels survive ─────────────────────────────────────────────
// RPT-00021, saved in the pre-Builder shape with curated labels.
const rpt21 = [
  { label:'Property Name',   field_name:'property_name',            field_table:'properties' },
  { label:'Street Address',  field_name:'property_street',           field_table:'properties' },
  { label:'City',            field_name:'property_city',             field_table:'properties' },
  { label:'ZIP Code',        field_name:'property_zip',              field_table:'properties' },
  { label:'HUD Property ID', field_name:'property_hud_property_id',  field_table:'properties' },
  { label:'Total Units',     field_name:'property_total_units',      field_table:'properties' },
  { label:'Account Name',    field_name:'property_account_id',       field_table:'accounts' },
]
check('RPT-00021: curated labels are kept verbatim',
  resolveReportColumnLabels(rpt21, opts('properties')).map(f => f.label),
  ['Property Name', 'Street Address', 'City', 'ZIP Code', 'HUD Property ID', 'Total Units', 'Account Name'])

check('derived label is recognised', isDerivedLabel('Name', rpt41[0], opts('opportunities')), true)
check('curated label is recognised', isDerivedLabel('Street Address', rpt21[1], opts('properties')), false)
check('an empty label is derived', isDerivedLabel('', rpt41[0], opts('opportunities')), true)
check('the qualified label is itself derived', isDerivedLabel('Property Name', rpt41[0], opts('opportunities')), true)

// ── Legacy descriptor shape ─────────────────────────────────────────────────
// A field with no via_path is a column on the PRIMARY object, whatever the
// stored `table` says — the pre-Builder rows recorded the FK's target there.
check('legacy: no via_path means the primary object owns the column',
  normalizeFieldDescriptor({ field_name:'property_account_id', field_table:'accounts' }, 'properties').table,
  'properties')
check('legacy: a via_path field keeps its own table',
  normalizeFieldDescriptor({ name:'account_name', table:'accounts', via_path:['property_account_id'] }, 'properties').table,
  'accounts')
check('a descriptor with no name resolves to null', normalizeFieldDescriptor({ table:'properties' }, 'properties'), null)
check('an empty field list resolves to an empty list', resolveReportColumnLabels([], opts('properties')), [])
check('a null field list does not throw', resolveReportColumnLabels(null, opts('properties')), [])

// ── Objects with no prefix map entry ────────────────────────────────────────
check('unmapped object: identity field still names its object',
  deriveReportColumnLabel({ name:'work_step_name', table:'work_steps', via_path:null }, opts('work_steps')),
  'Work Step Name')
check('unmapped object: non-identity field stays short',
  deriveReportColumnLabel({ name:'work_step_status', table:'work_steps', via_path:null }, opts('work_steps')),
  'Status')

// ── Multi-hop paths ─────────────────────────────────────────────────────────
// Only the first hop leaves the primary object, so only it can carry the
// primary object's column prefix. A later hop keeps its column name whole,
// which is what says the account was reached through the property.
check('two hops are named for the hop that reached the object',
  deriveReportColumnLabel({ name:'account_name', table:'accounts', via_path:['property_id','property_account_id'] }, opts('opportunities')),
  'Property Account Name')
check('the account on the opportunity and the account on its property read differently',
  resolveReportColumnLabels([
    { name:'account_name', table:'accounts', via_path:['property_id','property_account_id'], type:'text' },
    { name:'account_name', table:'accounts', via_path:['opportunity_account_id'], type:'text' },
  ], opts('opportunities')).map(f => f.label),
  ['Property Account Name', 'Account Name'])

// A real collision: the opportunity's own snapshot column and the property's
// live name would both read "Property Name". The one that can be widened is.
check('a collision widens the column that has an object to widen with',
  resolveReportColumnLabels([
    { name:'opportunity_property_name', table:'opportunities', via_path:null, type:'text' },
    { name:'property_name', table:'properties', via_path:['property_id'], type:'text' },
  ], opts('opportunities')).map(f => f.label),
  ['Opportunity Property Name', 'Property Name'])

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} FAILED`)
  process.exit(1)
}
