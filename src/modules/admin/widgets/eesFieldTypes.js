// ---------------------------------------------------------------------------
// Energy Efficiency Services field-type derivation — JS mirror of the Postgres function
// public._pick_anura_field_type(p_col, p_data_type, p_is_fk). Keeping these
// two in sync means fields added via the Page Layout Builder's field_group
// editor produce the same `type` value as the seeded widget_config.fields
// entries. If the DB function ever changes, update this to match.
// ---------------------------------------------------------------------------

const TEXTAREA_SUFFIX_RE = /(_notes|_description|_content|_message|_body|_instructions|_guidance)$/
const TEXTAREA_EXACT_NAMES = new Set([
  'notes', 'description', 'comments', 'instructions', 'guidance',
])

const NUMERIC_TYPES = new Set([
  'integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision',
])

/**
 * Given a column from describeObject, return the Energy Efficiency Services field type string
 * that the field_group runtime uses: one of 'lookup', 'date', 'datetime',
 * 'boolean', 'number', 'textarea', 'text'.
 */
export function deriveEesFieldType(col) {
  if (!col) return 'text'
  const name = col.column_name || ''
  const dt = col.data_type || ''
  const isFk = Boolean(col.is_foreign_key)

  if (isFk && dt === 'uuid') return 'lookup'
  if (dt === 'date') return 'date'
  if (dt === 'timestamp with time zone' || dt === 'timestamp without time zone') return 'datetime'
  if (dt === 'boolean') return 'boolean'
  if (NUMERIC_TYPES.has(dt)) return 'number'
  if (TEXTAREA_SUFFIX_RE.test(name) || TEXTAREA_EXACT_NAMES.has(name)) return 'textarea'
  return 'text'
}

/**
 * Build a widget_config.fields entry for a given column. Includes the
 * lookup_table / lookup_field pair for FK columns so runtime rendering
 * can resolve the display value without another round trip.
 */
export function buildFieldEntryFromColumn(col, overrides = {}) {
  const type = deriveEesFieldType(col)
  const entry = {
    name: col.column_name,
    type,
    label: humanizeColumnName(col.column_name),
  }
  if (type === 'lookup' && col.references_table) {
    entry.lookup_table = col.references_table
    entry.lookup_field = col.references_column || 'id'
  }
  return { ...entry, ...overrides }
}

/**
 * `first_name` → `First Name`. Mirrors the DB's _humanize_column function
 * closely enough that admins see the same label the seed would have made.
 */
export function humanizeColumnName(name) {
  if (!name) return ''
  // Strip a matching table-name prefix like "property_" from "property_name"
  // — runtime does this too, so labels match. We don't have the table name
  // here, so we just title-case everything. Fine for hand-picked fields.
  return name
    .split('_')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
