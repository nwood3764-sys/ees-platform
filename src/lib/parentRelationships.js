// ─── parentRelationships.js ──────────────────────────────────────────────────
// Which of a table's foreign keys are PARENTS whose ids a child should inherit?
//
// Standing rule (Nicholas, 2026-08-16): "a user must never be asked for
// something the platform can derive." Creating a child record fills in every
// relationship the platform already knows, rather than making somebody re-pick
// the project and the opportunity they were just looking at.
//
// The client had a curated map for this (TABLE_META) covering 74 of the
// platform's 100+ record objects, so an object missing from it inherited
// nothing at all: a Service Appointment created from a work order came out with
// Work Type, Project and Opportunity blank while the work order carried all
// three (Nicholas, 2026-09-02: "it should obviously inherit everything possible
// from the work order, building, opportunity"). The curated lists are also
// PARTIAL where they exist — TABLE_META.work_orders declares the four it
// navigates by and not work_type_id — so even a covered object could not pass
// down everything it held.
//
// So relationships are read off the table's real foreign keys, and the curated
// entry is UNIONED with them rather than replaced: a curated list can only gain
// relationships, so nothing that navigates correctly today changes.
//
// Kept free of React and Supabase so the rules are testable — see
// scripts/parent-relationships-fixture.mjs.
// ---------------------------------------------------------------------------

/**
 * Foreign keys that point at these tables are never a parent relationship:
 *   users           — an owner, a created-by or an assigned technician is a
 *                     PERSON on the record, not a record above it. Copying one
 *                     down would hand a child the wrong owner.
 *   picklist_values — a status, a type or a record type is a VALUE. It is
 *                     resolved per record type, never inherited from a parent.
 */
export const NON_PARENT_FK_TABLES = new Set(['users', 'picklist_values'])

/** Audit FKs, which point at users anyway but are excluded by name too so the
 *  rule still holds if one is ever repointed. */
export const AUDIT_FK_COLUMN = /(_created_by|_updated_by|_deleted_by|_owner)$/

/**
 * Relationships that must never be filled in by inheritance, because the column
 * does something in the platform beyond pointing at a parent. Keyed
 * `<table>.<column>`, and each entry states what it does — this is not a list of
 * objects somebody forgot, and nothing may be added to it without a reason of
 * this kind.
 *
 *   service_appointments.contact_id
 *     This is the CUSTOMER TO NOTIFY, not a parent record. It is the only gate
 *     on LEAP's outbound appointment email: trg_sa_fire_booking_confirmation
 *     and trg_sa_fire_status_or_reschedule both return early when it is null,
 *     which is precisely why install and removal appointments have always been
 *     safe (CLAUDE.md, 2026-07-13: "customers should not be emailed about
 *     install/removal work orders — in practice those SAs carry no contact_id,
 *     which is the pipeline's existing gate").
 *
 *     Inheriting it from the work order removed that gate. On 2026-09-02 an
 *     appointment created by hand on an Insulation Removal work order emailed a
 *     real property contact "Your home energy assessment is scheduled", with a
 *     blank date because the appointment had no time (NL-00043). Filling a
 *     field must never be what causes a message to be sent to a customer.
 */
export const NON_INHERITABLE_RELATIONSHIPS = new Set([
  'service_appointments.contact_id',
])

/**
 * True when this foreign key expresses a parent relationship worth inheriting.
 *
 * @param {{column_name: string, is_foreign_key?: boolean, references_table?: string}} column
 * @param {string} tableName  the table the column belongs to
 */
export function isParentForeignKey(column, tableName) {
  if (!column || !column.is_foreign_key || !column.references_table) return false
  if (NON_INHERITABLE_RELATIONSHIPS.has(`${tableName}.${column.column_name}`)) return false
  if (NON_PARENT_FK_TABLES.has(column.references_table)) return false
  // A self-reference expresses hierarchy WITHIN the object
  // (work_orders.parent_work_order_id). Inheriting it would file a new record
  // under whichever sibling the create happened to start from.
  if (column.references_table === tableName) return false
  if (AUDIT_FK_COLUMN.test(column.column_name)) return false
  return true
}

/**
 * The parent relationships of a table, from its real column metadata.
 *
 * @param {Array} columns    describe_object_columns rows
 * @param {string} tableName
 * @returns {{parents: string[], parentTables: string[]}}
 */
export function parentsFromColumns(columns, tableName) {
  const parents = []
  const parentTables = []
  for (const col of Array.isArray(columns) ? columns : []) {
    if (!isParentForeignKey(col, tableName)) continue
    parents.push(col.column_name)
    parentTables.push(col.references_table)
  }
  return { parents, parentTables }
}

/**
 * Curated entry ∪ derived relationships. Union only — a curated list never
 * loses a relationship, so existing navigation is untouched.
 */
export function mergeParentMeta(curated, derived) {
  const d = derived || { parents: [], parentTables: [] }
  if (!curated || !Array.isArray(curated.parents) || curated.parents.length === 0) return d
  const parents = [...curated.parents]
  const parentTables = [...(curated.parentTables || [])]
  d.parents.forEach((col, i) => {
    if (parents.includes(col)) return
    parents.push(col)
    parentTables.push(d.parentTables[i])
  })
  return { parents, parentTables }
}

/**
 * The relationship a column expresses, so the same one can be recognised under
 * a different prefix: work_order_account_id and project_account_id are both
 * "the account". This mirrors the resolver's own key and exists here so the
 * fixture can prove the matching end to end.
 */
export function relationshipKey(column) {
  const m = String(column).match(/([a-z]+)_id$/)
  return m ? m[0] : String(column)
}
