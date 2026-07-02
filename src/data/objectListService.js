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

import { supabase, fetchAllPaged, fetchAllPagedParallel } from '../lib/supabase'
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
  // Legacy/unused account column — the account's name is `account_name`
  // (surfaced as "Name"); `account_organization_name` is a leftover that only
  // confuses the column picker, so keep it out of the catalog entirely.
  'account_organization_name',
])

// How many business columns (beyond record number + name) to show by default.
const MAX_BUSINESS_COLS = 8

// Delimiter encoding a related (one-hop) column in a column field name:
//   <fk_column>__rel__<parent_column>
// e.g. property_id__rel__property_city. Chosen to never collide with a real
// column name and to survive React keys, storage keys, and saved-view JSON.
export const REL_DELIM = '__rel__'

export function isRelatedField(field) {
  return typeof field === 'string' && field.includes(REL_DELIM)
}
export function parseRelatedField(field) {
  if (!isRelatedField(field)) return null
  const [fkColumn, parentColumn] = field.split(REL_DELIM)
  return { fkColumn, parentColumn }
}

// FK references we resolve to a human label inline (no separate parent row
// fetch needed): picklist values and users have cheap label maps already.
const LABELED_FK_TABLES = new Set(['picklist_values', 'users'])

// Parent tables we never expand into related columns (audit/identity plumbing).
// user/picklist parents are surfaced as the FK's own __label column instead.
const NON_EXPANDABLE_PARENTS = new Set(['users', 'picklist_values'])

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

// Whether a schema column may appear in the column CATALOG (the searchable
// picker), which is broader than the default-visible set: it excludes only
// audit/system plumbing and the identity columns (surfaced as id/name). Table
// FKs are excluded as direct columns — they're surfaced as their *__label and,
// when expandable, as a related group — but everything else on the object is
// selectable, with no MAX cap.
function isSelectableColumn(c, { recordNumber, nameCol }) {
  const n = c.column_name
  if (n === 'id' || n === recordNumber || n === nameCol) return false
  if (c.is_primary_key) return false
  if (HIDDEN_EXACT.has(n)) return false
  if (HIDDEN_SUFFIXES.some(suf => n.endsWith(suf))) return false
  return true
}

// Column data-type → ListView filter/render type.
function columnType(c) {
  return /date/.test(c.data_type) ? 'date'
    : /(numeric|integer|double|real|bigint)/.test(c.data_type) ? 'number'
    : 'text'
}

// Build a ListView column descriptor for one own-object schema column.
// FK columns (picklist/user) resolve to a *__label field; others map straight.
// `valueSource` tells the filter sidebar where the value typeahead's options
// come from:
//   { kind: 'picklist', object, field }  — managed picklist_values definition
//   { kind: 'lookup',   table }          — search records in a referenced table
//   undefined                            — free text/number/date (manual entry)
function ownColumnDescriptor(c, group, ownerTable) {
  if (c.is_foreign_key && c.references_table === 'picklist_values') {
    return {
      field: `${c.column_name}__label`, label: titleize(c.column_name), type: 'text', group,
      valueSource: { kind: 'picklist', object: ownerTable, field: c.column_name },
    }
  }
  if (c.is_foreign_key && c.references_table === 'users') {
    return {
      field: `${c.column_name}__label`, label: userFkLabel(c.column_name), type: 'text', group,
      valueSource: { kind: 'lookup', table: 'users' },
    }
  }
  // Non-FK text column may still have a managed picklist definition keyed by
  // (object, column_name); the sidebar resolves this lazily and falls back to
  // free text when no definition exists.
  const type = columnType(c)
  const base = { field: c.column_name, label: titleize(c.column_name), type, group }
  if (type === 'text') base.valueSource = { kind: 'picklist', object: ownerTable, field: c.column_name, maybe: true }
  return base
}

// Strip a leading object prefix from a parent column for display under its
// relationship group: properties' "property_city" shows as "City" under the
// "Property" group, avoiding "Property › Property City".
function stripParentPrefix(parentColumn, parentTable) {
  const singular = parentTable.replace(/ies$/, 'y').replace(/s$/, '')
  const pfx = `${singular}_`
  return parentColumn.startsWith(pfx) ? parentColumn.slice(pfx.length) : parentColumn
}

