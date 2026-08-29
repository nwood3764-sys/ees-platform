// ---------------------------------------------------------------------------
// softDeleteColumn — which column marks a record as deleted.
//
// LEAP never hard-deletes: block_hard_delete() is on every table and each one
// carries a `<object>_is_deleted` flag. Any query that forgets it is showing
// the recycle bin — 1,001 deleted accounts, 4,871 deleted properties.
//
// The rule was previously written inline as `table.replace(/s$/, '')`, which is
// wrong for exactly the tables that matter most: "properties" became
// "propertie" and "opportunities" became "opportunitie", so no flag was found
// and NOTHING was filtered. Naming the column from the table is guesswork; the
// column list is the fact. So this reads the schema instead of the table name.
//
// Pure module: no network. Fixture-tested by scripts/soft-delete-fixture.mjs.
// ---------------------------------------------------------------------------

/**
 * The soft-delete flag among a table's real column names, or null when the
 * table has none (a join table, a log, a view-backed object).
 *
 * A prefixed flag (`property_is_deleted`) wins over a bare `is_deleted` when a
 * table somehow carries both — the prefixed spelling is the platform
 * convention, and the bare one on such a table is the legacy leftover.
 */
export function resolveSoftDeleteColumn(columnNames) {
  const names = Array.isArray(columnNames)
    ? columnNames
    : Array.from(columnNames || [])
  let bare = null
  const prefixed = []
  for (const n of names) {
    if (typeof n !== 'string') continue
    if (n === 'is_deleted') { bare = n; continue }
    if (n.endsWith('_is_deleted')) prefixed.push(n)
  }
  if (prefixed.length > 0) {
    // Shortest wins, so `property_is_deleted` beats a longer unrelated column
    // that happens to end the same way.
    prefixed.sort((a, b) => a.length - b.length || a.localeCompare(b))
    return prefixed[0]
  }
  return bare
}

/** True when the table keeps a soft-delete flag at all. */
export function hasSoftDelete(columnNames) {
  return resolveSoftDeleteColumn(columnNames) !== null
}
