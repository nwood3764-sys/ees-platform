import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../data/constants'

/**
 * SetPasswordScreen — shown when a user lands on Energy Efficiency Services via a Supabase Auth
 * invite or password-recovery link. The link puts the access/refresh tokens
 * in the URL hash; AuthGate picks them up, establishes a session, and then
 * renders this screen so the user can set a password before being dropped
 * into the app proper.
 *
 * Flow:
 *   1. AuthGate has already called supabase.auth.setSession() with the
 *      tokens from the URL hash, so a session exists by the time we mount.
 *   2. The user enters a new password (twice). We require it match and be
 *      at least 8 characters.
 *   3. supabase.auth.updateUser({ password }) saves the credential. From
 *      that moment, the user can sign in with email + password normally.
 *   4. We clear the hash from the URL so a refresh doesn't re-trigger this
 *      screen, then call onComplete() so AuthGate re-evaluates and renders
 *      the main app.
 *
 * The `mode` prop is 'invite' or 'recovery'. Copy is tweaked per mode but
 * the mechanics are identical — Supabase doesn't care which link type was
 * used as long as the session is live.
 */
export default function SetPasswordScreen({ email, mode, onComplete }) {
  const [password, setPassword]               = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw, setShowPw]                   = useState(false)
  const [submitting, setSubmitting]           = useState(false)
  const [error, setError]                     = useState(null)

  // If the session unexpectedly drops while this screen is open, route back
  // to login rather than letting updateUser fail silently. This can happen
  // if the user lets the recovery link expire after AuthGate set the session.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        // Calling onComplete will re-render AuthGate which will see no
        // session and show the login screen.
        onComplete?.()
      }
    })
    return () => sub?.subscription?.unsubscribe?.()
  }, [onComplete])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    if (!password || !confirmPassword) {
      setError('Enter your new password and confirmation.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    const { error: updateErr } = await supabase.auth.updateUser({ password })
    if (updateErr) {
      setError(updateErr.message || 'Could not set password. Try the link again.')
      setSubmitting(false)
      return
    }

    // Clear the hash so a refresh doesn't re-trigger the invite/recovery
    // flow. We use replaceState rather than location.hash = '' because the
    // latter scrolls the page to top and leaves a trailing #.
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      const cleanUrl = window.location.pathname + window.location.search
      window.history.replaceState(null, '', cleanUrl)
    }

    onComplete?.()
  }

  const heading      = mode === 'recovery' ? 'Reset your password' : 'Welcome to Energy Efficiency Services'
  const subheading   = mode === 'recovery' ? 'Choose a new password to continue.' : 'Set a password to finish creating your account.'
  const submitLabel  = mode === 'recovery' ? 'Reset Password' : 'Set Password'
  const submittingLb = mode === 'recovery' ? 'Resetting…' : 'Setting…'

  return (
    <div style={{
      minHeight: '100vh', background: C.page,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter, -apple-system, sans-serif', padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 400,
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
        padding: '32px 28px',
        boxShadow: '0 4px 24px rgba(13, 26, 46, 0.06)',
      }}>
        {/* Brand mark */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 44, height: 44, borderRadius: 10,
            background: '#07111f', color: '#3ecf8e',
            fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em',
            marginBottom: 12,
          }}>E</div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.textPrimary, letterSpacing: '-0.01em' }}>
            {heading}
          </h1>
          <div style={{ marginTop: 4, fontSize: 12, color: C.textMuted }}>{subheading}</div>
          {email && (
            <div style={{ marginTop: 10, fontSize: 12, color: C.textSecondary }}>
              Account: <span style={{ fontFamily: 'JetBrains Mono, monospace', color: C.textPrimary }}>{email}</span>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          <FieldLabel>New Password</FieldLabel>
          <PasswordField
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoFocus
            show={showPw}
            onToggle={() => setShowPw((v) => !v)}
          />

          <FieldLabel>Confirm Password</FieldLabel>
          <PasswordField
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            show={showPw}
            onToggle={() => setShowPw((v) => !v)}
          />

          {error && (
            <div style={{
              background: '#e8f1fb', border: '1px solid #bcd9f2', color: '#1e466b',
              padding: '9px 12px', borderRadius: 6, fontSize: 12, marginBottom: 14,
            }}>{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%', padding: '11px 14px', fontSize: 13, fontWeight: 600,
              color: '#ffffff',
              background: submitting ? '#7cc6a4' : '#3ecf8e',
              border: 'none', borderRadius: 6,
              cursor: submitting ? 'default' : 'pointer',
              transition: 'background 150ms ease',
            }}
          >
            {submitting ? submittingLb : submitLabel}
          </button>
        </form>

        <div style={{
          marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.border}`,
          textAlign: 'center', fontSize: 11, color: C.textMuted,
        }}>
          Energy Efficiency Services of Wisconsin
        </div>
      </div>
    </div>
  )
}

function FieldLabel({ children }) {
  return (
    <label style={{
      display: 'block', fontSize: 11, fontWeight: 600, color: C.textSecondary,
      textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5,
    }}>{children}</label>
  )
}

/**
 * Password input with a show/hide eye toggle. Technicians setting up their
 * account need to see what they type — fat-fingering an invisible password
 * twice is the #1 self-service support call. The toggle flips type between
 * 'password' and 'text'; `show`/`onToggle` are lifted to the parent so a
 * single toggle reveals both the New and Confirm fields together.
 */
function PasswordField({ value, onChange, placeholder, autoFocus, show, onToggle }) {
  return (
    <div style={{ position: 'relative', marginBottom: 14 }}>
      <input
        type={show ? 'text' : 'password'}
        autoComplete="new-password"
        required
        autoFocus={autoFocus}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        style={{ ...inputStyle, marginBottom: 0, paddingRight: 44 }}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={show ? 'Hide password' : 'Show password'}
        title={show ? 'Hide password' : 'Show password'}
        style={{
          position: 'absolute', top: 0, right: 0, height: '100%', width: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          color: C.textMuted,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = C.textSecondary }}
        onMouseLeave={(e) => { e.currentTarget.style.color = C.textMuted }}
      >
        <EyeIcon off={show} />
      </button>
    </div>
  )
}

/**
 * Eye / eye-off SVG. `off=true` draws the slashed eye (password is currently
 * visible, so the action hides it). SVG only — no emoji in UI chrome.
 */
function EyeIcon({ off }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {off ? (
        <>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <path d="M6.61 6.61A18.5 18.5 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </>
      ) : (
        <>
          <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  )
}

const inputStyle = {
  width: '100%', padding: '10px 12px', fontSize: 13, fontFamily: 'inherit',
  color: C.textPrimary, background: C.page,
  border: `1px solid ${C.border}`, borderRadius: 6, outline: 'none',
  marginBottom: 14, boxSizing: 'border-box',
}
