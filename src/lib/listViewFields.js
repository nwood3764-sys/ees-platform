// ---------------------------------------------------------------------------
// listViewFields — which fields a list view actually REFERENCES.
//
// A list view touches a field in three independent ways: it DISPLAYS it as a
// column, it FILTERS on it, or it SORTS by it. Only the first is visible on
// screen — and for a long time only the first was loaded, so hiding a column a
// filter used silently emptied the list: the rows came back without that
// field, and every row failed the comparison against `undefined`.
//
// Referencing a field is not the same as showing it. Everything here returns
// the UNION of the three, which is what the row fetch has to resolve.
//
// Only RELATED (one-hop, `<fk>__rel__<parent_column>`) fields matter to the
// fetch — an object's own columns are always emitted on every row — but the
// collectors deliberately return every referenced field so a caller that needs
// the full set (e.g. a future server-side filter push-down) has it.
// ---------------------------------------------------------------------------

export const REL_DELIM = '__rel__'

export function isRelatedFieldName(field) {
  return typeof field === 'string' && field.includes(REL_DELIM)
}

// Filter rows are the flat `{ field, op, value }` shape the list engine
// matches on. Nested shapes (an array of rows, or a group carrying its own
// `filters`/`conditions`) are walked too, so a future grouped-logic filter
// can't quietly drop its fields out of the fetch.
function pushFilterFields(out, filters, depth = 0) {
  if (!Array.isArray(filters) || depth > 10) return
  for (const f of filters) {
    if (!f) continue
    if (Array.isArray(f)) { pushFilterFields(out, f, depth + 1); continue }
    if (typeof f !== 'object') continue
    if (typeof f.field === 'string' && f.field) out.push(f.field)
    pushFilterFields(out, f.filters, depth + 1)
    pushFilterFields(out, f.conditions, depth + 1)
  }
}

// Every field a view definition references, de-duplicated, display order first.
export function collectViewFields({ visibleColumns, filters, sortField, groupField } = {}) {
  const out = []
  if (Array.isArray(visibleColumns)) {
    for (const f of visibleColumns) if (typeof f === 'string' && f) out.push(f)
  }
  pushFilterFields(out, filters)
  if (typeof sortField === 'string' && sortField) out.push(sortField)
  if (typeof groupField === 'string' && groupField) out.push(groupField)
  return Array.from(new Set(out))
}

// The related (one-hop) subset of the above, sorted so it can be compared as a
// stable key without re-sorting at every call site.
export function collectRelatedFields(view) {
  return collectViewFields(view).filter(isRelatedFieldName).sort()
}

// Union of EVERY field referenced across a set of view definitions. Seeds the
// first fetch on a wide table, which is no longer fetched with `select *`: the
// query has to name the own columns the saved views need, not just the related
// ones, or a view opens with blank cells until something triggers a refetch.
export function collectFieldsForViews(views) {
  const seen = new Set()
  for (const v of views || []) {
    if (!v) continue
    for (const f of collectViewFields(v)) seen.add(f)
  }
  return Array.from(seen).sort()
}

// Union across a set of view definitions — used to seed the first fetch so a
// saved view whose filter rides a related field resolves on first paint,
// whether or not that view also displays the column.
export function collectRelatedFieldsForViews(views) {
  const seen = new Set()
  for (const v of views || []) {
    if (!v) continue
    for (const f of collectRelatedFields(v)) seen.add(f)
  }
  return Array.from(seen).sort()
}
