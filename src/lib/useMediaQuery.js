import { useState, useEffect } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// useMediaQuery / useIsMobile
// ─────────────────────────────────────────────────────────────────────────────
// Shared hook for responsive behavior. Components should prefer this over
// rolling their own `window.innerWidth` effect so the mobile breakpoint is
// defined in exactly one place.
//
// Breakpoint matches the project design system:
//   - Mobile: ≤ 768px  → hamburger drawer, card lists, stacked forms
//   - Tablet: ≤ 900px  → grids collapse (handled case-by-case inline)
//   - Desktop: > 768px → full layout
// ─────────────────────────────────────────────────────────────────────────────

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(query)
    const handler = (e) => setMatches(e.matches)
    // addEventListener is preferred; fall back to addListener for older Safari
    if (mql.addEventListener) mql.addEventListener('change', handler)
    else mql.addListener(handler)
    // Ensure state is fresh after mount (handles SSR / stale initial match)
    setMatches(mql.matches)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler)
      else mql.removeListener(handler)
    }
  }, [query])

  return matches
}

export function useIsMobile() {
  return useMediaQuery('(max-width: 768px)')
}

export function useIsTablet() {
  return useMediaQuery('(max-width: 900px)')
}
