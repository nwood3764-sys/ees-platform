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

// ─── One row per child ("A with B") ───────────────────────────────────────
//
// The other half of reporting on children, and the half that changes what a row
// IS: "Buildings with Units" returns one row per unit, the building's fields
// repeated down the rows. It is declared on the report (rpt_child_detail), not
// implied by picking a field, because every row count, total and grouping in
// the report follows from it.

/** A child-detail column: a field read from the CHILD row, not the parent's. */
export function isChildDetailField(f) {
  return !!f && f.kind === 'child_field'
}

/** The row key a child-detail column reads. Namespaced so a child column can
 *  never collide with a parent column of the same name — `unit_name` and
 *  `building_name` are fine, but `id`, `created_at` and `name` are on both. */
export function childFieldKey(columnName) {
  return `__childrow__${columnName}`
}

export function isChildDetailReport(childDetail) {
  return !!(childDetail && childDetail.child_table && childDetail.child_fk)
}

/**
 * Expand parent rows into one row per child.
 *
 * @param parentRows   rows as fetched for the primary object
 * @param childRows    the children, each carrying its foreign key back
 * @param childDetail  { child_fk, join }
 * @returns one row per child, each a parent row with the child's columns
 *          namespaced onto it. With join='outer' a parent with no children
 *          still yields its own row and no child values.
 *
 * The parent row object is SPREAD, never mutated and never shared by reference:
 * two rows built from one parent must be able to carry different child values,
 * and a later pass that writes onto a row (a roll-up, a picklist label) must not
 * write through to its siblings.
 */
export function expandChildRows(parentRows, childRows, childDetail) {
  const rows = Array.isArray(parentRows) ? parentRows : []
  if (!isChildDetailReport(childDetail)) return rows
  const fk = childDetail.child_fk
  const outer = childDetail.join === 'outer'

  const byParent = new Map()
  for (const c of (childRows || [])) {
    const pid = c?.[fk]
    if (!pid) continue
    if (!byParent.has(pid)) byParent.set(pid, [])
    byParent.get(pid).push(c)
  }

  const out = []
  for (const parent of rows) {
    const kids = byParent.get(parent.id) || []
    if (kids.length === 0) {
      // Only an OUTER report keeps a parent with no children — and it keeps it
      // exactly once, with empty child columns. An inner report drops it, which
      // is what "Buildings WITH Units" means.
      if (outer) out.push({ ...parent, __child_id: null })
      continue
    }
    for (const kid of kids) {
      const row = { ...parent, __child_id: kid.id ?? null }
      for (const [k, v] of Object.entries(kid)) row[childFieldKey(k)] = v
      out.push(row)
    }
  }
  return out
}
