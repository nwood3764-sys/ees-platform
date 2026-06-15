// ─── MobileShell.jsx ─────────────────────────────────────────────────────────
// Shared chrome for technician screens: a sticky navy topbar (design-system
// #07111f) with optional back chevron, a title, and a right-slot. Content
// scrolls beneath. SVG icons only — no emoji, per the design system.
// ─────────────────────────────────────────────────────────────────────────────

import { C, FONT } from './styles'

function ChevronLeft() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

export default function MobileShell({ title, onBack, right, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: C.sidebar, color: C.navActive,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 12px',
        height: 54,
        paddingTop: 'env(safe-area-inset-top)',
        boxSizing: 'content-box',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        {onBack ? (
          <button
            onClick={onBack}
            aria-label="Back"
            style={{
              appearance: 'none', border: 'none', background: 'transparent',
              color: C.navActive, cursor: 'pointer', padding: 6, margin: '-6px 0 -6px -6px',
              display: 'flex', alignItems: 'center',
            }}
          >
            <ChevronLeft />
          </button>
        ) : null}
        <div style={{
          flex: 1, fontFamily: FONT, fontWeight: 700, fontSize: 16,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {title}
        </div>
        {right}
      </header>
      <main style={{ flex: 1, padding: 14, paddingBottom: 'calc(env(safe-area-inset-bottom) + 28px)', boxSizing: 'border-box' }}>
        {children}
      </main>
    </div>
  )
}
