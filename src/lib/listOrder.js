// ─── listOrder ───────────────────────────────────────────────────────────
// ONE definition of how LEAP orders rows by a text value.
//
// Why this module exists at all: the list loaders used to make the DATABASE
// order every full-table read (`.order('property_name').range(from, to)`),
// which is what made the Properties list time out — see fetchAllKeyset in
// src/lib/supabase.js for the full account. The loaders now page by primary
// key, which is cheap, and restore the display order here instead.
//
// That is only safe because the order is IDENTICAL to what the list itself
// would apply. ListView sorts client-side with `localeCompare` whenever a
// view carries a sort, and renders the fetch order verbatim when it does not
// (ListView.jsx, the `if (sortField)` branch). So a loader that hands back
// rows in a different order silently reorders every list with no saved sort.
// One comparator, used by both, is what keeps them from drifting apart.
//
// Intl.Collator rather than String.prototype.localeCompare: the spec defines
// localeCompare in terms of a Collator with the same (default) options, so the
// ORDER is identical — but a collator built once avoids re-resolving the
// locale on every one of the ~233,000 comparisons a 16,665-row sort makes.
//
// The `|| ''` (not `?? ''`) is deliberate and is the behaviour ListView has
// always had: a 0 or a false sorts as an empty string. Text columns are what
// this comparator is for; changing it here would silently reorder numeric
// columns in every saved list view.
// ─────────────────────────────────────────────────────────────────────────

const collator = new Intl.Collator(undefined)

// The value a row contributes to a text sort. Exported so a caller can see
// what it is comparing rather than guessing.
export function textSortValue(value) {
  return String(value || '')
}

// Compare two raw cell values as text. Returns the usual <0 / 0 / >0.
export function compareTextValues(a, b) {
  return collator.compare(textSortValue(a), textSortValue(b))
}

// Sort rows by one key, ascending, in place, and return them.
//
// `Array.prototype.sort` is stable (spec-guaranteed since ES2019), so rows
// that tie on the key keep the order they arrived in — which, for a loader
// paging by primary key, is a deterministic tie-break rather than an
// arbitrary one.
export function sortRowsByTextKey(rows, key, { descending = false } = {}) {
  if (!Array.isArray(rows) || !key) return rows
  rows.sort((a, b) => {
    const cmp = compareTextValues(a?.[key], b?.[key])
    return descending ? -cmp : cmp
  })
  return rows
}
