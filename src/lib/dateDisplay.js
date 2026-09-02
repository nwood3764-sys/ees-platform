// ─── dateDisplay.js ──────────────────────────────────────────────────────────
// How a date or a timestamp is WRITTEN on screen.
//
// One rule, in one place, because the difference between the two matters and is
// easy to get wrong in opposite directions:
//
//   • A `date` column holds "2026-08-12" — a calendar day with no time and no
//     zone. `new Date('2026-08-12')` parses that as midnight UTC, which in
//     Chicago is 7pm on the 11th, so the naive route prints the day BEFORE.
//     The fix is to pin it to local midnight ('T00:00:00'), which is what the
//     record page has always done and what this carries over.
//
//   • A `timestamptz` column holds an instant. It has a time of day and must be
//     shown in the reader's zone — the same zone the record page shows it in,
//     and the same zone its editor writes back in (see datetimeField.js).
//
// The list view printed neither: it wrote the raw cell straight into the <td>,
// so a service appointment's Scheduled Start read
// "2026-09-02T15:00:00.000Z" — the stored instant, in UTC, punctuation and all,
// on a screen whose whole job is to be scanned. The column catalog types both
// kinds as 'date' (columnType maps every /date/ data type to it), so the list
// cannot ask the schema which one it is holding and decides from the VALUE.
//
// Deciding from the value is not a guess: a bare date is exactly ten characters
// and nothing else in a date column looks like that.
// ─────────────────────────────────────────────────────────────────────────────

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** True when this value is a calendar day with no time of day. */
export function isDateOnlyValue(raw) {
  return typeof raw === 'string' && DATE_ONLY.test(raw.trim())
}

/**
 * A calendar day, in the reader's own terms: "Aug 12, 2026".
 * Parsed at LOCAL midnight so the day printed is the day stored.
 */
export function formatDateOnly(raw) {
  const d = new Date(isDateOnlyValue(raw) ? `${String(raw).trim()}T00:00:00` : raw)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** An instant, in the reader's zone: "Aug 12, 2026, 8:00 AM". */
export function formatInstant(raw) {
  const d = new Date(raw)
  if (isNaN(d.getTime())) return null
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

/**
 * Display one date-ish cell value, choosing by what the value IS.
 * Returns null for anything unparseable, so the caller can fall back to showing
 * the raw text rather than printing "Invalid Date" over real data.
 */
export function formatDateValue(raw) {
  if (raw == null || raw === '') return null
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : formatInstant(raw)
  if (typeof raw !== 'string') return null
  return isDateOnlyValue(raw) ? formatDateOnly(raw) : formatInstant(raw)
}
