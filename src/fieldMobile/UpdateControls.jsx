// ─── UpdateControls.jsx ──────────────────────────────────────────────────────
// Manual escape hatches for stale-bundle situations, mounted on the Schedule
// screen. Two affordances:
//
//   1. Pull-to-refresh: pull down past a threshold at the top of the page →
//      forces a service-worker update check, then reloads.
//   2. "Check for updates" button: same handler, explicit tap.
//
// WHY THIS EXISTS: the field PWA is a long-lived installed app that is almost
// never fully closed, so a newly deployed build can sit in the "waiting" state
// indefinitely. The build-time per-SHA CACHE_VERSION (vite emit-service-worker
// plugin) makes auto-update reliable, but these manual controls guarantee a
// technician can always pull the latest build on demand without reinstalling.
//
// REFRESH SEQUENCE:
//   • Call registration.update(). If a genuinely newer sw.js exists, a new
//     worker installs, takes over, and FieldMobileRoot's controllerchange
//     listener reloads the page. Done.
//   • If no newer worker appears within a short grace window (already on the
//     latest worker, but page assets may still be stale in some edge cases),
//     fall back to a hard reload that bypasses the HTTP cache.
//
// Design system: emerald primary, sky/navy only. No red/orange. SVG icon only.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react'
import { C, FONT, MONO } from './styles'

const BUILD_SHA = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev'

// Pull-to-refresh tuning.
const TRIGGER_DISTANCE = 70   // px pulled past top before a refresh fires
const MAX_PULL = 110          // px clamp on the visual indicator
const GRACE_MS = 2500         // wait for a new worker before hard-reloading

function RefreshIcon({ spinning }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      style={spinning ? { animation: 'ees-spin 0.8s linear infinite' } : undefined}
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

// Force a service-worker update check, then reload. Resolves by reloading the
// page one way or another, so the caller never needs to handle completion.
export async function forceRefresh() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    window.location.reload()
    return
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration('/field')
    if (!reg) { hardReload(); return }

    // If a worker is already waiting, activate it now; controllerchange in
    // FieldMobileRoot will reload.
    if (reg.waiting) { reg.waiting.postMessage('SKIP_WAITING'); return }

    await reg.update()

    // update() may have found and begun installing a new worker. Give it a
    // brief window to install + take control (which triggers the reload). If
    // nothing takes over, the installed worker is already current — hard-reload
    // to guarantee fresh assets.
    const tookOver = await waitForControllerChange(GRACE_MS)
    if (!tookOver) hardReload()
  } catch {
    hardReload()
  }
}

function waitForControllerChange(ms) {
  return new Promise((resolve) => {
    let settled = false
    const done = (v) => { if (!settled) { settled = true; resolve(v) } }
    const onChange = () => done(true)
    navigator.serviceWorker.addEventListener('controllerchange', onChange, { once: true })
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', onChange)
      done(false)
    }, ms)
  })
}

// Cache-busting hard reload. Appends a throwaway query param so the navigation
// request can't be served from the HTTP cache, then strips it on arrival.
function hardReload() {
  try {
    const u = new URL(window.location.href)
    u.searchParams.set('_r', Date.now().toString(36))
    window.location.replace(u.toString())
  } catch {
    window.location.reload()
  }
}

export default function UpdateControls() {
  const [busy, setBusy] = useState(false)
  const [pull, setPull] = useState(0)        // current pull distance (px)
  const startY = useRef(null)
  const armed = useRef(false)                // touch started at scroll top

  // Strip the cache-buster param on arrival so the URL stays clean.
  useEffect(() => {
    try {
      const u = new URL(window.location.href)
      if (u.searchParams.has('_r')) {
        u.searchParams.delete('_r')
        window.history.replaceState({}, '', u.toString())
      }
    } catch { /* noop */ }
  }, [])

  const run = useCallback(async () => {
    if (busy) return
    setBusy(true)
    await forceRefresh()
    // forceRefresh reloads the page; if it somehow returns without reloading,
    // release the spinner so the control isn't stuck.
    setBusy(false)
  }, [busy])

  // Pull-to-refresh, scoped to top-of-page. Uses passive-safe touch handlers on
  // window: arm only when the document is scrolled to the very top, track
  // downward drag, fire on release past the threshold.
  useEffect(() => {
    const onStart = (e) => {
      if (window.scrollY > 0) { armed.current = false; return }
      armed.current = true
      startY.current = e.touches[0].clientY
    }
    const onMove = (e) => {
      if (!armed.current || startY.current == null) return
      const dy = e.touches[0].clientY - startY.current
      if (dy <= 0) { setPull(0); return }
      // Resist: scale the visual pull so it feels rubber-banded.
      setPull(Math.min(MAX_PULL, dy * 0.55))
    }
    const onEnd = () => {
      if (armed.current && pull >= TRIGGER_DISTANCE && !busy) run()
      armed.current = false
      startY.current = null
      setPull(0)
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [pull, busy, run])

  const pulling = pull > 0
  const ready = pull >= TRIGGER_DISTANCE

  return (
    <>
      {/* Keyframes for the spinner; injected once. */}
      <style>{'@keyframes ees-spin{to{transform:rotate(360deg)}}'}</style>

      {/* Pull-to-refresh indicator. Fixed at the top, revealed by drag. */}
      {(pulling || busy) && (
        <div style={{
          position: 'fixed', top: 'calc(env(safe-area-inset-top) + 56px)', left: 0, right: 0,
          display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8,
          height: 34, zIndex: 30, pointerEvents: 'none',
          color: ready || busy ? C.emeraldMid : C.textMuted,
          fontFamily: FONT, fontWeight: 700, fontSize: 12,
          opacity: busy ? 1 : Math.min(1, pull / TRIGGER_DISTANCE),
          transform: `translateY(${busy ? 0 : Math.min(pull, MAX_PULL) - 34}px)`,
          transition: pulling ? 'none' : 'transform 0.2s ease, opacity 0.2s ease',
        }}>
          <RefreshIcon spinning={busy} />
          {busy ? 'Updating…' : ready ? 'Release to update' : 'Pull to update'}
        </div>
      )}

      {/* Explicit control + resolving SHA, in the footer region. */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        marginTop: 16,
      }}>
        <button
          onClick={run}
          disabled={busy}
          style={{
            appearance: 'none', cursor: busy ? 'default' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: C.card, border: `1px solid ${C.border}`,
            color: busy ? C.textMuted : C.emeraldMid,
            fontFamily: FONT, fontWeight: 700, fontSize: 13,
            borderRadius: 8, padding: '9px 16px',
          }}
        >
          <RefreshIcon spinning={busy} />
          {busy ? 'Updating…' : 'Check for updates'}
        </button>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.textMuted }}>
          running {BUILD_SHA}
        </div>
      </div>
    </>
  )
}
