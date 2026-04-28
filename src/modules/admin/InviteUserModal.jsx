import { useEffect, useRef, useState } from 'react'
import { C } from '../../data/constants'
import {
  inputStyle, buttonPrimaryStyle, buttonSecondaryStyle,
  FormField,
} from './adminStyles'
import { useIsMobile } from '../../lib/useMediaQuery'
import { fetchRoles, inviteUser, relinkUser } from '../../data/adminService'
import { useToast } from '../../components/Toast'

/**
 * InviteUserModal — opens from the Users pane in two modes:
 *
 *   • New user invite        — empty form. Admin enters email, names, role,
 *                              optional title/phone. Submit hits the
 *                              invite-user Edge Function which creates the
 *                              auth account, sends the invite email, and
 *                              writes a public.users row.
 *
 *   • Re-invite existing row — used for the seeded directory rows that
 *                              have no auth_user_id. The email is
 *                              displayed read-only (taken from the existing
 *                              row); the admin only confirms and submits.
 *                              Role/title/phone fields are pre-filled and
 *                              editable so the admin can correct anything
 *                              before the invite goes out.
 *
 * Successful submission triggers `onInvited` so the parent pane can refresh
 * its list and toast a confirmation. The modal is responsible for its own
 * inline error display.
 */
export default function InviteUserModal({
  mode = 'new',           // 'new' | 'relink'
  existingUser = null,    // { _id, firstName, lastName, email, title, phone, role } — required when mode='relink'
  onClose,
  onInvited,
}) {
  const isMobile = useIsMobile()
  const toast    = useToast()

  const isRelink = mode === 'relink' && existingUser
  const firstInputRef = useRef(null)

  const [firstName, setFirstName] = useState(isRelink ? (existingUser.firstName || '') : '')
  const [lastName, setLastName]   = useState(isRelink ? (existingUser.lastName  || '') : '')
  const [email, setEmail]         = useState(isRelink ? (existingUser.email     || '') : '')
  const [title, setTitle]         = useState(isRelink ? (existingUser.title     || '') : '')
  const [phone, setPhone]         = useState(isRelink ? (existingUser.phone     || '') : '')

  const [roles, setRoles]         = useState([])
  const [rolesLoading, setRolesLoading] = useState(true)
  const [roleId, setRoleId]       = useState('')

  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState(null)

  // Load roles on mount. We filter to active and present alphabetically.
  // Roles are critical to the invite — without one selected we can't
  // submit, so we surface a load error explicitly rather than letting the
  // form silently lack options.
  useEffect(() => {
    let cancelled = false
    setRolesLoading(true)
    fetchRoles()
      .then(rs => {
        if (cancelled) return
        const active = (rs || []).filter(r => r.status !== 'Inactive')
        // fetchRoles returns { id, _id, name, ... }. _id is the row UUID.
        setRoles(active)
        // Default to the existing user's role if we can find it by name.
        if (isRelink && existingUser?.role) {
          const match = active.find(r => r.name === existingUser.role)
          if (match) setRoleId(match._id)
        }
      })
      .catch(err => { if (!cancelled) setError(`Could not load roles: ${err.message || err}`) })
      .finally(() => { if (!cancelled) setRolesLoading(false) })
    return () => { cancelled = true }
  }, [isRelink, existingUser?.role])

  // Autofocus + Esc-to-close. Don't close mid-submit.
  useEffect(() => {
    firstInputRef.current?.focus()
  }, [])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const validate = () => {
    if (!isRelink) {
      if (!firstName.trim()) return 'First name is required.'
      if (!lastName.trim())  return 'Last name is required.'
      if (!email.trim())     return 'Email is required.'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.'
    }
    if (!roleId) return 'Select a role.'
    return null
  }

  const handleSubmit = async (e) => {
    e?.preventDefault?.()
    if (busy) return
    setError(null)
    const msg = validate()
    if (msg) { setError(msg); return }

    setBusy(true)
    try {
      let result
      if (isRelink) {
        result = await relinkUser({
          existingUserId: existingUser._id,
          roleId,
          title: title.trim() || null,
          phone: phone.trim() || null,
        })
      } else {
        result = await inviteUser({
          email: email.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          roleId,
          title: title.trim() || undefined,
          phone: phone.trim() || undefined,
        })
      }
      const sentTo = result?.email || email.trim()
      toast.success(`Invite sent to ${sentTo}`)
      onInvited?.(result)
      onClose()
    } catch (err) {
      setError(err.message || 'Invite failed.')
      setBusy(false)
    }
  }

  const heading = isRelink ? 'Send Invite' : 'Invite User'
  const subhead = isRelink
    ? `Provision a sign-in for an existing directory entry.`
    : `Email an invite link so the new user can set their own password.`
  const submitLabel = busy
    ? 'Sending…'
    : (isRelink ? 'Send Invite' : 'Send Invite')

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 700,
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 16,
      }}
    >
      <div
        role="dialog" aria-modal="true" aria-label={heading}
        style={{
          background: C.card,
          borderRadius: isMobile ? '12px 12px 0 0' : 10,
          padding: isMobile ? '22px 20px calc(20px + env(safe-area-inset-bottom))' : 26,
          width: isMobile ? '100%' : 520,
          maxWidth: '100%',
          maxHeight: isMobile ? '92vh' : '90vh',
          overflowY: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
            {heading}
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.45 }}>
            {subhead}
          </div>
          {isRelink && existingUser && (
            <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 6 }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{existingUser.id}</span>
              {' · '}
              {existingUser.name}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          {/* First/Last name — editable for new invites; show read-only for relink unless empty */}
          {!isRelink && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label="First Name" required>
                <input
                  ref={firstInputRef}
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  disabled={busy}
                  style={inputStyle}
                  autoComplete="given-name"
                />
              </FormField>
              <FormField label="Last Name" required>
                <input
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  disabled={busy}
                  style={inputStyle}
                  autoComplete="family-name"
                />
              </FormField>
            </div>
          )}

          <FormField
            label="Email"
            required={!isRelink}
            hint={isRelink
              ? 'The invite goes to the email already on file for this directory entry.'
              : 'The user will receive a one-time link at this address to set their password.'}
          >
            <input
              ref={isRelink ? firstInputRef : undefined}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={busy || isRelink}
              placeholder="user@ees-wi.org"
              style={{
                ...inputStyle,
                background: isRelink ? C.page : C.card,
                color: isRelink ? C.textSecondary : C.textPrimary,
                fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5,
              }}
              autoComplete="email"
            />
          </FormField>

          <FormField label="Role" required hint="Determines which Energy Efficiency Services modules and fields the user can see.">
            <select
              value={roleId}
              onChange={e => setRoleId(e.target.value)}
              disabled={busy || rolesLoading}
              style={inputStyle}
            >
              <option value="">{rolesLoading ? 'Loading roles…' : 'Select a role…'}</option>
              {roles.map(r => (
                <option key={r._id} value={r._id}>{r.name}</option>
              ))}
            </select>
          </FormField>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Title" hint="Optional.">
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                disabled={busy}
                style={inputStyle}
                placeholder="e.g. Project Coordinator"
              />
            </FormField>
            <FormField label="Phone" hint="Optional.">
              <input
                value={phone}
                onChange={e => setPhone(e.target.value)}
                disabled={busy}
                style={inputStyle}
                placeholder="(555) 555-1234"
                autoComplete="tel"
              />
            </FormField>
          </div>

          {error && (
            <div style={{
              background: '#fdecea', border: '1px solid #f3b9b1', color: '#8a2d20',
              padding: '9px 12px', borderRadius: 6, fontSize: 12, marginBottom: 14,
            }}>{error}</div>
          )}

          {/* Footer actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={buttonSecondaryStyle}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              style={{ ...buttonPrimaryStyle, opacity: busy ? 0.7 : 1 }}
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
