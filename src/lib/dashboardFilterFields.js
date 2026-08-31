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
  // A key present but empty is a deliberate "this filter does not apply here" —
  // the editor's "not filtered" choice. It must NOT fall through to the
  // filter's own column, or an object whose columns happen to be spelled the
  // same way gets filtered after someone explicitly excluded it.
  if (map && primaryObject && Object.prototype.hasOwnProperty.call(map, primaryObject)) {
    return map[primaryObject] || null
  }
  return filter.field_name || filter.dfilt_field_name || null
}

/**
 * A set of column NAMES from whatever a caller has to hand.
 *
 * The two natural shapes both turn up: a bare list of names (a describe result
 * reduced to strings) and the field descriptors the editor renders
 * ({name,label,type}). Taking only one of them is how a lookup silently misses
 * every column and a filter is reported as reaching nothing — which is exactly
 * what the browser check caught, and what no unit test written in one shape
 * ever would.
 */
function columnNameSet(columns) {
  if (columns instanceof Set) return columns
  const out = new Set()
  for (const c of (columns || [])) {
    if (typeof c === 'string') out.add(c)
    else if (c && typeof c === 'object' && c.name) out.add(c.name)
  }
  return out
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
  const cols = columnNameSet(targetColumns)
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
    const cols = columnNameSet(o.columns)
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

/**
 * The columns a dashboard's controls own on ONE object.
 *
 * An override column is how a dashboard filter beats the widget report's own
 * saved filter on the same column — setting State to "All" has to clear the
 * report's built-in `property_state = NC`, not AND with it. Since the column
 * differs per object, the override list has to be resolved per object too.
 *
 * Entries may be a plain column name (an on-canvas filter widget, which names
 * one column) or a filter carrying its map. A filter that resolves to nothing
 * here owns nothing here, which is right: it is not filtering this object.
 */
export function resolveOverrideColumns(overrideFields, primaryObject) {
  const out = new Set()
  for (const o of (overrideFields || [])) {
    if (!o) continue
    if (typeof o === 'string') { out.add(o); continue }
    const col = filterColumnForObject(o, primaryObject)
    if (col) out.add(col)
  }
  return out
}

/**
 * The dashboard filters that actually apply to one object, each rewritten to
 * the column it uses THERE.
 *
 * A filter that resolves to a column the object does not have is dropped — the
 * long-standing behaviour, and the only safe one at run time, since inventing a
 * column would error the whole widget. What is new is that it now gets a chance
 * to resolve: before this, `property_state` was simply absent from every
 * non-property widget and the filter silently did nothing there.
 */
export function resolveExtraFilters(extraFilters, primaryObject, columns) {
  const cols = columnNameSet(columns)
  const out = []
  for (const ef of (extraFilters || [])) {
    if (!ef) continue
    const col = filterColumnForObject(ef, primaryObject)
    if (!col || !cols.has(col)) continue
    out.push({ ...ef, field_name: col })
  }
  return out
}

/**
 * The dashboard filters that do NOT reach one object — the other half of
 * resolveExtraFilters, and the half a reader needs.
 *
 * A filter that cannot be applied to a widget is dropped at run time, which is
 * the only safe thing to do; what was missing is any sign of it. Two widgets
 * side by side, one filtered to NC and one showing every state, look exactly
 * alike. The widget can now say so.
 *
 * Only filters that are actually SET count: one left on "All" is filtering
 * nothing anywhere, so naming it would be noise.
 */
export function unappliedFilters(extraFilters, primaryObject, columns) {
  const cols = columnNameSet(columns)
  const out = []
  for (const ef of (extraFilters || [])) {
    if (!ef) continue
    const col = filterColumnForObject(ef, primaryObject)
    if (col && cols.has(col)) continue
    out.push(ef.label || ef.field_name || 'Filter')
  }
  return out
}
