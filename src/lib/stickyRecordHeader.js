// The one definition of the record page's pinned header band.
//
// Nicholas, 2026-08-29, scrolled halfway down an incentive application: "when we
// scroll down on a page, we kind of lose everything. We don't really know where
// we're at. I need this section here to remain locked so the Save button and
// edit buttons are still available, but the user also knows where they're at."
//
// So the identity of the record (breadcrumb trail, object, record number, name,
// status) and its action buttons (Edit / Save / Actions) stay pinned to the top
// of the record's own scroll region, and the tab bar pins directly underneath
// them. Salesforce parity: its highlights panel sticks and CONDENSES — the full
// header card is the page's masthead at rest, and once you start scrolling it
// collapses to one line so the pinned band costs as little of the screen as it
// can while still answering "what am I looking at".
//
// Two rules this file exists to keep in one place:
//
//   1. The band paints an OPAQUE background. `background: undefined` is not an
//      error in React — the declaration is dropped and the band paints nothing,
//      so the record's fields scroll straight THROUGH the header and the two
//      sets of text are drawn on top of each other. That is the same defect the
//      pinned table headers hit (see src/lib/pinnedTableHeader.js), and
//      scripts/pinned-header-fixture.mjs fails the build on a sticky style whose
//      background is not an opaque colour.
//
//   2. Condensing is HYSTERETIC. Collapsing the header makes the content below
//      it shorter, and a single threshold sitting where the collapse happens
//      leaves the band flipping between its two heights on one scroll gesture.
//      Condense at CONDENSE_AT, expand again only back at EXPAND_AT, which is
//      lower — so there is no scroll position at which both are true.

import { C } from '../data/constants.js'

// Scroll depth (px, in the record's own scroll region) at which the header
// collapses to its one-line form, and the shallower depth at which it opens
// back up. EXPAND_AT < CONDENSE_AT is the hysteresis — never make them equal.
export const HEADER_CONDENSE_AT = 56
export const HEADER_EXPAND_AT = 16

// Should the header be condensed at this scroll depth, given what it is doing
// right now? Pure — the component holds the boolean, this decides the next one.
export function shouldCondenseHeader(scrollTop, wasCondensed) {
  const top = Number.isFinite(scrollTop) ? scrollTop : 0
  if (wasCondensed) return top > HEADER_EXPAND_AT
  return top >= HEADER_CONDENSE_AT
}

// The pinned band itself. It sits inside the scroll region, so it has to bleed
// back out over that region's padding — otherwise content scrolls up the left
// and right margins beside the band, and through the strip above it, which
// reads as a rendering fault.
//
// `top: -padY` is not a fudge. A sticky element's constraint rectangle is the
// scrollport INSET BY THE SCROLL CONTAINER'S PADDING, so `top: 0` inside a
// region padded 20px pins the band 20px down from the region's edge and leaves
// a 20px strip of record scrolling past above it. Measured in a real browser
// (tools/record-header-check), not reasoned about: the band read y=20 at every
// offset. Pulling the offset back by the same padding is what puts the band on
// the region's actual top edge — which is why padY belongs to this function and
// not to the caller's imagination.
export function stickyHeaderBandStyle({ padX = 24, padY = 20, condensed = false, zIndex = 30 } = {}) {
  return {
    position: 'sticky',
    top: -padY,
    zIndex,
    background: C.page,
    margin: `-${padY}px -${padX}px 0`,
    padding: `${condensed ? 10 : padY}px ${padX}px ${condensed ? 10 : 12}px`,
    // The band is only visibly a band once it is holding still over content.
    borderBottom: condensed ? `1px solid ${C.border}` : '1px solid transparent',
    boxShadow: condensed ? '0 6px 14px rgba(13,26,46,0.06)' : 'none',
    // Only the shadow animates. Animating the band's PADDING animates its
    // HEIGHT, and the tab bar pins at that measured height — mid-transition
    // frames left the tabs pinned 12px below where the band ends, with a strip
    // of the record scrolling through the gap (caught by
    // tools/record-header-check, invisible in the source).
    transition: 'box-shadow 200ms ease',
  }
}

// The tab bar, pinned directly under the band. `bandHeight` is the band's
// MEASURED height rather than a constant: it depends on how many breadcrumb
// crumbs wrapped and on whether the band is condensed, and a guessed offset
// leaves either a gap the content shows through or an overlap that hides the
// tabs. `padY` is subtracted for the same reason the band's own offset is
// negative — both offsets are measured from the padding edge, so both have to
// discount it or the tabs pin one padding lower than the band ends.
export function stickyTabBarStyle({ bandHeight = 0, padY = 20, gap = 16, zIndex = 20 } = {}) {
  return {
    position: 'sticky',
    top: Math.max(0, bandHeight - padY),
    zIndex,
    background: C.page,
    paddingBottom: gap,
  }
}
