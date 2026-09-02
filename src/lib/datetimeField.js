// ─── datetimeField.js ────────────────────────────────────────────────────────
// Turning a stored timestamp into something `<input type="datetime-local">` can
// edit, and back again.
//
// Until 2026-09-02 no `datetime` field anywhere in LEAP was editable on a record
// page: the edit gate excluded the type outright and EditField's `datetime` case
// returned the literal text "Read-only". `date` fields had an editor; `datetime`
// never did. That went unnoticed for as long as it did because most datetime
// fields ARE audit columns, which are correctly read-only — but it also meant
// Scheduled Start on a service appointment, clock-in on a timesheet entry and a
// work order's start/end could be displayed and never entered (Nicholas,
// 2026-09-02: "why can't I edit the schedule start time?").
//
// The conversion is the whole risk here, so it lives in its own module with its
// own fixture. `datetime-local` has no timezone: it is wall-clock time in
// WHATEVER ZONE THE READER IS IN. The stored column is `timestamptz`, an
// absolute instant. Get the direction wrong and every appointment in the system
// silently moves by the UTC offset — five hours in Wisconsin — which is the kind
// of defect that is only noticed when somebody misses a job.
//
// The zone used is the BROWSER'S, deliberately, because that is already the zone
// LEAP displays these values in (the record page formats them with
// toLocaleString and no timeZone option). Editing in one zone and displaying in
// another would be worse than either choice alone.

/** Two digits, for building the wall-clock string by hand. */
const pad = (n) => String(n).padStart(2, '0')

/**
 * Stored timestamp → the value a `datetime-local` input expects.
 *
 * Built from the Date's LOCAL parts, never from toISOString(), which would hand
 * the input a UTC wall-clock and show a Chicago 8:00 AM appointment as 1:00 PM.
 *
 * @param {string|Date|null} value  ISO 8601 timestamp, or a Date
 * @returns {string} "YYYY-MM-DDTHH:mm", or '' when there is nothing to show
 */
export function toDatetimeLocal(value) {
  if (value == null || value === '') return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
         `T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * A `datetime-local` value → the ISO instant to store.
 *
 * `new Date("YYYY-MM-DDTHH:mm")` — with no trailing Z and no offset — is parsed
 * as LOCAL time by the spec, which is exactly what the input means. That is the
 * one behaviour this depends on, and the fixture pins it.
 *
 * @param {string} local  "YYYY-MM-DDTHH:mm" (seconds optional)
 * @returns {string|null} ISO 8601 with offset, or null when the field is cleared
 */
export function fromDatetimeLocal(local) {
  const s = String(local ?? '').trim()
  if (s === '') return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/**
 * True when a round trip through the input would change the stored instant.
 *
 * A `datetime-local` input carries no seconds, so reading a stored value that
 * has them and writing it straight back would silently truncate. Callers use
 * this to leave an untouched field alone rather than rewriting it on every save.
 */
export function datetimeRoundTripsCleanly(value) {
  const back = fromDatetimeLocal(toDatetimeLocal(value))
  if (back == null || value == null || value === '') return back == null
  const original = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(original.getTime())) return false
  return new Date(back).getTime() === original.getTime()
}
