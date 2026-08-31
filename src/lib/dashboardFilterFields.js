// ---------------------------------------------------------------------------
// dashboardFilterFields — one dashboard filter, the right column on every object.
//
// Nicholas, 2026-08-31: "we definitely need a dashboard-level filter for states
// and things, just like Salesforce."
//
// A dashboard filter already existed, but it carried ONE column name and every
// widget got it. A widget whose report is on another object simply does not have
// that column — and the runner's rule for a filter it cannot apply is
// `continue`. So on a dashboard mixing properties, opportunities and
// enrollments, setting State to NC filtered the property widgets and left the
// others showing every state, with nothing on screen to say so. Numbers that are
// quietly answering different questions, side by side.
//
// Salesforce solves this by letting one filter name its equivalent field per
// object. That is what `dfilt_field_map` is: { object → column }, with the
// filter's own field as the fallback.
//
// Pure module: no React, no network. Fixture-tested by
// scripts/dashboard-filter-fields-fixture.mjs.
// ---------------------------------------------------------------------------

/**
 * The column a filter uses on one object.
 * @param filter { field_name, field_map }
 * @param primaryObject the widget report's object
 * @returns the column name, or null when this filter has nothing to say here.
 */
export function filterColumnForObject(filter, primaryObject) {
  if (!filter) return null
  const map = filter.field_map || filter.dfilt_field_map || null
  if (map && primaryObject && map[primaryObject]) return map[primaryObject]
  return filter.field_name || filter.dfilt_field_name || null
}

/**
 * A field's meaning, stripped of the object prefix its table happens to use:
 * `property_state` and `opportunity_state` are both "state". This is what lets
 * an equivalent be proposed on another object instead of typed by hand.
 *
 * The prefix is only stripped when it actually matches the object's own naming
 * (`property_` on `properties`), never blindly at the first underscore — that
 * would turn `service_territory_id` into `territory_id` and propose nonsense.
 */
export function fieldMeaning(column, table) {
  if (!column) return ''
  const prefixes = candidatePrefixes(table)
  for (const p of prefixes) {
    if (column.startsWith(`${p}_`) && column.length > p.length + 1) return column.slice(p.length + 1)
  }
  return column
}

// The prefixes a table's columns plausibly carry: the singular of the table name
// and, for the two-word tables, its initials-free form. `properties` →
// 'property'; `incentive_applications` → 'incentive_application' and 'ia'.
function candidatePrefixes(table) {
  if (!table) return []
  const t = String(table)
  const singular = t.endsWith('ies') ? `${t.slice(0, -3)}y` : (t.endsWith('s') ? t.slice(0, -1) : t)
  const initials = singular.split('_').map(w => w[0]).join('')
  return [singular, initials].filter(p => p && p.length >= 2)
}

/**
 * Propose the equivalent column for a filter on another object.
 *
 * Two candidates, in order, and BOTH must exist on the target — a proposal that
 * names a column the object does not have is worse than no proposal, because it
 * silently filters nothing:
 *   1. the same column name (shared columns like `state` or `program_id`)
 *   2. the same meaning under the target's own prefix
 *      (`property_state` → `opportunity_state`)
 */
export function proposeEquivalentColumn(sourceColumn, sourceTable, targetTable, targetColumns) {
  const cols = targetColumns instanceof Set ? targetColumns : new Set(targetColumns || [])
  if (!sourceColumn || !targetTable) return null
  if (cols.has(sourceColumn)) return sourceColumn
  const meaning = fieldMeaning(sourceColumn, sourceTable)
  for (const p of candidatePrefixes(targetTable)) {
    const candidate = `${p}_${meaning}`
    if (cols.has(candidate)) return candidate
  }
  if (cols.has(meaning)) return meaning
  return null
}

/**
 * Which objects a filter reaches, and which it does not — so the editor can SAY
 * so instead of leaving the reader to discover it from a wrong number.
 *
 * @param objects [{ table, columns:Set<string> }] one per distinct object on the dashboard
 * @returns { covered: [{table, column}], uncovered: [table] }
 */
export function filterCoverage(filter, objects) {
  const covered = [], uncovered = []
  for (const o of (objects || [])) {
    if (!o?.table) continue
    const col = filterColumnForObject(filter, o.table)
    const cols = o.columns instanceof Set ? o.columns : new Set(o.columns || [])
    if (col && cols.has(col)) covered.push({ table: o.table, column: col })
    else uncovered.push(o.table)
  }
  return { covered, uncovered }
}

/** Build the initial per-object map when a filter's field is chosen. */
export function buildFieldMap(sourceColumn, sourceTable, objects) {
  const map = {}
  for (const o of (objects || [])) {
    if (!o?.table || o.table === sourceTable) continue
    const col = proposeEquivalentColumn(sourceColumn, sourceTable, o.table, o.columns)
    if (col) map[o.table] = col
  }
  return map
}
