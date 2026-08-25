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
import { guessPrefix } from './fieldMetadataService'
import {
  LABELED_FK_TABLES, idColumnKind, isOpaqueIdColumn, stripTablePrefix,
  parentLookupNameField, isParentLookupNameField, parentLookupColumnOf,
  qualifiedFieldLabel,
} from '../lib/lookupColumnRules'
// Re-exported so existing importers of the list service keep working.
export { qualifiedFieldLabel } from '../lib/lookupColumnRules'

// Columns we never surface in an auto-generated list (audit/system plumbing).
const HIDDEN_SUFFIXES = [
  '_is_deleted', '_deleted_at', '_deleted_by', '_deletion_reason',
  '_created_at', '_updated_at', '_created_by', '_updated_by',
]
const HIDDEN_EXACT    = new Set([
  'is_deleted', 'deleted_at', 'deleted_by', 'deletion_reason',
  'created_at', 'updated_at', 'created_by', 'updated_by',
  // tasks predates the standard spelling and carries created_by_id.
  'created_by_id', 'updated_by_id',
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
// LABELED_FK_TABLES is defined once, in ../lib/lookupColumnRules.

// Parent tables we never expand into related columns (audit/identity plumbing).
// user/picklist parents are surfaced as the FK's own __label column instead.
const NON_EXPANDABLE_PARENTS = new Set(['users', 'picklist_values'])


// ---------------------------------------------------------------------------
// The context the id-column rules need for one table: its column prefix, and
// whether the platform manages a picklist for a given field. Built from the
// picklist definitions the app already has loaded, so no extra round trip.
// ---------------------------------------------------------------------------
function idColumnContextFor(table, picklists) {
  const byField = picklists?.byField
  const hasPicklistDefinition = (obj, field) => {
    if (!byField) return false
    const rows = byField.get(`${obj}.${field}`)
    return Array.isArray(rows) && rows.length > 0
  }
  return { table, prefix: guessPrefix(table) || undefined, hasPicklistDefinition }
}

// An unconstrained uuid column the platform can name is a picklist column and
// is rendered/filtered exactly like an FK to picklist_values.
function isPicklistValuedColumn(c, ctx) {
  return !c.is_foreign_key && idColumnKind(c, ctx) === 'picklist'
}

// Whether a schema column belongs in an auto-generated list view.
function isListableColumn(c, { recordNumber, nameCol, idContext }) {
  const n = c.column_name
  if (n === 'id' || n === recordNumber || n === nameCol) return false
  if (c.is_primary_key) return false
  if (HIDDEN_EXACT.has(n)) return false
  if (HIDDEN_SUFFIXES.some(suf => n.endsWith(suf))) return false
  // Keep non-FKs and label-resolvable FKs; drop opaque table FKs.
  if (c.is_foreign_key && !LABELED_FK_TABLES.has(c.references_table)) return false
  // A uuid column carrying no FK and no picklist behind it renders a raw id.
  if (idContext && isOpaqueIdColumn(c, idContext)) return false
  return true
}

// Whether a schema column may appear in the column CATALOG (the searchable
// picker), which is broader than the default-visible set: it excludes only
// audit/system plumbing and the identity columns (surfaced as id/name). Table
// FKs are excluded as direct columns — they're surfaced as their *__label and,
// when expandable, as a related group — but everything else on the object is
// selectable, with no MAX cap.
function isSelectableColumn(c, { recordNumber, nameCol, idContext }) {
  const n = c.column_name
  if (n === 'id' || n === recordNumber || n === nameCol) return false
  if (c.is_primary_key) return false
  if (HIDDEN_EXACT.has(n)) return false
  if (HIDDEN_SUFFIXES.some(suf => n.endsWith(suf))) return false
  // A uuid column the platform cannot turn into a name is not a field a person
  // can filter, sort or read — it is an id. Offering it is what let a filter
  // be authored that could never match anything (Nicholas, 2026-08-25).
  if (idContext && isOpaqueIdColumn(c, idContext)) return false
  return true
}

// Column data-type → ListView filter/render type.
function columnType(c) {
  return /date/.test(c.data_type) ? 'date'
    : /(numeric|integer|double|real|bigint)/.test(c.data_type) ? 'number'
    : 'text'
}

// A phone / email / website column is plain `text` in Postgres — its logical
// type lives in field_metadata and rides along on describe_object_columns as
// display_type. Carry it onto the column descriptor as `linkType` so list cells
// render the value as a real dial/mail/open link. Kept separate from `type`,
// which drives the FILTER (a website still filters as text).
function linkTypeOf(c) {
  const dt = c?.display_type
  return dt === 'email' || dt === 'phone' || dt === 'url' ? dt : undefined
}

// Build a ListView column descriptor for one own-object schema column.
// FK columns (picklist/user) resolve to a *__label field; others map straight.
// `valueSource` tells the filter sidebar where the value typeahead's options
// come from:
//   { kind: 'picklist', object, field }  — managed picklist_values definition
//   { kind: 'lookup',   table }          — search records in a referenced table
//   undefined                            — free text/number/date (manual entry)
function ownColumnDescriptor(c, group, ownerTable, idContext) {
  // columnName is the real DB column the ListView writes back to for inline /
  // bulk edit. For FK columns the visible `field` is the *__label display
  // column, but edits target the underlying FK column — so carry both, and tell
  // the editor which display field to refresh after a save (labelField).
  // A picklist column — whether it carries the FK to picklist_values or is one
  // of the import's unconstrained uuids that the platform can still name.
  // Either way the row holds an id and the list must show, filter and sort the
  // LABEL; the raw id is never the value a person means.
  if ((c.is_foreign_key && c.references_table === 'picklist_values')
      || (idContext && isPicklistValuedColumn(c, idContext))) {
    return {
      field: `${c.column_name}__label`, label: titleize(c.column_name), type: 'text', group,
      columnName: c.column_name, labelField: `${c.column_name}__label`,
      valueSource: { kind: 'picklist', object: ownerTable, field: c.column_name },
    }
  }
  if (c.is_foreign_key && c.references_table === 'users') {
    return {
      field: `${c.column_name}__label`, label: userFkLabel(c.column_name), type: 'text', group,
      columnName: c.column_name, labelField: `${c.column_name}__label`,
      valueSource: { kind: 'lookup', table: 'users' },
    }
  }
  // Non-FK text column may still have a managed picklist definition keyed by
  // (object, column_name); the sidebar resolves this lazily and falls back to
  // free text when no definition exists.
  const type = columnType(c)
  const base = { field: c.column_name, label: titleize(c.column_name), type, group, columnName: c.column_name }
  const linkType = linkTypeOf(c)
  if (linkType) base.linkType = linkType
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

// Relationship group label from an FK column name. The group heads a set of
// columns that live on a REAL object, so the label always says which object —
// a relationship name on its own reads as the name of an object that doesn't
// exist. "Managing Account" is not an object in LEAP; the Account object,
// reached through the opportunity's managing-account lookup, is.
//
//   property_id                     -> Property
//   opportunity_account_id          -> Account   (relationship == object name)
//   opportunity_managing_account_id -> Managing Account (Account)
//   opportunity_account_contact     -> Account Contact (Contact)
//   building_id                     -> Building
//
// The relationship name is the FK stem (minus a leading object prefix and
// trailing _id), titleized; the object name is appended only when the two
// differ, so the common case stays clean. Distinct FKs to the same parent keep
// distinct labels so two account relationships don't collapse into one
// ambiguous "Account" group.
export function relationshipLabel(fkColumn, parentTable) {
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
  const relationship = titleize(stem)
  const objectLabel = titleize(parentSingular)
  return relationship === objectLabel ? relationship : `${relationship} (${objectLabel})`
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

// ---------------------------------------------------------------------------
// buildObjectColumns: the DEFAULT-VISIBLE ListView column set for a table.
// Returns [{ field, label, type, group }], with 'id' (record number) and
// 'name' (primary name) first. Capped at MAX_BUSINESS_COLS so the initial
// render is sensible; the full selectable set comes from
// buildObjectColumnCatalog and is exposed through the column picker.
// ---------------------------------------------------------------------------
export async function buildObjectColumns(table) {
  const [cols, picklists] = await Promise.all([
    describeObject(table),
    loadPicklists().catch(() => null),
  ])
  const { recordNumber, nameCol } = identityColumns(table, cols)
  const idContext = idColumnContextFor(table, picklists)
  const objectGroup = titleize(table.replace(/ies$/, 'y').replace(/s$/, ''))

  const out = []
  if (recordNumber) out.push({ field: 'id', label: 'Record #', type: 'text', group: objectGroup })
  // "Name" on its own says nothing — a list showing an opportunity's name beside
  // an account's name rendered two columns both headed NAME. The primary name
  // column always names its object.
  if (nameCol) out.push({ field: 'name', label: `${objectGroup} Name`, shortLabel: 'Name', type: 'text', group: objectGroup })

  let businessCount = 0
  for (const c of cols) {
    if (!isListableColumn(c, { recordNumber, nameCol, idContext })) continue
    if (businessCount >= MAX_BUSINESS_COLS) break
    out.push(ownColumnDescriptor(c, objectGroup, table, idContext))
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
  const [cols, picklists] = await Promise.all([
    describeObject(table),
    loadPicklists().catch(() => null),
  ])
  const { recordNumber, nameCol } = identityColumns(table, cols)
  const idContext = idColumnContextFor(table, picklists)
  const objectGroup = titleize(table.replace(/ies$/, 'y').replace(/s$/, ''))

  const catalog = []
  const groups = [objectGroup]

  // Identity columns first. They are ordinary catalog entries — shown by
  // default, but hideable, reorderable and filterable like anything else. They
  // used to carry locked:true, which pinned them to the left of every list AND
  // hid them from the filter sidebar's field picker.
  if (recordNumber) catalog.push({ field: 'id', label: 'Record #', type: 'text', group: objectGroup })
  if (nameCol) catalog.push({ field: 'name', label: `${objectGroup} Name`, shortLabel: 'Name', type: 'text', group: objectGroup })

  // All own selectable columns (no cap).
  for (const c of cols) {
    if (!isSelectableColumn(c, { recordNumber, nameCol, idContext })) continue
    // Table FKs are not added as a direct column; they become a related group
    // below (and their __label is offered if picklist/user).
    if (c.is_foreign_key && !LABELED_FK_TABLES.has(c.references_table)) continue
    catalog.push(ownColumnDescriptor(c, objectGroup, table, idContext))
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

  // Parent columns that are themselves lookups, collected on the first pass and
  // resolved on the second — their target tables are not known until every
  // parent has been described.
  const deferredParentLookups = []

  for (const fk of tableFks) {
    const parentTable = fk.references_table
    const pCols = parentSchemas.get(parentTable) || []
    if (pCols.length === 0) continue
    const groupLabel = relationshipLabel(fk.column_name, parentTable)
    if (!groups.includes(groupLabel)) groups.push(groupLabel)
    const pIdentity = identityColumns(parentTable, pCols)

    const parentIdContext = idColumnContextFor(parentTable, picklists)

    for (const pc of pCols) {
      if (!isSelectableColumn(pc, { recordNumber: pIdentity.recordNumber, nameCol: pIdentity.nameCol, idContext: parentIdContext })) continue

      // A parent column that is ITSELF a lookup onto another object. These used
      // to be skipped outright, which is why "properties managed by Lutheran"
      // could not be asked from the Opportunities list at all: the property's
      // management company is an FK to accounts, so it was dropped here, and
      // the only field left bearing that name was the opportunity's own
      // unconstrained uuid — a filter that could never match. Resolved one hop
      // further, to the referenced record's NAME, so it filters like the text
      // the user actually sees.
      const isParentTableFk = pc.is_foreign_key
        && pc.references_table
        && !LABELED_FK_TABLES.has(pc.references_table)
      if (isParentTableFk) {
        const grandTable = pc.references_table
        const grandCols = parentSchemas.get(grandTable) || []
        const grandName = grandCols.length > 0
          ? identityColumns(grandTable, grandCols).nameCol
          : null
        // Without the grandparent's schema (not among this object's own FK
        // targets) the name column can't be resolved yet — it is filled in on
        // the second pass below, once every referenced table is described.
        deferredParentLookups.push({
          fkColumn: fk.column_name, parentTable, groupLabel,
          parentColumn: pc.column_name, grandTable, grandName,
        })
        continue
      }

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

      const relShortLabel = pc.references_table === 'users' && /_owner$/.test(pc.column_name)
        ? 'Record Owner'
        : titleize(stripParentPrefix(pc.column_name, parentTable))
      catalog.push({
        field: `${fk.column_name}${REL_DELIM}${baseField}`,
        // Qualified for the header and the filter chip ("Property State"), bare
        // for the picker, where the group heading already says "Property".
        label: qualifiedFieldLabel(groupLabel, relShortLabel),
        shortLabel: relShortLabel,
        type,
        linkType: linkTypeOf(pc),
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
        label: qualifiedFieldLabel(groupLabel, 'Name'),
        shortLabel: 'Name',
        type: 'text',
        group: groupLabel,
        related: { fkColumn: fk.column_name, parentTable, parentColumn: pIdentity.nameCol },
      })
    }
  }

  // ── Second pass: parent columns that are themselves lookups ───────────────
  // Each resolves to the referenced record's NAME. The grandparent tables were
  // not necessarily described in the first pass (a property's management
  // company is an account, which the opportunity may not reference directly),
  // so describe whatever is still missing, once, and then emit the fields.
  const missingGrandTables = Array.from(new Set(
    deferredParentLookups.map(d => d.grandTable).filter(t => t && !parentSchemas.has(t))
  ))
  await Promise.all(missingGrandTables.map(async (gt) => {
    try { parentSchemas.set(gt, await describeObject(gt)) }
    catch { parentSchemas.set(gt, []) }
  }))

  for (const d of deferredParentLookups) {
    const grandCols = parentSchemas.get(d.grandTable) || []
    const grandName = d.grandName
      || (grandCols.length > 0 ? identityColumns(d.grandTable, grandCols).nameCol : null)
    // A referenced object with no name column has nothing to show but its id,
    // and an id is exactly what must never be offered as a filterable field.
    if (!grandName) continue
    const lookupShortLabel = titleize(stripParentPrefix(d.parentColumn, d.parentTable).replace(/_id$/, ''))
    catalog.push({
      field: `${d.fkColumn}${REL_DELIM}${parentLookupNameField(d.parentColumn)}`,
      // "Property Management Company" — the object it hangs off, then the
      // relationship. This is the name the field was always asked for by.
      label: qualifiedFieldLabel(d.groupLabel, lookupShortLabel),
      shortLabel: lookupShortLabel,
      type: 'text',
      group: d.groupLabel,
      // The value is a name on the grandparent object, so the filter typeahead
      // offers the names that are actually out there rather than free text.
      valueSource: { kind: 'lookup', table: d.grandTable },
      related: {
        fkColumn: d.fkColumn,
        parentTable: d.parentTable,
        parentColumn: d.parentColumn,
        parentIsLookup: true,
        parentRefTable: d.grandTable,
        parentRefNameColumn: grandName,
      },
    })
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
//
// relatedScope (optional): scopes the fetch to the children of a single parent
// record — the server-side query behind a related-list "View All" so the list
// shows only the related records, not every row of the object (Salesforce
// related-list page parity). Shape mirrors the related-list widget config:
//   { fk, via, parentId }
//   • direct FK   — { fk:'property_id', parentId } → .eq('property_id', parentId)
//   • via-path    — { fk:'building_id',
//                     via:[{ table:'buildings', fk:'property_id' }], parentId }
//     resolved with the same nested PostgREST inner-join embeds that
//     fetchRelatedRecords uses, filtered on the parent id (RLS-respecting).
// ---------------------------------------------------------------------------
export async function fetchObjectRecords(table, { activeFields = null, relatedScope = null } = {}) {
  const [cols, picklists] = await Promise.all([
    describeObject(table),
    loadPicklists().catch(() => ({ byId: new Map() })),
  ])
  const colNames = new Set(cols.map(c => c.column_name))
  const { recordNumber, nameCol } = identityColumns(table, cols)
  const idContext = idColumnContextFor(table, picklists)
  const softDel = softDeleteColumn(table, colNames)

  // FK columns and the table they reference, for label resolution.
  const fkCols = cols.filter(c => c.is_foreign_key)
  const userFkCols = fkCols.filter(c => c.references_table === 'users').map(c => c.column_name)
  // Columns whose value is a picklist id: the real FKs, plus the import's
  // unconstrained uuid columns the platform can still name. Both hold an id
  // and must render (and therefore filter and sort) as the LABEL.
  const picklistFkCols = [
    ...fkCols.filter(c => c.references_table === 'picklist_values').map(c => c.column_name),
    ...cols.filter(c => isPicklistValuedColumn(c, idContext)).map(c => c.column_name),
  ]

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

  // ── Related-list scope ───────────────────────────────────────────────────
  // When a related-list "View All" scopes the fetch to one parent, build the
  // select + filter for it. Mirrors fetchRelatedRecords: a direct FK becomes a
  // plain .eq(); a via-path becomes nested inner-join embeds filtered on the
  // parent id. scopeSelect is appended to the base `*` select so the embed
  // rides along; scopeApply adds the filter to both the page and count queries.
  let scopeSelect = '*'
  let scopeApply = (q) => q
  let scopeStripEmbed = false
  if (relatedScope && relatedScope.fk && relatedScope.parentId) {
    const viaChain = Array.isArray(relatedScope.via)
      ? relatedScope.via.filter(v => v && v.table && v.fk)
      : []
    const isViaPath = viaChain.length > 0
    if (isViaPath) {
      let embed = viaChain[viaChain.length - 1].fk
      for (let i = viaChain.length - 2; i >= 0; i--) {
        embed = `_v${i + 2}:${viaChain[i].fk}!inner(${embed})`
      }
      scopeSelect = `*, _v1:${relatedScope.fk}!inner(${embed})`
      scopeStripEmbed = true
      const aliasPath = viaChain.map((_, i) => `_v${i + 1}`).join('.')
      const lastFk = viaChain[viaChain.length - 1].fk
      scopeApply = (q) => q.eq(`${aliasPath}.${lastFk}`, relatedScope.parentId)
    } else {
      scopeApply = (q) => q.eq(relatedScope.fk, relatedScope.parentId)
    }
  }

  // Load every row (list search/filter runs client-side over the full set), but
  // fetch the pages CONCURRENTLY after a HEAD count instead of one-at-a-time —
  // ~7× faster on large objects (e.g. 17k properties). Falls back to sequential
  // paging automatically if the count query isn't available.
  const rows = await fetchAllPagedParallel(
    (from, to) => {
      let q = supabase.from(table).select(scopeSelect)
      // Plain eq(false) on the soft-delete column (an .or(...is.null...) filter
      // can error on some tables and return nothing). Every soft-deletable row
      // carries a boolean.
      if (softDel) q = q.eq(softDel, false)
      q = scopeApply(q)
      return q.range(from, to)
    },
    () => {
      let q = supabase.from(table).select(scopeSelect, { count: 'exact', head: true })
      if (softDel) q = q.eq(softDel, false)
      q = scopeApply(q)
      return q
    },
  )

  // Drop the join-plumbing embed from via-path scoped rows before shaping.
  if (scopeStripEmbed) {
    for (const r of rows) { if (r && typeof r === 'object') delete r._v1 }
  }

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
      // parentColumn may carry a trailing __label (parent FK to user/picklist)
      // or __name (the parent's own lookup, resolved to the referenced record's
      // name); strip either to the real column for the SELECT and remember how
      // the value has to be resolved.
      const isLabel = parentColumn.endsWith('__label')
      const isLookupName = isParentLookupNameField(parentColumn)
      const realCol = isLabel
        ? parentColumn.slice(0, -('__label'.length))
        : (isLookupName ? parentLookupColumnOf(parentColumn) : parentColumn)
      relNeeds.get(fkColumn).parentColumns.add(JSON.stringify({ realCol, isLabel, isLookupName, field }))
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
    // ── Second hop: parent columns that are themselves lookups ─────────────
    // "Properties managed by Lutheran" is opportunity → property → account →
    // account_name. The parent row holds only the account's id, so the ids it
    // references are collected and resolved to names in one further batch — a
    // filter can only match the text the user sees.
    const lookupNameMaps = new Map()   // realCol -> Map<grandId, name>
    const lookupCols = wanted.filter(w => w.isLookupName)
    if (lookupCols.length > 0) {
      const parentCols = await describeObject(need.parentTable).catch(() => [])
      await Promise.all(lookupCols.map(async (w) => {
        const meta = parentCols.find(c => c.column_name === w.realCol)
        const grandTable = meta?.references_table
        if (!grandTable) { lookupNameMaps.set(w.realCol, new Map()); return }
        const grandIds = Array.from(new Set(parentRows.map(pr => pr[w.realCol]).filter(Boolean)))
        if (grandIds.length === 0) { lookupNameMaps.set(w.realCol, new Map()); return }
        const grandCols = await describeObject(grandTable).catch(() => [])
        const grandName = identityColumns(grandTable, grandCols).nameCol
        if (!grandName) { lookupNameMaps.set(w.realCol, new Map()); return }
        const nameById = new Map()
        for (let i = 0; i < grandIds.length; i += CHUNK) {
          const slice = grandIds.slice(i, i + CHUNK)
          const { data } = await supabase.from(grandTable).select(`id, ${grandName}`).in('id', slice)
          for (const g of (data || [])) nameById.set(g.id, g[grandName] || '')
        }
        lookupNameMaps.set(w.realCol, nameById)
      }))
    }

    const byId = new Map()
    for (const pr of parentRows) {
      const vm = new Map()
      for (const w of wanted) {
        let val = pr[w.realCol]
        if (w.isLabel && val != null) {
          // Parent column is itself a user/picklist FK — label it.
          val = picklists.byId.get(val) || userLabels.get(val) || String(val)
        } else if (w.isLookupName) {
          // Parent column is a lookup onto another object — its NAME, and
          // blank (never the raw id) when the record can't be named.
          val = val != null ? (lookupNameMaps.get(w.realCol)?.get(val) || '') : ''
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
      if (!isSelectableColumn(c, { recordNumber, nameCol, idContext })) continue
      const n = c.column_name
      if (c.is_foreign_key || picklistFkCols.includes(n)) {
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
