import { useEffect } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// useInputFocusScroll
// ─────────────────────────────────────────────────────────────────────────────
// iOS Safari's behavior with on-screen keyboards is inconsistent: when an
// input focuses, the browser may or may not scroll it into view, and when
// it does, it often leaves the input flush against the top of the keyboard
// or hidden under sticky headers.
//
// This hook attaches a global focus listener that, on touch-capable devices,
// detects newly-focused form fields and waits a tick for the visual viewport
// to resize, then issues a scrollIntoView with 'nearest' block alignment.
// Combined with CSS scroll-margin-top/bottom on focused inputs (set in
// index.css), this produces a clean "bring the field into view with air
// above and below" behavior.
//
// Mount once at the app root.
// ─────────────────────────────────────────────────────────────────────────────
export function useInputFocusScroll() {
  useEffect(() => {
    // No-op on non-touch devices (desktop doesn't have this problem)
    if (typeof window === 'undefined') return
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (!isTouch) return

    const handler = (e) => {
      const el = e.target
      if (!el) return
      const tag = el.tagName
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return
      // Skip hidden inputs and checkbox-style controls that don't open a keyboard
      const type = (el.type || '').toLowerCase()
      if (type === 'checkbox' || type === 'radio' || type === 'hidden' || type === 'button' || type === 'submit') return

      // Wait for the visual viewport to settle after the keyboard opens.
      // 300ms is empirically enough on modern iOS; shorter delays sometimes
      // fire before the keyboard slide-up animation completes.
      setTimeout(() => {
        // Only scroll if the element is still focused and in the DOM
        if (document.activeElement !== el) return
        try {
          el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
        } catch {
          // Older Safari doesn't like behavior:'smooth' with scrollIntoView
          el.scrollIntoView()
        }
      }, 300)
    }

    document.addEventListener('focusin', handler)
    return () => document.removeEventListener('focusin', handler)
  }, [])
}
