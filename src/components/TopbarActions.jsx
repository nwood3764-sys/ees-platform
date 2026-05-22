// ===========================================================================
// TopbarActions
//
// Renders the right-hand action cluster of the RecordDetail topbar:
//   - "Primary" actions render as visible buttons
//   - "Menu" actions collapse into an Actions… overflow dropdown
//   - The Edit / Save / Cancel transition is handled by RecordDetail itself
//     (those buttons need direct access to editor state); this component
//     handles every other action
//
// Two visual variants are supported via the `variant` prop:
//   - 'desktop' — full-width buttons with labels, used in the desktop header
//                 card. Matches the prior <button> styling.
//   - 'mobile'  — icon-only buttons sized for the sticky mobile header. Same
//                 actions, same primary/menu split, just compact.
//
// Inputs:
//   variant            — 'desktop' | 'mobile'
//   tableName, record, ctx — passed through to the registry's isAvailable
//                            predicates and to resolveTopbarActions()
//   actionOverrides    — page_layout_actions rows for the active layout
//   handlers           — { [action_key]: () => void } — wired by RecordDetail
//   pendingByKey       — optional { [action_key]: bool } — disables the button
//                        and renders a loading affordance (e.g. statusChanging,
//                        envelopeBusy, cloningTemplate, previewingPdf)
// ===========================================================================