// Friendly relationship group label from an FK column name:
//   property_id              -> Property
//   opportunity_account_id   -> Account            (canonical single parent link)
//   opportunity_managing_account_id -> Managing Account
//   building_id              -> Building
// The label is the FK stem (minus a leading object prefix and trailing _id),
// titleized. Distinct FKs to the same parent keep distinct labels so two
// account relationships don't collapse into one ambiguous "Account" group.
function relationshipLabel(fkColumn, parentTable) {
  const parentSingular = parentTable.replace(/ies$/, 'y').replace(/s$/, '')
  let stem = fkColumn.replace(/_id$/, '')
  // Drop a leading object prefix that carries no relationship meaning, but only
  // when what's left still references the parent singular — so a meaningful
  // qualifier like "managing" is preserved.
  const m = stem.match(/^([a-z]+)_(.+)$/)
  if (m) {
    const rest = m[2]
    if (rest === parentSingular || rest.endsWith(`_${parentSingular}`) || rest.endsWith(parentSingular)) {
      stem = rest
    }
  }
  return titleize(stem)
}

function titleize(name) {
  // opportunity_close_date -> Close Date  (drop the object prefix noise where
  // present, then title-case the rest).
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, m => m.toUpperCase())
}

// Display label for a user-FK column. By platform convention a user FK named
// `<object>_owner` is the record-ownership field (assigned internal staff), not
// anything about the real-world entity. Titleizing it ("Property Owner",
// "Account Owner") collides with the legal/physical owner of the property or
// account, so record-ownership FKs always render as "Record Owner". Other user
// FKs (e.g. a "verified_by" lookup) keep their titleized name.
function userFkLabel(columnName) {
  return /_owner$/.test(columnName) ? 'Record Owner' : titleize(columnName)
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

// The object's own location columns (by exact platform-convention name, e.g.
// building_address / property_street / building_city / building_state) are
// promoted to the front of the default-visible business columns, in this
// order. Location is how users tell same-named records apart across the five
// operating states, and these columns otherwise sit so late in schema order
// that the MAX_BUSINESS_COLS cap always cut them. Exact names only — raw
// import columns (property_mf_raw_std_city, building_cif_address, …) stay in
// schema order.
const LOCATION_COLUMN_SUFFIX_ORDER = ['_address', '_street', '_city', '_state', '_zip']
function locationColumnRank(table, columnName) {
  const prefix = table.replace(/ies$/, 'y').replace(/s$/, '')
  const i = LOCATION_COLUMN_SUFFIX_ORDER.findIndex(suf => columnName === `${prefix}${suf}`)
  return i === -1 ? null : i
}

// ---------------------------------------------------------------------------
// buildObjectColumns: the DEFAULT-VISIBLE ListView column set for a table.
// Returns [{ field, label, type, group }], with 'id' (record number) and
// 'name' (primary name) first. Capped at MAX_BUSINESS_COLS so the initial
// render is sensible; the full selectable set comes from
// buildObjectColumnCatalog and is exposed through the column picker.
// ---------------------------------------------------------------------------
export async function buildObjectColumns(table) {
  const cols = await describeObject(table)
  const { recordNumber, nameCol } = identityColumns(table, cols)
  const objectGroup = titleize(table.replace(/ies$/, 'y').replace(/s$/, ''))

  const out = []
  if (recordNumber) out.push({ field: 'id', label: 'Record #', type: 'text', group: objectGroup })
  if (nameCol) out.push({ field: 'name', label: 'Name', type: 'text', group: objectGroup })

  // Location columns first (address → street → city → state → zip), then the
  // rest in schema order, both under the same default-visible cap.
  const listable = cols.filter(c => isListableColumn(c, { recordNumber, nameCol }))
  const location = listable
    .filter(c => locationColumnRank(table, c.column_name) !== null)
    .sort((a, b) => locationColumnRank(table, a.column_name) - locationColumnRank(table, b.column_name))
  const rest = listable.filter(c => locationColumnRank(table, c.column_name) === null)

  let businessCount = 0
  for (const c of [...location, ...rest]) {
    if (businessCount >= MAX_BUSINESS_COLS) break
    out.push(ownColumnDescriptor(c, objectGroup, table))
    businessCount++
  }
  return out
}

// ---------------------------------------------------------------------------
// buildObjectColumnCatalog: the FULL set of columns a user may add to the list
// view for a table, for the searchable column picker. Returns:
//   {
//     defaultColumns: [...],   // same as buildObjectColumns (initial visible)
//     catalog:        [...],   // every selectable column: own + related
//     groups:         [...],   // ordered group labels (object first)
//   }
// Each catalog entry: { field, label, type, group, related?: { fkColumn,
// parentTable, parentColumn } }.
//
// Related columns are one hop out: for each table-FK on the object (excluding
// user/picklist parents, which are surfaced as the FK's own __label), every
// selectable column on the parent table is offered under a relationship group
// (e.g. "Property", "Account"). Selecting one triggers a parent-row join at
// fetch time (see fetchObjectRecords).
// ---------------------------------------------------------------------------
export async function buildObjectColumnCatalog(table) {
  const cols = await describeObject(table)
  const { recordNumber, nameCol } = identityColumns(table, cols)
  const objectGroup = titleize(table.replace(/ies$/, 'y').replace(/s$/, ''))

  const catalog = []
  const groups = [objectGroup]

  // Identity columns first (always available, always shown — the picker marks
  // them locked, but they belong in the catalog so search finds them).
  if (recordNumber) catalog.push({ field: 'id', label: 'Record #', type: 'text', group: objectGroup, locked: true })
  if (nameCol) catalog.push({ field: 'name', label: 'Name', type: 'text', group: objectGroup, locked: true })

  // All own selectable columns (no cap).
  for (const c of cols) {
    if (!isSelectableColumn(c, { recordNumber, nameCol })) continue
    // Table FKs are not added as a direct column; they become a related group
    // below (and their __label is offered if picklist/user).
    if (c.is_foreign_key && !LABELED_FK_TABLES.has(c.references_table)) continue
    catalog.push(ownColumnDescriptor(c, objectGroup, table))
  }

  // Related (one-hop) columns. Follow each expandable table FK to its parent.
  const tableFks = cols.filter(c =>
    c.is_foreign_key &&
    c.references_table &&
    !NON_EXPANDABLE_PARENTS.has(c.references_table)
  )
  // De-dupe parent describes (two FKs to the same table are rare but possible).
  const parentSchemas = new Map()
  await Promise.all(
    Array.from(new Set(tableFks.map(c => c.references_table))).map(async (pt) => {
      try { parentSchemas.set(pt, await describeObject(pt)) }
      catch { parentSchemas.set(pt, []) }
    })
  )

  for (const fk of tableFks) {
    const parentTable = fk.references_table
    const pCols = parentSchemas.get(parentTable) || []
    if (pCols.length === 0) continue
    const groupLabel = relationshipLabel(fk.column_name, parentTable)
    if (!groups.includes(groupLabel)) groups.push(groupLabel)
    const pIdentity = identityColumns(parentTable, pCols)

    for (const pc of pCols) {
      if (!isSelectableColumn(pc, { recordNumber: pIdentity.recordNumber, nameCol: pIdentity.nameCol })) continue
      // Skip parent FK columns that point at further tables — we only expand one
      // hop. Picklist/user parent FKs are surfaced via their __label.
      const isParentTableFk = pc.is_foreign_key && !LABELED_FK_TABLES.has(pc.references_table)
      if (isParentTableFk) continue

      const baseField = pc.is_foreign_key && LABELED_FK_TABLES.has(pc.references_table)
        ? `${pc.column_name}__label`
        : pc.column_name
      const type = pc.is_foreign_key && LABELED_FK_TABLES.has(pc.references_table)
        ? 'text' : columnType(pc)

      // Value source for the filter typeahead on a related column.
      let valueSource
      if (pc.is_foreign_key && pc.references_table === 'picklist_values') {
        valueSource = { kind: 'picklist', object: parentTable, field: pc.column_name }
      } else if (pc.is_foreign_key && pc.references_table === 'users') {
        valueSource = { kind: 'lookup', table: 'users' }
      } else if (type === 'text') {
        valueSource = { kind: 'picklist', object: parentTable, field: pc.column_name, maybe: true }
      }

      catalog.push({
        field: `${fk.column_name}${REL_DELIM}${baseField}`,
        label: pc.references_table === 'users' && /_owner$/.test(pc.column_name)
          ? 'Record Owner'
          : titleize(stripParentPrefix(pc.column_name, parentTable)),
        type,
        group: groupLabel,
        valueSource,
        related: {
          fkColumn: fk.column_name,
          parentTable,
          parentColumn: pc.column_name,
          parentIsLabeledFk: pc.is_foreign_key && LABELED_FK_TABLES.has(pc.references_table),
          parentRefTable: pc.references_table || null,
        },
      })
    }
    // Also expose the parent's record number/name explicitly at the top of the
    // group (handy and often what users want first).
    if (pIdentity.nameCol) {
      catalog.push({
        field: `${fk.column_name}${REL_DELIM}${pIdentity.nameCol}`,
        label: 'Name',
        type: 'text',
        group: groupLabel,
        related: { fkColumn: fk.column_name, parentTable, parentColumn: pIdentity.nameCol },
      })
    }
  }

  // De-dupe by field (identity name columns added twice above), preserving
  // first occurrence order.
  const seen = new Set()
  const deduped = catalog.filter(e => (seen.has(e.field) ? false : (seen.add(e.field), true)))

  const defaultColumns = await buildObjectColumns(table)
  return { defaultColumns, catalog: deduped, groups }
}

// ---------------------------------------------------------------------------
// deriveColumnOptions: given auto-generated columns and the loaded rows,
// compute distinct values per column and promote eligible columns to a
// multi-select filter ('select' type with an `options` array). Excel-style
// column filtering needs an explicit value set per column; for an
// auto-generated list there's no picklist metadata to lean on, so the value
// set is the distinct values actually present in the data.
//
// Promotion rule: a 'text' column becomes 'select' when its distinct
// non-blank value count is within OPTION_CARDINALITY_CAP. High-cardinality
// columns (free-text names, addresses, IDs) stay 'text' and keep the
// contains-search filter. 'date' and 'number' columns are left as-is — they
// have their own range filters.
//
// The blank sentinel is NOT added to options here; the FilterDropdown renders
// a "(Blanks)" row itself when any row in the column is empty, signalled via
// `hasBlanks`. Options are returned sorted for stable display.
// ---------------------------------------------------------------------------
const OPTION_CARDINALITY_CAP = 200

export function deriveColumnOptions(columns, rows) {
  if (!Array.isArray(columns) || !Array.isArray(rows) || rows.length === 0) {
    return columns
  }
  return columns.map(col => {
    // Only consider text columns (incl. resolved FK __label columns) for
    // promotion. Date/number keep their range filters; existing selects pass
    // through untouched.
    if (col.type !== 'text') return col

    const distinct = new Set()
    let hasBlanks = false
    for (const r of rows) {
      const raw = r[col.field]
      if (raw === null || raw === undefined || String(raw).trim() === '') {
        hasBlanks = true
        continue
      }
      distinct.add(String(raw))
      if (distinct.size > OPTION_CARDINALITY_CAP) break
    }

    // Too many distinct values — leave as free-text contains filter, but still
    // record hasBlanks so a "(Blanks)" affordance could be offered later.
    if (distinct.size > OPTION_CARDINALITY_CAP) {
      return { ...col, hasBlanks }
    }

    // Identity columns (record #, primary name) are inherently high-signal
    // unique values; never collapse them into a checklist even if a small
    // dataset makes them look low-cardinality.
    if (col.field === 'id' || col.field === 'name') {
      return { ...col, hasBlanks }
    }

    const options = Array.from(distinct).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    )
    return { ...col, type: 'select', options, hasBlanks }
  })
}

