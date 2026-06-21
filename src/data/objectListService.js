// ---------------------------------------------------------------------------
// Generic object list service.
//
// Powers config-driven object tabs: any object exposed as a module tab renders
// its universal list view (the same records everywhere) without per-module
// code. Two pieces:
//
//   buildObjectColumns(table) — auto-generate a sensible list column set from
//                               the object's schema (describe_object_columns),
//                               resolving FK/picklist columns to labels.
//   fetchObjectRecords(table) — fetch all non-deleted rows for the object,
//                               shaped for ListView ({ id, _id, name, ...cols }).
//
// Nothing here is hardcoded per object — the column set and label resolution
// come from live schema + picklist/user lookups.
// ---------------------------------------------------------------------------

import { supabase, fetchAllPaged } from '../lib/supabase'
import { describeObject } from './adminService'
import { loadPicklists } from './outreachService'

// Columns we never surface in an auto-generated list (audit/system plumbing).
const HIDDEN_SUFFIXES = [
  '_is_deleted', '_deleted_at', '_deleted_by', '_deletion_reason',
  '_created_at', '_updated_at', '_created_by', '_updated_by',
]
const HIDDEN_EXACT    = new Set([
  'is_deleted', 'deleted_at', 'deleted_by', 'deletion_reason',
  'created_at', 'updated_at', 'created_by', 'updated_by',
])

// How many business columns (beyond record number + name) to show by default.
const MAX_BUSINESS_COLS = 8

// FK references we resolve to a human label. Other FKs (property_id,
// account_id, price_book_id, …) are opaque in a list and excluded from the
// auto-generated columns — they'd show a UUID or an unhelpful join.
const LABELED_FK_TABLES = new Set(['picklist_values', 'users'])

// Whether a schema column belongs in an auto-generated list view.
function isListableColumn(c, { recordNumber, nameCol }) {
  const n = c.column_name
  if (n === 'id' || n === recordNumber || n === nameCol) return false
  if (c.is_primary_key) return false
  if (HIDDEN_EXACT.has(n)) return false
  if (HIDDEN_SUFFIXES.some(suf => n.endsWith(suf))) return false
  // Keep non-FKs and label-resolvable FKs; drop opaque table FKs.
  if (c.is_foreign_key && !LABELED_FK_TABLES.has(c.references_table)) return false
  return true
}

function titleize(name) {
  // opportunity_close_date -> Close Date  (drop the object prefix noise where
  // present, then title-case the rest).
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, m => m.toUpperCase())
}

function softDeleteColumn(table, colNames) {
  const prefix = table.replace(/s$/, '')
  if (colNames.has(`${prefix}_is_deleted`)) return `${prefix}_is_deleted`
  if (colNames.has('is_deleted')) return 'is_deleted'
  return null
}

// Identify the record-number and name columns by the platform convention.
function identityColumns(table, cols) {
  const names = cols.map(c => c.column_name)
  const recordNumber =
    names.find(n => /_record_number$/.test(n)) || null
  // Shortest *_name column is the primary name (enrollment_name over
  // enrollment_property_name), else a bare 'name'.
  const nameCol =
    names.filter(n => /_name$/.test(n) || n === 'name')
         .sort((a, b) => a.length - b.length)[0] || null
  return { recordNumber, nameCol }
}

// ---------------------------------------------------------------------------
// buildObjectColumns: auto-generate ListView column descriptors for a table.
// Returns [{ field, label, type }], with 'id' (record number) and 'name'
// (primary name) first so rows are identifiable and clickable.
// ---------------------------------------------------------------------------
export async function buildObjectColumns(table) {
  const cols = await describeObject(table)
  const colNames = new Set(cols.map(c => c.column_name))
  const { recordNumber, nameCol } = identityColumns(table, cols)

  const out = []
  // Record number -> 'id' (ListView treats 'id' as the leading identity col).
  if (recordNumber) out.push({ field: 'id', label: 'Record #', type: 'text' })
  // Primary name -> 'name' (ListView treats 'name' as the row click label).
  if (nameCol) out.push({ field: 'name', label: 'Name', type: 'text' })

  let businessCount = 0
  for (const c of cols) {
    const n = c.column_name
    if (!isListableColumn(c, { recordNumber, nameCol })) continue
    if (businessCount >= MAX_BUSINESS_COLS) break

    // FK columns (picklist/user) are resolved to a label at fetch time and
    // exposed under a derived field name (n + '__label'); the column points
    // at that. Non-FK columns map straight through.
    if (c.is_foreign_key) {
      out.push({ field: `${n}__label`, label: titleize(n), type: 'text' })
    } else {
      const type = /date/.test(c.data_type) ? 'date'
        : /(numeric|integer|double|real|bigint)/.test(c.data_type) ? 'number'
        : 'text'
      out.push({ field: n, label: titleize(n), type })
    }
    businessCount++
  }
  return out
}

// ---------------------------------------------------------------------------
// fetchObjectRecords: all non-deleted rows for the object, shaped for ListView.
// Each row: { id: <record number or uuid>, _id: <uuid>, name: <primary name>,
//             <business cols>, <fk>__label: <resolved label> }.
// ---------------------------------------------------------------------------
export async function fetchObjectRecords(table) {
  const [cols, picklists] = await Promise.all([
    describeObject(table),
    loadPicklists().catch(() => ({ byId: new Map() })),
  ])
  const colNames = new Set(cols.map(c => c.column_name))
  const { recordNumber, nameCol } = identityColumns(table, cols)
  const softDel = softDeleteColumn(table, colNames)

  // FK columns and the table they reference, for label resolution.
  const fkCols = cols.filter(c => c.is_foreign_key)
  const userFkCols = fkCols.filter(c => c.references_table === 'users').map(c => c.column_name)
  const picklistFkCols = fkCols
    .filter(c => c.references_table === 'picklist_values')
    .map(c => c.column_name)

  // Build a users label map only if needed.
  let userLabels = new Map()
  if (userFkCols.length > 0) {
    const us = await fetchAllPaged((from, to) =>
      supabase.from('users')
        .select('id, user_name, user_first_name, user_last_name')
        .range(from, to)
    ).catch(() => [])
    for (const u of us) {
      const label = u.user_name
        || [u.user_first_name, u.user_last_name].filter(Boolean).join(' ')
        || u.id
      userLabels.set(u.id, label)
    }
  }

  const rows = await fetchAllPaged((from, to) => {
    let q = supabase.from(table).select('*')
    if (softDel) q = q.or(`${softDel}.is.null,${softDel}.eq.false`)
    return q.range(from, to)
  })

  return rows.map(r => {
    const out = {
      id:   recordNumber ? (r[recordNumber] || r.id) : r.id,
      _id:  r.id,
      name: nameCol ? (r[nameCol] || '') : (r.id || ''),
    }
    // Copy business columns through; resolve FK columns to *__label. Uses the
    // same listable predicate as buildObjectColumns so data and columns align.
    for (const c of cols) {
      const n = c.column_name
      if (!isListableColumn(c, { recordNumber, nameCol })) continue
      if (c.is_foreign_key) {
        const raw = r[n]
        let label = '—'
        if (raw != null) {
          if (picklistFkCols.includes(n)) label = picklists.byId.get(raw) || '—'
          else if (userFkCols.includes(n)) label = userLabels.get(raw) || '—'
          else label = String(raw)
        }
        out[`${n}__label`] = label
      } else {
        out[n] = r[n]
      }
    }
    return out
  })
}
