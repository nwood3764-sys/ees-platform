/**
 * Report filter semantics — the single source of truth for how a LEAP report
 * filter behaves, shared by the Report Builder UI, the report runner's
 * server-side pushdown, and its client-side evaluation.
 *
 * Modelled on Salesforce report filters:
 *   • the operator list is scoped to the field's kind (text / number / date /
 *     picklist / lookup / boolean) — you never see "starts with" on a picklist
 *   • picklist and lookup filters take MULTIPLE values ("is any of")
 *   • date filters accept relative date literals (TODAY, LAST 90 DAYS, THIS
 *     QUARTER…) as well as fixed dates
 *   • filter logic is a numbered boolean expression — "1 AND (2 OR 3)" — that
 *     is parsed and validated, not free text handed to the query builder
 *
 * Operator identifiers are the ones already persisted in
 * report_filters.rfilt_operator, so every previously-saved filter keeps
 * working unchanged. New operators are additive.
 */

// ─── Field kinds ──────────────────────────────────────────────────────────

/**
 * Classify a column into the kind that drives its operator list and value
 * editor. `column` is a describe_object_columns row (or the trimmed shape the
 * field tree exposes): { name|column_name, type|data_type, is_foreign_key,
 * references_table }.
 */
export function fieldKindFor(column) {
  if (!column) return 'text'
  const type = String(column.type || column.data_type || '').toLowerCase()
  const refs = column.references_table
  const isFk = column.is_foreign_key || !!refs

  if (isFk && refs === 'picklist_values') return 'picklist'
  if (isFk && refs) return 'lookup'
  if (type === 'boolean') return 'boolean'
  if (type.includes('timestamp')) return 'datetime'
  if (type === 'date') return 'date'
  if (['numeric', 'integer', 'bigint', 'smallint', 'double precision', 'real', 'money', 'decimal'].includes(type)) return 'number'
  if (type === 'uuid') return 'id'
  return 'text'
}

// ─── Operators ────────────────────────────────────────────────────────────
//
// `multi`  — value is an array of values, OR'd together (Salesforce "is any of")
// `range`  — value is a 2-tuple [low, high], inclusive of both bounds
// `noValue`— operator takes no value input at all

const OP = (op, label, extra = {}) => ({ op, label, ...extra })

const OPS_TEXT = [
  OP('equals', 'equals'),
  OP('not_equals', 'not equal to'),
  OP('contains', 'contains'),
  OP('does_not_contain', 'does not contain'),
  OP('starts_with', 'starts with'),
  OP('ends_with', 'ends with'),
  OP('is_null', 'is blank', { noValue: true }),
  OP('is_not_null', 'is not blank', { noValue: true }),
]

const OPS_PICKLIST = [
  OP('equals', 'equals', { multi: true }),
  OP('not_equals', 'not equal to', { multi: true }),
  OP('is_null', 'is blank', { noValue: true }),
  OP('is_not_null', 'is not blank', { noValue: true }),
]

const OPS_LOOKUP = [
  OP('equals', 'equals', { multi: true }),
  OP('not_equals', 'not equal to', { multi: true }),
  OP('is_null', 'is blank', { noValue: true }),
  OP('is_not_null', 'is not blank', { noValue: true }),
]

const OPS_NUMBER = [
  OP('equals', 'equals'),
  OP('not_equals', 'not equal to'),
  OP('greater_than', 'greater than'),
  OP('greater_or_equal', 'greater or equal'),
  OP('less_than', 'less than'),
  OP('less_or_equal', 'less or equal'),
  OP('between', 'between', { range: true }),
  OP('is_null', 'is blank', { noValue: true }),
  OP('is_not_null', 'is not blank', { noValue: true }),
]

const OPS_DATE = [
  OP('equals', 'equals'),
  OP('not_equals', 'not equal to'),
  OP('greater_than', 'after'),
  OP('greater_or_equal', 'on or after'),
  OP('less_than', 'before'),
  OP('less_or_equal', 'on or before'),
  OP('between', 'between', { range: true }),
  OP('is_null', 'is blank', { noValue: true }),
  OP('is_not_null', 'is not blank', { noValue: true }),
]

