// ─── Number choice ranges ────────────────────────────────────────────────────
//
// Nicholas, 2026-09-05, on a building record: "should the number of stories be
// a pick list? Not just a free-form text field... also, the year built should
// also be a pick list."
//
// Both are NUMERIC columns — buildings.building_stories_of_building is numeric
// and buildings.building_year_built is an integer — and they have to stay that
// way. A year is a number: it sorts, it subtracts to give a building's age, it
// filters as "before 1980", and the Asset Score report, the bulk property
// importer and four page layouts read it as one. Converting the column to a
// uuid FK the way an ordinary LEAP picklist works would print a record id
// wherever a year belongs. So what changes is the CONTROL, not the column: a
// dropdown whose choices are a RANGE, storing the number.
//
// The range is DERIVED, never enumerated. A year list written out as 227
// picklist rows is wrong every January; declaring 1800 through "one year past
// today" is right forever. `max_offset_from_current_year` is what makes that
// possible, and it is why this file exists instead of a list.
//
// Where a range is declared: field_metadata.fm_choice_range, one row per
// column — the same table that already declares a column's display type and
// its lookup scope, so one row governs the field on every layout that carries
// it and on any layout built later.
//
//   { "min": 1800, "max_offset_from_current_year": 1, "step": 1, "order": "desc" }
//   { "min": 1, "max": 50, "step": 1, "order": "asc" }
//
// THE ONE RULE THAT MATTERS: a value already stored is never hidden. A dropdown
// that does not contain the answer in front of you is a person stuck — the same
// lesson the disposal-facility field learned in 2026-09-03, and the reason the
// picklist resolver always returns the record's own current value. So
// numberChoiceOptions() takes the stored value and folds it in when the range
// does not reach it.

// A range that would produce more options than a person can face is a
// configuration mistake, not a dropdown. Cap it and say so rather than
// rendering 20,000 <option> elements.
export const MAX_CHOICE_OPTIONS = 1000

/** Is this field_metadata row declaring a number dropdown? */
export function isNumberChoiceRange(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false
  return Number.isFinite(Number(config.min))
    && (Number.isFinite(Number(config.max)) || Number.isFinite(Number(config.max_offset_from_current_year)))
}

/**
 * Resolve a declared range to its numeric bounds for a given "today".
 * `now` is injectable so a fixture can pin the year instead of drifting with
 * the calendar.
 */
export function resolveRangeBounds(config, now = new Date()) {
  if (!isNumberChoiceRange(config)) return null
  const min = Number(config.min)
  const max = Number.isFinite(Number(config.max))
    ? Number(config.max)
    : now.getFullYear() + Number(config.max_offset_from_current_year)
  if (!Number.isFinite(max) || max < min) return null
  const step = Number.isFinite(Number(config.step)) && Number(config.step) > 0 ? Number(config.step) : 1
  return { min, max, step }
}

/**
 * The options for a number dropdown: [{ value: <number>, label: <string> }].
 *
 * `currentValue` is the value the record already holds. When it falls outside
 * the declared range — a building recorded as built in 1780, a range an admin
 * narrowed after the fact — it is added rather than dropped, so opening a
 * record can never silently clear a field by saving a value the control could
 * not represent.
 *
 * The label is never thousand-separated: 1987 is a year, not a quantity, and
 * "1,987" is how it reads on the record page today.
 */
export function numberChoiceOptions(config, currentValue = null, now = new Date()) {
  const bounds = resolveRangeBounds(config, now)
  if (!bounds) return null
  const { min, max, step } = bounds
  const count = Math.floor((max - min) / step) + 1
  if (count > MAX_CHOICE_OPTIONS) return null

  const values = []
  for (let v = min; v <= max + 1e-9; v += step) {
    // Steps of 0.5 accumulate float error; round to the step's own precision.
    values.push(Number(v.toFixed(6)))
  }
  if (String(config.order).toLowerCase() === 'desc') values.reverse()

  const current = currentValue === '' || currentValue === null || currentValue === undefined
    ? null
    : Number(currentValue)
  if (current !== null && Number.isFinite(current) && !values.includes(current)) {
    // Keep it in the same order as the rest rather than always on top.
    if (String(config.order).toLowerCase() === 'desc') {
      const at = values.findIndex(v => v < current)
      values.splice(at === -1 ? values.length : at, 0, current)
    } else {
      const at = values.findIndex(v => v > current)
      values.splice(at === -1 ? values.length : at, 0, current)
    }
  }

  return values.map(v => ({ value: v, label: formatChoiceNumber(v) }))
}

/** A choice's label. Plain digits — no grouping separator, no trailing zeros. */
export function formatChoiceNumber(v) {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  return Number.isInteger(n) ? String(n) : String(n)
}

/**
 * What a number dropdown stores. The control hands back a string; the column is
 * numeric, so this is where it becomes a number — writing "1987" as text into
 * an integer column happens to work today and is not something to rely on.
 * An empty choice clears the field.
 */
export function parseNumberChoice(raw) {
  if (raw === '' || raw === null || raw === undefined) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}
