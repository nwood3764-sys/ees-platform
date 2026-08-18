// ─── SchedulerIdentityContext.jsx ────────────────────────────────────────────
// Lets the customer-facing pages publish the *appointment's state* upward so the
// global header + footer (rendered above the flow) show the correct state-aware
// company identity — "Energy Efficiency Services of North Carolina" for an NC
// booking, not a hardcoded Wisconsin. The flow calls setState once the customer
// picks/enters a state; the manage page sets it from the loaded appointment.

import { createContext, useContext, useState } from 'react'

const SchedulerIdentityContext = createContext({ state: '', setState: () => {} })

// Seed from a ?state= query param when present (per-person invite links carry
// it), so the header is correct before the customer touches the form.
function initialStateFromUrl() {
  if (typeof window === 'undefined') return ''
  const p = new URLSearchParams(window.location.search).get('state')
  return p ? p.toUpperCase() : ''
}

export function SchedulerIdentityProvider({ children }) {
  const [state, setState] = useState(initialStateFromUrl)
  return (
    <SchedulerIdentityContext.Provider value={{ state, setState }}>
      {children}
    </SchedulerIdentityContext.Provider>
  )
}

export function useSchedulerIdentity() {
  return useContext(SchedulerIdentityContext)
}