const OPS_BOOLEAN = [
  OP('equals', 'equals'),
  OP('not_equals', 'not equal to'),
]

const OPS_ID = [
  OP('equals', 'equals', { multi: true }),
  OP('not_equals', 'not equal to', { multi: true }),
  OP('is_null', 'is blank', { noValue: true }),
  OP('is_not_null', 'is not blank', { noValue: true }),
]

const OPERATORS_BY_KIND = {
  text:     OPS_TEXT,
  picklist: OPS_PICKLIST,
  lookup:   OPS_LOOKUP,
  number:   OPS_NUMBER,
  date:     OPS_DATE,
  datetime: OPS_DATE,
  boolean:  OPS_BOOLEAN,
  id:       OPS_ID,
}

// Legacy operators that predate the kind-scoped lists. They stay evaluable
// (saved reports keep running) and are surfaced in the operator dropdown only
// when a filter is already using one, so nothing silently changes meaning.
const LEGACY_OPS = {
  in:              OP('in', 'is any of (legacy)', { multi: true }),
  not_in:          OP('not_in', 'is none of (legacy)', { multi: true }),
  in_last_n_days:  OP('in_last_n_days', 'in last N days (legacy)'),
  this_month:      OP('this_month', 'this month (legacy)', { noValue: true }),
  this_year:       OP('this_year', 'this year (legacy)', { noValue: true }),
}

export function operatorsForKind(kind, currentOperator = null) {
  const list = OPERATORS_BY_KIND[kind] || OPS_TEXT
  if (currentOperator && !list.some(o => o.op === currentOperator)) {
    const legacy = LEGACY_OPS[currentOperator]
    if (legacy) return [...list, legacy]
    return [...list, OP(currentOperator, currentOperator)]
  }
  return list
}

export function defaultOperatorForKind(kind) {
  return (OPERATORS_BY_KIND[kind] || OPS_TEXT)[0].op
}

export function operatorMeta(kind, operator) {
  const list = operatorsForKind(kind, operator)
  return list.find(o => o.op === operator) || LEGACY_OPS[operator] || OP(operator, operator)
}

export function operatorNeedsValue(kind, operator) {
  return !operatorMeta(kind, operator).noValue
}

export function operatorIsRange(kind, operator) {
  return !!operatorMeta(kind, operator).range
}

export function operatorIsMulti(kind, operator) {
  return !!operatorMeta(kind, operator).multi
}

// ─── Relative date literals ───────────────────────────────────────────────
//
// Stored verbatim as the filter value, e.g. "TODAY" or "LAST_N_DAYS:90".
// Resolved to a concrete [start, end) instant range at run time, so a saved
// report means "the last 90 days" forever rather than a frozen date.

export const DATE_LITERALS = [
  { token: 'TODAY',           label: 'Today' },
  { token: 'YESTERDAY',       label: 'Yesterday' },
  { token: 'TOMORROW',        label: 'Tomorrow' },
  { token: 'THIS_WEEK',       label: 'This Week' },
  { token: 'LAST_WEEK',       label: 'Last Week' },
  { token: 'NEXT_WEEK',       label: 'Next Week' },
  { token: 'THIS_MONTH',      label: 'This Month' },
  { token: 'LAST_MONTH',      label: 'Last Month' },
  { token: 'NEXT_MONTH',      label: 'Next Month' },
  { token: 'THIS_QUARTER',    label: 'This Quarter' },
  { token: 'LAST_QUARTER',    label: 'Last Quarter' },
  { token: 'NEXT_QUARTER',    label: 'Next Quarter' },
  { token: 'THIS_YEAR',       label: 'This Year' },
  { token: 'LAST_YEAR',       label: 'Last Year' },
  { token: 'NEXT_YEAR',       label: 'Next Year' },
  { token: 'LAST_N_DAYS',     label: 'Last N Days',   needsN: true },
  { token: 'NEXT_N_DAYS',     label: 'Next N Days',   needsN: true },
  { token: 'LAST_N_WEEKS',    label: 'Last N Weeks',  needsN: true },
  { token: 'NEXT_N_WEEKS',    label: 'Next N Weeks',  needsN: true },
  { token: 'LAST_N_MONTHS',   label: 'Last N Months', needsN: true },
  { token: 'NEXT_N_MONTHS',   label: 'Next N Months', needsN: true },
  { token: 'LAST_N_YEARS',    label: 'Last N Years',  needsN: true },
  { token: 'NEXT_N_YEARS',    label: 'Next N Years',  needsN: true },
]

