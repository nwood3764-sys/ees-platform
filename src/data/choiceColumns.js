// ─── Choice columns ───────────────────────────────────────────────────────
//
// A *choice column* is a plain text column whose stored value is one of a
// fixed set of choices — `reports.rpt_primary_object` holds a table name,
// `reports.rpt_format` holds 'tabular' | 'summary' | 'matrix'.
//
// These can't ride the normal picklist editor: that editor stores a
// `picklist_values.id` (uuid), and these columns store the literal text. With
// no editor of their own they fell through to a free-text box, so creating a
// report meant typing a table name from memory and finding out it was wrong
// only when the report ran (Nicholas, 2026-08-18: "why can someone type in
// this field? should be a pick list").
//
// The registry names the column and where its choices come from. `source`
// entries resolve at call time from the platform's own list, so there is one
// source of truth per list — never a copy pasted into a page layout.
//
// To add a choice column: add an entry here. Both the record page (through
// fetchPageLayout) and the New-record pop-up read this registry, so the
// dropdown appears in both places with no per-screen wiring.

const CHOICE_COLUMNS = {
  // Every object a report can be built on — the same list the Report Builder's
  // Primary Object dropdown offers.
  'reports.rpt_primary_object': { source: 'reportable_objects' },

  // Salesforce's three report formats. `rpt_format` is checked in the DB, so
  // the options ARE the allowed values.
  'reports.rpt_format': {
    options: [
      { value: 'tabular', label: 'Tabular' },
      { value: 'summary', label: 'Summary' },
      { value: 'matrix',  label: 'Matrix'  },
    ],
  },
}

const _sourceCache = new Map()   // source name → Promise<Option[]>

// Option lists that come from elsewhere in the platform. Imported lazily so
// this module can be pulled into layoutService without creating a static
// import cycle (a cycle across vendor chunks is the documented TDZ trap).
const CHOICE_SOURCES = {
  reportable_objects: async () => {
    const { listPrimaryObjectOptions } = await import('./reportsService')
    const objects = await listPrimaryObjectOptions()
    return (objects || []).map(o => ({ value: o.table, label: o.label }))
  },
}

export function isChoiceColumn(tableName, columnName) {
  return !!CHOICE_COLUMNS[`${tableName}.${columnName}`]
}

/**
 * Options for a choice column, or null when the column isn't one.
 * Returns [{ value, label }]. A source that fails to resolve returns null so
 * the caller leaves the field as it was rather than rendering an empty
 * dropdown the user can't get past.
 */
export async function getChoiceOptions(tableName, columnName) {
  const entry = CHOICE_COLUMNS[`${tableName}.${columnName}`]
  if (!entry) return null
  if (entry.options) return entry.options
  if (!entry.source) return null
  if (!_sourceCache.has(entry.source)) {
    const loader = CHOICE_SOURCES[entry.source]
    if (!loader) return null
    _sourceCache.set(entry.source, loader().catch(() => null))
  }
  return _sourceCache.get(entry.source)
}
