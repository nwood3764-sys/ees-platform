// =============================================================================
// recordTypeSeed — what a create form writes into an object's record-type
// column.
//
// LEAP's convention is that a `{object}_record_type` column is a uuid FK to
// picklist_values, so the create form seeds the picked type's id. `portal_users`
// predates that convention: its `record_type` is TEXT and holds the picklist
// VALUE ('Provider User', 'Property Owner User', 'Program Manager User'). Every
// gate that reads it compares that text — the three portal read RPCs, the
// program-portal-file edge function, and the Manage Shared Records action — so
// seeding a uuid there produced a portal user that no portal would let in, and
// no action would offer anything to.
//
// The fix is not a list of exceptions. The form seeds what the COLUMN can hold,
// decided from the column's own data type.
// =============================================================================

/**
 * The value to write into a record-type column for a picked record type.
 *
 * @param {{id?: string, value?: string, picklist_value?: string, label?: string}|null} recordType
 * @param {string|null} columnDataType  the column's Postgres data type, as
 *   describe_object_columns reports it ('uuid', 'text', …). Unknown is treated
 *   as uuid, which is the platform convention.
 * @returns {string|null} the value to seed, or null when there is nothing to seed.
 */
export function recordTypeSeedValue(recordType, columnDataType) {
  if (!recordType) return null
  const storesId = !columnDataType || String(columnDataType).toLowerCase() === 'uuid'
  if (storesId) return recordType.id || null
  // A text column holds the picklist VALUE. Fall back to the label only when
  // the value is absent — a picklist row without a value is a configuration
  // problem, and a label is closer to right than a uuid.
  return recordType.value || recordType.picklist_value || recordType.label || null
}

/**
 * Does this object's record-type column store the picklist VALUE rather than
 * its id? Used to decide how to seed and how to match.
 */
export function recordTypeColumnStoresValue(columnDataType) {
  return !!columnDataType && String(columnDataType).toLowerCase() !== 'uuid'
}
