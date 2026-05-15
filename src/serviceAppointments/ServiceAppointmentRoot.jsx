// ─── ServiceAppointmentRoot.jsx ─────────────────────────────────────────────────────────
// Top-level component for the customer-facing /sa/* paths. Path-based
// routing (no router library — matches the rest of the app):
//
//   /sa/<slug>             → ServiceAppointmentFlow (intake → slots → confirm → success)
//   /sa/manage/<token>     → ManagePage (view + future reschedule/cancel)
//   /sa or /sa/          → SlugIndex (list of bookable services)
//
// Renders its own page chrome (header + footer). Bypasses AuthGate and the
// staff sidebar — customers are unauthenticated.

import { useEffect } from 'react'
import ServiceAppointmentFlow   from './ServiceAppointmentFlow'
import ManagePage    from './ManagePage'
import SlugIndex     from './SlugIndex'
import ServiceAppointmentHeader from './ServiceAppointmentHeader'
import ServiceAppointmentFooter from './ServiceAppointmentFooter'
import { C } from './styles'

export default function ServiceAppointmentRoot() {
  // Override the staff-app body styles. The staff app sets html/body to
  // overflow:hidden + height:100% (because it has its own scroll container).
  // For a customer-facing flow we want normal page scrolling.
  useEffect(() => {
    const prevHtmlOverflow = document.documentElement.style.overflow
    const prevHtmlHeight   = document.documentElement.style.height
    const prevBodyOverflow = document.body.style.overflow
    const prevBodyHeight   = document.body.style.height
    document.documentElement.style.overflow = 'auto'
    document.documentElement.style.height   = 'auto'
    document.body.style.overflow            = 'auto'
    document.body.style.height              = 'auto'
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow
      document.documentElement.style.height   = prevHtmlHeight
      document.body.style.overflow            = prevBodyOverflow
      document.body.style.height              = prevBodyHeight
    }
  }, [])

  const path = typeof window !== 'undefined' ? window.location.pathname : '/sa'
  const parts = path.split('/').filter(Boolean) // ['book'], ['book','single-family-assessment'], ['book','manage','<token>']

  let content
  if (parts.length === 1) {
    content = <SlugIndex />
  } else if (parts[1] === 'manage' && parts[2]) {
    content = <ManagePage token={parts[2]} />
  } else {
    content = <ServiceAppointmentFlow slug={parts[1]} />
  }

  return (
    <div style={{
      minHeight:      '100vh',
      background:     C.page,
      color:          C.textPrimary,
      display:        'flex',
      flexDirection:  'column',
    }}>
      <ServiceAppointmentHeader />
      <main style={{
        flex:        1,
        width:       '100%',
        maxWidth:    760,
        margin:      '0 auto',
        padding:     '24px 16px 48px',
        boxSizing:   'border-box',
      }}>
        {content}
      </main>
      <ServiceAppointmentFooter />
    </div>
  )
}
