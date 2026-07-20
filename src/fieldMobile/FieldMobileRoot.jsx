// ─── FieldMobileRoot.jsx ─────────────────────────────────────────────────────
// Top-level component for the technician PWA at /field/*. Path-based routing
// (no router library — matches /sa/* and /sign/* elsewhere in the app):
//
//   /field            → HomeScreen
//   /field/schedule   → TodaySchedule
//   /field/map        → MapView
//   /field/knowledge  → KnowledgeScreen (list)
//   /field/knowledge/<slug> → KnowledgeArticle (reader)
//   /field/wo/<id>    → WorkOrderDetail
//
// AUTH: unlike /sa/* (customer, unauthenticated) this surface is for
// authenticated internal staff (field technicians). It bypasses the staff
// CHROME (Sidebar/MobileHeader/desktop AuthGate) but enforces a real
// Supabase Auth session via its own lightweight gate, reusing the shared
// LoginScreen. No staff sidebar, no desktop layout — a dedicated one-handed
// field surface.
//
// Netlify SPA fallback (/* → /index.html, 200) means a direct hit or PWA
// launch to any /field/* path serves index.html, so main.jsx dispatch runs.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { clearUserCache } from '../data/layoutService'
import LoginScreen from '../components/LoginScreen'
import HomeScreen from './HomeScreen'
import TodaySchedule from './TodaySchedule'
import MapView from './MapView'
import KnowledgeScreen, { KnowledgeArticle } from './KnowledgeScreen'
import WorkOrderDetail from './WorkOrderDetail'
import VehicleInspection, { VehiclePicker } from './VehicleInspectionScreen'
import { C, FONT } from './styles'

// Lightweight client-side navigation. pushState + a popstate listener; every
// screen calls navigate() rather than touching history directly, so the back
// button works and deep links resolve.
export function useFieldPath() {
  const [path, setPath] = useState(
    typeof window !== 'undefined' ? window.location.pathname : '/field'
  )
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = useCallback((to) => {
    if (to === window.location.pathname) return
    window.history.pushState(null, '', to)
    setPath(to)
  }, [])
  return { path, navigate }
}

function Centered({ children }) {
  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: C.page, color: C.textMuted,
      fontFamily: FONT, fontSize: 14, padding: 24, textAlign: 'center',
    }}>
      {children}
    </div>
  )
}

export default function FieldMobileRoot() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const { path, navigate } = useFieldPath()

  // Override the staff-app body styles for a normal mobile scroll surface,
  // and set the viewport background so overscroll doesn't flash white.
  useEffect(() => {
    const prevTitle = document.title
    document.title = 'LEAP Pad'
    const prev = {
      htmlOverflow: document.documentElement.style.overflow,
      htmlHeight:   document.documentElement.style.height,
      bodyOverflow: document.body.style.overflow,
      bodyHeight:   document.body.style.height,
      bodyBg:       document.body.style.background,
    }
    document.documentElement.style.overflow = 'auto'
    document.documentElement.style.height   = 'auto'
    document.body.style.overflow            = 'auto'
    document.body.style.height              = 'auto'
    document.body.style.background          = C.page
    return () => {
      document.title = prevTitle
      document.documentElement.style.overflow = prev.htmlOverflow
      document.documentElement.style.height   = prev.htmlHeight
      document.body.style.overflow            = prev.bodyOverflow
      document.body.style.height              = prev.bodyHeight
      document.body.style.background          = prev.bodyBg
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data?.session || null)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (cancelled) return
      setSession(s || null)
      if (event === 'SIGNED_OUT') clearUserCache()
    })
    return () => { cancelled = true; sub?.subscription?.unsubscribe?.() }
  }, [])

  // Register the field service worker, scoped to /field. Other surfaces don't
  // register a worker; the scope keeps the staff app and customer flows out of
  // the cache entirely. On finding a new version, activate it immediately and
  // reload once so the technician picks up the latest build without a manual
  // reinstall. Fire-and-forget — failure must not block the app.
  //
  // Update checks fire on mount AND on every return-to-foreground plus a slow
  // periodic timer. Mount-only checking was the stale-bundle trap: an
  // installed PWA can live in the app switcher for days without ever
  // re-mounting, so a deployed fix never reached the device until a manual
  // pull-to-update. Resume is also the safest reload moment — the technician
  // has just switched back and isn't mid-capture.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    let reloaded = false
    let reg = null
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return
      reloaded = true
      window.location.reload()
    })
    const checkForUpdate = () => { reg?.update?.().catch(() => undefined) }
    const onVisible = () => { if (document.visibilityState === 'visible') checkForUpdate() }
    const interval = setInterval(checkForUpdate, 30 * 60 * 1000)
    document.addEventListener('visibilitychange', onVisible)
    navigator.serviceWorker
      .register('/sw.js', { scope: '/field' })
      .then((r) => {
        reg = r
        // If an updated worker is waiting, tell it to take over now.
        if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING')
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing
          if (!nw) return
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              reg.waiting?.postMessage('SKIP_WAITING')
            }
          })
        })
        // Proactively check for a new build on each mount.
        reg.update?.()
      })
      .catch((err) => { console.warn('Field SW registration failed:', err?.message || err) })
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (loading) return <Centered>Loading…</Centered>
  if (!session) return <LoginScreen />

  // Path dispatch.
  // parts = ['field'] | ['field','schedule'] | ['field','map']
  //       | ['field','knowledge'] | ['field','wo','<id>']
  //       | ['field','vehicles'] | ['field','vehicle-inspection','<id>']
  const parts = path.split('/').filter(Boolean)

  let screen
  if (parts.length === 1) {
    screen = <HomeScreen navigate={navigate} />
  } else if (parts[1] === 'schedule') {
    screen = <TodaySchedule navigate={navigate} />
  } else if (parts[1] === 'map') {
    screen = <MapView navigate={navigate} />
  } else if (parts[1] === 'knowledge' && parts[2]) {
    screen = <KnowledgeArticle slug={parts[2]} navigate={navigate} />
  } else if (parts[1] === 'knowledge') {
    screen = <KnowledgeScreen navigate={navigate} />
  } else if (parts[1] === 'vehicles') {
    screen = <VehiclePicker navigate={navigate} />
  } else if (parts[1] === 'vehicle-inspection' && parts[2]) {
    screen = <VehicleInspection activityId={parts[2]} navigate={navigate} />
  } else if (parts[1] === 'wo' && parts[2]) {
    screen = <WorkOrderDetail woId={parts[2]} navigate={navigate} />
  } else {
    screen = (
      <Centered>
        <div>
          <div style={{ fontSize: 15, color: C.textPrimary, marginBottom: 8 }}>Page not found</div>
          <button
            onClick={() => navigate('/field')}
            style={{
              appearance: 'none', border: 'none', cursor: 'pointer',
              background: C.emerald, color: '#062018', fontFamily: FONT,
              fontWeight: 700, fontSize: 14, borderRadius: 8, padding: '10px 16px',
            }}
          >
            Home
          </button>
        </div>
      </Centered>
    )
  }

  return (
    <div style={{
      // Own scroll container: bound to the viewport height and scroll
      // internally, independent of the staff app's `html, body { overflow:
      // hidden }` base rule. This is what lets long step lists scroll on
      // mobile. height (not minHeight) + overflowY:auto is the key.
      height: '100dvh',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      overscrollBehavior: 'contain',
      background: C.page, color: C.textPrimary,
      fontFamily: FONT,
    }}>
      {screen}
    </div>
  )
}