const DATE_LITERAL_TOKENS = new Set(DATE_LITERALS.map(d => d.token))

/** True when `value` is a relative date literal such as 'LAST_N_DAYS:90'. */
export function isDateLiteral(value) {
  if (typeof value !== 'string') return false
  const [token] = value.split(':')
  return DATE_LITERAL_TOKENS.has(token)
}

export function parseDateLiteral(value) {
  if (!isDateLiteral(value)) return null
  const [token, nRaw] = String(value).split(':')
  const n = parseInt(nRaw, 10)
  return { token, n: Number.isFinite(n) ? n : null }
}

export function dateLiteralLabel(value) {
  const parsed = parseDateLiteral(value)
  if (!parsed) return null
  const def = DATE_LITERALS.find(d => d.token === parsed.token)
  if (!def) return parsed.token
  return def.needsN ? def.label.replace(' N ', ` ${parsed.n ?? 'N'} `) : def.label
}

const DAY = 86400000
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays    = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const startOfWeek = (d) => addDays(startOfDay(d), -startOfDay(d).getDay())   // Sunday start
const startOfMonth = (d, offset = 0) => new Date(d.getFullYear(), d.getMonth() + offset, 1)
const startOfQuarter = (d, offset = 0) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + offset * 3, 1)
const startOfYear = (d, offset = 0) => new Date(d.getFullYear() + offset, 0, 1)

/**
 * Resolve a date literal to a half-open [start, end) range of local instants,
 * returned as ISO strings. Returns null when the value isn't a literal.
 */
export function resolveDateLiteral(value, now = new Date()) {
  const parsed = parseDateLiteral(value)
  if (!parsed) return null
  const { token, n } = parsed
  const count = Number.isFinite(n) && n > 0 ? n : 1
  const today = startOfDay(now)
  let start, end

  switch (token) {
    case 'TODAY':        start = today;                end = addDays(today, 1); break
    case 'YESTERDAY':    start = addDays(today, -1);   end = today; break
    case 'TOMORROW':     start = addDays(today, 1);    end = addDays(today, 2); break
    case 'THIS_WEEK':    start = startOfWeek(now);     end = addDays(startOfWeek(now), 7); break
    case 'LAST_WEEK':    start = addDays(startOfWeek(now), -7); end = startOfWeek(now); break
    case 'NEXT_WEEK':    start = addDays(startOfWeek(now), 7);  end = addDays(startOfWeek(now), 14); break
    case 'THIS_MONTH':   start = startOfMonth(now);    end = startOfMonth(now, 1); break
    case 'LAST_MONTH':   start = startOfMonth(now, -1); end = startOfMonth(now); break
    case 'NEXT_MONTH':   start = startOfMonth(now, 1); end = startOfMonth(now, 2); break
    case 'THIS_QUARTER': start = startOfQuarter(now);  end = startOfQuarter(now, 1); break
    case 'LAST_QUARTER': start = startOfQuarter(now, -1); end = startOfQuarter(now); break
    case 'NEXT_QUARTER': start = startOfQuarter(now, 1);  end = startOfQuarter(now, 2); break
    case 'THIS_YEAR':    start = startOfYear(now);     end = startOfYear(now, 1); break
    case 'LAST_YEAR':    start = startOfYear(now, -1); end = startOfYear(now); break
    case 'NEXT_YEAR':    start = startOfYear(now, 1);  end = startOfYear(now, 2); break
    // Salesforce semantics: LAST_N_* includes today and reaches back N units;
    // NEXT_N_* starts tomorrow and reaches forward N units.
    case 'LAST_N_DAYS':   start = addDays(today, -(count - 1)); end = addDays(today, 1); break
    case 'NEXT_N_DAYS':   start = addDays(today, 1);            end = addDays(today, count + 1); break
    case 'LAST_N_WEEKS':  start = addDays(startOfWeek(now), -7 * count); end = addDays(today, 1); break
    case 'NEXT_N_WEEKS':  start = addDays(today, 1);            end = addDays(startOfWeek(now), 7 * (count + 1)); break
    case 'LAST_N_MONTHS': start = startOfMonth(now, -count);    end = addDays(today, 1); break
    case 'NEXT_N_MONTHS': start = addDays(today, 1);            end = startOfMonth(now, count + 1); break
    case 'LAST_N_YEARS':  start = startOfYear(now, -count);     end = addDays(today, 1); break
    case 'NEXT_N_YEARS':  start = addDays(today, 1);            end = startOfYear(now, count + 1); break
    default: return null
  }
  return { start: start.toISOString(), end: end.toISOString() }
}

