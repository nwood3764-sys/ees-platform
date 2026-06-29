// =============================================================================
// src/lib/formula/engine.js
//
// The LEAP formula engine — Salesforce/Excel-grade, built on mathjs (parser +
// math/logic core) with the full @formulajs/formulajs Excel function library
// registered on top. This is the single evaluator used by reports (row + summary
// scope) and the visual formula editor, so what validates in the editor is
// exactly what runs.
//
// Security: a sandboxed mathjs instance — `import`, `createUnit`, `evaluate`,
// `parse`, `simplify`, `derivative` are disabled inside expressions, so a
// formula can only call the whitelisted function library, never reach arbitrary
// JS. Expressions are compiled once and cached; evaluation is per-row/per-group.
//
// Null semantics (Excel parity): a referenced field that is null/blank is
// treated as 0 in the scope (blank cells behave as 0 in arithmetic); real text
// values are preserved. Any evaluation error yields null (a blank cell) rather
// than crashing the report.
// =============================================================================

import { create, all } from 'mathjs'
import * as formulajs from '@formulajs/formulajs'

// ─── Sandboxed mathjs instance ────────────────────────────────────────────────
const math = create(all, { matrix: 'Array', number: 'number' })

// Capture the real parser BEFORE we disable the in-expression `parse` below, so
// the engine can still parse programmatically while expressions cannot.
const parseExpr = math.parse

// Register every formulajs function (uppercase Excel names) FIRST — disabling
// `import` (next) would block this registration. Skip a couple whose names would
// shadow mathjs constants we want to keep numeric (PI, E).
const SKIP = new Set(['PI', 'E'])
const fjs = {}
for (const [name, fn] of Object.entries(formulajs)) {
  if (typeof fn === 'function' && !SKIP.has(name)) fjs[name] = fn
}
math.import(fjs, { override: true })

// Lock the sandbox. `import`/`createUnit` can mutate the instance (the real
// escape vectors); the rest are unnecessary inside a field formula. Disabling
// them on the instance also blocks their use INSIDE an expression — programmatic
// parsing uses the captured parseExpr reference above.
const DISABLED = ['import', 'createUnit', 'reviver', 'evaluate', 'parse', 'simplify', 'derivative', 'resolve']
const disabledImpls = {}
for (const name of DISABLED) {
  disabledImpls[name] = function disabled() { throw new Error(`"${name}" is disabled in formulas`) }
}
math.import(disabledImpls, { override: true })

// Every Excel function name we registered — for autocomplete + validation.
export const ALL_FUNCTION_NAMES = Object.keys(fjs).sort()

// ─── Compile + symbol caches ──────────────────────────────────────────────────
const codeCache = new Map()   // expr → compiled mathjs code
const symCache  = new Map()   // expr → Set<fieldSymbol>

function compiled(expr) {
  let c = codeCache.get(expr)
  if (c === undefined) {
    c = parseExpr(expr).compile()
    codeCache.set(expr, c)
  }
  return c
}

// Field symbols referenced by an expression: SymbolNodes that are NOT a
// registered function/constant (those live on the math instance). Cached.
function fieldSymbols(expr) {
  let s = symCache.get(expr)
  if (s === undefined) {
    s = new Set()
    try {
      parseExpr(expr).traverse(node => {
        if (node.isSymbolNode && !(node.name in math)) s.add(node.name)
      })
    } catch { /* parse error surfaced elsewhere */ }
    symCache.set(expr, s)
  }
  return s
}

