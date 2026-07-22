import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import SigningPortalRoot from './pages/SigningPortal.jsx'
import ProjectPortalRoot from './pages/ProjectPortalRoot.jsx'
import ProviderPortalRoot from './pages/ProviderPortalRoot.jsx'
import ProviderIntakeRoot from './pages/ProviderIntakeRoot.jsx'
import ServiceAppointmentRoot from './serviceAppointments/ServiceAppointmentRoot.jsx'
import FieldMobileRoot from './fieldMobile/FieldMobileRoot.jsx'
import { installGlobalErrorHandlers } from './lib/clientErrorLogger'

// Catches uncaught errors and unhandled promise rejections at the
// window level — the layer below React's ErrorBoundary, which only
// catches errors thrown during render. Together they cover both
// synchronous render exceptions and async failures (fetch, promise
// chains, setTimeout callbacks).
installGlobalErrorHandlers()

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
//   /field or /field/*                 → FieldMobileRoot
//     Technician mobile PWA. Authenticated internal staff (field crew), but
//     bypasses the staff sidebar/topbar chrome for a dedicated one-handed
//     field surface. Enforces its own Supabase Auth gate (reuses LoginScreen).
//
// Anything else goes through the normal authenticated App tree.
//
// Netlify SPA fallback (netlify.toml: /* → /index.html, 200) means direct
// hits to these paths still serve index.html so this dispatch runs.
// ─────────────────────────────────────────────────────────────────────────────

const pathname                  = window.location.pathname
const isSigningRoute            = pathname.startsWith('/sign/')
const isProjectPortalRoute      = pathname === '/project-portal' || pathname.startsWith('/project-portal/')
const isProviderPortalRoute     = pathname === '/provider-portal' || pathname.startsWith('/provider-portal/')
const isProviderIntakeRoute     = pathname === '/provider-signup' || pathname.startsWith('/provider-signup/')
const isServiceAppointmentRoute = pathname === '/sa' || pathname.startsWith('/sa/')
const isFieldRoute              = pathname === '/field' || pathname.startsWith('/field/')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isSigningRoute ? <SigningPortalRoot />
     : isProjectPortalRoute ? <ProjectPortalRoot />
     : isProviderPortalRoute ? <ProviderPortalRoot />
     : isProviderIntakeRoute ? <ProviderIntakeRoot />
     : isServiceAppointmentRoute ? <ServiceAppointmentRoot />
     : isFieldRoute ? <FieldMobileRoot />
     : <App />}
  </StrictMode>,
)
