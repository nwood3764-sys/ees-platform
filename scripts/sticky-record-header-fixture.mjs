// Fixture: the record page's pinned header band.
//
// Nicholas, 2026-08-29: "when we scroll down on a page, we kind of lose
// everything. We don't really know where we're at. I need this section here to
// remain locked so the Save button and edit buttons are still available, but the
// user also knows where they're at."
//
// Two things have to hold, and both of them are the kind that read fine in the
// source and fail on screen:
//
//   1. The band paints an OPAQUE background. `background: undefined` is dropped
//      silently by React and the record's fields then scroll straight THROUGH
//      the header — the same defect that took five attempts to kill in the
//      pinned table headers. (scripts/pinned-header-fixture.mjs enforces this
//      across every sticky style in src/; this suite checks the values this
//      module actually produces.)
//
//   2. Condensing is hysteretic. The band gets shorter when it condenses, which
//      moves the content under it; a single threshold at the collapse point
//      leaves the band flickering between its two heights on one scroll. There
//      must be no scroll position at which "condense" and "expand" are both
//      true, and once condensed it must stay condensed all the way down.
//
// Run with:  node scripts/sticky-record-header-fixture.mjs

import {
  HEADER_CONDENSE_AT, HEADER_EXPAND_AT,
  shouldCondenseHeader, stickyHeaderBandStyle, stickyTabBarStyle,
} from '../src/lib/stickyRecordHeader.js'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures += 1
    console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`)
  }
}

const OPAQUE_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

// ── Thresholds ──────────────────────────────────────────────────────────────
check('expand threshold sits below the condense threshold (this IS the hysteresis)',
  HEADER_EXPAND_AT < HEADER_CONDENSE_AT, true)

// ── Condensing ──────────────────────────────────────────────────────────────
check('at rest the header is full-size', shouldCondenseHeader(0, false), false)
check('a nudge does not collapse the header', shouldCondenseHeader(10, false), false)
check('just short of the threshold, still full-size',
  shouldCondenseHeader(HEADER_CONDENSE_AT - 1, false), false)
check('at the threshold it condenses', shouldCondenseHeader(HEADER_CONDENSE_AT, false), true)
check('deep in the record it stays condensed', shouldCondenseHeader(4000, true), true)

// The band losing ~46px of height moves the content up by the same amount. If
// the expand rule used the condense threshold, that shift alone could re-expand
// the band, which re-lengthens the content, which re-condenses it: the flicker.
check('the height the band gives back does not re-expand it',
  shouldCondenseHeader(HEADER_CONDENSE_AT - 20, true), true)
check('scrolling back to near the top expands it again',
  shouldCondenseHeader(HEADER_EXPAND_AT, true), false)
check('scrolling back to the very top expands it', shouldCondenseHeader(0, true), false)

// No scroll position may satisfy both rules — that is what "no flicker" means.
let ambiguous = []
for (let top = 0; top <= 400; top += 1) {
  if (shouldCondenseHeader(top, false) === true && shouldCondenseHeader(top, true) === false) {
    ambiguous.push(top)
  }
}
check('no scroll position both condenses and expands', ambiguous, [])

// Once condensed, it stays condensed for every deeper position — a band that
// popped back open halfway down the record would be worse than none.
let reopened = []
for (let top = HEADER_CONDENSE_AT; top <= 5000; top += 37) {
  if (shouldCondenseHeader(top, true) !== true) reopened.push(top)
}
check('condensed never re-opens further down the record', reopened, [])

// Junk in, sane out: a scroll container that has not been measured yet reports
// undefined, and the header must render full-size rather than throw.
check('undefined scrollTop reads as the top of the page',
  shouldCondenseHeader(undefined, false), false)
check('NaN scrollTop reads as the top of the page', shouldCondenseHeader(NaN, true), false)

// ── The band's own style ────────────────────────────────────────────────────
const band = stickyHeaderBandStyle({ padX: 24, padY: 20, condensed: false })
check('band is sticky', band.position, 'sticky')
// A sticky offset is measured from the scroll container's PADDING edge, so a
// band inside a region padded 20px and offset `top: 0` pins 20px down and lets
// a strip of the record scroll past above it. Measured in a real browser
// (tools/record-header-check) — the offset discounts the padding.
check('band pins to the scroll region edge, not to its padding edge', band.top, -20)
check('a differently padded region moves the offset with it',
  stickyHeaderBandStyle({ padY: 12 }).top, -12)
check('band paints an opaque colour, not a token that evaluates to nothing',
  OPAQUE_HEX.test(String(band.background)), true)
// The band lives INSIDE the padded scroll region, so it has to bleed back out
// over that padding — otherwise content scrolls up the margins beside it.
check('band bleeds over the scroll region padding', band.margin, '-20px -24px 0')
check('band restores that padding inside itself', band.padding.startsWith('20px 24px'), true)

const condensedBand = stickyHeaderBandStyle({ padX: 24, padY: 20, condensed: true })
check('condensed band is still opaque', OPAQUE_HEX.test(String(condensedBand.background)), true)
check('condensed band is shorter than the resting band',
  parseInt(condensedBand.padding, 10) < parseInt(band.padding, 10), true)
check('condensed band shows its edge', condensedBand.borderBottom.startsWith('1px solid #'), true)
check('resting band shows no edge', band.boxShadow, 'none')

// ── The tab bar under it ────────────────────────────────────────────────────
const tabs = stickyTabBarStyle({ bandHeight: 118, padY: 20, gap: 16 })
check('tab bar is sticky', tabs.position, 'sticky')
// The tabs land exactly where the band ends: both offsets discount the same
// padding, so the two pin flush and no strip of record shows between them.
check('tab bar pins where the measured band ends', tabs.top, 98)
check('tab bar paints an opaque colour', OPAQUE_HEX.test(String(tabs.background)), true)
check('tab bar keeps the gap below it', tabs.paddingBottom, 16)
// A band that has not been measured yet must not park the tabs above the top of
// the region, where they would cover the header instead of following it.
check('an unmeasured band pins the tabs at the top', stickyTabBarStyle({}).top, 0)
check('a band shorter than the padding never pins the tabs negatively',
  stickyTabBarStyle({ bandHeight: 4, padY: 20 }).top, 0)

console.log(`${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
