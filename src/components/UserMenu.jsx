import { useEffect, useRef, useState } from 'react'
import { C } from '../data/constants'
import { getCurrentUserProfile } from '../data/layoutService'

// ---------------------------------------------------------------------------
// UserMenu — the clickable user block at the bottom of the sidebar plus its
// dropdown.
//
// Visual lineage: preserves the avatar + name + role layout that the
// sidebar footer previously rendered inline. Adding a menu trigger on top
// rather than rebuilding from scratch keeps the sidebar footprint stable
// and avoids a wave of visual regressions across desktop/mobile/collapsed.
//
// Dropdown layout notes:
//   • Desktop expanded: menu opens above the trigger, same width (minus
//     padding). Dropdown is inside the sidebar column, so it respects the
//     dark sidebar background only for its trigger; the popup itself uses
//     the standard card surface so it reads clearly.
//   • Desktop collapsed: trigger is just the 28px avatar; menu floats to
//     the right (beyond the 60px sidebar) so a 220px popup doesn't get
//     clipped. A small left offset keeps it off the sidebar edge.
//   • Mobile: trigger sits in the drawer. The drawer has overflow-hidden on
//     the inner scroller, so we use position:absolute relative to the
//     trigger which is inside the footer — that works because the footer
//     has no overflow clip on its own.
//
// Close behaviors:
//   • Click outside the menu → close
//   • Escape → close
//   • Select an action → close (action fires)
// ---------------------------------------------------------------------------

export default function UserMenu({
  userEmail,
  onSignOut,
  onChangePassword,
  onOpenIntegrations,
  isMobile,
  isCollapsed,
}) {
  const [open, setOpen] = useState(false)
  const [profile, setProfile] = useState(null)
  const wrapperRef = useRef(null)

  // Fetch the authenticated user's display name + role lazily. We only need
  // this once per session; getCurrentUserProfile() caches internally so this
  // is effectively a single roundtrip over the app's lifetime.
  useEffect(() => {
    let cancelled = false
    getCurrentUserProfile()
      .then((p) => { if (!cancelled) setProfile(p || null) })
      .catch(() => { /* fall back to email-derived display below */ })
    return () => { cancelled = true }
  }, [])

  // Close the menu when a click lands outside the wrapper.
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler, { passive: true })
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [open])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  // Derive what to show. Prefer the app-level users row (real name + role);
  // fall back to the email local-part if that row is missing or hasn't loaded.
  const emailDerivedName = userEmail
    ? userEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'User'
  const emailDerivedInitials = userEmail
    ? userEmail.split('@')[0].split(/[._]/).map((s) => s[0]?.toUpperCase() || '').join('').slice(0, 2)
    : 'U'

  const displayName = profile?.displayName || emailDerivedName
  const displayRole = profile?.roleName || userEmail || ''
  const displayEmail = profile?.email || userEmail || ''
  const displayInitials = profile?.displayName
    ? profile.displayName.split(/\s+/).map((s) => s[0]?.toUpperCase() || '').join('').slice(0, 2)
    : emailDerivedInitials

  const handleTriggerClick = () => setOpen((v) => !v)

  const fire = (fn) => () => {
    setOpen(false)
    // Defer the action a tick so the menu can unmount before any modal
    // mounts. Avoids a brief overlap frame on slower devices.
    setTimeout(() => fn?.(), 0)
  }

  // Trigger styling — mirrors the previous inline sidebar footer layout so
  // the sidebar's visual weight doesn't change.
  const triggerPadding = isMobile
    ? '14px 20px calc(14px + env(safe-area-inset-bottom)) 20px'
    : isCollapsed ? '12px 0' : '12px 20px'

  const avatarSize = isMobile ? 32 : 28

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'relative',
        borderTop: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      {/* Trigger — the entire user block is clickable. */}
      <button
        type="button"
        onClick={handleTriggerClick}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="User menu"
        title={isCollapsed ? `${displayName}${displayRole ? `\n${displayRole}` : ''}` : undefined}
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: isCollapsed ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'flex-start',
          gap: isCollapsed ? 0 : 10,
          padding: triggerPadding,
          background: open ? 'rgba(255,255,255,0.04)' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'inherit',
          transition: 'background 120ms ease',
          minHeight: isMobile ? 60 : 52,
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent' }}
      >
        <div style={{
          width: avatarSize, height: avatarSize, borderRadius: '50%', background: C.emerald,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: isMobile ? 12 : 11, fontWeight: 600, color: '#07111f', flexShrink: 0,
        }}>
          {displayInitials || 'U'}
        </div>

        {!isCollapsed && (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                color: C.navActive,
                fontSize: isMobile ? 13 : 12,
                fontWeight: 500,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {displayName}
              </div>
              <div style={{
                color: C.navInactive,
                fontSize: isMobile ? 11 : 10,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {displayRole || displayEmail}
              </div>
            </div>

            {/* Caret — rotates 180° when open. */}
            <svg
              width={isMobile ? 14 : 12} height={isMobile ? 14 : 12} viewBox="0 0 24 24"
              fill="none" stroke={C.navInactive}
              strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
              style={{
                flexShrink: 0,
                transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 180ms ease',
              }}
            >
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            // Open upwards from the trigger in all modes (the user block is at
            // the bottom of the sidebar, so there is no room below it).
            bottom: 'calc(100% + 6px)',
            // Desktop expanded: flush left with 8px gutter. Mobile: same.
            // Desktop collapsed: float to the right so it doesn't clip.
            ...(isCollapsed
              ? { left: 'calc(100% + 6px)', bottom: 6 }
              : { left: 8, right: 8 }),
            minWidth: 220,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            padding: 6,
            zIndex: 500,
            animation: 'ees-fade-in 140ms ease',
          }}
        >
          {/* Account summary — not interactive, just context. */}
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
            variant="neutral"
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MenuItem — one row in the dropdown. Kept local to this file; neither the
// rest of the app nor the sidebar needs this shape.
// ---------------------------------------------------------------------------

function MenuItem({ icon, label, onClick, variant = 'neutral' }) {
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
        transition: 'background 120ms ease',
      }}
    >
      {/* Inline SVG instead of importing Icon from ./UI — ./UI imports this
          file (UserMenu), so reaching back into ./UI creates a circular
          dependency that leaves Icon undefined in the production bundle
          when ./UI evaluates first. */}
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
