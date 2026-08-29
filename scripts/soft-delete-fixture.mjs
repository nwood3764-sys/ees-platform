// Fixture test for resolving a table's soft-delete flag.
//
// The rule matters because LEAP never hard-deletes. A query that misses the
// flag shows the recycle bin: deleted accounts in a lookup picker, deleted
// properties in a list. The previous inline rule derived the column from the
// TABLE NAME (`table.replace(/s$/, '')`) and so missed "properties" and
// "opportunities" entirely — the two biggest objects in the platform.
//
// Run with: node scripts/soft-delete-fixture.mjs

import { resolveSoftDeleteColumn, hasSoftDelete } from '../src/lib/softDeleteColumn.js'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { failures += 1; console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`) }
}

// ── The tables the old name-derived rule got wrong ─────────────────────────
check('properties (the old rule looked for "propertie_is_deleted")',
  resolveSoftDeleteColumn(['id', 'property_name', 'property_is_deleted']), 'property_is_deleted')
check('opportunities (the old rule looked for "opportunitie_is_deleted")',
  resolveSoftDeleteColumn(['id', 'opportunity_name', 'opportunity_is_deleted']), 'opportunity_is_deleted')
check('activities',
  resolveSoftDeleteColumn(['id', 'activity_is_deleted']), 'activity_is_deleted')

// ── The ones it got right, which must keep working ─────────────────────────
check('accounts', resolveSoftDeleteColumn(['id', 'account_name', 'account_is_deleted']), 'account_is_deleted')
check('buildings', resolveSoftDeleteColumn(['building_is_deleted']), 'building_is_deleted')
check('work_orders', resolveSoftDeleteColumn(['work_order_is_deleted']), 'work_order_is_deleted')

// ── Bare and mixed spellings ───────────────────────────────────────────────
check('a table using the bare flag', resolveSoftDeleteColumn(['id', 'is_deleted']), 'is_deleted')
check('prefixed wins over bare when both exist',
  resolveSoftDeleteColumn(['is_deleted', 'saved_list_view_is_deleted']), 'saved_list_view_is_deleted')
check('the shortest prefixed flag wins',
  resolveSoftDeleteColumn(['a_very_long_thing_is_deleted', 'unit_is_deleted']), 'unit_is_deleted')

// ── Tables with no flag at all ─────────────────────────────────────────────
check('a table with no soft delete', resolveSoftDeleteColumn(['id', 'al_performed_at']), null)
check('no columns at all', resolveSoftDeleteColumn([]), null)
check('nothing', resolveSoftDeleteColumn(null), null)
check('a Set is accepted as well as an array',
  resolveSoftDeleteColumn(new Set(['id', 'contact_is_deleted'])), 'contact_is_deleted')
check('a column merely CONTAINING the words is not the flag',
  resolveSoftDeleteColumn(['id', 'is_deleted_reason', 'deletion_reason']), null)

check('hasSoftDelete says yes', hasSoftDelete(['property_is_deleted']), true)
check('hasSoftDelete says no', hasSoftDelete(['id']), false)

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) { console.error(`${failures} failing`); process.exit(1) }
