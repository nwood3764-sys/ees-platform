// ─── ServiceAppointmentFooter.jsx ───────────────────────────────────────────────────────
// Small footer below the scheduling flow — company contact + jurisdiction note.

import { C } from './styles'

export default function ServiceAppointmentFooter() {
  return (
    <footer style={{
      borderTop:  `1px solid ${C.border}`,
      background: C.card,
      padding:    '20px 16px',
      color:      C.textMuted,
      fontSize:   12,
    }}>
      <div style={{
        maxWidth:   760,
        margin:     '0 auto',
        display:    'flex',
        flexWrap:   'wrap',
        gap:        16,
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          Energy Efficiency Services of Wisconsin · 3218 Progress Rd, Madison, WI 53716
        </div>
        <div>
          Questions? <a
            href="mailto:assessments.wi@EES-WI.org"
            style={{ color: C.emeraldMid, textDecoration: 'none' }}
          >assessments.wi@EES-WI.org</a>
        </div>
      </div>
    </footer>
  )
}
