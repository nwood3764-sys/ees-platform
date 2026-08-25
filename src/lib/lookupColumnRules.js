// ---------------------------------------------------------------------------
// lookupColumnRules — what a column that holds a record ID is, and what a list
// view may do with it.
//
// The defect this exists to end (Nicholas, 2026-08-25, from the Opportunities
// list: "Filters aren't working... It needs to work on anything, like the
// properties, the buildings, everything"): a filter compares the value that is
// IN THE ROW. For anything holding a record id, the value in the row is a
// uuid — so "Property Management Company contains Lutheran" compared the word
// Lutheran against "3eace332-7c60-…" and returned, correctly and uselessly,
// nothing. The list said "No records match the current filters" while ten
// matching records sat in the table.
//
// The platform has three kinds of id column and had one behavior for all of
// them:
//
//   TABLE LOOKUP  — a real FK to an object (property_id → properties). Already
//                   expanded into a relationship group whose columns resolve to
//                   the parent's values, so these filter by name.
//   LABELED       — an FK to picklist_values or users. Resolved inline to a
//                   label, so these filter by name.
//   UNCONSTRAINED — a uuid column carrying no FK at all: 165 of them, left by
//                   the Salesforce import. Postgres calls them uuid, the list
//                   engine called them text, and every one was offered in the
//                   column picker and the filter sidebar as a field a human
//                   could type words into. None of them could ever match.
//
// An unconstrained uuid is not automatically junk — the values still point at
// something. Two of them, resolved by what they actually contain:
//   • picklist values, when the object/column has a managed picklist definition
//     (enrollments.enrollment_building_type → the enrollments.building_type
//     picklist). Nameable, so it stays, labeled.
//   • everything else — an id into a table nothing records. NOT nameable, so it
//     is not offered. A field that cannot be filtered must not appear in the
//     filter sidebar; offering it is how a list silently returns nothing.
//
// Pure module: no network, no React. Fixture-tested by
// scripts/lookup-column-rules-fixture.mjs.
// ---------------------------------------------------------------------------

// FK references resolved to a human label inline, without a parent-row fetch.
export const LABELED_FK_TABLES = new Set(['picklist_values', 'users'])

/** True when the column's value is a record id rather than data. */
export function isIdColumn(column) {
  if (!column) return false
  return column.data_type === 'uuid' || column.is_foreign_key === true
}

/**
 * The object-prefix convention: a column on `enrollments` named
 * `enrollment_building_type` names the `building_type` field. Picklist
 * definitions are stored under the stripped name, so resolving one needs this.
 *
 * The prefix is derived from the table, never assumed from the column: a
 * column called `property_state` on `opportunities` keeps its full name,
 * because the opportunity's prefix is `opportunity`.
 */
export function stripTablePrefix(table, columnName, prefix) {
  const p = prefix || defaultTablePrefix(table)
  if (!p) return columnName
  return columnName.startsWith(`${p}_`) ? columnName.slice(p.length + 1) : columnName
}

/** The naive singular prefix for a table, when no explicit map supplies one. */
export function defaultTablePrefix(table) {
  if (!table) return ''
  return String(table).replace(/ies$/, 'y').replace(/s$/, '')
}

/**
 * What kind of id column this is, and therefore how a list view must treat it.
 *
 * `hasPicklistDefinition(objectTable, strippedColumn)` answers whether the
 * platform manages a picklist for that pair — supplied by the caller, which
 * holds the loaded picklist definitions.
 *
 * Returns one of:
 *   null            — not an id column at all; ordinary data.
 *   'picklist'      — resolves to a picklist label (FK, or unconstrained but
 *                     backed by a picklist definition).
 *   'user'          — resolves to a user's name.
 *   'table_lookup'  — a real FK to an object; expand it as a relationship.
 *   'opaque'        — holds an id nothing can name. Never offered as a field.
 */
export function idColumnKind(column, { table, prefix, hasPicklistDefinition } = {}) {
  if (!isIdColumn(column)) return null
  if (column.is_foreign_key) {
    if (column.references_table === 'picklist_values') return 'picklist'
    if (column.references_table === 'users') return 'user'
    return column.references_table ? 'table_lookup' : 'opaque'
  }
  // Unconstrained uuid: nameable only if a picklist definition backs it.
  const stripped = stripTablePrefix(table, column.column_name, prefix)
  if (typeof hasPicklistDefinition === 'function' && hasPicklistDefinition(table, stripped)) {
    return 'picklist'
  }
  return 'opaque'
}

/**
 * True when a column must be kept out of the column picker, the filter sidebar
 * and the default list — because its value is an id the platform cannot turn
 * into anything a person could search for.
 */
export function isOpaqueIdColumn(column, context) {
  return idColumnKind(column, context) === 'opaque'
}

/**
 * The field name for a related column that is ITSELF a lookup — the parent's
 * own FK, resolved one further hop to the grandparent's NAME.
 *
 * "Properties managed by Lutheran", asked from the Opportunities list, is
 * opportunity → property → management company account → its name. The related
 * catalog expanded one hop and then SKIPPED every parent column that was a
 * lookup, so the property's management company simply did not exist as a field
 * anywhere on that list; the only thing bearing the name was the dead
 * unconstrained uuid column on the opportunity itself.
 *
 * The suffix marks the value as the parent lookup's resolved NAME, not its id,
 * so nothing downstream can mistake one for the other.
 */
export const LOOKUP_NAME_SUFFIX = '__name'

export function parentLookupNameField(parentColumn) {
  return `${parentColumn}${LOOKUP_NAME_SUFFIX}`
}

export function isParentLookupNameField(field) {
  return typeof field === 'string' && field.endsWith(LOOKUP_NAME_SUFFIX)
}

export function parentLookupColumnOf(field) {
  return isParentLookupNameField(field)
    ? field.slice(0, -LOOKUP_NAME_SUFFIX.length)
    : field
}

// ---------------------------------------------------------------------------
// Field labels name the OBJECT, never just the part of it.
//
// "Name" is not a field name. An opportunities list showing its own name and
// the account's name rendered two columns both headed NAME, and a filter chip
// read "State: WI" without saying whose state (Nicholas, 2026-08-25: "you just
// can't have name as a field. That's not a unique situation"). LEAP's naming
// rule is explicit names always — no abbreviations, no ambiguous terms.
//
// So every column carries two labels:
//   label       — fully qualified, used in the column HEADER, the filter chip
//                 and the filter row: "Opportunity Name", "Account Name",
//                 "Property State", "Property Management Company".
//   shortLabel  — the bare field, used only inside the field PICKER, where the
//                 relationship group heading above it already supplies the
//                 context and "Property › Property State" would stutter.
// ---------------------------------------------------------------------------

// The relationship half of a group label: "Managing Account (Account)" is the
// Managing Account relationship, and qualifying a field with the parenthetical
// object name too reads as a sentence rather than a label.
function relationshipName(groupLabel) {
  return String(groupLabel || '').replace(/\s*\([^)]*\)\s*$/, '').trim()
}

// Qualify a field label with the relationship it is reached through, without
// stuttering when the field already says it.
export function qualifiedFieldLabel(groupLabel, shortLabel) {
  const rel = relationshipName(groupLabel)
  const short = String(shortLabel || '').trim()
  if (!rel) return short
  if (!short) return rel
  const relLower = rel.toLowerCase()
  const shortLower = short.toLowerCase()
  if (shortLower === relLower) return short
  if (shortLower.startsWith(`${relLower} `)) return short
  return `${rel} ${short}`
}
