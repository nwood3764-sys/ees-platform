// ---------------------------------------------------------------------------
// chartDataLabels — what a data label SAYS, and what colour it can be read in.
//
// Nicholas, 2026-08-31, on a live pie: "Why would you have white text? I can't
// even see that shit... I need to be able to turn on percentages, count, all of
// this stuff."
//
// Two separate faults, both here:
//
//   1. The label was a hardcoded white. LEAP's series fills are light — emerald
//      #3ecf8e, sky #7eb3e8 — and white on them is about 1.9:1, well under the
//      4.5:1 a small label needs. The ink has to be CHOSEN from the fill it
//      sits on, not fixed. (The chart palette failing its contrast check is the
//      root of this; until those hues are re-stepped, dark ink on a light fill
//      is the readable side of the trade.)
//
//   2. There was one boolean — labels on or off — and it always showed a
//      percentage on a pie. What a label should say is a real choice: the
//      value, the share, both, or nothing.
//
// Pure module: no React, no chart library. Fixture-tested by
// scripts/chart-data-labels-fixture.mjs.
// ---------------------------------------------------------------------------

// What a data label carries. `auto` is what an existing widget means by
// `show_data_labels: true` — the shape each chart type showed before this
// existed — so nothing that is already saved changes appearance.
export const DATA_LABEL_MODES = ['none', 'value', 'percent', 'value_percent', 'auto']

/**
 * The saved config, read as one mode. Handles the older boolean, which is what
 * every widget on the platform carries today.
 */
export function dataLabelMode(cfg, fallback = 'auto') {
  const explicit = cfg?.data_label_mode
  if (explicit && DATA_LABEL_MODES.includes(explicit)) return explicit
  if (cfg?.show_data_labels === false) return 'none'
  if (cfg?.show_data_labels === true) return fallback
  return fallback
}

/**
 * The text of one label.
 *
 * @param mode      one of DATA_LABEL_MODES
 * @param value     the raw measure
 * @param percent   the share, 0-100 (null when the form has no share)
 * @param fmt       the widget's number formatter
 * @param autoMode  what `auto` means for this chart type
 * @param minPercent  below this share a label is dropped — a slice too small to
 *                    hold text renders its label ON TOP of its neighbour's.
 */
export function dataLabelText(mode, { value, percent, fmt, autoMode = 'value', minPercent = 0 }) {
  const m = mode === 'auto' ? autoMode : mode
  if (m === 'none') return ''
  if (percent != null && minPercent > 0 && percent < minPercent) return ''
  const v = typeof fmt === 'function' ? fmt(value) : String(value ?? '')
  const p = percent == null ? null : `${Math.round(percent)}%`
  if (m === 'value') return v
  if (m === 'percent') return p ?? v
  if (m === 'value_percent') return p ? `${v} · ${p}` : v
  return ''
}

/**
 * Ink that can be read on a given fill.
 *
 * WCAG relative luminance, then the higher-contrast of the platform's own two
 * text ends. Not a guess about "light" or "dark" hues: #7eb3e8 and #2aab72 look
 * similarly mid to the eye and land on opposite sides of the threshold.
 */
export function labelInkFor(fillHex, { dark = '#0d1a2e', light = '#ffffff' } = {}) {
  const L = relativeLuminance(fillHex)
  if (L == null) return dark
  const contrastWithDark  = contrastRatio(L, relativeLuminance(dark))
  const contrastWithLight = contrastRatio(L, relativeLuminance(light))
  return contrastWithDark >= contrastWithLight ? dark : light
}

/** Does this ink actually clear the small-text bar on this fill? */
export function labelIsLegible(fillHex, inkHex, min = 4.5) {
  const a = relativeLuminance(fillHex), b = relativeLuminance(inkHex)
  if (a == null || b == null) return false
  return contrastRatio(a, b) >= min
}

export function contrastRatio(l1, l2) {
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

export function relativeLuminance(hex) {
  const rgb = parseHex(hex)
  if (!rgb) return null
  const [r, g, b] = rgb.map(c => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function parseHex(hex) {
  if (typeof hex !== 'string') return null
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
}

/**
 * A category with no value is not a category named "—". A blank group is
 * labelled as blank, so a legend row reads "(blank)" rather than a dash the
 * reader has to interpret.
 */
export function categoryLabel(name) {
  const s = name == null ? '' : String(name).trim()
  if (s === '' || s === '—' || s === '-') return '(blank)'
  return s
}