// Convert a mathjs result back to a plain JS value for a report cell.
function unwrap(v) {
  if (v == null) return v
  const t = typeof v
  if (t === 'number' || t === 'string' || t === 'boolean') return v
  if (v instanceof Date) return v
  if (t === 'object') {
    if (typeof v.toNumber === 'function') { try { return v.toNumber() } catch { /* fall through */ } }
    if (Array.isArray(v)) return v
    if (typeof v.toString === 'function') return v.toString()
  }
  return v
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Evaluate an expression against a scope (a row's resolved values, or a group's
 * pre-computed aggregates). Blank fields → 0; errors → null.
 */
export function evaluateFormula(expression, scopeValues = {}) {
  if (!expression || !expression.trim()) return null
  try {
    const syms = fieldSymbols(expression)
    const scope = {}
    for (const k of syms) {
      const v = scopeValues[k]
      scope[k] = (v === null || v === undefined || v === '') ? 0 : v
    }
    return unwrap(compiled(expression).evaluate(scope))
  } catch {
    return null
  }
}

/**
 * Validate an expression. Always checks syntax; when `knownFields` is provided,
 * also flags symbols that are neither a known field nor a registered function/
 * constant (catches typos before save). Returns { ok } or { ok:false, error }.
 */
export function validateFormula(expression, knownFields = []) {
  if (!expression || !expression.trim()) return { ok: false, error: 'Empty formula' }
  let node
  try {
    node = parseExpr(expression)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  if (knownFields && knownFields.length) {
    const known = new Set(knownFields)
    const unknown = new Set()
    node.traverse(n => {
      if (n.isSymbolNode && !(n.name in math) && !known.has(n.name)) unknown.add(n.name)
    })
    if (unknown.size) return { ok: false, error: `Unknown field or function: ${[...unknown].join(', ')}` }
  }
  return { ok: true }
}

// ─── Function catalog (for the editor's insert picker + autocomplete) ──────────
// A curated, categorized subset with signatures + descriptions. The engine
// supports the full @formulajs library (ALL_FUNCTION_NAMES) — this is the
// discoverable shortlist.
export const FORMULA_FUNCTIONS = [
  { category: 'Logical', items: [
    { name: 'IF', template: 'IF(condition, value_if_true, value_if_false)', desc: 'Returns one value if true, another if false.' },
    { name: 'IFS', template: 'IFS(test1, value1, test2, value2)', desc: 'Checks multiple conditions, returns the first match.' },
    { name: 'AND', template: 'AND(logical1, logical2)', desc: 'TRUE if all arguments are true.' },
    { name: 'OR', template: 'OR(logical1, logical2)', desc: 'TRUE if any argument is true.' },
    { name: 'NOT', template: 'NOT(logical)', desc: 'Reverses a boolean.' },
    { name: 'SWITCH', template: 'SWITCH(expression, val1, result1, default)', desc: 'Matches an expression against values.' },
    { name: 'ISBLANK', template: 'ISBLANK(value)', desc: 'TRUE if the value is blank.' },
  ] },
  { category: 'Math', items: [
    { name: 'ABS', template: 'ABS(number)', desc: 'Absolute value.' },
    { name: 'ROUND', template: 'ROUND(number, digits)', desc: 'Rounds to the given decimals.' },
    { name: 'ROUNDUP', template: 'ROUNDUP(number, digits)', desc: 'Rounds away from zero.' },
    { name: 'ROUNDDOWN', template: 'ROUNDDOWN(number, digits)', desc: 'Rounds toward zero.' },
    { name: 'CEILING', template: 'CEILING(number, significance)', desc: 'Rounds up to a multiple.' },
    { name: 'FLOOR', template: 'FLOOR(number, significance)', desc: 'Rounds down to a multiple.' },
    { name: 'MOD', template: 'MOD(number, divisor)', desc: 'Remainder after division.' },
    { name: 'POWER', template: 'POWER(number, power)', desc: 'Raises a number to a power.' },
    { name: 'SQRT', template: 'SQRT(number)', desc: 'Square root.' },
    { name: 'SUM', template: 'SUM(a, b)', desc: 'Adds values.' },
    { name: 'PRODUCT', template: 'PRODUCT(a, b)', desc: 'Multiplies values.' },
    { name: 'MIN', template: 'MIN(a, b)', desc: 'Smallest value.' },
    { name: 'MAX', template: 'MAX(a, b)', desc: 'Largest value.' },
    { name: 'AVERAGE', template: 'AVERAGE(a, b)', desc: 'Mean of values.' },
    { name: 'ROUND', template: 'ROUND(number, digits)', desc: 'Rounds to the given decimals.' },
  ] },
  { category: 'Text', items: [
    { name: 'CONCATENATE', template: 'CONCATENATE(text1, text2)', desc: 'Joins text values.' },
    { name: 'TEXT', template: 'TEXT(value, format)', desc: 'Formats a value as text.' },
    { name: 'LEN', template: 'LEN(text)', desc: 'Number of characters.' },
    { name: 'LEFT', template: 'LEFT(text, count)', desc: 'Leftmost characters.' },
    { name: 'RIGHT', template: 'RIGHT(text, count)', desc: 'Rightmost characters.' },
    { name: 'MID', template: 'MID(text, start, count)', desc: 'Characters from the middle.' },
    { name: 'UPPER', template: 'UPPER(text)', desc: 'Uppercase.' },
    { name: 'LOWER', template: 'LOWER(text)', desc: 'Lowercase.' },
    { name: 'PROPER', template: 'PROPER(text)', desc: 'Title-cases text.' },
    { name: 'TRIM', template: 'TRIM(text)', desc: 'Removes extra spaces.' },
    { name: 'SUBSTITUTE', template: 'SUBSTITUTE(text, old, new)', desc: 'Replaces text.' },
    { name: 'FIND', template: 'FIND(find_text, within_text)', desc: 'Position of text (case-sensitive).' },
    { name: 'SEARCH', template: 'SEARCH(find_text, within_text)', desc: 'Position of text (case-insensitive).' },
  ] },
  { category: 'Date', items: [
    { name: 'TODAY', template: 'TODAY()', desc: "Today's date." },
    { name: 'NOW', template: 'NOW()', desc: 'Current date and time.' },
    { name: 'DATE', template: 'DATE(year, month, day)', desc: 'Builds a date.' },
    { name: 'YEAR', template: 'YEAR(date)', desc: 'Year component.' },
    { name: 'MONTH', template: 'MONTH(date)', desc: 'Month (1–12).' },
    { name: 'DAY', template: 'DAY(date)', desc: 'Day of month.' },
    { name: 'WEEKDAY', template: 'WEEKDAY(date)', desc: 'Day of week.' },
    { name: 'DATEDIF', template: 'DATEDIF(start, end, unit)', desc: 'Difference between dates.' },
    { name: 'EDATE', template: 'EDATE(date, months)', desc: 'Date n months away.' },
    { name: 'DAYS', template: 'DAYS(end, start)', desc: 'Days between two dates.' },
  ] },
  { category: 'Lookup & Info', items: [
    { name: 'IFERROR', template: 'IFERROR(value, value_if_error)', desc: 'Catches an error result.' },
    { name: 'ISNUMBER', template: 'ISNUMBER(value)', desc: 'TRUE if numeric.' },
    { name: 'ISTEXT', template: 'ISTEXT(value)', desc: 'TRUE if text.' },
    { name: 'N', template: 'N(value)', desc: 'Converts to a number.' },
  ] },
]
