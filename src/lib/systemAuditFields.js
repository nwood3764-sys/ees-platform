/**
 * System audit fields — the four values every LEAP record carries under
 * System Information: Created Date, Created By, Last Modified Date,
 * Last Modified By.
 *
 * There are two questions in play and they have DIFFERENT answers, which is why
 * this module exposes two things rather than one:
 *
 *   1. "Is this LAID-OUT FIELD one of the four?" — answered by the layout
 *      itself. The page-layout row carries `system_audit: true` on exactly the
 *      four fields the platform placed (migration
 *      20260822225900_system_information_fields_marked_system_audit). Use
 *      `isSystemAuditField(field)`. Never guess this from the column name: a
 *      real business timestamp can end in `_updated_at` (vehicles carries
 *      `vehicle_odometer_updated_at`, which a user legitimately edits) and
 *      holding it read-only would break the record.
 *
 *   2. "Is this RAW COLUMN one of the four?" — asked where there is no layout
 *      to consult: building the create form's field list, or deciding which
 *      columns are user-editable at all. There the column name is the only
 *      signal available, and the answer only ever HIDES a field from a create
 *      form or marks it system-managed, so a false positive costs nothing.
 *      Use `isSystemAuditColumn(name)`.
 *
 * The column patterns cover every spelling in the schema: prefixed
 * (`property_created_at`), bare (`created_at`, which a dozen older tables use),
 * and the `_id` suffix (`tasks.created_by_id`).
 */

// <prefix>_created_at | created_at | ..._updated_by_id, and every combination.
const SYSTEM_AUDIT_COLUMN = /(?:^|_)(?:created|updated)_(?:at|by)(?:_id)?$/

/**
 * True when a column name is one of the four audit columns, in any of the
 * spellings the schema uses. Name-based on purpose — see the header for where
 * that is and is not the right question to ask.
 */
export function isSystemAuditColumn(name) {
  if (typeof name !== 'string' || name === '') return false
  return SYSTEM_AUDIT_COLUMN.test(name)
}

/**
 * True when a page-layout field is one of the four the platform placed under
 * System Information. Reads the layout's own declaration, so an admin-placed
 * field that happens to share a name is untouched.
 */
export function isSystemAuditField(field) {
  return !!field && field.system_audit === true
}

/**
 * Stable React key for a laid-out field. The four audit fields resolve to the
 * SAME column twice on an append-only log (audit_log's created and last-modified
 * are both `al_performed_at` — an audit row is written once and never edited),
 * and an admin can drag any field into two sections, so a field's name is not
 * unique within a group. Pairing it with its position is.
 */
export function fieldRenderKey(field, index) {
  const base = field?.name || field?.spacer_id || 'field'
  return `${base}#${index}`
}
