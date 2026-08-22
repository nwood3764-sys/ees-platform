// Fixture test for picking up a new build without asking the user to refresh.
//
// The rules: reload when the deployed build differs from the running one,
// NEVER over unsaved work, and never more than once per cooldown (a wedged
// deploy must not trap someone in a reload loop). Run with
//   node scripts/app-update-fixture.mjs

import {
  isNewerBuild, reloadDecision, holdAppReload, appReloadHolds, onHoldsCleared,
} from '../src/lib/appUpdate.js'

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

// ── Is there a new build? ───────────────────────────────────────────────────
check('a different sha is a new build', isNewerBuild('a151fbf', { sha: 'a164225' }), true)
check('the same sha is not', isNewerBuild('a151fbf', { sha: 'a151fbf' }), false)
check('a manifest with no sha is not a signal', isNewerBuild('a151fbf', { id: 'x' }), false)
check('a missing manifest is not a signal', isNewerBuild('a151fbf', null), false)
check('a non-string sha is not a signal', isNewerBuild('a151fbf', { sha: 42 }), false)
check('an unknown running build never triggers', isNewerBuild(null, { sha: 'a164225' }), false)
check('an empty running build never triggers', isNewerBuild('', { sha: 'a164225' }), false)

// ── Should we reload right now? ─────────────────────────────────────────────
const NOW = 1_700_000_000_000
check('no new build → nothing to do',
  reloadDecision({ newBuild: false, holds: 0, lastAttemptAt: 0, now: NOW }), 'none')
check('new build, nothing held → reload',
  reloadDecision({ newBuild: true, holds: 0, lastAttemptAt: 0, now: NOW }), 'reload')
check('new build while a record is being edited → defer, never discard the typing',
  reloadDecision({ newBuild: true, holds: 1, lastAttemptAt: 0, now: NOW }), 'defer')
check('holds win over an expired cooldown',
  reloadDecision({ newBuild: true, holds: 2, lastAttemptAt: NOW - 120_000, now: NOW }), 'defer')
check('a reload 10s ago → cooldown, do not loop',
  reloadDecision({ newBuild: true, holds: 0, lastAttemptAt: NOW - 10_000, now: NOW }), 'cooldown')
check('a reload 59s ago → still cooling down',
  reloadDecision({ newBuild: true, holds: 0, lastAttemptAt: NOW - 59_000, now: NOW }), 'cooldown')
check('a reload 61s ago → free to reload again',
  reloadDecision({ newBuild: true, holds: 0, lastAttemptAt: NOW - 61_000, now: NOW }), 'reload')

// ── Holds are balanced, and clearing them fires once ────────────────────────
check('no holds at rest', appReloadHolds(), 0)
{
  const releaseA = holdAppReload()
  const releaseB = holdAppReload()
  check('two holds counted', appReloadHolds(), 2)

  let cleared = 0
  const stop = onHoldsCleared(() => { cleared += 1 })

  releaseA()
  check('one release is not enough', appReloadHolds(), 1)
  check('the deferred reload has not fired', cleared, 0)

  releaseB()
  check('the last release clears the holds', appReloadHolds(), 0)
  check('the deferred reload fires exactly once', cleared, 1)

  releaseB()   // double-release must not underflow or re-fire
  check('a repeated release is a no-op', appReloadHolds(), 0)
  check('and does not re-fire the deferred reload', cleared, 1)

  stop()
  const releaseC = holdAppReload()
  releaseC()
  check('an unsubscribed listener stops hearing', cleared, 1)
  check('holds are back to zero', appReloadHolds(), 0)
}

console.log(failures === 0
  ? `app-update fixture: ${checks} checks passed`
  : `app-update fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
