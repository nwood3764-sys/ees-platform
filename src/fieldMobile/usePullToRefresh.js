// ─── usePullToRefresh.js ─────────────────────────────────────────────────────
// Reusable pull-to-refresh for the technician PWA's data screens (Home,
// Schedule). Unlike the service-worker "check for updates" flow (which reloads
// the page), this re-runs a data fetch in place — the gesture a technician
// expects when they want fresh stops without leaving the screen.
//
// The field app scrolls inside FieldMobileRoot's container, not the window, so
// the gesture arms off the nearest scrollable ancestor's scrollTop (passed via
// scrollElRef), falling back to window scroll. Touch handlers are passive; the
// visual pull is rubber-banded and clamped.
//
// Returns { pull, ready, refreshing, indicator } — spread `indicator` props
// onto a PullIndicator, and the hook wires its own window touch listeners.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react'

const TRIGGER_DISTANCE = 70
const MAX_PULL = 110

export function usePullToRefresh(onRefresh, { scrollElRef = null } = {}) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef(null)
  const armed = useRef(false)

  const run = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try { await onRefresh?.() } finally { setRefreshing(false) }
  }, [onRefresh, refreshing])

  useEffect(() => {
    const atTop = () => {
      const el = scrollElRef?.current
      if (el) return el.scrollTop <= 0
      return window.scrollY <= 0
    }
    const onStart = (e) => {
      if (!atTop()) { armed.current = false; return }
      armed.current = true
      startY.current = e.touches[0].clientY
    }
    const onMove = (e) => {
      if (!armed.current || startY.current == null) return
      const dy = e.touches[0].clientY - startY.current
      if (dy <= 0) { setPull(0); return }
      setPull(Math.min(MAX_PULL, dy * 0.55))
    }
    const onEnd = () => {
      if (armed.current && pull >= TRIGGER_DISTANCE && !refreshing) run()
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
  }, [pull, refreshing, run, scrollElRef])

  return {
    pull,
    ready: pull >= TRIGGER_DISTANCE,
    refreshing,
    triggerDistance: TRIGGER_DISTANCE,
    maxPull: MAX_PULL,
  }
}
