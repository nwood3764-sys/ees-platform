#!/usr/bin/env node
// =============================================================================
// soft-delete-column-fixture — the list view must not show deleted records.
//
// The guard that excludes soft-deleted rows resolved its column by
// SINGULARIZING THE TABLE NAME (`table.replace(/s$/,'') + '_is_deleted'`).
// That produces 'opportunitie_is_deleted' and 'propertie_is_deleted', columns
// which do not exist, so the guard resolved to null and the filter was
// dropped: the Properties list rendered 4,871 deleted properties among 21,535,
// and the Opportunities list rendered the duplicate a user had just deleted.
//
// It survived because it happens to work on `accounts` — where the platform's
// most visible soft-delete event lived (981 merged duplicates) — so spot
// checks looked right.
//
// These are the real column names from the live schema, including every shape
// that broke it: -ies plurals, abbreviation prefixes (ia_, oli_, sa_, ha_),
// multi-word tables, a bare `is_deleted`, and tables with no soft-delete
// column at all (where the answer must be null, not a guess).
// =============================================================================

import { softDeleteColumnFor, liveRecordsFilter } from '../src/lib/softDeleteColumn.js'

let checks = 0
const failures = []
function eq(actual, expected, label) {
  checks++
  if (actual !== expected) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// table -> [real columns (abridged), expected soft-delete column]
const REAL = [
  ['opportunities',          ['id', 'opportunity_name', 'opportunity_is_deleted', 'property_id'], 'opportunity_is_deleted'],
  ['properties',             ['id', 'property_name', 'property_is_deleted'],                      'property_is_deleted'],
  ['activities',             ['id', 'activity_subject', 'activity_is_deleted'],                   'activity_is_deleted'],
  ['accounts',               ['id', 'account_name', 'account_is_deleted'],                        'account_is_deleted'],
  ['incentive_applications', ['id', 'ia_name', 'ia_is_deleted'],                                  'ia_is_deleted'],
  ['opportunity_line_items', ['id', 'oli_quantity', 'oli_is_deleted'],                            'oli_is_deleted'],
  ['service_appointments',   ['id', 'sa_record_number', 'sa_is_deleted'],                         'sa_is_deleted'],
  ['help_articles',          ['id', 'ha_title', 'ha_is_deleted'],                                 'ha_is_deleted'],
  ['work_orders',            ['id', 'work_order_name', 'work_order_is_deleted'],                  'work_order_is_deleted'],
  ['work_steps',             ['id', 'work_step_name', 'work_step_is_deleted'],                    'work_step_is_deleted'],
  ['photos',                 ['id', 'file_url', 'is_deleted'],                                    'is_deleted'],
  ['units',                  ['id', 'unit_name', 'unit_is_deleted'],                              'unit_is_deleted'],
  ['buildings',              ['id', 'building_name', 'building_is_deleted'],                      'building_is_deleted'],
  ['projects',               ['id', 'project_name', 'project_is_deleted'],                        'project_is_deleted'],
  ['assessments',            ['id', 'assessment_is_deleted'],                                     'assessment_is_deleted'],
  ['enrollments',            ['id', 'enrollment_is_deleted'],                                     'enrollment_is_deleted'],
]

for (const [table, columns, expected] of REAL) {
  eq(softDeleteColumnFor(columns), expected, `${table} (array)`)
  eq(softDeleteColumnFor(new Set(columns)), expected, `${table} (Set)`)
  eq(softDeleteColumnFor(columns.map(c => ({ column_name: c }))), expected, `${table} (descriptors)`)
}

// The rule this replaces, applied to the same tables. Every mismatch below is
// a list that was showing deleted records; if this ever stops finding them the
// fixture has lost its point.
const naive = t => `${t.replace(/s$/, '')}_is_deleted`
const brokenBy = REAL.filter(([t, , expected]) => naive(t) !== expected && expected !== 'is_deleted')
checks++
if (brokenBy.length < 6) {
  failures.push(`expected the table-name rule to fail on at least 6 of these tables, it failed on ${brokenBy.length}`)
}
for (const [table, columns, expected] of brokenBy) {
  // The old rule found nothing at all on these — which is why the filter was
  // skipped rather than erroring.
  eq(columns.includes(naive(table)), false, `${table}: '${naive(table)}' must not be a real column`)
  eq(softDeleteColumnFor(columns), expected, `${table}: resolver still finds the real column`)
}

// No soft-delete column: the honest answer is null, so the caller applies no
// filter instead of querying a column that does not exist (which 400s the
// whole fetch).
eq(softDeleteColumnFor(['id', 'al_action', 'al_performed_at']), null, 'audit_log has no soft-delete column')
eq(softDeleteColumnFor([]), null, 'empty column set')
eq(softDeleteColumnFor(null), null, 'null column set')
eq(softDeleteColumnFor(undefined), null, 'undefined column set')

// A bare is_deleted wins over any prefixed column that might also be present.
eq(softDeleteColumnFor(['other_is_deleted', 'is_deleted']), 'is_deleted', 'bare is_deleted wins')

// Columns that merely mention deletion are not the flag.
eq(softDeleteColumnFor(['id', 'opportunity_deleted_at', 'opportunity_deleted_by']), null,
   'deleted_at / deleted_by are not the flag')
eq(softDeleteColumnFor(['id', 'property_deletion_reason']), null, 'deletion_reason is not the flag')

// The live-rows clause treats NULL as live — 70 soft-delete columns are
// nullable, and hiding a row whose flag was never stamped is the worse error.
eq(liveRecordsFilter('ia_is_deleted'), 'ia_is_deleted.is.null,ia_is_deleted.eq.false', 'live filter clause')
eq(liveRecordsFilter('is_deleted'), 'is_deleted.is.null,is_deleted.eq.false', 'live filter clause (bare)')
eq(liveRecordsFilter(null), null, 'no column -> no filter')

if (failures.length) {
  console.error('✗ soft-delete-column fixture FAILED\n')
  for (const f of failures) console.error(`  • ${f}`)
  process.exit(1)
}
console.log(`soft-delete-column fixture: ${checks} checks passed — ${brokenBy.length} tables the table-name rule got wrong`)