// ---------------------------------------------------------------------------
// fetchObjectRecords: all non-deleted rows for the object, shaped for ListView.
// Each row: { id: <record number or uuid>, _id: <uuid>, name: <primary name>,
//             <business cols>, <fk>__label: <resolved label> }.
//
// activeFields (optional): the set/array of column fields currently visible in
// the list view (from the saved view or column picker). Used to decide which
// RELATED (one-hop) relationships to resolve via a parent-row join. Own
// columns are always emitted in full (the underlying fetch is select *), so a
// newly-shown own column always has data without re-fetching. When
// activeFields is omitted, no related columns are resolved (default render).
// ---------------------------------------------------------------------------
export async function fetchObjectRecords(table, { activeFields = null } = {}) {
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

  // Load every row (list search/filter runs client-side over the full set), but
  // fetch the pages CONCURRENTLY after a HEAD count instead of one-at-a-time —
  // ~7× faster on large objects (e.g. 17k properties). Falls back to sequential
  // paging automatically if the count query isn't available.
  const rows = await fetchAllPagedParallel(
    (from, to) => {
      let q = supabase.from(table).select('*')
      // Plain eq(false) on the soft-delete column (an .or(...is.null...) filter
      // can error on some tables and return nothing). Every soft-deletable row
      // carries a boolean.
      if (softDel) q = q.eq(softDel, false)
      return q.range(from, to)
    },
    () => {
      let q = supabase.from(table).select('*', { count: 'exact', head: true })
      if (softDel) q = q.eq(softDel, false)
      return q
    },
  )

  // ── Resolve active related (one-hop) columns ────────────────────────────
  // Determine which relationships are needed from activeFields, then batch-load
  // the distinct parent rows referenced by the list and build a per-relationship
  // resolver: fkValue -> { parentColumn -> rendered value }.
  const activeSet = activeFields
    ? (activeFields instanceof Set ? activeFields : new Set(activeFields))
    : null
  // Map<fkColumn, { parentTable, parentColumns:Set, parentIsLabeledFk per col }>
  const relNeeds = new Map()
  if (activeSet) {
    for (const field of activeSet) {
      const parsed = parseRelatedField(field)
      if (!parsed) continue
      const { fkColumn, parentColumn } = parsed
      // Validate the fkColumn really is a table FK on this object.
      const fkMeta = cols.find(c => c.column_name === fkColumn && c.is_foreign_key)
      if (!fkMeta || NON_EXPANDABLE_PARENTS.has(fkMeta.references_table)) continue
      if (!relNeeds.has(fkColumn)) {
        relNeeds.set(fkColumn, { parentTable: fkMeta.references_table, parentColumns: new Set() })
      }
      // parentColumn may carry a trailing __label (parent FK to user/picklist);
      // strip it to the real column for the SELECT, remember it needs labeling.
      const isLabel = parentColumn.endsWith('__label')
      const realCol = isLabel ? parentColumn.slice(0, -('__label'.length)) : parentColumn
      relNeeds.get(fkColumn).parentColumns.add(JSON.stringify({ realCol, isLabel, field }))
    }
  }

  // For each needed relationship, fetch the distinct parent rows and build a
  // value map keyed by parent id.
  const relResolvers = new Map() // fkColumn -> Map<parentId, Map<field, value>>
  await Promise.all(Array.from(relNeeds.entries()).map(async ([fkColumn, need]) => {
    const ids = Array.from(new Set(rows.map(r => r[fkColumn]).filter(Boolean)))
    if (ids.length === 0) { relResolvers.set(fkColumn, new Map()); return }
    const wanted = Array.from(need.parentColumns).map(s => JSON.parse(s))
    const selectCols = Array.from(new Set(['id', ...wanted.map(w => w.realCol)])).join(', ')
    // Batch the id IN-list to stay under URL limits.
    const parentRows = []
    const CHUNK = 300
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK)
      const { data } = await supabase.from(need.parentTable).select(selectCols).in('id', slice)
      if (data) parentRows.push(...data)
    }
    const byId = new Map()
    for (const pr of parentRows) {
      const vm = new Map()
      for (const w of wanted) {
        let val = pr[w.realCol]
        if (w.isLabel && val != null) {
          // Parent column is itself a user/picklist FK — label it.
          val = picklists.byId.get(val) || userLabels.get(val) || String(val)
        }
        vm.set(w.field, val == null ? '' : val)
      }
      byId.set(pr.id, vm)
    }
    relResolvers.set(fkColumn, byId)
  }))

  return rows.map(r => {
    const out = {
      id:   recordNumber ? (r[recordNumber] || r.id) : r.id,
      _id:  r.id,
      name: nameCol ? (r[nameCol] || '') : (r.id || ''),
    }
    // Emit ALL selectable own columns (not just the capped default set) so any
    // column the user adds via the picker has data. FK columns resolve to a
    // *__label; table FKs pass their raw uuid through under *__label too (so a
    // bare table-FK column, if ever shown, isn't blank — though the picker
    // surfaces those as related groups instead).
    for (const c of cols) {
      if (!isSelectableColumn(c, { recordNumber, nameCol })) continue
      const n = c.column_name
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
    // Flatten active related columns onto the row under their __rel__ field.
    for (const [fkColumn, byId] of relResolvers) {
      const pid = r[fkColumn]
      const vm = pid ? byId.get(pid) : null
      if (vm) for (const [field, val] of vm) out[field] = val
    }
    return out
  })
}
