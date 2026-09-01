// ---------------------------------------------------------------------------
// currencyFormat — a money column reads as money, wherever it is drawn.
//
// Nicholas, 2026-08-31, on the Incentive Applications list: "Why aren't my
// fields coming in like currency?" — the Requested Incentive column showed
// `110000`, not `$110,000`.
//
// The cause is the same one the phone/email/url fix hit on 2026-08-22: a money
// column is `numeric` in Postgres, so every surface inherited "number" and drew
// the raw digits. A column's LOGICAL type lives in field_metadata
// (fm_display_type), which already rides along on describe_object_columns —
// nothing was reading it for currency.
//
// Never a name heuristic. `project_incentive_processing_time` is a number of
// days and `opportunity_h_s_to_ee_cost_ratio` is a ratio; both would match any
// pattern over "incentive" or "cost" and both would then print as dollars.
//
// Pure module. Fixture-tested by scripts/currency-format-fixture.mjs.
// ---------------------------------------------------------------------------

/** Is this column declared as money? Reads the DECLARATION, never the name. */
export function isCurrencyColumn(col) {
  const dt = col?.display_type ?? col?.displayType ?? col?.valueType ?? col?.type
  return dt === 'currency'
}

/**
 * Money, as a person writes it.
 *
 * Whole dollars by default — LEAP's amounts are contract values and rebates, and
 * a column of `$110,000.00` is harder to scan than `$110,000` for no gain. Cents
 * are kept only when the value actually has them, so `$1,234.56` survives.
 *
 * Zero is a real answer and formats as $0; null/blank is not zero and stays an
 * em dash. A value that is not a number at all is passed through untouched
 * rather than rendered as "$NaN".
 */
export function formatCurrency(value, { blank = '—', currency = 'USD', locale = 'en-US' } = {}) {
  if (value == null || value === '') return blank
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n)) return String(value)
  const hasCents = Math.abs(n * 100 - Math.round(n * 100)) < 1e-9 && Math.round(n * 100) % 100 !== 0
  try {
    return n.toLocaleString(locale, {
      style: 'currency', currency,
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: hasCents ? 2 : 0,
    })
  } catch {
    // An unknown locale or currency must not take the cell down with it.
    return `$${n.toLocaleString('en-US', { maximumFractionDigits: hasCents ? 2 : 0 })}`
  }
}

/** Format a cell only if its column is money; otherwise hand back the value. */
export function formatIfCurrency(value, col, opts) {
  return isCurrencyColumn(col) ? formatCurrency(value, opts) : value
}