/**
 * Normalise one side of a comparison into an instant range. Fixed dates
 * ('2026-07-01') resolve to that whole calendar day so "equals 7/1" matches a
 * timestamp at 3pm; literals resolve to their relative range.
 */
export function resolveDateBound(value, now = new Date()) {
  if (value == null || value === '') return null
  const literal = resolveDateLiteral(value, now)
  if (literal) return literal
  const raw = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number)
    const start = new Date(y, m - 1, d)
    return { start: start.toISOString(), end: new Date(start.getTime() + DAY).toISOString() }
  }
  const parsed = new Date(raw)
  if (isNaN(parsed.getTime())) return null
  return { start: parsed.toISOString(), end: parsed.toISOString() }
}

// ─── Value normalisation ──────────────────────────────────────────────────

/** Multi-value operators store arrays; tolerate legacy comma-separated text. */
export function toValueArray(value) {
  if (value == null || value === '') return []
  if (Array.isArray(value)) return value.filter(v => v != null && v !== '')
  return String(value).split(',').map(s => s.trim()).filter(Boolean)
}

/** True when the filter is incomplete and should be skipped at run time. */
export function filterIsIncomplete(kind, operator, value) {
  if (!operatorNeedsValue(kind, operator)) return false
  if (operatorIsRange(kind, operator)) {
    const arr = Array.isArray(value) ? value : []
    return !(arr[0] != null && arr[0] !== '' && arr[1] != null && arr[1] !== '')
  }
  if (operatorIsMulti(kind, operator)) return toValueArray(value).length === 0
  return value == null || value === ''
}

// ─── Row-level evaluation ─────────────────────────────────────────────────

const asNumber = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

const asInstant = (v) => {
  if (v == null || v === '') return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.getTime()
}

const isDateish = (kind, target) =>
  kind === 'date' || kind === 'datetime' || isDateLiteral(target) ||
  (typeof target === 'string' && /^\d{4}-\d{2}-\d{2}/.test(target))

/**
 * Evaluate one operator against one raw cell value. `kind` steers date and
 * numeric comparison; it may be omitted (falls back to inference).
 */
