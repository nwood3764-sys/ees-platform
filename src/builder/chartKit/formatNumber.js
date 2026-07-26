// =============================================================================
// src/builder/chartKit/formatNumber.js
//
// The single number-formatting vocabulary for dashboard widgets (Salesforce's
// "Show Value As" family). Widgets read `number_format` + `decimals` from
// dw_widget_config and route every rendered number — data labels, axis ticks,
// tooltips, metric values — through here so a widget is formatted consistently
// everywhere it shows the same quantity.
// =============================================================================

export function formatNumber(value, format = 'number', decimals) {
  const n = Number(value)
  if (!Number.isFinite(n)) return value == null ? '—' : String(value)
  const d = Number.isFinite(Number(decimals)) && decimals !== '' && decimals !== null
    ? Math.max(0, Math.min(4, Number(decimals)))
    : (Number.isInteger(n) ? 0 : 1)
  switch (format) {
    case 'currency':
      return n.toLocaleString('en-US', {
        style: 'currency', currency: 'USD',
        minimumFractionDigits: d, maximumFractionDigits: d,
      })
    case 'percent':
      // Value is already a percentage quantity (e.g. 42 → "42%"), matching
      // Salesforce's percent display of an aggregate.
      return `${n.toLocaleString('en-US', { maximumFractionDigits: d })}%`
    case 'compact':
      return n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
    default:
      return n.toLocaleString('en-US', { maximumFractionDigits: d })
  }
}

// Axis ticks always compact large magnitudes so they never collide; currency
// keeps its symbol ("$1.2M"), everything else falls back to compact ("1.2M").
export function formatAxisTick(value, format = 'number') {
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value ?? '')
  if (format === 'currency') {
    return n.toLocaleString('en-US', {
      style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
    })
  }
  if (format === 'percent') return `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
  return n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
}
