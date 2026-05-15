// ─── ServiceAppointmentHeader.jsx ───────────────────────────────────────────────────────
// Branded header for customer-facing scheduling pages. Deep-navy bar with the
// EES-WI / Anura Energy mark. No nav — customers are on a single-purpose flow.

import { C } from './styles'

export default function ServiceAppointmentHeader() {
  return (
    <header style={{
      background:     C.navy,
      color:          'rgba(255,255,255,0.96)',
      padding:        '18px 16px',
      borderBottom:   `1px solid rgba(255,255,255,0.06)`,
    }}>
      <div style={{
        maxWidth:     760,
        margin:       '0 auto',
        display:      'flex',
        alignItems:   'center',
        gap:          12,
      }}>
        {/* Inline SVG mark — leaf in an emerald circle */}
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <circle cx="16" cy="16" r="16" fill={C.emerald} />
          <path
            d="M10 21c0-5 4-9 9-9h2v2c0 5-4 9-9 9h-2v-2zM10 21l5-5"
            stroke="#07111f" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: 0.2 }}>
            Energy Efficiency Services of Wisconsin
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.62)', marginTop: 2 }}>
            Schedule a home energy assessment
          </div>
        </div>
      </div>
    </header>
  )
}
