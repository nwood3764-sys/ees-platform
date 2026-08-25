// ---------------------------------------------------------------------------
// listFilterLogic — filter LOGIC for list views.
//
// A list view used to mean one thing and one thing only: every filter must
// match. That answers "properties in WI managed by Lutheran" and cannot answer
// "properties OWNED by Lutheran or MANAGED by Lutheran" (Nicholas, 2026-08-25:
// "I need to have properties owned by Lutheran and properties managed by
// Lutheran" — two sets, not their intersection). Two filters ANDed return the
// handful of records where the same company happens to be both, which is not
// what either half of the question asked for.
//
// The expression grammar, its validation and its evaluator are NOT rebuilt
// here: they are the platform's shared filter kernel in reportFilters.js
// ("1 AND (2 OR 3)"), built for the report builder's Filters tab and used
// verbatim so a list view and a report mean the same thing by the same words.
// What lives here is the part list views need and reports don't: turning the
// list's FLAT filter array into the NUMBERED filters the logic refers to.
//
// Why numbering needs its own rule: the flat array is not 1:1 with what the
// user sees. The column-header multi-select emits one `{op:'equals'}` row per
// chosen value, so picking three states writes three rows for one filter. The
// sidebar has always collapsed those back into a single editable row; filter
// logic has to number them the same way, or "2" in the expression points at
// something the user never counted.
//
// Pure module: no React, no DOM. Fixture-tested by
// scripts/list-filter-logic-fixture.mjs.
// ---------------------------------------------------------------------------

import {
  parseFilterLogic, evaluateLogic, defaultFilterLogic, logicIsPlainAnd,
  remapFilterLogic,
} from './reportFilters.js'

export { parseFilterLogic, defaultFilterLogic, logicIsPlainAnd, remapFilterLogic }

// The expression that means "match every filter" — the default, and what a
// view saved before filter logic existed carries (i.e. nothing).
export const MATCH_ALL = 'all'

export function isMatchAll(logic) {
  const e = String(logic ?? '').trim()
  return e === '' || e.toLowerCase() === MATCH_ALL
}

/**
 * The list's flat filter array as NUMBERED filters — one entry per filter the
 * user authored, in authoring order. Consecutive-or-not scalar `equals` rows on
 * the same field collapse into a single multi-value entry (the header
 * multi-select's shape), which is exactly how the filter sidebar hydrates them.
 *
 * Each entry: { field, label, op, value, rows }
 *   value — for a collapsed equals entry, the array of chosen values (OR'd by
 *           the row matcher); otherwise the row's own value, untouched.
 *   rows  — the original flat rows this entry stands for, so a caller can map
 *           an entry back to what it must remove.
 */
export function numberFilters(activeFilters) {
  const entries = []
  const equalsEntryByField = new Map()
  for (const f of (activeFilters || [])) {
    if (!f || typeof f !== 'object' || !f.field) continue
    const isScalarEquals = f.op === 'equals' && !Array.isArray(f.value)
    if (isScalarEquals) {
      const existing = equalsEntryByField.get(f.field)
      if (existing) {
        existing.value.push(f.value)
        existing.rows.push(f)
        continue
      }
      const entry = { field: f.field, label: f.label || f.field, op: 'equals', value: [f.value], rows: [f] }
      equalsEntryByField.set(f.field, entry)
      entries.push(entry)
      continue
    }
    entries.push({ field: f.field, label: f.label || f.field, op: f.op, value: f.value, rows: [f] })
  }
  return entries
}

/**
 * Does one record satisfy the numbered filters under this logic?
 *
 * `matchAt(entry, index)` evaluates ONE numbered filter against the record and
 * returns a boolean — the caller owns value comparison (types, blanks, dates),
 * this owns only how the answers combine. Evaluation is lazy per entry and
 * memoized, so `1 OR 2` never evaluates 2 when 1 already matched... via the
 * cache, not short-circuit: correctness first, and a cached miss is cheap.
 *
 * An expression that doesn't parse is treated as match-all rather than
 * matching nothing: a list that silently empties itself is the failure this
 * whole change exists to end. Callers validate before saving, so an unparseable
 * expression here means a hand-edited or legacy value.
 */
