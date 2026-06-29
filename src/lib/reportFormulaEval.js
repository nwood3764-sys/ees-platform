// Calculated-field expression evaluator for reports.
//
// This is now a thin adapter over the LEAP formula engine (src/lib/formula/
// engine.js) — a sandboxed mathjs instance with the full @formulajs/formulajs
// Excel function library. The custom mini-parser that used to live here was
// replaced by that engine so reports get Salesforce/Excel-grade formulas, and
// so the visual editor validates against the exact evaluator the runtime uses.
//
// Public surface is unchanged for callers:
//   evaluateRowExpression(expr, row)         — row-scope formulas
//   evaluateSummaryExpression(expr, aggs)    — group/summary-scope formulas
//   computeAggregates(rows, columns)         — SUM_/COUNT_/AVG_/MIN_/MAX_ values
//   validateExpression(expr, knownFields?)   — syntax + unknown-symbol check
//   FORMULA_FUNCTIONS / ALL_FUNCTION_NAMES   — catalog for the editor

import { evaluateFormula, validateFormula, FORMULA_FUNCTIONS, ALL_FUNCTION_NAMES } from './formula/engine'

export { FORMULA_FUNCTIONS, ALL_FUNCTION_NAMES }
export const validateExpression = validateFormula

// Row-scope: the scope is the row's resolved column values.
export function evaluateRowExpression(expression, row) {
  return evaluateFormula(expression, row || {})
}

// Summary-scope: the scope is the group's pre-computed aggregates
// (SUM_<field>, COUNT_<field>, AVG_<field>, MIN_<field>, MAX_<field>), used as
// plain identifiers in the expression.
export function evaluateSummaryExpression(expression, aggregates) {
  return evaluateFormula(expression, aggregates || {})
}

function toNumber(v) {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Date) return v.getTime()
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Compute aggregates over a group of rows. Emits SUM_, COUNT_, AVG_, MIN_, MAX_
 * keyed by column name, for summary-scope formulas to reference.
 */
export function computeAggregates(rows, columnNames) {
  const out = {}
  for (const col of columnNames) {
    const values = rows.map(r => r[col]).filter(v => v != null && v !== '').map(toNumber)
    out[`COUNT_${col}`] = rows.filter(r => r[col] != null && r[col] !== '').length
    if (values.length === 0) {
      out[`SUM_${col}`] = 0
      out[`AVG_${col}`] = null
      out[`MIN_${col}`] = null
      out[`MAX_${col}`] = null
    } else {
      const sum = values.reduce((a, b) => a + b, 0)
      out[`SUM_${col}`] = sum
      out[`AVG_${col}`] = sum / values.length
      out[`MIN_${col}`] = Math.min(...values)
      out[`MAX_${col}`] = Math.max(...values)
    }
  }
  return out
}
