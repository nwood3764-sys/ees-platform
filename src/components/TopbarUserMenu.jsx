import { useEffect, useRef, useState } from 'react'
import { C } from '../data/constants'
import { getCurrentUserProfile } from '../data/layoutService'

/**
 * Salesforce-style user menu for the top-right corner of the global topbar.
 * Avatar-only trigger (initials in a colored circle) opens a downward menu
 * with the same actions as the sidebar UserMenu — Change password, Integrations,
 * Sign out. Same data source (getCurrentUserProfile) so name + role stay
 * consistent with whatever the sidebar shows.
 *
 * Separate component from the existing sidebar UserMenu rather than a shared
 * component with conditional layout, because the two have meaningfully
 * different chrome (sidebar collapsed/expanded states, mobile drawer, dark
 * background, dropdown direction) and conflating them produces a thicket of
 * `if (placement === 'topbar')` branches. The trade-off is duplication of
 * the action item set, which is small and stable.
 */
export default function TopbarUserMenu({
  userEmail,
  onSignOut,
  onChangePassword,
  onOpenIntegrations,
}) {
  const [open, setOpen] = useState(false)
  const [profile, setProfile] = useState(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    getCurrentUserProfile()
      .then(p => { if (!cancelled) setProfile(p || null) })
      .catch(() => { /* fall back to email-derived display below */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const emailDerivedName = userEmail
    ? userEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'User'
  const emailDerivedInitials = userEmail
    ? userEmail.split('@')[0].split(/[._]/).map((s) => s[0]?.toUpperCase() || '').join('').slice(0, 2)
    : 'U'

  const displayName = profile?.displayName || emailDerivedName
  const displayRole = profile?.roleName || ''
  const displayEmail = profile?.email || userEmail || ''
  const displayInitials = profile?.displayName
    ? profile.displayName.split(/\s+/).map((s) => s[0]?.toUpperCase() || '').join('').slice(0, 2)
    : emailDerivedInitials

  const fire = (fn) => () => {
    setOpen(false)
    setTimeout(() => fn?.(), 0)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="User menu"
        title={`${displayName}${displayRole ? `\n${displayRole}` : ''}`}
        style={{
          width: 30, height: 30, borderRadius: '50%',
          background: C.emerald, color: '#07111f',
          border: 'none', cursor: 'pointer',
          fontSize: 11, fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0,
          outline: open ? `2px solid ${C.emerald}` : 'none',
          outlineOffset: 2,
        }}
      >
        {displayInitials || 'U'}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            minWidth: 240,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            padding: 6,
            zIndex: 500,
          }}
        >
          {/* Account summary — context only, not interactive */}
          <div style={{ padding: '8px 10px 10px', borderBottom: `1px solid ${C.border}`, marginBottom: 6 }}>
            <div style={{
              fontSize: 12.5, fontWeight: 600, color: C.textPrimary,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {displayName}
            </div>
            {displayRole && (
              <div style={{
                fontSize: 11, color: C.textSecondary, marginTop: 2,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {displayRole}
              </div>
            )}
            {displayEmail && displayEmail !== displayRole && (
              <div style={{
                fontSize: 11, color: C.textMuted, marginTop: 2,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {displayEmail}
              </div>
            )}
          </div>

          <MenuItem
            icon="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            label="Change password"
            onClick={fire(onChangePassword)}
          />
          <MenuItem
            icon="M14 7l-5 5 5 5M5 7l5 5-5 5"
            label="Integrations"
            onClick={fire(onOpenIntegrations)}
          />
          <MenuItem
            icon="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            label="Sign out"
            onClick={fire(onSignOut)}
          />
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon, label, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%',
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 10px',
        background: hover ? C.page : 'transparent',
        border: 'none', borderRadius: 6,
        fontSize: 13, color: C.textPrimary,
        cursor: 'pointer', textAlign: 'left',
      }}
    >
      <svg
        width={14} height={14} viewBox="0 0 24 24" fill="none"
        stroke={C.textSecondary} strokeWidth={1.8}
        strokeLinecap="round" strokeLinejoin="round"
        style={{ flexShrink: 0 }}
      >
        <path d={icon} />
      </svg>
      <span>{label}</span>
    </button>
  )
}
