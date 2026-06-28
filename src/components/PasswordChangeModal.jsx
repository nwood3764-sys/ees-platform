import { forwardRef, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import { useIsMobile } from '../lib/useMediaQuery'

// ---------------------------------------------------------------------------
// PasswordChangeModal — in-app password change for the currently signed-in
// user. Standard enterprise flow:
//
//   1. User enters their current password, a new password, and a confirmation.
//   2. We re-verify the current password against Supabase Auth
//      (signInWithPassword) before touching the credential. This guards
//      against session-hijack abuse — a hijacker can reset the password with
//      only a live session, since supabase.auth.updateUser() does not require
//      the prior password.
//   3. On success, we call supabase.auth.updateUser({ password }) and toast
//      the result.
//
// Client-side rules:
//   • new password at least 8 characters
//   • new password may not equal the current password
//   • new and confirm must match
//
// Server errors (rate limiting, password policy rejections, network) are
// surfaced inline and via toast so the user always knows why a save failed.
// ---------------------------------------------------------------------------

export default function PasswordChangeModal({ userEmail, onClose }) {
  const toast = useToast()
  const isMobile = useIsMobile()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const firstInputRef = useRef(null)

  // Close on Escape. Don't close while a save is in flight — confusing
  // to have the modal vanish mid-request.
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, busy])

  // Autofocus the first input on mount. Mobile keyboards won't auto-open on
  // programmatic focus, which is fine — tapping the input handles it there.
  useEffect(() => {
    firstInputRef.current?.focus()
  }, [])

  const validate = () => {
    if (!currentPassword) return 'Enter your current password.'
    if (!newPassword) return 'Enter a new password.'
    if (newPassword.length < 8) return 'New password must be at least 8 characters.'
    if (newPassword === currentPassword) return 'New password must be different from your current password.'
    if (newPassword !== confirmPassword) return 'New password and confirmation do not match.'
    return null
  }

  const handleSubmit = async (e) => {
    e?.preventDefault?.()
    if (busy) return

    const msg = validate()
    if (msg) {
      setError(msg)
      return
    }

    if (!userEmail) {
      // Shouldn't happen — the menu only opens the modal when a session exists
      // — but guard anyway so the user doesn't get a silent failure.
      setError('Could not determine your account email. Please sign out and back in, then try again.')
      return
    }

    setBusy(true)
    setError(null)

    // Step 1 — re-verify current password. If the credential is wrong,
    // signInWithPassword returns an error and does not mutate the session.
    // If it's right, we get a new session for the same user (harmless).
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password: currentPassword,
    })
    if (reauthError) {
      setBusy(false)
      setError('Current password is incorrect.')
      return
    }

    // Step 2 — actually update the password.
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    })

    if (updateError) {
      setBusy(false)
      // Surface the real Supabase error. Common cases: password too weak per
      // project auth settings, too many requests, network failure.
      setError(updateError.message || 'Could not update password.')
      return
    }

    setBusy(false)
    toast.success('Password updated.')
    onClose()
  }

  return (
    <div
      onClick={(e) => {
        // Click outside the card closes, unless we're saving.
        if (e.target === e.currentTarget && !busy) onClose()
      }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 700,
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
        padding: isMobile ? 0 : 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Change password"
        style={{
          background: C.card,
          borderRadius: isMobile ? '12px 12px 0 0' : 10,
          padding: isMobile ? '22px 20px calc(20px + env(safe-area-inset-bottom))' : 26,
          width: isMobile ? '100%' : 420,
          maxWidth: '100%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 18 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: '#f0f9f5', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Icon path="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              size={15} color={C.emeraldMid} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
              Change password
            </div>
            {userEmail && (
              <div style={{ fontSize: 12, color: C.textMuted, wordBreak: 'break-all' }}>
                {userEmail}
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <Field
            ref={firstInputRef}
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={setCurrentPassword}
            disabled={busy}
          />
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            hint="At least 8 characters."
            value={newPassword}
            onChange={setNewPassword}
            disabled={busy}
          />
          <Field
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            disabled={busy}
            last
          />

          {error && (
            <div style={{
              background: '#e8f1fb', border: '1px solid #bcd9f2', color: '#1e466b',
              padding: '9px 12px', borderRadius: 6, fontSize: 12, marginBottom: 14,
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button
              type="submit"
              disabled={busy}
              style={{
                flex: 1,
                background: busy ? '#7cc6a4' : C.emerald,
                color: '#fff', border: 'none', borderRadius: 6,
                padding: '10px 0', fontSize: 13, fontWeight: 600,
                cursor: busy ? 'wait' : 'pointer',
                minHeight: 40,
              }}
            >
              {busy ? 'Updating…' : 'Update password'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={{
                flex: 1, background: C.page, color: C.textSecondary,
                border: `1px solid ${C.border}`, borderRadius: 6,
                padding: '10px 0', fontSize: 13, cursor: busy ? 'wait' : 'pointer',
                minHeight: 40,
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Field — compact labeled input used inside the modal. Extracted so the
// three identical password rows don't duplicate 20 lines of styling each.
// ---------------------------------------------------------------------------

const Field = forwardRef(function Field(
  { label, hint, value, onChange, disabled, last, ...rest },
  ref
) {
  return (
    <div style={{ marginBottom: last ? 16 : 14 }}>
      <label style={{
        display: 'block',
        fontSize: 11, fontWeight: 600, color: C.textSecondary,
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5,
      }}>
        {label}
      </label>
      <input
        ref={ref}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', padding: '10px 12px', fontSize: 13,
          fontFamily: 'inherit', color: C.textPrimary,
          background: disabled ? '#f7f9fc' : C.page,
          border: `1px solid ${C.border}`, borderRadius: 6,
          outline: 'none', boxSizing: 'border-box',
        }}
        {...rest}
      />
      {hint && (
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{hint}</div>
      )}
    </div>
  )
})
