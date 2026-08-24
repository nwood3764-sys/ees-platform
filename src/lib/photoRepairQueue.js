// ---------------------------------------------------------------------------
// photoRepairQueue — which unrendered photos this tab should render, and how
// often it may try.
//
// A HEIC uploaded before device-side renditions existed has no displayable
// image. The card repairs those itself, on load, with nobody pressing anything
// (Nicholas, 2026-08-24: "why don't you just correct anything that's wrong?" —
// the same standing rule as never asking him to hard-refresh: a manual step is
// the app making the user do its job).
//
// Doing that safely needs two pieces of bookkeeping, and they are the reason
// this is a module rather than a line of code in the component:
//
//   attempted   a photo is tried ONCE per page session. Repair ends in a
//               refresh, which re-renders the card, which would otherwise
//               start the same repair again — an infinite loop over a file
//               that cannot be decoded at all.
//   in flight   two Photos cards on one record (a work order shows photos at
//               the step grain and the order grain) must not decode the same
//               photo twice, so passes are serialized process-wide.
//
// The registries are module-level and deliberately NOT persisted: a reload is
// a legitimate "try again", because the failure may have been a spent signed
// URL, a dropped connection, or a tab that ran out of memory.
// ---------------------------------------------------------------------------

const attempted = new Set()
const failed = new Set()
let inFlight = null

/**
 * A photo needs rendering when it has an original in storage but nothing that
 * a browser can paint. `_thumbUrl` is the resolved display URL — null is
 * exactly the state that used to render as a broken tile.
 */
export function needsRendering(photo) {
  return !!photo && !photo._thumbUrl && !!photo.storage_path_original
}

/**
 * The photos this pass should attempt: unrendered, and not already tried in
 * this page session.
 *
 * `alreadyAttempted` is injectable so the rule can be tested without touching
 * module state; the component calls it with no second argument.
 */
export function selectRepairTargets(photos, alreadyAttempted = attempted) {
  return (photos || []).filter(
    p => needsRendering(p) && !alreadyAttempted.has(p.id)
  )
}

/** Photos this session tried and could not render — the only ones a person is ever asked about. */
export function unrepairableIds(photos) {
  return (photos || []).filter(p => needsRendering(p) && failed.has(p.id)).map(p => p.id)
}

export function markAttempted(ids) {
  for (const id of ids || []) attempted.add(id)
}

export function markFailed(ids) {
  for (const id of ids || []) failed.add(id)
}

/**
 * Clear the attempt record for specific photos so they may be tried again.
 * This is what the Retry affordance calls — a person explicitly asking for
 * another pass is not the loop the `attempted` set exists to prevent.
 */
export function allowRetry(ids) {
  for (const id of ids || []) {
    attempted.delete(id)
    failed.delete(id)
  }
}

/**
 * Run `task` only if no other repair pass is running anywhere in the app.
 * Returns the task's result, or null if a pass was already under way — the
 * caller skips silently, because the other pass is doing the same work.
 */
export async function withRepairLock(task) {
  if (inFlight) return null
  let release
  inFlight = new Promise(resolve => { release = resolve })
  try {
    return await task()
  } finally {
    release()
    inFlight = null
  }
}

/** Test seam — drops all bookkeeping. */
export function resetRepairQueue() {
  attempted.clear()
  failed.clear()
  inFlight = null
}
