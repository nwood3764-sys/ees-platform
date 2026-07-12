// ─── styles.js (field mobile) ────────────────────────────────────────────────
// Design-system tokens for the technician PWA. Mirrors src/data/constants C
// but kept local so the mobile bundle doesn't pull the full constants module
// (STATUS_CFG, chart colors, nav config) it doesn't need. Values are the
// canonical Energy Efficiency Services palette — do not drift.
// ─────────────────────────────────────────────────────────────────────────────

export const C = {
  sidebar:      '#07111f',
  sidebarHover: '#0d1f35',
  emerald:      '#3ecf8e',
  emeraldMid:   '#2aab72',
  page:         '#f0f3f8',
  card:         '#ffffff',
  cardSecondary:'#f7f9fc',
  border:       '#e4e9f2',
  borderDark:   '#d0d8e8',
  textPrimary:  '#0d1a2e',
  textSecondary:'#4a5e7a',
  textMuted:    '#8fa0b8',
  amber:        '#7eb3e8',
  navWarn:      '#4a5e7a',
  danger:       '#4a6da8',
  sky:          '#7eb3e8',
  link:         '#1d5a96',
  navActive:    'rgba(255,255,255,0.96)',
  navInactive:  'rgba(255,255,255,0.62)',
}

export const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
export const MONO = "'JetBrains Mono', ui-monospace, monospace"

// Status → badge colors. Work order + work step statuses both flow through
// here; unknown statuses fall back to a neutral chip.
export function statusChip(status) {
  const s = (status || '').toLowerCase()
  if (s.includes('correction')) return { bg: '#e8f0fb', color: '#2a5a8a', dot: C.sky }
  if (s.includes('verified'))   return { bg: '#e8f8f0', color: '#1a7a4f', dot: C.emerald }
  if (s.includes('complete'))   return { bg: '#e8f8f0', color: '#1a7a4f', dot: C.emerald }
  if (s.includes('in progress'))return { bg: '#e8f3fb', color: '#1a5a8a', dot: C.sky }
  if (s.includes('to be verif'))return { bg: '#e8f0fb', color: '#2a5a8a', dot: C.sky }
  if (s.includes('submitted'))  return { bg: '#e8f0fb', color: '#2a5a8a', dot: C.sky }
  if (s.includes('unable'))     return { bg: '#eceff4', color: '#4a5e7a', dot: C.textSecondary }
  if (s.includes('scheduled'))  return { bg: '#e8f3fb', color: '#1a5a8a', dot: C.sky }
  if (s.includes('assigned'))   return { bg: '#e8f3fb', color: '#1a5a8a', dot: C.sky }
  return { bg: C.page, color: C.textSecondary, dot: C.textMuted }
}

// Shared inline style fragments.
export const card = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  boxShadow: '0 1px 2px rgba(13,26,46,0.04)',
}

export const btnPrimary = {
  appearance: 'none', border: 'none', cursor: 'pointer',
  background: C.emerald, color: '#062018',
  fontFamily: FONT, fontWeight: 700, fontSize: 15,
  borderRadius: 8, padding: '14px 18px', width: '100%',
  minHeight: 50,
}

export const btnSecondary = {
  appearance: 'none', cursor: 'pointer',
  background: C.card, color: C.textPrimary,
  border: `1px solid ${C.borderDark}`,
  fontFamily: FONT, fontWeight: 600, fontSize: 15,
  borderRadius: 8, padding: '14px 18px', width: '100%',
  minHeight: 50,
}

export const btnDisabled = {
  ...btnPrimary, background: C.border, color: C.textMuted, cursor: 'not-allowed',
}
