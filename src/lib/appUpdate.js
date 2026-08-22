// ---------------------------------------------------------------------------
// appUpdate — the app picks up a new build by itself.
//
// A deploy changes every chunk filename (content hash). A tab that was open
// across the deploy still holds the old filenames, so the next lazy import
// 404s. Recovering from THAT is reactive: it only happens once the user walks
// into a broken chunk, and it costs them a visible interruption.
//
// So don't wait for the break. Every build writes its identity to
// /build-manifest.json; the running app compares that against the identity
// compiled into its own bundle, and when they differ it reloads itself. The
// user is never asked to refresh — they shouldn't have to know a deploy
// happened at all.
//
// Two rules keep that safe:
//   • Never reload over unsaved work. Anything holding a reload (a record
//     being edited, an open create form) defers it until the hold is released.
//   • Never loop. One reload per cooldown window, shared with the stale-chunk
//     recovery path in clientErrorLogger so the two can't double-fire.
//
// The decision logic is pure and fixture-tested (scripts/app-update-fixture.mjs);
// only startAutoUpdate touches the browser.
// ---------------------------------------------------------------------------

export const BUILD_MANIFEST_PATH = '/build-manifest.json'

// Shared with clientErrorLogger's stale-chunk recovery: whichever fires first
// claims the window, and the other stands down.
const RELOAD_GUARD_KEYS = ['leap.staleReload.attemptedAt', 'ees_stale_chunk_reloaded_at']
const RELOAD_COOLDOWN_MS = 60 * 1000

// ── Pure decisions ─────────────────────────────────────────────────────────

// Is the deployed build different from the one this tab is running?
// Compares the git sha, which is what actually changes the chunk names. A
// missing or malformed manifest means "can't tell" — never a reload.
export function isNewerBuild(runningSha, manifest) {
  if (!runningSha || typeof runningSha !== 'string') return false
  const deployed = manifest && typeof manifest.sha === 'string' ? manifest.sha : null
  if (!deployed) return false
  return deployed !== runningSha
}

// May we reload right now? Not while work is held, and not if this tab already
// reloaded inside the cooldown window (a wedged deploy must not trap the user
// in a loop).
export function reloadDecision({ newBuild, holds, lastAttemptAt, now }) {
  if (!newBuild) return 'none'
  if (holds > 0) return 'defer'
  if (lastAttemptAt && now - lastAttemptAt < RELOAD_COOLDOWN_MS) return 'cooldown'
  return 'reload'
}

// ── Reload holds ───────────────────────────────────────────────────────────
//
// Anything that would lose the user's typing takes a hold and releases it when
// it's done. Balanced by construction: holdAppReload returns its own release.

let holds = 0
const holdListeners = new Set()

export function holdAppReload() {
  holds += 1
  let released = false
  return function release() {
    if (released) return
    released = true
    holds = Math.max(0, holds - 1)
    if (holds === 0) for (const fn of holdListeners) fn()
  }
}

export function appReloadHolds() { return holds }
export function onHoldsCleared(fn) {
  holdListeners.add(fn)
  return () => holdListeners.delete(fn)
}

// ── Browser wiring ─────────────────────────────────────────────────────────

function readLastAttempt() {
  try {
    return RELOAD_GUARD_KEYS.reduce((max, k) => Math.max(max, Number(sessionStorage.getItem(k) || 0)), 0)
  } catch { return 0 }
}

function markAttempt(now) {
  try { for (const k of RELOAD_GUARD_KEYS) sessionStorage.setItem(k, String(now)) } catch { /* storage off */ }
}

async function fetchManifest() {
  const res = await fetch(`${BUILD_MANIFEST_PATH}?t=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) return null
  return res.json()
}

// Start watching for a new deploy. Returns a stop function.
//
// Checks on a slow timer, whenever the tab is brought back to the foreground,
// and when the network comes back — the moments a deploy is most likely to
// have landed since the last look. Failures are silent: a missed check just
// means we look again later.
export function startAutoUpdate({
  runningSha,
  intervalMs = 2 * 60 * 1000,
  fetchImpl = fetchManifest,
  reload = () => window.location.reload(),
  now = () => Date.now(),
} = {}) {
  if (!runningSha) return () => {}
  let stopped = false
  let pending = false

  const act = () => {
    if (stopped) return
    const decision = reloadDecision({
      newBuild: pending, holds, lastAttemptAt: readLastAttempt(), now: now(),
    })
    if (decision !== 'reload') return
    markAttempt(now())
    reload()
  }

  const check = async () => {
    if (stopped || pending) return
    try {
      const manifest = await fetchImpl()
      if (!isNewerBuild(runningSha, manifest)) return
      pending = true
      act()
    } catch { /* offline, blocked, mid-deploy — look again next time */ }
  }

  const onVisible = () => { if (document.visibilityState === 'visible') { check(); act() } }
  const timer = setInterval(check, intervalMs)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', check)
  const unsubscribe = onHoldsCleared(act)   // deferred reload lands the moment work is saved
  check()

  return () => {
    stopped = true
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', check)
    unsubscribe()
  }
}
