// ─── ServiceAppointmentFooter.jsx ───────────────────────────────────────────────────────
// Small footer below the scheduling flow — state-aware company + program phone.
// No hardcoded Wisconsin address/mailbox: the company identity follows the
// appointment's state via SchedulerIdentityContext.

import { C, companyForState, programPhoneForState } from './styles'
import { useSchedulerIdentity } from './SchedulerIdentityContext'

export default function ServiceAppointmentFooter() {
  const { state } = useSchedulerIdentity()
  const company = companyForState(state)
  const phone   = programPhoneForState(state)

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
        <div>{company}</div>
        {phone && (
          <div>
            Questions? Call <a
              href={`tel:${phone.replace(/[^\d]/g, '')}`}
              style={{ color: C.emeraldMid, textDecoration: 'none', fontWeight: 600 }}
            >{phone}</a>
          </div>
        )}
      </div>
    </footer>
  )
}
