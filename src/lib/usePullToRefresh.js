import { useRef, useState, useCallback } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// usePullToRefresh
// ─────────────────────────────────────────────────────────────────────────────
// Gesture hook for pull-to-refresh on a scrollable mobile container. Returns
// touch handlers to attach to the scroll container, plus the current pull
// distance (for rendering the indicator) and a boolean indicating whether a
// refresh is currently in flight.
//
// Usage:
//   const { handlers, pullDistance, refreshing } = usePullToRefresh({
//     onRefresh: async () => { await fetchFreshData() },
//     threshold: 70,
//   })
//   <div {...handlers} style={{ overflowY: 'auto' }}>
//     {pullDistance > 0 && <div style={{ height: pullDistance }}>…</div>}
//     ... content ...
//   </div>
//
// Behavior:
//   - Pull starts only when the container is scrolled to the top AND the
//     gesture is primarily vertical (dy > dx). This prevents the hook from
//     triggering mid-scroll or when the user is swiping horizontally
//     through tabs.
//   - The pull distance uses a rubber-band easing so longer pulls feel
//     weighty rather than linear.
//   - Released past threshold → onRefresh() runs while the indicator stays
//     visible at ~threshold until the promise resolves.
//   - Released short of threshold → distance snaps back to 0.
// ─────────────────────────────────────────────────────────────────────────────
export function usePullToRefresh({ onRefresh, threshold = 70, maxPull = 120, enabled = true } = {}) {
  const start = useRef(null)
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const isAtTop = (el) => el.scrollTop <= 0

  const onTouchStart = useCallback((e) => {
    if (!enabled || refreshing) return
    if (e.touches.length !== 1) return
    if (!isAtTop(e.currentTarget)) return
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY }
  }, [enabled, refreshing])

  const onTouchMove = useCallback((e) => {
    if (!start.current || refreshing) return
    const t = e.touches[0]
    const dx = t.clientX - start.current.x
    const dy = t.clientY - start.current.y
    // Only engage on a downward, primarily-vertical pull
    if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { setPullDistance(0); return }
    if (!isAtTop(e.currentTarget)) { setPullDistance(0); return }
    // Rubber-band easing: dy^0.8 so pulls decelerate
    const eased = Math.min(maxPull, Math.pow(dy, 0.85))
    setPullDistance(eased)
  }, [refreshing, maxPull])

  const onTouchEnd = useCallback(async () => {
    const dist = pullDistance
    start.current = null
    if (dist >= threshold && onRefresh) {
      setRefreshing(true)
      setPullDistance(threshold)
      try {
        await onRefresh()
      } finally {
        setRefreshing(false)
        setPullDistance(0)
      }
    } else {
      setPullDistance(0)
    }
  }, [pullDistance, threshold, onRefresh])

  const handlers = enabled
    ? { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd }
    : {}

  return { handlers, pullDistance, refreshing, threshold }
}