import { useEffect, useRef, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { resolveTopbarActions, actionColors } from '../data/recordActions'

// ── Styling helpers ────────────────────────────────────────────────────────

function desktopButtonStyle(palette, { pending, primaryEmphasis }) {
  // primaryEmphasis = first primary action gets the filled emerald look
  // (matches the prior Edit / Publish styling). All others use the outline
  // pattern with the action's color.
  if (primaryEmphasis) {
    return {
      background: pending ? '#a7f3d0' : C.emerald,
      color:      '#fff',
      border:     'none',
      borderRadius: 6,
      padding:    '7px 16px',
      fontSize:   12.5,
      fontWeight: 600,
      cursor:     pending ? 'wait' : 'pointer',
      display:    'flex',
      alignItems: 'center',
      gap:        5,
      opacity:    pending ? 0.85 : 1,
    }
  }
  return {
    background: palette.bg,
    color:      palette.fg,
    border:     `1px solid ${palette.border}`,
    borderRadius: 6,
    padding:    '7px 14px',
    fontSize:   12.5,
    fontWeight: 500,
    cursor:     pending ? 'wait' : 'pointer',
    display:    'flex',
    alignItems: 'center',
    gap:        5,
    opacity:    pending ? 0.85 : 1,
  }
}

const MOBILE_BTN_STYLE = (palette, pending) => ({
  background: 'transparent',
  border:     'none',
  padding:    10,
  borderRadius: 6,
  cursor:     pending ? 'wait' : 'pointer',
  color:      palette.fg,
  display:    'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth:   44,
  minHeight:  44,
  opacity:    pending ? 0.6 : 1,
})

// ── Component ──────────────────────────────────────────────────────────────

export default function TopbarActions({
  variant = 'desktop',
  tableName,
  record,
  ctx,
  actionOverrides,
  handlers,
  pendingByKey = {},
}) {
  const { primary, menu } = resolveTopbarActions({
    objectName: tableName,
    ctx,
    overrides:  actionOverrides,
  })

  // ── Overflow menu state ──────────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef(null)
  const menuPanelRef  = useRef(null)

  // Click-outside closes the menu
  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(e) {
      if (menuButtonRef.current?.contains(e.target)) return
      if (menuPanelRef.current?.contains(e.target))  return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  // Escape closes the menu
  useEffect(() => {
    if (!menuOpen) return
    function onKey(e) { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const isMobile = variant === 'mobile'

  // No actions at all? Render nothing — caller is responsible for its own
  // edit-mode Save/Cancel UI.
  if (primary.length === 0 && menu.length === 0) return null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: isMobile ? 2 : 8,
      flexShrink: 0,
    }}>
      {/* ── Primary tier — visible buttons ── */}
      {primary.map((action, idx) => {
        const handler = handlers[action.key]
        if (!handler) return null   // defensive — registry has it but caller didn't wire
        const pending = !!pendingByKey[action.key]
        const palette = actionColors(C, action.color)

        if (isMobile) {
          return (
            <button
              key={action.key}
              onClick={pending ? undefined : handler}
              disabled={pending}
              aria-label={action.label}
              title={action.label}
              style={MOBILE_BTN_STYLE(palette, pending)}
            >
              <Icon path={action.icon} size={18} color="currentColor" />
            </button>
          )
        }

        // Desktop — first primary action in the publish-flavored group
        // (publish/restore) gets the filled emerald treatment for visual
        // emphasis. Detected by registry color===EMERALD AND key in the
        // publish-shaped set.
        const primaryEmphasis = idx === 0 &&
          ['publish', 'restore'].includes(action.key)

        return (
          <button
            key={action.key}
            onClick={pending ? undefined : handler}
            disabled={pending}
            title={action.label}
            style={desktopButtonStyle(palette, { pending, primaryEmphasis })}
            onMouseEnter={primaryEmphasis ? undefined : (e) => {
              if (!pending) e.currentTarget.style.background = palette.hoverBg
            }}
            onMouseLeave={primaryEmphasis ? undefined : (e) => {
              if (!pending) e.currentTarget.style.background = palette.bg
            }}
          >
            <Icon path={action.icon} size={13} color={primaryEmphasis ? '#fff' : palette.fg} />
            {pending ? `${action.label}…` : action.label}
          </button>
        )
      })}

      {/* ── Menu tier — Actions… overflow dropdown ── */}
      {menu.length > 0 && (
        <div style={{ position: 'relative' }}>
          <button
            ref={menuButtonRef}
            onClick={() => setMenuOpen(v => !v)}
            aria-label="Actions"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            title="Actions"
            style={isMobile ? MOBILE_BTN_STYLE(actionColors(C, 'neutral'), false) : {
              background: C.page,
              color: C.textSecondary,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: '7px 12px',
              fontSize: 12.5,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
            onMouseEnter={isMobile ? undefined : (e) => {
              e.currentTarget.style.background = '#eef2f7'
            }}
            onMouseLeave={isMobile ? undefined : (e) => {
              e.currentTarget.style.background = C.page
            }}
          >
            <Icon
              path="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
              size={isMobile ? 18 : 13}
              color="currentColor"
            />
            {!isMobile && 'Actions'}
            {!isMobile && (
              <Icon path="M6 9l6 6 6-6" size={11} color="currentColor" />
            )}
          </button>

          {menuOpen && (
            <div
              ref={menuPanelRef}
              role="menu"
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                right: 0,
                minWidth: 220,
                maxWidth: 320,
                background: C.card,
                border: `1px solid ${C.borderDark || C.border}`,
                borderRadius: 8,
                boxShadow: '0 12px 32px rgba(13,26,46,0.18)',
                padding: '4px 0',
                zIndex: 60,
              }}
            >
              {menu.map(action => {
                const handler = handlers[action.key]
                if (!handler) return null
                const pending = !!pendingByKey[action.key]
                const palette = actionColors(C, action.color)
                return (
                  <button
                    key={action.key}
                    role="menuitem"
                    onClick={() => {
                      if (pending) return
                      setMenuOpen(false)
                      handler()
                    }}
                    disabled={pending}
                    title={action.label}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      padding: '8px 14px',
                      fontSize: 13,
                      textAlign: 'left',
                      cursor: pending ? 'wait' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      color: palette.fg,
                      fontFamily: 'inherit',
                      opacity: pending ? 0.6 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (!pending) e.currentTarget.style.background = palette.hoverBg
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <Icon path={action.icon} size={14} color={palette.fg} />
                    <span style={{ flex: 1 }}>{pending ? `${action.label}…` : action.label}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
