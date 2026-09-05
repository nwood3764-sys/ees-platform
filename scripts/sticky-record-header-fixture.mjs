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
//   2. Condensing is hysteretic AND the hysteresis is wider than the height the
//      band gives back. Collapsing the band removes its lost height from the
//      content above the viewport, and scroll anchoring takes the same amount
//      off scrollTop — so the collapse moves the number that decided it. A
//      state machine checked on its own, at a fixed scroll position, cannot see
//      that: this suite therefore SIMULATES the feedback, stepping the scroll
//      position by the height the band just gave back and requiring the state
//      to settle. Checking the two thresholds against each other is what passed
//      while the real header strobed (Nicholas, 2026-09-05).
//
// Run with:  node scripts/sticky-record-header-fixture.mjs

import {
  HEADER_EXPAND_AT, HEADER_CONDENSE_FLOOR, HEADER_CONDENSE_MARGIN,
  condenseThreshold, shouldCondenseHeader, stickyHeaderBandStyle, stickyTabBarStyle,
} from '../src/lib/stickyRecordHeader.js'

// The band heights measured in Chromium on the real record page
// (tools/record-header-flicker-check, 2026-09-05).
const MEASURED_EXPANDED = 226
const MEASURED_CONDENSED = 91
const HEADER_CONDENSE_AT = condenseThreshold(MEASURED_EXPANDED)

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
// The safety property, stated directly: the window between the two thresholds
// has to be wider than the height the band gives back when it collapses.
check('the hysteresis window is wider than the height the band gives back',
  HEADER_CONDENSE_AT - HEADER_EXPAND_AT > MEASURED_EXPANDED - MEASURED_CONDENSED, true)
check('an unmeasured band still gets a usable threshold',
  condenseThreshold(0), HEADER_CONDENSE_FLOOR)
check('a NaN measurement does not produce a NaN threshold',
  condenseThreshold(NaN), HEADER_CONDENSE_FLOOR)
check('a taller band (a wrapped breadcrumb trail) pushes the threshold out with it',
  condenseThreshold(300) > condenseThreshold(226), true)
check('the threshold is derived from the measurement, not a constant',
  condenseThreshold(MEASURED_EXPANDED), HEADER_EXPAND_AT + MEASURED_EXPANDED + HEADER_CONDENSE_MARGIN)

// ── Condensing ──────────────────────────────────────────────────────────────
check('at rest the header is full-size', shouldCondenseHeader(0, false, HEADER_CONDENSE_AT), false)
check('a nudge does not collapse the header', shouldCondenseHeader(10, false, HEADER_CONDENSE_AT), false)
check('just short of the threshold, still full-size',
  shouldCondenseHeader(HEADER_CONDENSE_AT - 1, false, HEADER_CONDENSE_AT), false)
check('at the threshold it condenses', shouldCondenseHeader(HEADER_CONDENSE_AT, false, HEADER_CONDENSE_AT), true)
check('deep in the record it stays condensed', shouldCondenseHeader(4000, true, HEADER_CONDENSE_AT), true)

// The band losing its height moves the content up by the same amount. If
// the expand rule used the condense threshold, that shift alone could re-expand
// the band, which re-lengthens the content, which re-condenses it: the flicker.
check('the height the band gives back does not re-expand it',
  shouldCondenseHeader(HEADER_CONDENSE_AT - 20, true, HEADER_CONDENSE_AT), true)
check('scrolling back to near the top expands it again',
  shouldCondenseHeader(HEADER_EXPAND_AT, true, HEADER_CONDENSE_AT), false)
check('scrolling back to the very top expands it', shouldCondenseHeader(0, true, HEADER_CONDENSE_AT), false)

// No scroll position may satisfy both rules — that is what "no flicker" means.
let ambiguous = []
for (let top = 0; top <= 600; top += 1) {
  if (shouldCondenseHeader(top, false, HEADER_CONDENSE_AT) === true
    && shouldCondenseHeader(top, true, HEADER_CONDENSE_AT) === false) {
    ambiguous.push(top)
  }
}
check('no scroll position both condenses and expands', ambiguous, [])

