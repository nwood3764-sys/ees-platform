import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../data/constants'

// ---------------------------------------------------------------------------
// OutlookCallback — landing page Microsoft redirects to after OAuth consent.
//
// URL shape:    /auth/outlook-callback?code=<auth_code>&state=<state>
// Or on error:  /auth/outlook-callback?error=<err>&error_description=<msg>
//
// Flow:
//   1. Read code + state from the URL
//   2. Validate state matches the value we stashed in sessionStorage
//      under 'ees.outlook.oauth.state' before redirecting to Microsoft.
//      (The Energy Efficiency Services JWT requirement on the callback edge fn is the real
//      CSRF protection — state is just an OAuth hygiene check.)
//   3. Call outlook-oauth-callback edge fn with the user's Supabase JWT;
//      that fn exchanges the code for tokens and persists them to
//      user_outlook_connections via service role.
//   4. On success: drop a localStorage breadcrumb so any open Settings
//      tabs refresh their connection card, then send the user back to
//      the app with a one-shot success flag.
//
// This page is rendered INSIDE the authenticated App tree (App.jsx
// dispatches to it when window.location.pathname === '/auth/outlook-callback').
// We need the user's Supabase session for the edge fn call to work, so
// we cannot bypass AuthGate the way the public signing portal does.
// ---------------------------------------------------------------------------

const STATE_STORAGE_KEY     = 'ees.outlook.oauth.state'
const CHANGED_STORAGE_KEY   = 'ees.outlook.connection.changed'

export default function OutlookCallback() {
  const [phase, setPhase] = useState('working')   // 'working' | 'success' | 'error'
  const [message, setMessage] = useState('Finishing Outlook connection…')
  const [accountEmail, setAccountEmail] = useState(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code   = params.get('code')
    const state  = params.get('state')
    const err    = params.get('error')
    const errDesc= params.get('error_description')

    // Wipe the state token regardless of outcome — it's single-use and we
    // don't want a stale value lying around in sessionStorage.
    const storedState = sessionStorage.getItem(STATE_STORAGE_KEY)
    sessionStorage.removeItem(STATE_STORAGE_KEY)

    if (err) {
      setPhase('error')
      setMessage(errDesc || err || 'Microsoft returned an error during sign-in.')
      return
    }
    if (!code) {
      setPhase('error')
      setMessage('No authorization code returned by Microsoft. Try connecting again from Settings.')
      return
    }
    if (!state || !storedState || state !== storedState) {
      setPhase('error')
      setMessage('Connection state mismatch. For your security the connection was not completed. Try again from Settings.')
      return
    }

    ;(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('outlook-oauth-callback', {
          body: { code },
        })
        if (error) throw error
        if (!data?.ok) throw new Error('Server did not confirm connection')

        setAccountEmail(data.account_email || null)
        setPhase('success')
        setMessage('Outlook connected.')

        // Notify any open Settings tabs to refresh their status card.
        try { localStorage.setItem(CHANGED_STORAGE_KEY, String(Date.now())) }
        catch { /* storage disabled — non-fatal */ }
      } catch (e) {
        setPhase('error')
        setMessage(e?.message || 'Failed to complete Outlook connection.')
      }
    })()
  }, [])

  const handleDone = () => {
    // Strip the OAuth params so a refresh doesn't re-run the callback.
    window.location.replace('/')
  }

  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: C.page, padding: 20,
    }}>
      <div style={{
        background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10,
        padding: 32, maxWidth: 440, width: '100%',
        boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
        textAlign: 'center',
      }}>
        {phase === 'working' && (
          <>
            <Spinner />
            <div style={{ fontSize: 15, color: C.textPrimary, marginTop: 18, fontWeight: 500 }}>
              {message}
            </div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 6 }}>
              Hold on a moment.
            </div>
          </>
        )}

        {phase === 'success' && (
          <>
            <SuccessGlyph />
            <div style={{ fontSize: 17, fontWeight: 700, color: C.textPrimary, marginTop: 14 }}>
              Outlook connected
            </div>
            {accountEmail && (
              <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 6, wordBreak: 'break-all' }}>
                {accountEmail}
              </div>
            )}
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 14, lineHeight: 1.5 }}>
              Energy Efficiency Services can now send signing requests and other client emails through your Outlook mailbox. A copy of every message is saved to the related record.
            </div>
            <button
              onClick={handleDone}
              style={primaryButton}
            >
              Continue to Energy Efficiency Services
            </button>
          </>
        )}

        {phase === 'error' && (
          <>
            <ErrorGlyph />
            <div style={{ fontSize: 17, fontWeight: 700, color: C.textPrimary, marginTop: 14 }}>
              Could not connect Outlook
            </div>
            <div style={{
              fontSize: 13, color: '#8a2c20', marginTop: 12,
              background: '#fdecea', border: '1px solid #f3b9b3', borderRadius: 6,
              padding: '10px 12px', textAlign: 'left',
            }}>
              {message}
            </div>
            <button
              onClick={handleDone}
              style={primaryButton}
            >
              Back to Energy Efficiency Services
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Visual atoms ───────────────────────────────────────────────────────────

const primaryButton = {
  marginTop: 22,
  background: C.emerald, color: '#fff', border: 'none',
  padding: '10px 22px', fontSize: 14, fontWeight: 600,
  borderRadius: 6, cursor: 'pointer',
}

function Spinner() {
  return (
    <div style={{
      width: 32, height: 32, borderRadius: '50%',
      border: `3px solid ${C.border}`,
      borderTopColor: C.emerald,
      animation: 'ees-spin 0.7s linear infinite',
      margin: '0 auto',
    }} />
  )
}

function SuccessGlyph() {
  return (
    <div style={{
      width: 48, height: 48, borderRadius: '50%',
      background: '#e8f5ee', display: 'flex',
      alignItems: 'center', justifyContent: 'center', margin: '0 auto',
    }}>
      <svg width={24} height={24} viewBox="0 0 24 24" fill="none"
        stroke={C.emerald} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
  )
}

function ErrorGlyph() {
  return (
    <div style={{
      width: 48, height: 48, borderRadius: '50%',
      background: '#fdecea', display: 'flex',
      alignItems: 'center', justifyContent: 'center', margin: '0 auto',
    }}>
      <svg width={24} height={24} viewBox="0 0 24 24" fill="none"
        stroke="#b03a2e" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6"  x2="6"  y2="18" />
        <line x1="6"  y1="6"  x2="18" y2="18" />
      </svg>
    </div>
  )
}