export function evaluateOperator(rawValue, operator, target, kind = 'text', now = new Date()) {
  const v = rawValue
  const blank = v == null || v === ''

  switch (operator) {
    case 'is_null':     return blank
    case 'is_not_null': return !blank
    case 'this_month':
    case 'this_year': {
      // Legacy valueless date operators.
      const range = resolveDateLiteral(operator === 'this_month' ? 'THIS_MONTH' : 'THIS_YEAR', now)
      const t = asInstant(v)
      return t != null && t >= Date.parse(range.start) && t < Date.parse(range.end)
    }
    case 'in_last_n_days': {
      const range = resolveDateLiteral(`LAST_N_DAYS:${parseInt(target, 10) || 0}`, now)
      const t = asInstant(v)
      return !!range && t != null && t >= Date.parse(range.start) && t < Date.parse(range.end)
    }
    default: break
  }

  if (operator === 'between') {
    const arr = Array.isArray(target) ? target : []
    if (isDateish(kind, arr[0]) || isDateish(kind, arr[1])) {
      const lo = resolveDateBound(arr[0], now)
      const hi = resolveDateBound(arr[1], now)
      const t = asInstant(v)
      if (t == null) return false
      if (lo && t < Date.parse(lo.start)) return false
      if (hi && t >= Date.parse(hi.end)) return false
      return true
    }
    const n = asNumber(v)
    const lo = asNumber(arr[0]), hi = asNumber(arr[1])
    if (n == null) return false
    if (lo != null && n < lo) return false
    if (hi != null && n > hi) return false
    return true
  }

  if (operator === 'equals' || operator === 'not_equals' || operator === 'in' || operator === 'not_in') {
    const negate = operator === 'not_equals' || operator === 'not_in'
    const values = (operator === 'in' || operator === 'not_in' || Array.isArray(target))
      ? toValueArray(target)
      : [target]
    let hit = false
    for (const candidate of values) {
      if (isDateish(kind, candidate)) {
        const range = resolveDateBound(candidate, now)
        const t = asInstant(v)
        if (range && t != null && t >= Date.parse(range.start) && t < Date.parse(range.end)) { hit = true; break }
        continue
      }
      if (kind === 'boolean') {
        const want = candidate === true || candidate === 'true'
        if (!!v === want) { hit = true; break }
        continue
      }
      const n = asNumber(candidate)
      if (kind === 'number' && n != null) {
        if (asNumber(v) === n) { hit = true; break }
        continue
      }
      if (v != null && String(v) === String(candidate)) { hit = true; break }
    }
    return negate ? !hit : hit
  }

  const cmpOps = { greater_than: '>', greater_or_equal: '>=', less_than: '<', less_or_equal: '<=' }
  if (cmpOps[operator]) {
    if (isDateish(kind, target)) {
      const range = resolveDateBound(target, now)
      const t = asInstant(v)
      if (!range || t == null) return false
      switch (operator) {
        case 'greater_than':     return t >= Date.parse(range.end)
        case 'greater_or_equal': return t >= Date.parse(range.start)
        case 'less_than':        return t < Date.parse(range.start)
        case 'less_or_equal':    return t < Date.parse(range.end)
        default: return false
      }
    }
    const a = asNumber(v), b = asNumber(target)
    if (a != null && b != null) {
      switch (operator) {
        case 'greater_than':     return a > b
        case 'greater_or_equal': return a >= b
        case 'less_than':        return a < b
        case 'less_or_equal':    return a <= b
        default: return false
      }
    }
    const sa = v == null ? '' : String(v), sb = target == null ? '' : String(target)
    switch (operator) {
      case 'greater_than':     return sa > sb
      case 'greater_or_equal': return sa >= sb
      case 'less_than':        return sa < sb
      case 'less_or_equal':    return sa <= sb
      default: return false
    }
  }

  const hay = blank ? '' : String(v).toLowerCase()
  const needle = String(target ?? '').toLowerCase()
  switch (operator) {
    case 'contains':         return hay.includes(needle)
    case 'does_not_contain': return !hay.includes(needle)
    case 'starts_with':      return hay.startsWith(needle)
    case 'ends_with':        return hay.endsWith(needle)
    default: return true
  }
}

// ─── Filter logic expressions ─────────────────────────────────────────────

/**
 * Parse a Salesforce-style filter-logic expression ("1 AND (2 OR 3)") against
 * the current filter count. Returns
 *   { ok, error, rpn, referenced }
 * where `rpn` is the shunting-yard output ready for evaluateLogic(), and
 * `error` carries a message written the way Salesforce writes them.
 *
 * 'all' (or an empty expression) means "AND every filter" and is always valid.
 */
