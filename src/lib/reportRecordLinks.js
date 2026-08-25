// reportRecordLinks — which cells of a report are records, and which record
// each one is.
//
// Nicholas, 2026-08-25: "the property and the opportunity have to be
// hyperlinked so we can click into them on the reports." Only the first
// column had ever linked, so a report listing a property, its building and
// the opportunity was a dead end in two columns out of three.
//
// Three kinds of cell carry a record, and nothing else links:
//   1. the primary object's own name / record number → this row's record
//   2. a lookup column on the primary object         → the record it references
//      (a picklist FK is not a lookup — a stage is a value, not a record)
//   3. a related object's own name / record number   → that related record
//
// The decision is made once, per COLUMN, from the report definition — never
// guessed per cell from what a value looks like. The row then supplies the
// id: the row's own for (1), the FK's value for (2), and the embedded
// object's `id` for (3), which is why the runner selects `id` on every embed.
//
// Pure — no imports beyond the label rule it shares. Pinned by
// scripts/report-record-links-fixture.mjs.

import { isIdentityColumn, normalizeFieldDescriptor } from './reportColumnLabels.js'

/**
 * The link descriptor for a column, or null when the column isn't a record.
 *
 * @param field         selected-field descriptor from the report definition
 * @param primaryObject the report's primary object
 * @param fkLookup      `${table}.${column}` → { references_table, is_picklist }
 * @param prefixFor     the platform's column-prefix map
 */
export function recordLinkForField(field, primaryObject, fkLookup, { prefixFor = null } = {}) {
  const f = normalizeFieldDescriptor(field, primaryObject)
  if (!f) return null
  const opts = { prefixFor }

  if (f.via_path.length === 0) {
    const fkInfo = fkLookup?.[`${primaryObject}.${f.name}`]
    if (fkInfo && fkInfo.references_table && !fkInfo.is_picklist) {
      return { table: fkInfo.references_table, source: 'fk', fk_column: f.name }
    }
    if (primaryObject && isIdentityColumn(primaryObject, f.name, opts)) {
      return { table: primaryObject, source: 'row' }
    }
    return null
  }

  if (f.table && isIdentityColumn(f.table, f.name, opts)) {
    return { table: f.table, source: 'embed', via_path: f.via_path }
  }
  return null
}

/**
 * The record a rendered cell points at: `{ table, id }`, or null when this
 * cell isn't a record or the reference didn't resolve on this row.
 */
export function resolveRowRecordLink(row, column) {
  const link = column?._link
  if (!row || !link) return null

  if (link.source === 'row') {
    return row.id ? { table: link.table, id: row.id } : null
  }
  if (link.source === 'fk') {
    const id = row[link.fk_column]
    return id ? { table: link.table, id } : null
  }
  if (link.source === 'embed') {
    let nested = row
    for (const fk of (link.via_path || [])) {
      if (!nested) return null
      nested = nested[fk]
    }
    return nested?.id ? { table: link.table, id: nested.id } : null
  }
  return null
}
