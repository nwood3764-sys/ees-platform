import { C } from '../../data/constants'
import { useHelp } from './HelpProvider'
import { useCurrentPageAnchors, describeCurrentPage } from './useCurrentPageAnchors'

// ---------------------------------------------------------------------------
// HelpTopbarButton — the global Help entry point. Lives in the topbar next
// to the search bar. Click opens HelpPanel with anchors derived from the
// current page (activeModule + selectedRecord). User never has to know
// what to search for — context surfaces relevant articles automatically.
//
// This is the single, always-visible help entry point referenced in every
// help workflow. Salesforce-style: one persistent corner control rather
// than icons scattered across every UI element.
// ---------------------------------------------------------------------------

export default function HelpTopbarButton({ activeModule, selectedRecord }) {
  const { open, isOpen } = useHelp()
  const anchors = useCurrentPageAnchors({ activeModule, selectedRecord })
  const title = describeCurrentPage({ activeModule, selectedRecord })

  const handleClick = () => {
    // If panel is already open, toggle closed by re-opening with the same
    // call — close happens via the panel's own X. Opening from a different
    // place updates anchors and title. Keep it simple: clicking always
    // opens (idempotent).
    open(anchors, title)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Help"
      title="Help"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        borderRadius: 6,
        background: isOpen ? '#e9f7ef' : 'transparent',
        border: `1px solid ${isOpen ? C.emerald : C.border}`,
        color: isOpen ? C.emerald : C.textSecondary,
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'background 120ms, border-color 120ms, color 120ms',
      }}
      onMouseEnter={e => {
        if (isOpen) return
        e.currentTarget.style.background = C.page
        e.currentTarget.style.borderColor = C.borderDark || C.border
        e.currentTarget.style.color = C.textPrimary
      }}
      onMouseLeave={e => {
        if (isOpen) return
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.borderColor = C.border
        e.currentTarget.style.color = C.textSecondary
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    </button>
  )
}
