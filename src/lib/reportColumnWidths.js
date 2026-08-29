// ---------------------------------------------------------------------------
// reportColumnWidths — a report's columns are as wide as the report says, and
// they do not move on their own.
//
// Nicholas, 2026-08-29: "I need a way to adjust the column widths and never
// have them change again. There's too much of this auto-scaling and moving
// around."
//
// The auto-scaling was `table-layout: auto`, the browser default: with it, EVERY
// column is re-measured from the widest cell in it, so re-running a report,
// changing a filter, expanding a group, or an inline edit that lengthens one
// value silently re-lays out the whole table. No amount of setting widths fixes
// that on its own — under `auto` a width is a suggestion the browser is free to
// overrule. The table is therefore laid out FIXED, and every column carries an
// explicit width: a saved one if the report has it, otherwise a default derived
// from what the column holds. Fixed layout also means the browser stops after
// the first row instead of measuring every row, which is faster on a long
// report.
//
// Widths live on the REPORT (reports.rpt_column_widths), not in the browser: a
// report is a shared, named artifact, so the layout someone sets is the layout
// the report has — the same rule that already governs its columns, filters and
// format. Nothing here is per-user.
// ---------------------------------------------------------------------------

// A column's stable identity across runs. A report can carry the same column
// name twice by reaching it through different relationships (`account_name` on
// the opportunity's account and on the property's account), so the hop path is
// part of the key — keying on the name alone would tie those two together and
// resize both at once. A calculated field has no column at all, so it is keyed
// by its label under a prefix that no column name can collide with.
export function reportColumnKey(col) {
  if (!col) return ''
  if (col._calc || col.scope === 'row') return `calc:${col.label || ''}`
  const via = Array.isArray(col.via_path) ? col.via_path.filter(Boolean) : []
  return via.length > 0 ? `${via.join('>')}>${col.name}` : String(col.name || '')
}

// Starting width for a column nobody has sized yet. A report is read across —
// the eye travels a row — so these lean generous rather than equal: a date is
// never longer than a date, a name usually is.
export function defaultReportColumnWidth(col) {
  if (!col) return 160
  const type = String(col.type || col.data_type || '').toLowerCase()
  const name = String(col.name || '').toLowerCase()
  const label = String(col.label || '').toLowerCase()

  if (col._calc) return 150
  if (/record\s*(#|number)/.test(label) || /record_number$/.test(name)) return 130
  if (/(^|_)name$/.test(name) || label === 'name' || /\bname\b/.test(label)) return 240
  if (/address|street/.test(name) || /address|street/.test(label)) return 240
  if (/email/.test(name)) return 210
  if (/phone/.test(name)) return 150
  if (/status|stage|record_type/.test(name)) return 190
  if (type.includes('bool')) return 90
  if (type.includes('date') || type.includes('timestamp')) return 130
  if (/(numeric|integer|bigint|smallint|double|real|money|decimal)/.test(type)) return 130
  return 170
}

/**
 * The width every rendered column gets, in render order — a saved width when
 * the report has one, the type default otherwise. Every column is given a
 * number: under fixed layout a column with no width is sized from whatever is
 * left over, which is the auto-scaling this exists to stop.
 */
export function resolveReportColumnWidths(columns, saved) {
  const map = (saved && typeof saved === 'object' && !Array.isArray(saved)) ? saved : {}
  return (columns || []).map(col => {
    const key = reportColumnKey(col)
    const w = map[key]
    return Number.isFinite(w) && w > 0 ? Math.round(w) : defaultReportColumnWidth(col)
  })
}

// The table's own width under fixed layout: the sum of its columns. Without it
// a table narrower than its container is stretched to fit — which would size
// the columns by division rather than by what was set.
export function totalWidth(widths) {
  return (widths || []).reduce((sum, w) => sum + (Number.isFinite(w) ? w : 0), 0)
}

/**
 * Merge one dragged column into the saved map. Returns a NEW map — the caller
 * persists it. Widths for columns the report no longer carries are kept: a
 * column removed and added back keeps the width it had, and a report edited by
 * two people does not lose one of their layouts.
 */
export function withColumnWidth(saved, key, px) {
  const base = (saved && typeof saved === 'object' && !Array.isArray(saved)) ? saved : {}
  if (!key) return base
  return { ...base, [key]: Math.round(px) }
}

// Drop a column's saved width, returning it to its default (double-click reset).
export function withoutColumnWidth(saved, key) {
  const base = (saved && typeof saved === 'object' && !Array.isArray(saved)) ? saved : {}
  if (!key || !(key in base)) return base
  const next = { ...base }
  delete next[key]
  return next
}
