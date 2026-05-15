// ─── ManagePage.jsx ──────────────────────────────────────────────────────────
// Customer self-serve appointment management at /book/manage/<token>.
//
// V1 stub: shows the token + a "contact us to change" message. Full lookup +
// reschedule/cancel needs a `lookup_booking_by_token(token)` RPC + a
// `reschedule_appointment` RPC + a `cancel_appointment` RPC; those land in a
// follow-up slice once notifications and the dispatcher console are wired.
//
// The token is rendered in monospace so customers can paste it back to staff
// when contacting support.

import { C, card, FONT_MONO, buttonPrimary } from './styles'

export default function ManagePage({ token }) {
  const valid = /^[a-f0-9]{32}$/.test(token || '')

  if (!valid) {
    return (
      <div style={card}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
          Invalid management link
        </h1>
        <p style={{ color: C.textSecondary, fontSize: 15, lineHeight: 1.5 }}>
          We couldn't recognize that booking token. Double-check the link from
          your confirmation, or email{' '}
          <a href="mailto:assessments.wi@ees-wi.org" style={{ color: C.emeraldMid, textDecoration: 'none' }}>
            assessments.wi@ees-wi.org
          </a>{' '}
          and we'll find your appointment.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div style={card}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
          Your appointment is on file
        </h1>
        <p style={{ color: C.textSecondary, fontSize: 15, lineHeight: 1.6, marginBottom: 16 }}>
          We've got your booking saved. To view your scheduled time, reschedule,
          or cancel, please email{' '}
          <a href="mailto:assessments.wi@ees-wi.org" style={{ color: C.emeraldMid, textDecoration: 'none' }}>
            assessments.wi@ees-wi.org
          </a>{' '}
          and include the reference code below. Self-serve reschedule and
          cancel will be available here shortly.
        </p>

        <div style={{
          padding:      14,
          background:   C.cardSecondary,
          border:       `1px solid ${C.border}`,
          borderRadius: 6,
          fontFamily:   FONT_MONO,
          fontSize:     13,
          color:        C.textPrimary,
          wordBreak:    'break-all',
        }}>
          {token}
        </div>

        <div style={{ marginTop: 20 }}>
          <a href="mailto:assessments.wi@ees-wi.org?subject=Appointment reference"
             style={{ ...buttonPrimary, display: 'inline-block', textAlign: 'center', textDecoration: 'none' }}>
            Email Energy Efficiency Services
          </a>
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <a href="/book" style={{ color: C.textMuted, fontSize: 13, textDecoration: 'none' }}>
          Book another appointment →
        </a>
      </div>
    </div>
  )
}
