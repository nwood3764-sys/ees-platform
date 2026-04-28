import { useState } from 'react'
import { supabase, hasSupabaseConfig } from '../lib/supabase'
import { C } from '../data/constants'

/**
 * LoginScreen — email + password auth against Supabase Auth.
 *
 * This screen is the first thing an unauthenticated user sees. On successful
 * login the parent AuthGate observes the auth state change and swaps this
 * component out for the main application. There is no signup flow here —
 * user accounts are created by an Admin in Energy Efficiency Services Admin, per the project's
 * role-based access model (no self-signup from the public internet).
 */
export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
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
    // No explicit navigation needed here.
  }

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
            A
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
            Sign in to continue
          </div>
        </div>

        <form onSubmit={handleSubmit}>
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
            placeholder="you@ees-wi.org"
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
          <input
            type="password"
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

          {error && (
            <div
              style={{
                background: '#fdecea',
                border: '1px solid #f3b9b1',
                color: '#8a2d20',
                padding: '9px 12px',
                borderRadius: 6,
                fontSize: 12,
                marginBottom: 14,
              }}
            >
              {error}
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
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

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
