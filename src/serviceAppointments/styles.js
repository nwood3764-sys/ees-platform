// ─── styles.js ───────────────────────────────────────────────────────────────
// Inline-style helpers for the customer-facing /sa/* scheduling pages. Mirrors the
// design tokens in src/data/constants.js (kept independent because the
// /sa/* module bypasses the rest of the app via main.jsx path routing).

export const C = {
  page:           '#f0f3f8',
  card:           '#ffffff',
  cardSecondary:  '#f7f9fc',
  border:         '#e4e9f2',
  borderDark:     '#d0d8e8',
  emerald:        '#3ecf8e',
  emeraldMid:     '#2aab72',
  emeraldDark:    '#1d8054',
  navy:           '#07111f',
  textPrimary:    '#0d1a2e',
  textSecondary:  '#4a5e7a',
  textMuted:      '#8fa0b8',
  sky:            '#7eb3e8',
  amber:          '#7eb3e8',
  danger:         '#7eb3e8',
  dangerBg:       '#e8f1fb',
  emeraldBg:      '#e8f8f2',
  link:           '#1d5a96',
}

export const RADIUS = 8

export const FONT_UI   = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
export const FONT_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace"

// ─── reusable style objects ─────────────────────────────────────────────────

export const card = {
  background:   C.card,
  border:       `1px solid ${C.border}`,
  borderRadius: RADIUS,
  padding:      24,
  boxShadow:    '0 1px 3px rgba(13, 26, 46, 0.05)',
}

export const label = {
  display:      'block',
  fontSize:     12,
  fontWeight:   600,
  color:        C.textSecondary,
  marginBottom: 6,
  letterSpacing: 0.2,
  textTransform: 'uppercase',
}

export const input = {
  width:        '100%',
  padding:      '12px 14px',
  fontSize:     15,
  fontFamily:   FONT_UI,
  color:        C.textPrimary,
  background:   C.card,
  border:       `1px solid ${C.borderDark}`,
  borderRadius: RADIUS,
  outline:      'none',
  transition:   'border-color 0.15s ease',
}

export const inputFocus = { borderColor: C.emerald }

export const buttonPrimary = {
  width:        '100%',
  padding:      '14px 20px',
  fontSize:     15,
  fontWeight:   600,
  fontFamily:   FONT_UI,
  color:        '#ffffff',
  background:   C.emerald,
  border:       'none',
  borderRadius: RADIUS,
  cursor:       'pointer',
  transition:   'background 0.15s ease, transform 0.05s ease',
  letterSpacing: 0.2,
}

export const buttonPrimaryHover = { background: C.emeraldMid }

export const buttonSecondary = {
  ...buttonPrimary,
  color:      C.textSecondary,
  background: C.card,
  border:     `1px solid ${C.borderDark}`,
}

export const buttonSecondaryHover = { background: C.cardSecondary }

export const errorBanner = {
  padding:      '12px 16px',
  fontSize:     14,
  color:        '#1e466b',
  background:   C.dangerBg,
  border:       `1px solid ${C.danger}`,
  borderRadius: RADIUS,
  marginBottom: 16,
}

// ─── responsive helpers ─────────────────────────────────────────────────────

export const isMobile = () => typeof window !== 'undefined' && window.innerWidth <= 640

export const formatPhoneDisplay = (raw) => {
  const d = (raw || '').replace(/\D/g, '').slice(-10)
  if (d.length !== 10) return raw
  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
}

// Format an ISO instant as a human-friendly Chicago local time/date pair.
// Returns { date: 'Thursday, May 14', time: '7:30 AM' }.
export const formatChicagoSlot = (iso) => {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago',
  })
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago',
  })
  return { date, time }
}

export const formatChicagoTimeRange = (startIso, endIso) => {
  const s = formatChicagoSlot(startIso).time
  const e = formatChicagoSlot(endIso).time
  return `${s} – ${e}`
}
