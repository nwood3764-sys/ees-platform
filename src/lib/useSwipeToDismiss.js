import { useRef, useState, useCallback, useEffect } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// useSwipeToDismiss
// ─────────────────────────────────────────────────────────────────────────────
// Touch gesture helper for mobile dismissible panels (bottom sheets, side
// drawers). Attach the returned handlers to the panel element; the hook
// tracks the touch delta in the requested direction, exposes a live
// transform offset for visual follow, and invokes onDismiss() once the user
// releases past the threshold or flicks quickly.
//
// Usage:
//   const { style, handlers } = useSwipeToDismiss({
//     direction: 'down',        // 'down' | 'left' | 'right'
//     onDismiss: () => close(),
//     threshold: 100,           // pixels past which a release dismisses
//     velocityThreshold: 0.6,   // px/ms — fast flicks dismiss even short-swipe
//   })
//   <div {...handlers} style={{ ...existingStyle, ...style }}>…</div>
//
// Notes:
//   - Guards against interactive touches: if the touch starts inside a
//     scrollable region that is not already scrolled to its limit in the
//     dismissal direction, we let the native scroll happen and skip the
//     gesture. This prevents the sheet from fighting with a scrolling list.
//   - `style.transform` is only set while dragging; on release the panel
//     either snaps back to 0 (auto-clearing the inline style) or unmounts
//     via onDismiss.
//   - Transition is applied while snapping back so the release feels smooth,
//     removed during drag so finger-follow is 1:1.
// ─────────────────────────────────────────────────────────────────────────────
export function useSwipeToDismiss({
  direction = 'down',
  onDismiss,
  threshold = 90,
  velocityThreshold = 0.55,
  enabled = true,
} = {}) {
  const start = useRef(null)
  const lastMove = useRef(null)
  const [offset, setOffset] = useState(0)
  const [snapping, setSnapping] = useState(false)

  const axis = direction === 'down' ? 'y' : 'x'
  const signedDirection = direction === 'down' || direction === 'right' ? 1 : -1

  // If the user starts swiping inside a scroll container whose scroll position
  // doesn't allow the dismissal direction (e.g. swipe-down inside a list that
  // isn't scrolled to the top), we defer to the native scroll instead of
  // hijacking the gesture.
  const canDismissFromEvent = (e) => {
    if (direction !== 'down') return true
    let el = e.target
    while (el && el !== e.currentTarget) {
      const overflowY = window.getComputedStyle(el).overflowY
      if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
        if (el.scrollTop > 0) return false
      }
      el = el.parentElement
    }
    return true
  }

  const onTouchStart = useCallback((e) => {
    if (!enabled) return
    if (e.touches.length !== 1) return
    if (!canDismissFromEvent(e)) return
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY, time: Date.now() }
    lastMove.current = { x: t.clientX, y: t.clientY, time: Date.now() }
    setSnapping(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, direction])

  const onTouchMove = useCallback((e) => {
    if (!enabled || !start.current) return
    const t = e.touches[0]
    const dx = t.clientX - start.current.x
    const dy = t.clientY - start.current.y
    const delta = axis === 'y' ? dy : dx
    // Only follow the finger if the gesture is in the dismissal direction
    const inDir = delta * signedDirection
    if (inDir < 0) { setOffset(0); return }
    // On the first genuine move, check that the gesture is primarily along
    // the dismissal axis — cross-axis dominance means the user is probably
    // scrolling or swiping between tabs.
    if (axis === 'y' && Math.abs(dx) > Math.abs(dy)) { setOffset(0); return }
    if (axis === 'x' && Math.abs(dy) > Math.abs(dx)) { setOffset(0); return }
    setOffset(inDir)
    lastMove.current = { x: t.clientX, y: t.clientY, time: Date.now() }
  }, [enabled, axis, signedDirection])

  const onTouchEnd = useCallback(() => {
    if (!enabled || !start.current) return
    const now = Date.now()
    const dt = now - (lastMove.current?.time || start.current.time)
    const velocity = dt > 0 ? offset / Math.max(dt, 1) : 0
    const shouldDismiss = offset >= threshold || velocity >= velocityThreshold
    start.current = null
    lastMove.current = null
    if (shouldDismiss) {
      // Keep the offset where it is — caller will unmount via onDismiss.
      onDismiss?.()
    } else {
      setSnapping(true)
      setOffset(0)
    }
  }, [enabled, offset, threshold, velocityThreshold, onDismiss])

  // Clear snapping flag once the transition finishes
  useEffect(() => {
    if (!snapping) return
    const t = setTimeout(() => setSnapping(false), 220)
    return () => clearTimeout(t)
  }, [snapping])

  const handlers = enabled
    ? { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd }
    : {}

  const transform =
    offset === 0 ? undefined :
    axis === 'y' ? `translateY(${offset * signedDirection}px)` :
                   `translateX(${offset * signedDirection}px)`

  const style = {
    transform,
    transition: snapping ? 'transform 200ms ease' : undefined,
    // Slight fade as the user drags further. Max fade capped at 0.4 loss.
    opacity: offset === 0 ? undefined : Math.max(0.6, 1 - offset / 400),
  }

  return { style, handlers, offset, isDragging: offset > 0 && !snapping }
}
