import { useState } from 'react'
import { supabase, hasSupabaseConfig } from '../lib/supabase'
import { C } from '../data/constants'
import PasswordInput from './PasswordInput'

/**
 * LoginScreen — email + password auth against Supabase Auth.
 *
 * Two view modes via the local `view` state:
 *   • 'signin'  — the standard email/password form
 *   • 'forgot'  — a single email input that calls
 *                 supabase.auth.resetPasswordForEmail(...)
 *
 * Why both live in this file (not separate routes):
 *   AuthGate selects between LoginScreen / SetPasswordScreen / the app
 *   based on session + URL hash. A separate /forgot route would add a
 *   third branch with no real benefit — the recovery REQUEST has no
 *   session, no tokens, no hash to detect. Inline mode-switch keeps
 *   the AuthGate boundary clean and the forgot flow one click away.
 *
 * The actual password reset (after the user clicks the recovery email
 * link) is handled entirely outside this file: Supabase sends a link
 * containing #access_token=...&type=recovery; AuthGate picks that up,
 * exchanges it for a session, and renders SetPasswordScreen. Nothing
 * to change there — it already works for invites and worked for
 * recovery the moment we ship this trigger.
 *
 * Important for invite-but-never-confirmed users (e.g. someone who got
 * an invite email weeks ago and never clicked it): resetPasswordForEmail
 * works on them. The resulting recovery link both CONFIRMS the email
 * and sets the new password in one step. So this single button covers
 * both "I forgot my password" and "I never finished signing up".
 *
 * There is no public signup on this screen by design — accounts are
 * provisioned by an Admin in the Energy Efficiency Services Admin
 * setup, per the project's role-based access model.
 */
export default function LoginScreen() {
  const [view, setView]             = useState('signin')   // 'signin' | 'forgot'
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState(null)
  // Distinct from `error` so we can show a success state in the same
  // place. Null until the recovery email has been requested.
  const [recoveryMessage, setRecoveryMessage] = useState(null)

  const goTo = (next) => {
    setView(next)
    setError(null)
    setRecoveryMessage(null)
    setPassword('')
  }

  const handleSignIn = async (e) => {
    e.preventDefault()
    if (!hasSupabaseConfig) {
      setError('Site is not configured. Missing Supabase environment variables.')
      return
    }
    setSubmitting(true)
    setError(null)
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (authError) {
      setError(authError.message || 'Unable to sign in.')
      setSubmitting(false)
      return
    }
    // On success the AuthGate picks up the new session and re-renders.
  }

  const handleForgot = async (e) => {
    e.preventDefault()
    if (!hasSupabaseConfig) {
      setError('Site is not configured. Missing Supabase environment variables.')
      return
    }
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Enter the email address on your account.')
      return
    }
    setSubmitting(true)
    setError(null)
    setRecoveryMessage(null)

    // redirectTo: the user lands back on the app root with
    // #access_token=...&type=recovery in the hash. AuthGate already
    // detects that exact shape and routes to SetPasswordScreen.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: window.location.origin,
    })

    setSubmitting(false)

    if (resetError) {
      // Supabase deliberately returns success for non-existent emails
      // (to avoid leaking account existence). Any error we DO see is a
      // real failure — rate limit, malformed input, network — and worth
      // surfacing verbatim.
      setError(resetError.message || 'Unable to send reset email.')
      return
    }

    // Always show the same confirmation regardless of whether the
    // email exists — same reason as above. If they typed the right
    // address they'll receive the link; if not, nothing happens.
    setRecoveryMessage(
      `If an account exists for ${trimmed}, a password-reset link has been sent. ` +
      `Check your inbox (and spam folder). The link expires in 1 hour.`
    )
  }

  const isForgot = view === 'forgot'

  return (
    <div
      style={{
        minHeight: '100vh',
        background: C.page,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter, -apple-system, sans-serif',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: '32px 28px',
          boxShadow: '0 4px 24px rgba(13, 26, 46, 0.06)',
        }}
      >
        {/* Brand mark */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              borderRadius: 10,
              background: '#07111f',
              color: '#3ecf8e',
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              marginBottom: 12,
            }}
          >
            E
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 700,
              color: C.textPrimary,
              letterSpacing: '-0.01em',
            }}
          >
            Energy Efficiency Services
          </h1>
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              color: C.textMuted,
            }}
          >
            {isForgot ? 'Reset your password' : 'Sign in to continue'}
          </div>
        </div>

        <form onSubmit={isForgot ? handleForgot : handleSignIn}>
          <label
            style={{
              display: 'block',
              fontSize: 11,
              fontWeight: 600,
              color: C.textSecondary,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 5,
            }}
          >
            Email
          </label>
          <input
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@EES-WI.org"
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 13,
              fontFamily: 'inherit',
              color: C.textPrimary,
              background: C.page,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              outline: 'none',
              marginBottom: 14,
              boxSizing: 'border-box',
            }}
          />

          {!isForgot && (
            <>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 600,
                  color: C.textSecondary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 5,
                }}
              >
                Password
              </label>
              <PasswordInput
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  color: C.textPrimary,
                  background: C.page,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  outline: 'none',
                  marginBottom: 18,
                  boxSizing: 'border-box',
                }}
              />
            </>
          )}

          {error && (
            <div
              style={{
                background: '#e8f1fb',
                border: '1px solid #bcd9f2',
                color: '#1e466b',
                padding: '9px 12px',
                borderRadius: 6,
                fontSize: 12,
                marginBottom: 14,
              }}
            >
              {error}
            </div>
          )}

          {recoveryMessage && (
            <div
              style={{
                background: '#ecfdf3',
                border: '1px solid #b7e4c7',
                color: '#1a5e3a',
                padding: '10px 12px',
                borderRadius: 6,
                fontSize: 12,
                marginBottom: 14,
                lineHeight: 1.5,
              }}
            >
              {recoveryMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              padding: '11px 14px',
              fontSize: 13,
              fontWeight: 600,
              color: '#ffffff',
              background: submitting ? '#7cc6a4' : '#3ecf8e',
              border: 'none',
              borderRadius: 6,
              cursor: submitting ? 'default' : 'pointer',
              transition: 'background 150ms ease',
            }}
          >
            {submitting
              ? (isForgot ? 'Sending…' : 'Signing in…')
              : (isForgot ? 'Send reset link' : 'Sign In')
            }
          </button>
        </form>

        {/* Mode toggle. Single click between sign-in and forgot-password. */}
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          {isForgot ? (
            <button
              type="button"
              onClick={() => goTo('signin')}
              style={{
                background: 'none',
                border: 'none',
                color: C.textSecondary,
                fontSize: 12,
                cursor: 'pointer',
                padding: 4,
                fontFamily: 'inherit',
                textDecoration: 'underline',
              }}
            >
              Back to sign in
            </button>
          ) : (
            <button
              type="button"
              onClick={() => goTo('forgot')}
              style={{
                background: 'none',
                border: 'none',
                color: C.textSecondary,
                fontSize: 12,
                cursor: 'pointer',
                padding: 4,
                fontFamily: 'inherit',
                textDecoration: 'underline',
              }}
            >
              Forgot password?
            </button>
          )}
        </div>

        <div
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: `1px solid ${C.border}`,
            textAlign: 'center',
            fontSize: 11,
            color: C.textMuted,
          }}
        >
          Energy Efficiency Services of Wisconsin
        </div>
      </div>
    </div>
  )
}
