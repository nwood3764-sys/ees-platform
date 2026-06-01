import { useEffect, useState, useRef, useCallback } from 'react'

// ─── useCachedFetch ─────────────────────────────────────────────────────
// In-memory cache + request deduplication + stale-while-revalidate.
//
// The problem this solves:
//   Every module today calls its fetchers on mount, even if the user
//   never looks at the data. Switching modules and back re-fires all
//   the same network requests. On a 6,800-row table that means
//   3+ seconds of latency for navigation alone, repeated every time.
//
// What this does:
//   • Module-level cache survives component unmounts. Switching away
//     from Outreach and back returns the previously-loaded data
//     synchronously — no network round trip.
//   • Concurrent subscribers share one in-flight promise. If Section A
//     and Section B both call `useCachedFetch('properties', ...)` on the
//     same mount, only one fetch fires.
//   • Stale-while-revalidate: when a cached entry is older than `ttl`
//     ms (default 5 min) subscribers get the stale value immediately
//     and a background refresh kicks off. They re-render when the
//     fresh value lands.
//   • Manual `refresh()` (force-revalidate now) and `invalidate(key)`
//     (drop from cache; next read goes to network) for write paths.
//
// What this is NOT:
//   • Not a query language. Caller still writes their fetcher.
//   • Not persistent. Cache is cleared on page reload by design —
//     localStorage would race against real DB writes and we'd ship
//     stale data forever. The 30-second initial load on cold reload
//     is fine; the 0ms warm load is what makes the app feel alive.
//   • Not optimistic. If your fetcher does a write, call invalidate()
//     after, then re-render. Don't try to mutate the cached entry.
//
// Key choice matters:
//   The key string is the cache identity. Two different fetchers that
//   produce the same shape but different data must use different keys
//   (e.g. 'outreach:properties' vs 'prospecting:properties'). Same
//   data fetched from two call sites SHOULD use the same key — that's
//   how dedup wins.
// ─────────────────────────────────────────────────────────────────────────

// Module-level state. Outlives every component.
const cache       = new Map() // key -> { data, error, fetchedAt }
const inflight    = new Map() // key -> Promise (dedups concurrent fetches)
const subscribers = new Map() // key -> Set<callback>

function notify(key) {
  const subs = subscribers.get(key)
  if (!subs) return
  for (const cb of subs) cb()
}

async function runFetch(key, fetcher) {
  // If someone else is already fetching this key, await their promise.
  if (inflight.has(key)) return inflight.get(key)

  const p = (async () => {
    try {
      const data = await fetcher()
      cache.set(key, { data, error: null, fetchedAt: Date.now() })
    } catch (err) {
      // A failed *background* refresh must not destroy data we already
      // have — otherwise a transient error on revalidate makes a list
      // that just rendered go empty ("records appear then disappear").
      // Keep the last good data and attach the error; only store a null
      // dataset when this was a cold load with nothing cached yet.
      const prior = cache.get(key)
      if (prior && prior.data != null) {
        cache.set(key, { data: prior.data, error: err, fetchedAt: prior.fetchedAt })
      } else {
        cache.set(key, { data: null, error: err, fetchedAt: Date.now() })
      }
    } finally {
      inflight.delete(key)
      notify(key)
    }
  })()

  inflight.set(key, p)
  return p
}

/**
 * Drop a cache entry. Next read for this key goes to network.
 * Use after a write path that changed the underlying data.
 */
export function invalidate(key) {
  cache.delete(key)
  notify(key)
}

/**
 * Drop every cache entry whose key starts with the given prefix.
 * Useful after a destructive batch op (e.g. import → invalidate
 * everything under 'prospecting:').
 */
export function invalidatePrefix(prefix) {
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k)
  }
  for (const k of subscribers.keys()) {
    if (k.startsWith(prefix)) notify(k)
  }
}

/**
 * Nuke the entire cache. Notifies every active subscriber so they
 * re-render and trigger a fresh fetch.
 *
 * Called from the centralized write paths (saveRecord, deleteRecord,
 * createRecord) so any single mutation guarantees subsequent reads
 * across the whole app are fresh. Trade-off: a save in one section
 * forces a re-fetch when the user navigates to any other section.
 * For our scale that's the right trade — the alternative (per-table
 * invalidation registry) is significantly more code and one bug in
 * the registry means silent stale-data forever.
 */
export function invalidateAll() {
  cache.clear()
  for (const k of subscribers.keys()) notify(k)
}

/**
 * The hook.
 *
 * @param {string} key      cache identity; same key = shared cache + dedup
 * @param {() => Promise<any>} fetcher  zero-arg async fn returning the data
 * @param {Object} opts
 * @param {number}  opts.ttl     ms before an entry is considered stale (default 5min)
 * @param {boolean} opts.swr     when stale, return cached value immediately and
 *                               refresh in background (default true)
 * @param {boolean} opts.enabled when false, don't fetch (e.g. wait for a parent
 *                               to resolve a dependency). Default true.
 *
 * @returns {{
 *   data: any,
 *   loading: boolean,   // true on cold load only; SWR background fetches don't flip this
 *   refreshing: boolean,// true during any in-flight fetch, including SWR background
 *   error: Error | null,
 *   refresh: () => Promise<void>,    // force network refresh now
 * }}
 */
export function useCachedFetch(key, fetcher, opts = {}) {
  const { ttl = 5 * 60 * 1000, swr = true, enabled = true } = opts

  // The fetcher closure changes every render; pin it in a ref so the
  // effect doesn't re-run on every parent re-render. Subscribers care
  // about the key + enabled flag, not the function identity.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  // Local force-rerender. The hook reads from the module-level cache
  // each render; this just kicks the cycle when notified.
  const [, setTick] = useState(0)
  const rerender = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!enabled) return undefined

    // Subscribe
    let subs = subscribers.get(key)
    if (!subs) { subs = new Set(); subscribers.set(key, subs) }
    subs.add(rerender)

    // Decide whether to trigger a fetch
    const entry = cache.get(key)
    const isStale = !entry || (Date.now() - entry.fetchedAt > ttl)

    if (!entry) {
      // Cold load — must fetch before we can render data
      runFetch(key, () => fetcherRef.current())
    } else if (isStale && swr) {
      // Warm but stale — return cached now, refresh in background
      runFetch(key, () => fetcherRef.current())
    }

    return () => {
      subs.delete(rerender)
      if (subs.size === 0) subscribers.delete(key)
    }
  }, [key, enabled, ttl, swr, rerender])

  const refresh = useCallback(async () => {
    // Force a fresh fetch even if cache is warm. Awaits completion
    // so the caller can chain UI feedback (e.g. pull-to-refresh spinner).
    await runFetch(key, () => fetcherRef.current())
  }, [key])

  const entry = enabled ? cache.get(key) : null
  return {
    data:       entry?.data ?? null,
    error:      entry?.error ?? null,
    // loading = no cached entry yet AND a fetch is in flight (cold load)
    loading:    enabled && !entry && inflight.has(key),
    // refreshing = any in-flight fetch, including SWR background refreshes
    refreshing: enabled && inflight.has(key),
    refresh,
  }
}
