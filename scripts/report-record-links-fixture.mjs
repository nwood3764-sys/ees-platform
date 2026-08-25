// Fixture test for record links in report cells.
//
// Nicholas, 2026-08-25: "the property and the opportunity have to be
// hyperlinked so we can click into them on the reports." Before this, only
// the first column of a report linked anywhere — so RPT-00041, which lists a
// property, its building and the opportunity, was a dead end in two columns
// out of three.
//
// What this pins is the DECISION, made per column from the report definition
// rather than per cell from what a value looks like: a stage is not a record,
// a related object's city is not a record, and a reference that is null on
// this row is not a link.
//
// Run with:  node scripts/report-record-links-fixture.mjs

import { recordLinkForField, resolveRowRecordLink } from '../src/lib/reportRecordLinks.js'

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

const prefixFor = (t) => ({
  properties: 'property', accounts: 'account', opportunities: 'opportunity',
  buildings: 'building', work_orders: 'work_order',
}[t] || null)
const opts = { prefixFor }

// The FK lookup the runner builds from describe_object_columns. These are the
// real shapes for `opportunities` on prod: opportunity_stage is a FK too —
// onto picklist_values — and must NOT become a link.
const fkLookup = {
  'opportunities.property_id':            { references_table: 'properties', name_column: 'property_name' },
  'opportunities.building_id':            { references_table: 'buildings',  name_column: 'building_name' },
  'opportunities.opportunity_account_id': { references_table: 'accounts',   name_column: 'account_name' },
  'opportunities.opportunity_stage':      { references_table: 'picklist_values', is_picklist: true },
}

// ── Which columns are records ───────────────────────────────────────────────
check('the primary object\'s own name is this row\'s record',
  recordLinkForField({ name:'opportunity_name', table:'opportunities', via_path:null }, 'opportunities', fkLookup, opts),
  { table: 'opportunities', source: 'row' })

check('the primary object\'s record number is this row\'s record too',
  recordLinkForField({ name:'opportunity_record_number', table:'opportunities', via_path:null }, 'opportunities', fkLookup, opts),
  { table: 'opportunities', source: 'row' })

check('a lookup column points at the record it references',
  recordLinkForField({ name:'property_id', table:'opportunities', via_path:null, type:'uuid' }, 'opportunities', fkLookup, opts),
  { table: 'properties', source: 'fk', fk_column: 'property_id' })

check('a related object\'s own name points at that related record',
  recordLinkForField({ name:'property_name', table:'properties', via_path:['property_id'] }, 'opportunities', fkLookup, opts),
  { table: 'properties', source: 'embed', via_path: ['property_id'] })

check('a building reached through its FK links to the building',
  recordLinkForField({ name:'building_name', table:'buildings', via_path:['building_id'] }, 'opportunities', fkLookup, opts),
  { table: 'buildings', source: 'embed', via_path: ['building_id'] })

// ── Which columns are NOT records ───────────────────────────────────────────
check('a picklist FK is a value, not a record — a stage never links',
  recordLinkForField({ name:'opportunity_stage', table:'opportunities', via_path:null, type:'uuid' }, 'opportunities', fkLookup, opts),
  null)
check('a plain column on the primary object is not a record',
  recordLinkForField({ name:'opportunity_amount', table:'opportunities', via_path:null }, 'opportunities', fkLookup, opts),
  null)
check('a related object\'s city is not a record',
  recordLinkForField({ name:'property_city', table:'properties', via_path:['property_id'] }, 'opportunities', fkLookup, opts),
  null)
check('a descriptor with no name is not a record',
  recordLinkForField({ table:'properties' }, 'opportunities', fkLookup, opts), null)

// ── Resolving the id from a row ─────────────────────────────────────────────
// A row as PostgREST returns it for RPT-00041: direct columns, plus one
// embedded object per FK hop carrying the `id` the runner now selects.
const row = {
  id: 'opp-1',
  opportunity_name: '922 Tessie Street - Rocky Mount - 931 - NC-IRA-MF-HOMES',
  opportunity_stage: 'pv-income-qualification',
  property_id: 'prop-1',
  building_id: 'bld-1',
  _lbl_property_id: { property_name: '922 Tessie Street - Rocky Mount' },
}
const rowWithEmbeds = {
  ...row,
  property_id: { id: 'prop-1', property_name: '922 Tessie Street - Rocky Mount' },
  building_id: { id: 'bld-1', building_name: '922 Tessie Street - Rocky Mount - 931' },
}

const col = (name, table, via, link) => ({ name, table, via_path: via, _link: link })

check('the row\'s own record resolves from the row id',
  resolveRowRecordLink(rowWithEmbeds, col('opportunity_name','opportunities',null,{ table:'opportunities', source:'row' })),
  { table: 'opportunities', id: 'opp-1' })

check('an embedded property resolves from the embedded id',
  resolveRowRecordLink(rowWithEmbeds, col('property_name','properties',['property_id'],{ table:'properties', source:'embed', via_path:['property_id'] })),
  { table: 'properties', id: 'prop-1' })

check('an embedded building resolves from the embedded id',
  resolveRowRecordLink(rowWithEmbeds, col('building_name','buildings',['building_id'],{ table:'buildings', source:'embed', via_path:['building_id'] })),
  { table: 'buildings', id: 'bld-1' })

check('a lookup column resolves from the FK value on the row',
  resolveRowRecordLink(row, col('property_id','opportunities',null,{ table:'properties', source:'fk', fk_column:'property_id' })),
  { table: 'properties', id: 'prop-1' })

// ── Nothing to link to ──────────────────────────────────────────────────────
check('a null reference is not a link',
  resolveRowRecordLink({ id:'opp-2', building_id: null },
    col('building_id','opportunities',null,{ table:'buildings', source:'fk', fk_column:'building_id' })),
  null)
check('an embed that came back empty is not a link',
  resolveRowRecordLink({ id:'opp-2', building_id: null },
    col('building_name','buildings',['building_id'],{ table:'buildings', source:'embed', via_path:['building_id'] })),
  null)
check('an embed with no id is not a link',
  resolveRowRecordLink({ id:'opp-2', building_id: { building_name: 'x' } },
    col('building_name','buildings',['building_id'],{ table:'buildings', source:'embed', via_path:['building_id'] })),
  null)
check('a column with no link descriptor is not a link',
  resolveRowRecordLink(rowWithEmbeds, col('opportunity_amount','opportunities',null,undefined)), null)
check('a missing row is not a link',
  resolveRowRecordLink(null, col('opportunity_name','opportunities',null,{ table:'opportunities', source:'row' })), null)
check('an unsaved row has no record to open',
  resolveRowRecordLink({ opportunity_name:'draft' }, col('opportunity_name','opportunities',null,{ table:'opportunities', source:'row' })), null)

// ── Two hops ────────────────────────────────────────────────────────────────
check('a two-hop related name links to the object at the end of the path',
  recordLinkForField({ name:'account_name', table:'accounts', via_path:['property_id','property_account_id'] }, 'opportunities', fkLookup, opts),
  { table: 'accounts', source: 'embed', via_path: ['property_id','property_account_id'] })
check('a two-hop id resolves by walking the whole path',
  resolveRowRecordLink(
    { id:'opp-1', property_id: { id:'prop-1', property_account_id: { id:'acc-1', account_name:'Lutheran Social Services' } } },
    col('account_name','accounts',['property_id','property_account_id'],
      { table:'accounts', source:'embed', via_path:['property_id','property_account_id'] })),
  { table: 'accounts', id: 'acc-1' })

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} FAILED`)
  process.exit(1)
}
