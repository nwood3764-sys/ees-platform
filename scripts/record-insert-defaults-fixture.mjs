// Fixture: a new record carries an owner, whatever object it is.
//
// "Create failed — null value in column "sa_owner" of relation
//  "service_appointments" violates not-null constraint"
//
// A Service Appointment could not be created from the UI. Nor could most
// objects: applyInsertDefaults carried a hand-written map of about 34 table →
// column prefixes, and 86 tables have a NOT NULL owner column. Roughly 54
// objects were uncreatable, and every object added to LEAP after the map was
// written joined them in silence. The map was the defect — the same shape as
// the URL/display allowlists (2026-08-24) and the four hand-rolled picker
// option maps (2026-08-31).
//
// The rule is now derived from the table's real columns, anchored on
// `<prefix>_record_number`. This pins WHY that anchor and not the obvious ones,
// using real column sets taken from production:
//
//   * `_owner` is NOT safe to search for. Four tables carry more than one such
//     column, so the search is decided by declaration order — which nothing
//     guarantees. The CONTROL below runs the naive rule over
//     property_hud_match_review's real column order and requires it to pick
//     phmr_source_owner, a business text field, ahead of the record's own
//     phmr_owner. If it ever stops doing so, this fixture is testing nothing.
//   * The TABLE NAME is not safe either: saved_list_views prefixes its columns
//     `list_view_`.
//
// Run with:  node scripts/record-insert-defaults-fixture.mjs

import {
  resolveInsertAuditColumns,
  applyRecordInsertDefaults,
  RECORD_NUMBER_PLACEHOLDER,
} from '../src/lib/recordInsertDefaults.js'

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

const USER = '11111111-2222-3333-4444-555555555555'

// ── Column sets, verbatim shapes from production ───────────────────────────
const TABLES = {
  // The one that failed.
  service_appointments: [
    'id', 'sa_record_number', 'sa_name', 'sa_owner', 'sa_created_by', 'sa_created_at',
    'sa_updated_by', 'sa_is_deleted', 'work_order_id', 'work_type_id', 'contact_id',
    'sa_scheduled_start_time', 'sa_scheduled_end_time', 'sa_status',
  ],
  // Four columns end in _owner; exactly one is the record owner.
  assessments: [
    'id', 'assessment_record_number', 'assessment_owner', 'assessment_created_by',
    'assessment_building_owner',
    'assessment_is_the_applicant_the_building_owner',
    'assessment_permission_to_apply_on_behalf_of_owner',
    'property_id', 'building_id',
  ],
  // The prefix is nothing like the table name.
  saved_list_views: [
    'id', 'list_view_record_number', 'list_view_owner', 'list_view_created_by',
    'list_view_name', 'list_view_object',
  ],
  // Predates the prefixed-column convention: prefixed record number, BARE
  // owner_id / created_by.
  email_templates: [
    'id', 'et_record_number', 'owner_id', 'created_by', 'et_name', 'et_subject',
  ],
  // Mixed: prefixed owner, bare created_by.
  envelopes: [
    'id', 'env_record_number', 'env_owner', 'created_by', 'env_status',
  ],
  // A child object with no owner at all — it belongs to its parent.
  opportunity_contact_roles: [
    'id', 'ocr_record_number', 'ocr_created_by', 'ocr_name', 'opportunity_id', 'contact_id',
  ],
  // Real ordinal order: the two business owner columns are declared BEFORE the
  // record's own owner, so a first-match search on `_owner` picks the wrong one.
  property_hud_match_review: [
    'id', 'phmr_record_number', 'phmr_created_by', 'phmr_source_owner',
    'phmr_candidate_owner', 'phmr_owner', 'phmr_match_status',
  ],
  work_orders: [
    'id', 'work_order_record_number', 'work_order_owner', 'work_order_created_by',
    'work_order_name', 'work_order_status', 'assigned_technician_id',
  ],
  // Short prefix, previously an explicit else-if branch.
  incentive_applications: [
    'id', 'ia_record_number', 'ia_owner', 'ia_created_by',
    'ia_multiple_properties_same_owner',
  ],
}

// ── The anchor resolves correctly on every shape ───────────────────────────
check('service_appointments — the object that could not be created',
  resolveInsertAuditColumns(TABLES.service_appointments),
  { prefix: 'sa', recordNumberColumn: 'sa_record_number',
    ownerColumn: 'sa_owner', createdByColumn: 'sa_created_by' })

check('assessments — the record owner, not one of the three business fields',
  resolveInsertAuditColumns(TABLES.assessments).ownerColumn, 'assessment_owner')

check('saved_list_views — a prefix no table-name rule derives',
  resolveInsertAuditColumns(TABLES.saved_list_views),
  { prefix: 'list_view', recordNumberColumn: 'list_view_record_number',
    ownerColumn: 'list_view_owner', createdByColumn: 'list_view_created_by' })

check('email_templates — bare owner_id / created_by beside a prefixed record number',
  resolveInsertAuditColumns(TABLES.email_templates),
  { prefix: 'et', recordNumberColumn: 'et_record_number',
    ownerColumn: 'owner_id', createdByColumn: 'created_by' })

check('envelopes — prefixed owner, bare created_by',
  resolveInsertAuditColumns(TABLES.envelopes),
  { prefix: 'env', recordNumberColumn: 'env_record_number',
    ownerColumn: 'env_owner', createdByColumn: 'created_by' })

check('a child object with no owner column reports none, rather than inventing one',
  resolveInsertAuditColumns(TABLES.opportunity_contact_roles).ownerColumn, null)

