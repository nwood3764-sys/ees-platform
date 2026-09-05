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
//   2. Condensing is HYSTERETIC, and the hysteresis has to be WIDER THAN THE
//      HEIGHT THE BAND GIVES BACK. This is the part that was wrong from
//      2026-08-29 until 2026-09-05, and it is worth stating precisely because
//      the original constants read as if they had it covered.
//
//      The band is in the flow at the top of the scroll region, so collapsing
//      it removes its lost height from the content ABOVE the viewport. The
//      browser's scroll anchoring then keeps what you are looking at still by
//      SUBTRACTING that same height from scrollTop. So the band's own collapse
//      moves the very number that decided to collapse it.
//
//      Measured in Chromium on the real record page (tools/record-header-flicker-check):
//      the band is 226px expanded and 91px condensed, so collapsing it hands
//      back 135px — while the old window between condensing (56) and expanding
//      (16) was 40px. One wheel-click down from the top read:
//
//          0/226  ->  70/226  ->  0/91  ->  0/226  ->  70/226  ->  ...
//
//      condense at 70, anchoring drags scrollTop to 0, 0 is below the expand
//      threshold so it re-expands, which puts scrollTop back over the condense
//      threshold. Each state is the other's trigger, the record cannot be
//      scrolled past its own header, and the band strobes (Nicholas,
//      2026-09-05: "the whole header is just flickering like crazy").
//
//      So the condense threshold is DERIVED from the band's measured expanded
//      height rather than being a constant somebody picked. Condense only once
//      the record has scrolled further than the header's whole height: collapse
//      then leaves scrollTop at (condensed height + margin), which is still
//      above the expand threshold, and re-expanding leaves it below the
//      condense threshold. There is no fixed point, at any band height, so the
//      loop is not merely unlikely — it cannot be constructed.

import { C } from '../data/constants.js'

// The shallow depth at which the header opens back up. Deliberately small: at
// the top of a record the masthead is the point.
export const HEADER_EXPAND_AT = 16

// Slack either side of the derived threshold, so a sub-pixel measurement or a
// fractional scroll offset cannot land exactly on a boundary.
export const HEADER_CONDENSE_MARGIN = 24

// The floor for the derived threshold — used until the band has been measured,
// and for a band so short that collapsing it costs nothing.
export const HEADER_CONDENSE_FLOOR = 56

/**
 * How far the record must scroll before the header collapses, given the band's
 * MEASURED expanded height.
 *
 * The band gives back at most its whole expanded height when it condenses (it
 * cannot give back more, since the condensed band is never shorter than
 * nothing). Setting the threshold above that height guarantees the scroll
 * position left behind by the collapse is still deeper than HEADER_EXPAND_AT —
 * which is the whole safety property. Never replace this with a constant.
 */
export function condenseThreshold(expandedBandHeight) {
  const h = Number.isFinite(expandedBandHeight) && expandedBandHeight > 0 ? expandedBandHeight : 0
  return Math.max(HEADER_CONDENSE_FLOOR, HEADER_EXPAND_AT + h + HEADER_CONDENSE_MARGIN)
}

/**
 * Should the header be condensed at this scroll depth, given what it is doing
 * right now? Pure — the component holds the boolean, this decides the next one.
 *
 * `condenseAt` comes from condenseThreshold() with the band's measured height.
 * It defaults to the floor so an unmeasured band still behaves.
 */
export function shouldCondenseHeader(scrollTop, wasCondensed, condenseAt = HEADER_CONDENSE_FLOOR) {
  const top = Number.isFinite(scrollTop) ? scrollTop : 0
  const at = Number.isFinite(condenseAt)
    ? Math.max(condenseAt, HEADER_EXPAND_AT + 1)
    : HEADER_CONDENSE_FLOOR
  if (wasCondensed) return top > HEADER_EXPAND_AT
  return top >= at
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
