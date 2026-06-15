// ─── AppChrome.jsx ───────────────────────────────────────────────────────────
// Persistent app shell for the technician PWA's primary tab screens (Home,
// Schedule, Map). Provides the three things that make this read as a native
// app rather than a scrolling web page:
//
//   1. Sticky header — hamburger (left) opens the drawer, title (center),
//      optional right slot for a screen action.
//   2. Slide-in drawer — backdrop overlay, secondary navigation and settings:
//      Knowledge base, Check for updates (+ build SHA), Sign out.
//   3. Fixed bottom tab bar — Home / Schedule / Map, thumb-reachable, the
//      primary navigation. Active tab in emerald.
//
// Content scrolls between the header and the tab bar. WorkOrderDetail does
// NOT use this shell — it's a full-screen execution surface with its own back
// chrome (no tab bar), so the technician isn't tempted to tab away mid-step.
//
// Design system: navy header/drawer (#07111f), emerald active accent, sky/
// navy only — no red/orange. SVG icons only, no emoji.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import { C, FONT, MONO } from './styles'
import { signOut } from './fieldMobileService'
import { forceRefresh } from './UpdateControls'

const BUILD_SHA = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev'
const BUILD_ID  = typeof __BUILD_ID__  !== 'undefined' ? __BUILD_ID__  : 'dev'

const TAB_BAR_HEIGHT = 58

// ─── Icons ───────────────────────────────────────────────────────────────────
function Icon({ paths, size = 22, stroke = 'currentColor', fill = 'none', sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}
      stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {paths}
    </svg>
  )
}
const HamburgerIcon = () => <Icon paths={<><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>} />
const CloseIcon = () => <Icon paths={<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>} />
const HomeIcon = ({ active }) => <Icon size={22} sw={active ? 2.4 : 2} paths={<><path d="M3 9.5L12 3l9 6.5" /><path d="M5 9.5V21h14V9.5" /></>} />
const ScheduleIcon = ({ active }) => <Icon size={22} sw={active ? 2.4 : 2} paths={<><rect x="3" y="4" width="18" height="17" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="16" y1="2" x2="16" y2="6" /></>} />
const MapIcon = ({ active }) => <Icon size={22} sw={active ? 2.4 : 2} paths={<><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" /></>} />
const BookIcon = () => <Icon size={20} paths={<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>} />
const RefreshIcon = ({ spinning }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={spinning ? { animation: 'ees-spin 0.8s linear infinite' } : undefined}>
    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
)
const SignOutIcon = () => <Icon size={20} paths={<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>} />

// Spinner icon reused by the pull-to-refresh indicator.
function SpinnerIcon({ spinning }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      style={spinning ? { animation: 'ees-spin 0.8s linear infinite' } : undefined}>
      <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

// Pull-to-refresh indicator. Driven by the usePullToRefresh hook state; render
// it as the first child inside an AppChrome data screen. Fixed under the header,
// revealed by drag, becomes a spinner while refreshing.
export function PullIndicator({ pull, ready, refreshing, triggerDistance = 70, maxPull = 110 }) {
  const visible = pull > 0 || refreshing
  if (!visible) return null
  return (
    <>
      <style>{'@keyframes ees-spin{to{transform:rotate(360deg)}}'}</style>
      <div style={{
        position: 'fixed', top: 'calc(env(safe-area-inset-top) + 60px)', left: 0, right: 0,
        display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8,
        height: 34, zIndex: 30, pointerEvents: 'none',
        color: ready || refreshing ? C.emeraldMid : C.textMuted,
        fontFamily: FONT, fontWeight: 700, fontSize: 12,
        opacity: refreshing ? 1 : Math.min(1, pull / triggerDistance),
        transform: `translateY(${refreshing ? 0 : Math.min(pull, maxPull) - 34}px)`,
        transition: pull > 0 ? 'none' : 'transform 0.2s ease, opacity 0.2s ease',
      }}>
        <SpinnerIcon spinning={refreshing} />
        {refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh'}
      </div>
    </>
  )
}

// ─── Tabs ────────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'home',     label: 'Home',     path: '/field',          Icon: HomeIcon },
  { key: 'schedule', label: 'Schedule', path: '/field/schedule', Icon: ScheduleIcon },
  { key: 'map',      label: 'Map',      path: '/field/map',      Icon: MapIcon },
]

// ─── Drawer ──────────────────────────────────────────────────────────────────
function Drawer({ open, onClose, navigate }) {
  const [refreshing, setRefreshing] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const doRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    await forceRefresh() // reloads the page; spinner released only if it returns
    setRefreshing(false)
  }
  const doSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try { await signOut() } finally { setSigningOut(false); onClose() }
  }

  const itemStyle = {
    display: 'flex', alignItems: 'center', gap: 12,
    width: '100%', appearance: 'none', cursor: 'pointer',
    background: 'transparent', border: 'none',
    color: C.navActive, fontFamily: FONT, fontSize: 15, fontWeight: 600,
    padding: '14px 18px', textAlign: 'left',
  }

  return (
    <>
      <style>{'@keyframes ees-spin{to{transform:rotate(360deg)}}'}</style>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 60,
          background: 'rgba(7,17,31,0.55)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.22s ease',
        }}
      />
      {/* Panel */}
      <aside
        style={{
          position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 61,
          width: 'min(84vw, 320px)',
          background: C.sidebar, color: C.navActive,
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.24s ease',
          display: 'flex', flexDirection: 'column',
          paddingTop: 'env(safe-area-inset-top)',
          boxShadow: open ? '2px 0 24px rgba(0,0,0,0.35)' : 'none',
        }}
      >
        {/* Drawer header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          height: 54, padding: '0 12px 0 18px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 26, height: 26, borderRadius: 6, background: C.emerald,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#062018', fontWeight: 800, fontSize: 14, fontFamily: FONT,
            }}>E</div>
            <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 16 }}>LEAP Pad</span>
          </div>
          <button onClick={onClose} aria-label="Close menu" style={{
            appearance: 'none', border: 'none', background: 'transparent',
            color: C.navActive, cursor: 'pointer', padding: 6, margin: '-6px',
            display: 'flex',
          }}>
            <CloseIcon />
          </button>
        </div>

        {/* Primary drawer items */}
        <nav style={{ paddingTop: 8 }}>
          <button
            style={itemStyle}
            onClick={() => { onClose(); navigate('/field/knowledge') }}
          >
            <BookIcon /> Knowledge base
          </button>
        </nav>

        <div style={{ flex: 1 }} />

        {/* Settings / footer region pinned to bottom */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <button style={{ ...itemStyle, color: refreshing ? C.navInactive : C.navActive }} onClick={doRefresh} disabled={refreshing}>
            <RefreshIcon spinning={refreshing} />
            {refreshing ? 'Updating…' : 'Check for updates'}
          </button>
          <button style={{ ...itemStyle, color: signingOut ? C.navInactive : C.navActive }} onClick={doSignOut} disabled={signingOut}>
            <SignOutIcon />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
          <div style={{
            padding: '10px 18px 16px', fontFamily: MONO, fontSize: 10,
            color: C.navInactive, lineHeight: 1.5,
          }}>
            LEAP Pad<br />build {BUILD_ID}
          </div>
        </div>
      </aside>
    </>
  )
}