check('incentive_applications — ia_owner, not ia_multiple_properties_same_owner',
  resolveInsertAuditColumns(TABLES.incentive_applications).ownerColumn, 'ia_owner')

// ── CONTROL: the naive rules, which MUST get it wrong ──────────────────────
// If either of these starts agreeing with the real rule, the traps they model
// are gone from the schema and these checks are no longer protecting anything.
const naiveByOwnerSuffix = cols => cols.find(c => c.endsWith('_owner')) || null
check('CONTROL: "any column ending in _owner" picks a BUSINESS field',
  naiveByOwnerSuffix(TABLES.property_hud_match_review), 'phmr_source_owner')
check('CONTROL: ...and the real rule picks the record owner instead',
  resolveInsertAuditColumns(TABLES.property_hud_match_review).ownerColumn, 'phmr_owner')
// On `assessments` the naive rule happens to land right, because the record
// owner was declared at ordinal 5 and the business fields at 77/190/216. That
// is luck, not correctness, and it is the reason the rule cannot rest on order.
check('CONTROL: on another table the same naive rule happens to be right — by luck',
  naiveByOwnerSuffix(TABLES.assessments), 'assessment_owner')

const naiveByTableName = (table, cols) => {
  const guess = table.replace(/ies$/, 'y').replace(/s$/, '')
  return cols.includes(`${guess}_owner`) ? `${guess}_owner` : null
}
check('CONTROL: a table-name rule finds nothing on saved_list_views',
  naiveByTableName('saved_list_views', TABLES.saved_list_views), null)
check('CONTROL: ...and the real rule finds it',
  resolveInsertAuditColumns(TABLES.saved_list_views).ownerColumn, 'list_view_owner')

// ── What actually lands in the insert ──────────────────────────────────────
{
  const fields = applyRecordInsertDefaults(TABLES.service_appointments,
    { work_order_id: 'wo-1' }, USER)
  check('the failing insert now carries every NOT NULL column',
    fields,
    { work_order_id: 'wo-1', sa_record_number: RECORD_NUMBER_PLACEHOLDER,
      sa_owner: USER, sa_created_by: USER })
}

{
  // Assigning a record to somebody else on the create form must survive.
  const fields = applyRecordInsertDefaults(TABLES.work_orders,
    { work_order_owner: 'someone-else' }, USER)
  check('an owner chosen deliberately is not overwritten', fields.work_order_owner, 'someone-else')
  check('...but created_by is still the person who made it', fields.work_order_created_by, USER)
}

{
  const fields = applyRecordInsertDefaults(TABLES.assessments, {}, USER)
  check('no business field is ever stamped with a user id',
    [fields.assessment_building_owner,
     fields.assessment_is_the_applicant_the_building_owner,
     fields.assessment_permission_to_apply_on_behalf_of_owner],
    [undefined, undefined, undefined])
  check('and the real owner is', fields.assessment_owner, USER)
}

{
  const fields = applyRecordInsertDefaults(TABLES.opportunity_contact_roles, {}, USER)
  check('a child object gets a record number and created_by, and no owner key at all',
    Object.keys(fields).sort(), ['ocr_created_by', 'ocr_record_number'])
}

{
  // A record number already supplied (an import, a clone) is left alone.
  const fields = applyRecordInsertDefaults(TABLES.work_orders,
    { work_order_record_number: 'WO-00243' }, USER)
  check('a supplied record number is not replaced by the placeholder',
    fields.work_order_record_number, 'WO-00243')
}

// ── Degenerate input must not throw; a create is in flight ─────────────────
check('no columns yields nothing rather than an error',
  resolveInsertAuditColumns([]),
  { prefix: null, recordNumberColumn: null, ownerColumn: null, createdByColumn: null })
check('a table with no record number yields nothing',
  resolveInsertAuditColumns(['id', 'some_owner', 'created_by']).ownerColumn, null)
check('undefined does not throw', resolveInsertAuditColumns(undefined).prefix, null)
check('a missing user id leaves the owner unset rather than writing "undefined"',
  applyRecordInsertDefaults(TABLES.work_orders, {}, null).work_order_owner, undefined)
check('...and still supplies the record number, which the trigger needs',
  applyRecordInsertDefaults(TABLES.work_orders, {}, null).work_order_record_number,
  RECORD_NUMBER_PLACEHOLDER)

// ── The enumeration is really gone ─────────────────────────────────────────
// A list that still exists is a list that drifts.
{
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/data/layoutService.js', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('export async function applyInsertDefaults'),
                         src.indexOf('const _tableColumnNamesCache'))
  check('applyInsertDefaults no longer enumerates table names',
    /TABLE_PREFIX|tableName === '/.test(body), false)
  check('it derives from the table’s real columns instead',
    /applyRecordInsertDefaults\(columns, fields, userId\)/.test(body), true)
  check('and it is async, because reading the columns is a round trip',
    /export async function applyInsertDefaults/.test(src), true)

  // Every call site must await it, or the insert gets a Promise for a payload.
  for (const file of ['src/components/RecordDetail.jsx', 'src/data/opportunityProductsService.js']) {
    const callerSrc = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    const unawaited = callerSrc.split('\n').filter(l =>
      /applyInsertDefaults\(/.test(l) && !/await applyInsertDefaults\(/.test(l))
    check(`${file}: every call awaits it`, unawaited, [])
  }
}

console.log(failures === 0
  ? `record-insert-defaults fixture: ${checks} checks passed`
  : `record-insert-defaults fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
