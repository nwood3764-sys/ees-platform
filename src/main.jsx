import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import SigningPortalRoot from './pages/SigningPortal.jsx'
import ServiceAppointmentRoot from './serviceAppointments/ServiceAppointmentRoot.jsx'

// ─── Path-based routing (no router library) ──────────────────────────────────
// Two public, unauthenticated entry points bypass <AuthGate> and the staff
// chrome (sidebar/topbar) by being dispatched here:
//
//   /sign/{env_record_number}/{token}  → SigningPortalRoot
//     E-signature recipients are not Energy Efficiency Services users; the
//     URL token is their auth.
//
//   /sa/<slug> or /sa/manage/<token>   → ServiceAppointmentRoot
//     Customer-facing scheduling flow for a Service Appointment. Anyone in
//     the service area can schedule a home energy assessment without an
//     account; the create-service-appointment edge function enforces input validation,
//     territory containment, and the advisory-lock-based conflict check.
//
// Anything else goes through the normal authenticated App tree.
//
// Netlify SPA fallback (netlify.toml: /* → /index.html, 200) means direct
// hits to these paths still serve index.html so this dispatch runs.
// ─────────────────────────────────────────────────────────────────────────────

const pathname                  = window.location.pathname
const isSigningRoute            = pathname.startsWith('/sign/')
const isServiceAppointmentRoute = pathname === '/sa' || pathname.startsWith('/sa/')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isSigningRoute ? <SigningPortalRoot />
     : isServiceAppointmentRoute ? <ServiceAppointmentRoot />
     : <App />}
  </StrictMode>,
)