// ─── Bottom tab bar ──────────────────────────────────────────────────────────
function TabBar({ activeKey, navigate }) {
  return (
    <nav style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50,
      height: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`,
      paddingBottom: 'env(safe-area-inset-bottom)',
      background: C.sidebar,
      borderTop: '1px solid rgba(255,255,255,0.08)',
      display: 'flex', alignItems: 'stretch',
    }}>
      {TABS.map(t => {
        const active = t.key === activeKey
        return (
          <button
            key={t.key}
            onClick={() => navigate(t.path)}
            aria-label={t.label}
            aria-current={active ? 'page' : undefined}
            style={{
              flex: 1, appearance: 'none', border: 'none', cursor: 'pointer',
              background: 'transparent',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 3,
              color: active ? C.emerald : C.navInactive,
              fontFamily: FONT, fontSize: 11, fontWeight: active ? 700 : 500,
              paddingTop: 6,
            }}
          >
            <t.Icon active={active} />
            {t.label}
          </button>
        )
      })}
    </nav>
  )
}

// ─── Shell ───────────────────────────────────────────────────────────────────
export default function AppChrome({ title, activeKey, navigate, right, children }) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Close the drawer on Escape for keyboard/desktop testing.
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 40,
        background: C.sidebar, color: C.navActive,
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 8px',
        height: 54,
        paddingTop: 'env(safe-area-inset-top)',
        boxSizing: 'content-box',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          style={{
            appearance: 'none', border: 'none', background: 'transparent',
            color: C.navActive, cursor: 'pointer', padding: 8, margin: '-2px',
            display: 'flex', alignItems: 'center',
          }}
        >
          <HamburgerIcon />
        </button>
        <div style={{
          flex: 1, fontFamily: FONT, fontWeight: 700, fontSize: 16,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {title}
        </div>
        {right}
      </header>

      {/* Scrollable content; padded so the fixed tab bar never overlaps. */}
      <main style={{
        flex: 1,
        padding: 14,
        paddingBottom: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom) + 20px)`,
        boxSizing: 'border-box',
      }}>
        {children}
      </main>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={navigate} />
      <TabBar activeKey={activeKey} navigate={navigate} />
    </div>
  )
}