export function parseFilterLogic(expression, filterCount) {
  const expr = String(expression ?? '').trim()
  if (!expr || expr.toLowerCase() === 'all') {
    return { ok: true, error: null, rpn: null, referenced: new Set(), isAll: true }
  }
  if (filterCount === 0) {
    return { ok: false, error: 'Add at least one filter before writing filter logic.', rpn: null, referenced: new Set() }
  }

  // Tokenise
  const tokens = []
  let i = 0
  while (i < expr.length) {
    const c = expr[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9]/.test(c)) {
      let j = i
      while (j < expr.length && /[0-9]/.test(expr[j])) j++
      tokens.push({ type: 'num', value: parseInt(expr.slice(i, j), 10) })
      i = j; continue
    }
    if (c === '(') { tokens.push({ type: '(' }); i++; continue }
    if (c === ')') { tokens.push({ type: ')' }); i++; continue }
    if (/[a-zA-Z]/.test(c)) {
      let j = i
      while (j < expr.length && /[a-zA-Z]/.test(expr[j])) j++
      const word = expr.slice(i, j).toUpperCase()
      if (word === 'AND' || word === 'OR' || word === 'NOT') tokens.push({ type: word })
      else return { ok: false, error: `"${expr.slice(i, j)}" isn't valid in filter logic. Use filter numbers with AND, OR, NOT, and parentheses.`, rpn: null, referenced: new Set() }
      i = j; continue
    }
    return { ok: false, error: `"${c}" isn't valid in filter logic. Use filter numbers with AND, OR, NOT, and parentheses.`, rpn: null, referenced: new Set() }
  }

  if (tokens.length === 0) {
    return { ok: false, error: 'Enter filter logic, or switch back to matching all filters.', rpn: null, referenced: new Set() }
  }

  // Reference + structural validation
  const referenced = new Set()
  let depth = 0
  let expectOperand = true
  for (const t of tokens) {
    if (t.type === 'num') {
      if (!expectOperand) return { ok: false, error: `Add AND or OR before filter ${t.value}.`, rpn: null, referenced }
      if (t.value < 1 || t.value > filterCount) {
        return { ok: false, error: `Filter logic references filter ${t.value}, which doesn't exist. Filters are numbered 1–${filterCount}.`, rpn: null, referenced }
      }
      referenced.add(t.value)
      expectOperand = false
    } else if (t.type === '(') {
      if (!expectOperand) return { ok: false, error: 'Add AND or OR before the opening parenthesis.', rpn: null, referenced }
      depth++
    } else if (t.type === ')') {
      if (expectOperand) return { ok: false, error: 'A parenthesis closes without a filter inside it.', rpn: null, referenced }
      depth--
      if (depth < 0) return { ok: false, error: 'Filter logic has an unmatched closing parenthesis.', rpn: null, referenced }
    } else if (t.type === 'NOT') {
      if (!expectOperand) return { ok: false, error: 'Add AND or OR before NOT.', rpn: null, referenced }
    } else { // AND / OR
      if (expectOperand) return { ok: false, error: `Filter logic can't ${tokens[0] === t ? 'start' : 'have two operators in a row'} — use a filter number on each side of ${t.type}.`, rpn: null, referenced }
      expectOperand = true
    }
  }
  if (depth !== 0) return { ok: false, error: 'Filter logic has an unmatched opening parenthesis.', rpn: null, referenced }
  if (expectOperand) return { ok: false, error: 'Filter logic ends with an operator. Finish it with a filter number.', rpn: null, referenced }

  const missing = []
  for (let n = 1; n <= filterCount; n++) if (!referenced.has(n)) missing.push(n)
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Filter logic must reference every filter. Add ${missing.length === 1 ? 'filter' : 'filters'} ${missing.join(', ')}.`,
      rpn: null,
      referenced,
    }
  }

  // Shunting-yard → RPN
  const prec = { NOT: 3, AND: 2, OR: 1 }
  const rightAssoc = { NOT: true }
  const output = []
  const stack = []
  for (const t of tokens) {
    if (t.type === 'num') output.push(t)
    else if (t.type === '(') stack.push(t)
    else if (t.type === ')') {
      while (stack.length && stack[stack.length - 1].type !== '(') output.push(stack.pop())
      stack.pop()
    } else {
      while (stack.length) {
        const top = stack[stack.length - 1]
        if (top.type === '(') break
        const higher = (prec[top.type] || 0) > (prec[t.type] || 0)
        const equalLeft = (prec[top.type] || 0) === (prec[t.type] || 0) && !rightAssoc[t.type]
        if (higher || equalLeft) output.push(stack.pop())
        else break
      }
      stack.push(t)
    }
  }
  while (stack.length) output.push(stack.pop())

  return { ok: true, error: null, rpn: output, referenced, isAll: false }
}

/** Evaluate a parsed expression. `boolAt(filterIndex)` returns that filter's result. */
export function evaluateLogic(rpn, boolAt) {
  const stack = []
  for (const t of rpn) {
    if (t.type === 'num') stack.push(!!boolAt(t.value))
    else if (t.type === 'NOT') stack.push(!stack.pop())
    else if (t.type === 'AND') { const b = stack.pop(), a = stack.pop(); stack.push(a && b) }
    else if (t.type === 'OR')  { const b = stack.pop(), a = stack.pop(); stack.push(a || b) }
  }
  return !!stack.pop()
}

/** "1 AND 2 AND 3" for a filter count — what the Add Filter Logic link seeds. */
export function defaultFilterLogic(count) {
  if (!count || count < 1) return 'all'
  return Array.from({ length: count }, (_, i) => i + 1).join(' AND ')
}

/**
 * True when the expression is semantically "AND every filter" — either the
 * literal 'all', or an expression that is nothing but ANDed filter numbers.
 * The runner uses this to decide whether it can push filters to PostgREST.
 */
export function logicIsPlainAnd(expression, filterCount) {
  const expr = String(expression ?? '').trim()
  if (!expr || expr.toLowerCase() === 'all') return true
  const parsed = parseFilterLogic(expr, filterCount)
  if (!parsed.ok || !parsed.rpn) return false
  if (/[()]|\bOR\b|\bNOT\b/i.test(expr)) return false
  return parsed.referenced.size === filterCount
}

/**
 * Rewrite an expression after filters are removed or reordered.
 * `mapping` maps old 1-based index → new 1-based index, or null when the
 * filter was removed. A removed filter's reference is dropped along with the
 * operator that joined it, so "1 AND (2 OR 3)" with 2 removed becomes
 * "1 AND (2)" → normalised to "1 AND 2". Falls back to the default AND chain
 * when the rewrite can't produce something valid.
 */
export function remapFilterLogic(expression, mapping, newCount) {
  const expr = String(expression ?? '').trim()
  if (!expr || expr.toLowerCase() === 'all') return 'all'
  if (newCount === 0) return 'all'

  // Tokenise loosely — this runs on expressions already validated at save time,
  // but must not throw on a half-typed one.
  const raw = expr.match(/\d+|\(|\)|AND|OR|NOT/gi) || []
  const mapped = []
  for (const tok of raw) {
    if (/^\d+$/.test(tok)) {
      const next = mapping[parseInt(tok, 10)]
      mapped.push(next == null ? { type: 'dead' } : { type: 'num', text: String(next) })
    } else {
      mapped.push({ type: tok.toUpperCase(), text: tok.toUpperCase() })
    }
  }

  // Drop dead references together with an adjacent binary operator.
  const cleaned = []
  for (let i = 0; i < mapped.length; i++) {
    const t = mapped[i]
    if (t.type !== 'dead') { cleaned.push(t); continue }
    const prev = cleaned[cleaned.length - 1]
    if (prev && (prev.type === 'AND' || prev.type === 'OR')) { cleaned.pop(); continue }
    // No preceding operator — swallow a following one instead.
    if (mapped[i + 1] && (mapped[i + 1].type === 'AND' || mapped[i + 1].type === 'OR')) i++
  }

  // Collapse empty and redundant parentheses left behind.
  let text = cleaned.map(t => t.text).join(' ')
  for (let pass = 0; pass < 5; pass++) {
    const before = text
    text = text.replace(/\(\s*\)/g, '').replace(/\(\s*(\d+)\s*\)/g, '$1')
      .replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim()
    if (text === before) break
  }

  const check = parseFilterLogic(text, newCount)
  return check.ok && !check.isAll ? text : defaultFilterLogic(newCount)
}
