// =============================================================================
// src/lib/builderSourceOptions.js
//
// One rule for every picker in the LEAP builders that binds a <select> to a
// uuid foreign key.
//
// Every LEAP service returns a row carrying TWO ids. `id` is the HUMAN display
// id — a record number (DSH-00010) or, on an object with no record number, the
// uuid's first 8 characters uppercased (FA6C5203). `_id` is the row's real
// uuid, and a uuid column can store nothing else.
//
// Binding an option to `id` therefore builds a control that looks correct and
// writes a value Postgres refuses: `invalid input syntax for type uuid:
// "FA6C5203"` (Nicholas, 2026-08-31, assigning a Role on the Enrollment Home
// page — FA6C5203 is the first 8 characters of the Admin role's uuid). It has a
// second, quieter half: a page that ALREADY holds a real uuid matches no option
// value, so the control reads "All roles in module" while the record is in fact
// role-scoped.
//
// The home-page editor hand-rolled four of these mappings — dashboards,
// reports, list views, roles — and one of the four read `r.id`. Four copies of
// a rule is four chances for one to be wrong, so there is one function now.
// Never map a picker's option values by hand.
// =============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim())
}

// The row's real uuid, or null when the row carries only a display id.
// `_id` is checked first because that is where every service puts the uuid;
// `id` is accepted only when it IS a uuid, which is how the handful of services
// that never took on a display id return their rows.
export function optionRowId(row) {
  if (!row || typeof row !== 'object') return null
  if (isUuid(row._id)) return row._id.trim()
  if (isUuid(row.id)) return row.id.trim()
  return null
}

// Services spell the human name differently by object (`name`, `label`,
// `role_name`); the fallback names the kind of thing so a nameless row is still
// selectable rather than blank.
export function optionRowLabel(row, fallback = 'Untitled') {
  if (!row || typeof row !== 'object') return fallback
  for (const key of ['name', 'label', 'role_name']) {
    const v = row[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return fallback
}

// Service rows → [{ id, name }] for a <select> bound to a uuid FK.
//
// A row with no resolvable uuid is DROPPED, not rendered: an option that cannot
// be saved is worse than an option that is not offered, because the failure
// lands at save time on a page of unrelated work.
export function toSourceOptions(rows, fallbackLabel = 'Untitled') {
  return (Array.isArray(rows) ? rows : []).reduce((out, row) => {
    const id = optionRowId(row)
    if (id) out.push({ id, name: optionRowLabel(row, fallbackLabel) })
    return out
  }, [])
}

// Save-path guard. Empty is a legitimate answer for an optional FK (no role, no
// bound source), so it passes through as null; anything else must be a uuid.
// Named on purpose — the point is that a recurrence reads as "Role is not a
// saved record id", not as a Postgres cast error the admin cannot act on.
export function assertUuidOrNull(value, fieldLabel) {
  if (value === null || value === undefined || value === '') return null
  if (isUuid(value)) return String(value).trim()
  throw new Error(
    `${fieldLabel} is not a saved record id ("${value}"). ` +
    'The picker sent a display id instead of the record\'s id — reopen the page and re-select it.')
}