// ── The feedback the old rule could not see ────────────────────────────────
// Collapsing the band removes (expanded - condensed) px of content from above
// the viewport, and the browser subtracts the same from scrollTop to hold the
// view still; re-expanding adds it back. Settle the loop from every starting
// offset and require it to stop. This is the check that fails on the pre-fix
// constants, and it is the whole point of the suite.
function settle(startTop, condenseAt, expanded, condensed, startCondensed = false) {
  const delta = expanded - condensed
  let top = startTop
  let state = startCondensed
  const seen = []
  for (let i = 0; i < 50; i += 1) {
    const next = shouldCondenseHeader(top, state, condenseAt)
    if (next === state) return { settled: true, state, top, steps: i }
    // The collapse/expand actually happens: scroll anchoring moves scrollTop by
    // the height that just left or joined the flow, clamped at the top.
    top = Math.max(0, top + (next ? -delta : delta))
    state = next
    seen.push(`${Math.round(top)}/${next ? condensed : expanded}`)
  }
  return { settled: false, state, top, trace: seen.slice(0, 8).join(' ') }
}

const unsettled = []
for (let top = 0; top <= 3000; top += 1) {
  for (const from of [false, true]) {
    const r = settle(top, HEADER_CONDENSE_AT, MEASURED_EXPANDED, MEASURED_CONDENSED, from)
    if (!r.settled) unsettled.push(`${top}${from ? ' (condensed)' : ''}: ${r.trace}`)
  }
}
check('the header settles from every scroll position instead of strobing',
  unsettled.slice(0, 3), [])

// POSITIVE CONTROL — the thresholds this shipped with on 2026-08-29 (condense
// at 56, expand at 16) MUST still strobe under the same simulation. If this
// control ever settles, the simulation is not modelling the defect and the
// result above is worthless.
const controlUnsettled = []
for (let top = 0; top <= 3000; top += 1) {
  const r = settle(top, 56, MEASURED_EXPANDED, MEASURED_CONDENSED, false)
  if (!r.settled) controlUnsettled.push(top)
}
check('POSITIVE CONTROL — the pre-fix thresholds DO strobe under this simulation',
  controlUnsettled.length > 0, true)

// And the loop has to survive a band of any height, not just the one measured
// on an incentive application: a shorter record name or a wrapped breadcrumb
// changes it, and the threshold is derived precisely so that still holds.
const badHeights = []
for (const expanded of [80, 120, 180, 226, 300, 420]) {
  for (const condensed of [24, 48, 91, 120]) {
    if (condensed > expanded) continue
    const at = condenseThreshold(expanded)
    for (let top = 0; top <= 1200; top += 7) {
      if (!settle(top, at, expanded, condensed, false).settled
        || !settle(top, at, expanded, condensed, true).settled) {
        badHeights.push(`${expanded}/${condensed} @ ${top}`)
      }
    }
  }
}
check('it settles at every band height, not only the one that was measured',
  badHeights.slice(0, 3), [])

// Once condensed, it stays condensed for every deeper position — a band that
// popped back open halfway down the record would be worse than none.
let reopened = []
for (let top = HEADER_CONDENSE_AT; top <= 5000; top += 37) {
  if (shouldCondenseHeader(top, true, HEADER_CONDENSE_AT) !== true) reopened.push(top)
}
check('condensed never re-opens further down the record', reopened, [])

// Junk in, sane out: a scroll container that has not been measured yet reports
// undefined, and the header must render full-size rather than throw.
check('undefined scrollTop reads as the top of the page',
  shouldCondenseHeader(undefined, false, HEADER_CONDENSE_AT), false)
check('NaN scrollTop reads as the top of the page', shouldCondenseHeader(NaN, true, HEADER_CONDENSE_AT), false)

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
