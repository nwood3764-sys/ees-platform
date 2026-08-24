// Fixture test for automatic photo rendering.
//
// The behaviour (Nicholas, 2026-08-24): "why don't you just correct anything
// that's wrong?" — a photo with no preview is repaired by the card on load,
// with no button. What's pinned here is the bookkeeping that makes running it
// automatically safe, because the failure modes are a runaway loop and a
// double decode, neither of which is visible in a screenshot.
//
// Run with:  node scripts/photo-repair-queue-fixture.mjs

import {
  needsRendering,
  selectRepairTargets,
  unrepairableIds,
  markAttempted,
  markFailed,
  allowRetry,
  withRepairLock,
  resetRepairQueue,
} from '../src/lib/photoRepairQueue.js'

let checks = 0
let failures = 0
function check(label, actual, expected) {
  checks++
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures++
    console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`)
  }
}

resetRepairQueue()

// ── What counts as needing work ────────────────────────────────────────────
check('a photo with no display URL but an original needs rendering',
  needsRendering({ id: 'a', storage_path_original: 'x.heic' }), true)
check('a rendered photo does not',
  needsRendering({ id: 'b', _thumbUrl: 'https://…', storage_path_original: 'x.jpg' }), false)
// A row with no original is a broken record, not a rendering job — re-decoding
// it every load would spin forever on nothing.
check('a photo with no original in storage is not a rendering job',
  needsRendering({ id: 'c' }), false)

// ── One attempt per photo per page session ─────────────────────────────────
// This is the guard that matters most: a pass ends by refreshing the card,
// which re-runs the selection. Without it, an undecodable file is decoded on
// every refresh, forever.
const photos = [
  { id: 'p1', storage_path_original: '1.heic' },
  { id: 'p2', storage_path_original: '2.heic' },
  { id: 'p3', _thumbUrl: 'https://…', storage_path_original: '3.jpg' },
]
check('the first pass takes every unrendered photo',
  selectRepairTargets(photos).map(p => p.id), ['p1', 'p2'])
markAttempted(['p1', 'p2'])
check('the refresh that follows a pass selects nothing',
  selectRepairTargets(photos).map(p => p.id), [])

// A photo that arrives later is still picked up — the guard is per photo, not
// a one-shot for the whole card.
const withNew = [...photos, { id: 'p4', storage_path_original: '4.heic' }]
check('a newly arrived unrendered photo is still taken',
  selectRepairTargets(withNew).map(p => p.id), ['p4'])

// ── Only genuine failures are ever surfaced ────────────────────────────────
check('nothing is reported as stuck before anything fails',
  unrepairableIds(photos), [])
markFailed(['p1'])
check('a photo that failed its pass is reported as stuck',
  unrepairableIds(photos), ['p1'])
check('a photo still rendering is not reported as stuck',
  unrepairableIds([{ id: 'p2', storage_path_original: '2.heic' }]), [])
// Once it renders it drops off, even though the failure is still recorded.
check('a stuck photo that later rendered is no longer stuck',
  unrepairableIds([{ id: 'p1', _thumbUrl: 'https://…', storage_path_original: '1.heic' }]), [])

// ── An explicit retry is not the loop the guard prevents ───────────────────
allowRetry(['p1'])
check('retry clears the attempt so the automatic pass takes it again',
  selectRepairTargets(photos).map(p => p.id), ['p1'])
check('retry also clears the stuck record', unrepairableIds(photos), [])

// ── One pass at a time, process-wide ───────────────────────────────────────
// A work order shows photos at the step grain and the order grain, in two
// cards, over the same files. Both mount at once.
resetRepairQueue()
let running = 0
let maxConcurrent = 0
const pass = () => withRepairLock(async () => {
  running++
  maxConcurrent = Math.max(maxConcurrent, running)
  await new Promise(r => setTimeout(r, 10))
  running--
  return 'done'
})
const [first, second] = await Promise.all([pass(), pass()])
check('two cards starting at once never decode in parallel', maxConcurrent, 1)
check('the card that got the lock runs', first, 'done')
check('the card that did not is told so, rather than duplicating the work', second, null)
check('the lock is released for the next pass', await pass(), 'done')

// A throw must not strand the lock, or every later pass is skipped silently.
resetRepairQueue()
try { await withRepairLock(async () => { throw new Error('decode died') }) } catch { /* expected */ }
check('a pass that throws still releases the lock', await pass(), 'done')

if (failures > 0) {
  console.error(`\nphoto-repair-queue fixture: ${failures} of ${checks} checks FAILED`)
  process.exit(1)
}
console.log(`photo-repair-queue fixture: ${checks} checks passed`)
