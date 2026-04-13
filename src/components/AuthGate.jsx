import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../data/constants'
import LoginScreen from './LoginScreen'

/**
 * AuthGate — the root authentication boundary for Anura.
 *
 * Flow:
 *   1. On mount, check whether a Supabase session already exists in
 *      localStorage (the client persists sessions). If yes, we're authed.
 *   2. Subscribe to auth state changes so sign-in and sign-out update
 *      the gate in real time.
 *   3. While the initial session check is in flight, show a minimal
 *      loading state so we don't flash the login screen for a user
 *      who is already signed in.
 *
 * When signed in, children is rendered with the current session passed
 * via a render prop so downstream code can access the user without having
 * to re-query Supabase.
 */
export default function AuthGate({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    // Initial session check
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session || null)
      setLoading(false)
    })

    // Subscribe to sign-in, sign-out, token refresh
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (cancelled) return
      setSession(newSession || null)
    })

    return () => {
      cancelled = true
      sub?.subscription?.unsubscribe?.()
    }
  }, [])

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: C.page,
          color: C.textMuted,
          fontFamily: 'Inter, -apple-system, sans-serif',
          fontSize: 13,
        }}
      >
        Loading…
      </div>
    )
  }

  if (!session) {
    return <LoginScreen />
  }

  return typeof children === 'function' ? children(session) : children
}
