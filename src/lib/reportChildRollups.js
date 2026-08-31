// ---------------------------------------------------------------------------
// reportChildRollups — reporting on an object's CHILDREN without changing what
// a row is.
//
// Nicholas, 2026-08-31: "If I select a building as my primary object, I need to
// go to all of its children, all of its grandparents, any of its cousins
// sideways, everything."
//
// The field picker only ever walked outgoing foreign keys — parents, and their
// parents. Nothing pointing AT the object was reachable. The reason it was left
// out is real: a building with twelve units is not one row any more, so joining
// children in changes what every existing report means.
//
// A roll-up is the half that does NOT change the row: an aggregate over the
// children, carried on the parent's own row — "Units", "Sum of Square Feet",
// "Latest Assessment Date". One grouped query per roll-up COLUMN (never per
// row), resolved after the rows are in.
// ---------------------------------------------------------------------------

export const ROLLUP_AGGREGATES = ['count', 'sum', 'avg', 'min', 'max']

/**
 * The row key a roll-up writes its value under. Every part that makes the
 * roll-up what it is goes into the key, so "Count of Units" and "Sum of Unit
 * Square Feet" cannot collide — and neither can two roll-ups over the same
 * child object reached through DIFFERENT foreign keys (work orders hang off a
 * property and off a building).
 */
export function childRollupKey({ child_table, child_fk, agg, value_column } = {}) {
  return `__child__${child_table}__${child_fk}__${agg}__${value_column || '*'}`
}

export function isChildRollupField(f) {
  return !!f && f.kind === 'child_rollup'
}

/**
 * What a roll-up cell shows.
 *
 * A parent with no children has COUNT ZERO — a blank there would read as "not
 * measured" when the honest answer is "none", and a column of blanks does not
 * total. Every other aggregate over no rows is genuinely absent: the average of
 * nothing is not 0, and neither is the earliest date of nothing.
 */
export function childRollupValue(field, raw) {
  if (raw != null) return raw
  return field?.agg === 'count' ? 0 : null
}

/**
 * Which aggregates a child column can carry. Numbers total and average; dates
 * take an earliest and a latest; everything else takes none — offering SUM of a
 * text column is offering an error.
 */
export function aggregatesForColumnType(type) {
  const t = String(type || '').toLowerCase()
  if (/(numeric|integer|bigint|smallint|double|real|money|decimal)/.test(t)) return ['sum', 'avg', 'min', 'max']
  if (/(date|timestamp)/.test(t)) return ['min', 'max']
  return null
}

/** The column header a roll-up gets when it is added. */
export function childRollupLabel(childLabel, agg, columnLabel) {
  if (agg === 'count') return childLabel
  const word = agg === 'avg' ? 'Average' : agg.charAt(0).toUpperCase() + agg.slice(1)
  return `${word} of ${columnLabel}`
}

/**
 * An audit stamp is not a parent-child relationship. `created_by` /
 * `updated_by` / `deleted_by` point at users from every table in the platform,
 * so without this a report on Users offers "count of accounts you created" 200
 * times over and buries the relationships that mean something.
 */
export function isRelationshipFk(columnName) {
  return !!columnName && !String(columnName).endsWith('_by')
}
