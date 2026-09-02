// ─── listFilterDates.js ──────────────────────────────────────────────────────
// One definition of what a DATE filter means on a list view.
//
// A list view compared its filter values as plain strings: `cmp(v, value)` on
// the raw cell text. That is lexical, and a timestamp column does not compare
// lexically against a date. `sa_scheduled_start_time` holds
// "2026-08-12T13:00:00+00:00"; a filter of `equals 2026-08-12` compared those
// two strings and matched nothing, and `on or before 2026-08-12` EXCLUDED that
// whole day, because 13:00 sorts after midnight. Both read as "there are no
// such records".
//
// It also meant a saved list view could only ever name a FIXED date, so
// "Today's Service Appointments" was not a view anybody could author — it would
// be true for one day and a lie every day after.
//
// The platform already owns this: `reportFilters.js` resolves relative date
// literals (TODAY, THIS_WEEK, LAST_N_DAYS:30 …) to a half-open [start, end)
// instant range and evaluates every operator against it. This module points
// the list view at that same kernel rather than defining a second set of date
// rules — the two must never be able to disagree about what "before today"
// means.
//
// The only thing that lives here is the mapping from the LIST view's operator
// vocabulary (which carries `from`/`to` as its "on or after" / "on or before"
// pair) onto the report kernel's.
// ─────────────────────────────────────────────────────────────────────────────

import { isDateLiteral, evaluateOperator } from './reportFilters.js'

// List operator → report-kernel operator. `from`/`to` are the list's own
// spelling of "on or after" / "on or before"; `gte`/`lte` are the number
// vocabulary reused on dates by older saved views. Both mean the same instant
// comparison, so both map onto the same kernel operator.
export const LIST_DATE_OPERATORS = {
  equals:     'equals',
  not_equals: 'not_equals',
  gt:         'greater_than',
  gte:        'greater_or_equal',
  from:       'greater_or_equal',
  lt:         'less_than',
  lte:        'less_or_equal',
  to:         'less_or_equal',
  between:    'between',
}

/** True when this operator has a date-range meaning worth resolving. */
export function isDateComparableOperator(op) {
  return Object.prototype.hasOwnProperty.call(LIST_DATE_OPERATORS, op)
}

/**
 * True when a filter row should be evaluated as a date rather than as text.
 *
 * Two ways in, and BOTH are needed:
 *   • the column is declared a date by the column catalog, or
 *   • the value is a relative date literal — which is self-describing, and is
 *     the only signal available for a filter saved before the catalog carried
 *     a type, or authored against a related column whose type never travelled
 *     with the saved view.
 *
 * A blank-check operator (`is_blank`) is deliberately NOT date-ish: "has no
 * value" is the same question on every type and the kernel would resolve it
 * against a range it has no business consulting.
 */
export function isDateFilterRow(type, value, op) {
  if (!isDateComparableOperator(op)) return false
  if (type === 'date' || type === 'datetime') return true
  if (Array.isArray(value)) return value.some(v => isDateLiteral(v))
  return isDateLiteral(value)
}

/**
 * Evaluate one date filter row against one raw cell value.
 *
 * A blank cell never matches a date comparison — an appointment with no
 * scheduled time is not "before today", it is unscheduled. `not_equals` is the
 * one place that would otherwise say yes to a blank, and the kernel already
 * treats it as a negated match rather than a free pass.
 */
export function evaluateDateFilter(rawValue, op, value, now = new Date()) {
  const kernelOp = LIST_DATE_OPERATORS[op]
  if (!kernelOp) return true
  if (rawValue == null || rawValue === '') return false
  return evaluateOperator(rawValue, kernelOp, value, 'date', now)
}
