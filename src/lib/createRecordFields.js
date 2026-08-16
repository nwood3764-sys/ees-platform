// ---------------------------------------------------------------------------
// Create-record pop-up — which fields it asks for
// ---------------------------------------------------------------------------
// Standing rule (Nicholas, 2026-08-16): a manual New on ANY object, from ANY
// page layout, opens a pop-up that asks for the REQUIRED fields ONLY. The full
// record page is where everything else gets filled in, once the record exists.
//
// "Required" is the union of
//   • the table's NOT NULL columns (ees_table_metadata → requiredFields), and
//   • fields an admin marked required on the page layout (widget config
//     `required: true`),
// minus the columns nobody should ever be asked for:
//   • system / audit columns — applyInsertDefaults fills them at insert
//   • trigger-derived columns — the DB composes them (building_name, etc.)
//   • computed fields — formula / rollup / inherited / cross-object related
//   • layout spacers, and fields the user's field permissions make read-only
//
// Field ORDER follows the page layout, so the pop-up reads in the order an
// admin designed, section by section.
//
// Pure functions, no imports: the caller supplies its own exclusion sets, which
// keeps this testable in node (scripts/create-modal-fields-fixture.mjs).

export const CREATE_MODAL_HIDDEN_TYPES = new Set([
  'spacer', 'related_field', 'formula', 'rollup', 'inherited',
])

// Columns applyInsertDefaults owns. Same expression the create form's
// required-field validator uses, kept here so both agree on what "system" means.
export const CREATE_MODAL_SYSTEM_COLUMN =
  /(^id$|_record_number$|_owner$|_created_by$|_created_at$|_updated_by$|_updated_at$|_is_deleted$|^is_seed_data$|_is_seed_data$)/

/**
 * Group the page layout's fields down to what the create pop-up should ask for.
 *
 * @param sections  loaded page-layout sections ([{ id, section_label, widgets }])
 * @param opts.requiredFields  Set of NOT NULL column names
 * @param opts.showAll         true = every editable layout field (the pop-up's
 *                             "Show all fields" toggle), false = required only
 * @param opts.neverAsk        Set of columns to never render (trigger-derived
 *                             names, read-only derived columns)
 * @returns { groups: [{ key, title, fields }], covered: Set<columnName> }
 *          `covered` is every layout column seen, whether or not it was kept —
 *          the caller uses it to find required columns the layout doesn't carry.
 */
export function buildCreateModalGroups(sections, { requiredFields, showAll = false, neverAsk } = {}) {
  const required = requiredFields || new Set()
  const skip = neverAsk || new Set()
  const covered = new Set()
  const groups = []
  for (const sec of sections || []) {
    const fields = []
    for (const w of (sec.widgets || [])) {
      if (w.widget_type !== 'field_group') continue
      for (const f of (w.widget_config?.fields || [])) {
        if (!f?.name || covered.has(f.name)) continue
        covered.add(f.name)
        if (CREATE_MODAL_HIDDEN_TYPES.has(f.type)) continue
        if (CREATE_MODAL_SYSTEM_COLUMN.test(f.name)) continue
        if (skip.has(f.name)) continue
        if (f._editable === false) continue
        const isRequired = f.required === true || required.has(f.name)
        if (!showAll && !isRequired) continue
        // The pop-up is one narrow column of its own — drop the record page's
        // column pinning so fields flow in layout order instead of leaving
        // holes where the second column would have been.
        const { column, full_width, ...rest } = f   // eslint-disable-line no-unused-vars
        fields.push({ ...rest, required: isRequired })
      }
    }
    if (fields.length) {
      groups.push({
        key: sec.id || sec.section_label || `section-${groups.length}`,
        title: sec.section_label || '',
        fields,
      })
    }
  }
  return { groups, covered }
}

/**
 * NOT NULL columns the page layout doesn't carry at all. Without these the
 * pop-up would look complete and then fail on save with "Required field
 * missing" — and an object with no layout would have nothing to fill in. The
 * caller resolves each to a real editor from the table's column metadata.
 */
export function listUnlaidOutRequiredColumns(requiredFields, covered, { neverAsk, recordTypeColumn } = {}) {
  const seen = covered || new Set()
  const skip = neverAsk || new Set()
  const out = []
  for (const col of (requiredFields || [])) {
    if (seen.has(col)) continue
    if (CREATE_MODAL_SYSTEM_COLUMN.test(col)) continue
    if (skip.has(col)) continue
    if (recordTypeColumn && col === recordTypeColumn) continue   // the record-type picker owns this
    out.push(col)
  }
  return out
}