export function recordMatchesFilters(entries, logic, matchAt) {
  const list = entries || []
  if (list.length === 0) return true
  if (isMatchAll(logic)) {
    for (let i = 0; i < list.length; i++) if (!matchAt(list[i], i)) return false
    return true
  }
  const parsed = parseFilterLogic(logic, list.length)
  if (!parsed.ok || !parsed.rpn) {
    for (let i = 0; i < list.length; i++) if (!matchAt(list[i], i)) return false
    return true
  }
  const cache = new Map()
  return evaluateLogic(parsed.rpn, (n) => {
    if (cache.has(n)) return cache.get(n)
    const entry = list[n - 1]
    const result = entry ? !!matchAt(entry, n - 1) : false
    cache.set(n, result)
    return result
  })
}

/**
 * Compile once per filter set instead of re-parsing per row. Returns a
 * predicate factory: `compileFilterLogic(entries, logic)(matchAt)` answers for
 * one record. A list of 20,000 properties parses the expression once, not
 * 20,000 times.
 */
export function compileFilterLogic(entries, logic) {
  const list = entries || []
  const parsed = (list.length === 0 || isMatchAll(logic))
    ? null
    : parseFilterLogic(logic, list.length)
  const rpn = parsed && parsed.ok ? parsed.rpn : null
  return (matchAt) => {
    if (list.length === 0) return true
    if (!rpn) {
      for (let i = 0; i < list.length; i++) if (!matchAt(list[i], i)) return false
      return true
    }
    const cache = new Map()
    return evaluateLogic(rpn, (n) => {
      if (cache.has(n)) return cache.get(n)
      const entry = list[n - 1]
      const result = entry ? !!matchAt(entry, n - 1) : false
      cache.set(n, result)
      return result
    })
  }
}

/**
 * The logic expression after the numbered filter at `removedIndex` (0-based) is
 * deleted, renumbering the rest. Returns MATCH_ALL when nothing meaningful is
 * left to say, so removing a filter can never strand the view on an expression
 * that references a filter that no longer exists — the way a list silently
 * empties itself.
 */
/**
 * Drop a paren pair that wraps the WHOLE expression and therefore says nothing:
 * remapping "(1 OR 2) AND 3" after 3 is removed leaves "(1 OR 2)", and showing
 * a user parentheses they did not write reads as the app having rewritten their
 * logic. Only strips when the opening paren genuinely closes at the very end.
 */
function stripRedundantOuterParens(expr) {
  let out = String(expr ?? '').trim()
  for (let pass = 0; pass < 5; pass++) {
    if (!out.startsWith('(') || !out.endsWith(')')) return out
    let depth = 0
    let closesAtEnd = true
    for (let i = 0; i < out.length; i++) {
      if (out[i] === '(') depth++
      else if (out[i] === ')') {
        depth--
        if (depth === 0 && i < out.length - 1) { closesAtEnd = false; break }
      }
    }
    if (!closesAtEnd) return out
    out = out.slice(1, -1).trim()
  }
  return out
}

export function logicAfterRemoval(logic, entryCount, removedIndex) {
  if (isMatchAll(logic)) return MATCH_ALL
  // remapFilterLogic indexes its mapping with [oldNumber], so it must be a
  // plain object — a Map reads as "every filter was removed" and the whole
  // expression collapses.
  const mapping = {}
  let next = 1
  for (let i = 0; i < entryCount; i++) {
    if (i === removedIndex) { mapping[i + 1] = null; continue }
    mapping[i + 1] = next++
  }
  const remaining = entryCount - 1
  if (remaining < 1) return MATCH_ALL
  const rewritten = stripRedundantOuterParens(remapFilterLogic(logic, mapping, remaining))
  if (!rewritten) return MATCH_ALL
  // A rewrite that comes back as a plain AND chain says the same thing as
  // match-all — return the plain form so the sidebar drops back to its simple
  // mode instead of showing the user an expression they never wrote.
  if (logicIsPlainAnd(rewritten, remaining)) return MATCH_ALL
  const parsed = parseFilterLogic(rewritten, remaining)
  return parsed.ok ? rewritten : MATCH_ALL
}

/**
 * Validate an expression for a filter count, for the sidebar's inline message.
 * Returns { ok, error }.
 */
export function validateFilterLogic(logic, entryCount) {
  if (isMatchAll(logic)) return { ok: true, error: null }
  const parsed = parseFilterLogic(logic, entryCount)
  return { ok: parsed.ok, error: parsed.error }
}
