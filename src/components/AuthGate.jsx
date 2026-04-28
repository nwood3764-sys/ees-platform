import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../data/constants'
import LoginScreen from './LoginScreen'
import SetPasswordScreen from './SetPasswordScreen'

/**
 * AuthGate — the root authentication boundary for Energy Efficiency Services.
 *
 * Three terminal states:
 *
 *   1. Loading                 — initial session check is in flight.
 *   2. SetPasswordScreen       — the user arrived via a Supabase Auth invite
 *                                or password-recovery link. We detect that
 *                                from the URL hash, exchange the tokens for
 *                                a session, and ask the user to set a
 *                                password before letting them into the app.
 *   3. LoginScreen             — no session and no invite/recovery hash.
 *   4. children(session)       — fully authenticated; render the app.
 *
 * Invite & recovery handling:
 *   Supabase action links (invite, recovery, magiclink) deposit the new
 *   session's tokens in the URL fragment as `#access_token=...&refresh_token=
 *   ...&type=invite|recovery|signup|magiclink`. The `supabase` client in
 *   this project has `detectSessionInUrl: false`, so it does NOT
 *   auto-consume those tokens. We do it ourselves below — the explicit
 *   handling lets us tell invite/recovery apart from a normal sign-in and
 *   show the password-setting screen accordingly.
 */
export default function AuthGate({ children }) {
  const [session, setSession]                   = useState(null)
  const [loading, setLoading]                   = useState(true)
  // Set to 'invite' or 'recovery' when the URL hash carries those tokens.
  // Cleared once the user successfully sets a password (or signs out).
  const [passwordSetMode, setPasswordSetMode]   = useState(null)
  // Local snapshot of the invited email so the SetPasswordScreen can show
  // the user which account they're activating. Pulled from the session
  // after we exchange the hash tokens.
  const [passwordSetEmail, setPasswordSetEmail] = useState(null)

  useEffect(() => {
    let cancelled = false

    const init = async () => {
      // Step 1 — see if the URL fragment carries an invite/recovery payload.
      // Format: #access_token=...&refresh_token=...&type=...&expires_in=...
      const hash = typeof window !== 'undefined' ? window.location.hash : ''
      const hashParams = new URLSearchParams(hash.replace(/^#/, ''))
      const tokenType = hashParams.get('type')
      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')
      const errorCode = hashParams.get('error_code') || hashParams.get('error')

      // If the link is expired or revoked, the redirect comes back with an
      // error in the hash instead of tokens. Clear it so a refresh doesn't
      // loop, log it for debugging, and fall through to the login screen.
      if (errorCode) {
        console.warn('Auth link error:', hashParams.get('error_description') || errorCode)
        if (window.history?.replaceState) {
          window.history.replaceState(null, '', window.location.pathname + window.location.search)
        }
      }

      if ((tokenType === 'invite' || tokenType === 'recovery') && accessToken && refreshToken) {
        // Exchange the hash tokens for a real session. This persists to
        // localStorage like a normal sign-in, so a refresh during password
        // setup keeps the user in the SetPasswordScreen rather than
        // bouncing back to login.
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        if (cancelled) return
        if (!error && data?.session) {
          setSession(data.session)
          setPasswordSetMode(tokenType)
          setPasswordSetEmail(data.session.user?.email || null)
          setLoading(false)
          return
        }
        // If the exchange failed we fall through to the normal flow — the
        // user will see the login screen and can request a new link.
      }

      // Step 2 — normal flow. Read whatever session is already persisted.
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      setSession(data.session || null)
      setLoading(false)
    }

    init()

    // Subscribe to sign-in / sign-out / token-refresh.
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (cancelled) return
      setSession(newSession || null)
      if (event === 'SIGNED_OUT') {
        setPasswordSetMode(null)
        setPasswordSetEmail(null)
      }
    })

    return () => {
      cancelled = true
      sub?.subscription?.unsubscribe?.()
    }
  }, [])

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: C.page, color: C.textMuted,
        fontFamily: 'Inter, -apple-system, sans-serif', fontSize: 13,
      }}>
        Loading…
      </div>
    )
  }

  // The user is mid-invite or mid-recovery — let them set a password before
  // entering the app. We pass `onComplete` so the screen can clear the
  // invite/recovery state when it's done. The session itself stays put,
  // so the next render will fall through to the authed app.
  if (session && passwordSetMode) {
    return (
      <SetPasswordScreen
        email={passwordSetEmail}
        mode={passwordSetMode}
        onComplete={() => {
          setPasswordSetMode(null)
          setPasswordSetEmail(null)
        }}
      />
    )
  }

  if (!session) {
    return <LoginScreen />
  }

  return typeof children === 'function' ? children(session) : children
}
