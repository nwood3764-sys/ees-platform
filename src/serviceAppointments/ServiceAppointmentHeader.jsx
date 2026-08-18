// ─── ServiceAppointmentHeader.jsx ───────────────────────────────────────────────────────
// Branded header for customer-facing scheduling pages. Deep-navy bar with the
// state-aware company name — "Energy Efficiency Services of North Carolina" for
// an NC booking, not a hardcoded Wisconsin. The state is published from the
// flow / manage page via SchedulerIdentityContext. No nav, no logo mark —
// customers are on a single-purpose flow and the wordmark is the brand.

import { C, companyForState } from './styles'
import { useSchedulerIdentity } from './SchedulerIdentityContext'

export default function ServiceAppointmentHeader() {
  const { state } = useSchedulerIdentity()
  const company = companyForState(state)

  return (
    <header style={{
      background:     C.navy,
      color:          'rgba(255,255,255,0.96)',
      padding:        '20px 16px',
      borderBottom:   `1px solid rgba(255,255,255,0.06)`,
      textAlign:      'center',
    }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: 0.2 }}>
          {company}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.62)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Energy Assessment Scheduling
        </div>
      </div>
    </header>
  )
}
