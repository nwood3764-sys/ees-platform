import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import SigningPortalRoot from './pages/SigningPortal.jsx'

// ─── Path-based routing (no router library) ──────────────────────────────────
// The signing portal is publicly accessible at /sign/{env_record_number}/{token}
// without authentication. Recipients are not Anura users; the token is the
// auth. We can't render this through the normal App tree because that tree
// gates everything behind <AuthGate>. Detecting the path here and dispatching
// to a separate component avoids both the auth gate and the chrome (sidebar/
// topbar) for these magic-link visits. Anything else goes to the normal App.
//
// Server-side routing for /sign/* paths is handled by Netlify's SPA fallback
// (public/_redirects) so direct visits to those URLs still hit index.html.
// ─────────────────────────────────────────────────────────────────────────────
const isSigningRoute = window.location.pathname.startsWith('/sign/')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isSigningRoute ? <SigningPortalRoot /> : <App />}
  </StrictMode>,
)
