import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import SigningPortalRoot from './pages/SigningPortal.jsx'
import BookingRoot from './booking/BookingRoot.jsx'

// ─── Path-based routing (no router library) ──────────────────────────────────
// Two public, unauthenticated entry points bypass <AuthGate> and the staff
// chrome (sidebar/topbar) by being dispatched here:
//
//   /sign/{env_record_number}/{token}  → SigningPortalRoot
//     E-signature recipients are not Energy Efficiency Services users; the
//     URL token is their auth.
//
//   /book/<slug> or /book/manage/<token>  → BookingRoot
//     Customer-facing booking flow. Anyone in the service area can book a
//     home energy assessment without an account; the bookAppointment edge
//     function enforces input validation, territory containment, and the
//     advisory-lock-based slot-conflict check.
//
// Anything else goes through the normal authenticated App tree.
//
// Netlify SPA fallback (netlify.toml: /* → /index.html, 200) means direct
// hits to these paths still serve index.html so this dispatch runs.
// ─────────────────────────────────────────────────────────────────────────────
const pathname       = window.location.pathname
const isSigningRoute = pathname.startsWith('/sign/')
const isBookingRoute = pathname === '/book' || pathname.startsWith('/book/')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isSigningRoute ? <SigningPortalRoot />
     : isBookingRoute ? <BookingRoot />
     : <App />}
  </StrictMode>,
)
