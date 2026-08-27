// =============================================================================
// softDeleteColumn — ONE definition of "which column says this record is
// deleted", discovered from the table's real columns.
//
// Every list view, related list and record fetch has to exclude soft-deleted
// rows, and the column that carries the flag is named differently on almost
// every table:
//
//     accounts                → account_is_deleted
//     opportunities           → opportunity_is_deleted     (NOT opportunitie_)
//     properties              → property_is_deleted        (NOT propertie_)
//     incentive_applications  → ia_is_deleted
//     opportunity_line_items  → oli_is_deleted
//     service_appointments    → sa_is_deleted
//     help_articles           → ha_is_deleted
//     photos                  → is_deleted                 (bare)
//
// Two places used to derive it from the TABLE NAME instead, as
// `table.replace(/s$/, '') + '_is_deleted'`. That rule is wrong on 116 of the
// platform's 188 soft-deletable tables — every table whose prefix is an
// abbreviation, and every plural ending in -ies, where it produces
// "opportunitie_is_deleted" and "propertie_is_deleted". Those columns do not
// exist, so the guard resolved to null and the filter was silently DROPPED:
// the list rendered deleted records as though they were live.
//
// It went unnoticed for so long because it happens to work on `accounts`,
// which is where the platform's largest soft-delete event lived (the 981
// merged-away duplicates of 2026-07-25) — those did disappear, so the filter
// looked correct. Meanwhile the Properties list was showing 4,871 deleted
// properties among 21,535, and the Opportunities list was showing the
// duplicate a user had just deleted (Nicholas, 2026-08-27).
//
// The rule here is the one the database itself uses (ees_table_metadata):
// read the columns, take the one that carries the flag. No table has more
// than one — verified across all 188 — so the answer is unambiguous, and a
// table added tomorrow works without anyone editing a list.
// =============================================================================

/**
 * The soft-delete column for a table, from its real column names.
 *
 * @param columns  an iterable of column names, a Set of them, or an array of
 *                 describeObject() descriptors ({ column_name, ... }).
 * @returns the column name, or null when the table has no soft-delete column
 *          (a genuine answer for join tables and append-only logs — the caller
 *          must then apply no filter rather than guess a column name).
 */
export function softDeleteColumnFor(columns) {
  const names = normalizeColumnNames(columns)
  // A bare `is_deleted` is exact and wins outright.
  if (names.has('is_deleted')) return 'is_deleted'
  for (const name of names) {
    if (name.endsWith('_is_deleted')) return name
  }
  return null
}

function normalizeColumnNames(columns) {
  if (!columns) return new Set()
  if (columns instanceof Set) return columns
  if (Array.isArray(columns)) {
    return new Set(columns.map(c => (typeof c === 'string' ? c : c?.column_name)).filter(Boolean))
  }
  if (typeof columns[Symbol.iterator] === 'function') {
    return new Set([...columns].map(c => (typeof c === 'string' ? c : c?.column_name)).filter(Boolean))
  }
  return new Set()
}

/**
 * The PostgREST `or` clause that keeps only live rows.
 *
 * NULL counts as LIVE: 70 of the soft-delete columns are nullable, and reading
 * "we don't know" as "deleted" is the more damaging of the two mistakes.
 * Returns null when there is no column, which the caller must read as "apply
 * no filter".
 *
 * NOT for the object list-view query, which stays on a plain `.eq(column,
 * false)`: an `.or(...is.null...)` there was found to error on some tables and
 * return nothing when combined with the scoped embed a related-list "View All"
 * builds. Column discovery is what was broken in that query — not the
 * comparison — so the comparison is left exactly as it was.
 */
export function liveRecordsFilter(column) {
  if (!column) return null
  return `${column}.is.null,${column}.eq.false`
}
