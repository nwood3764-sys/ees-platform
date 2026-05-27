import { createClient } from '@supabase/supabase-js'

// Both values must be provided via Vite env vars at build time.
// Set them in Netlify under Site settings → Environment variables:
//   VITE_SUPABASE_URL       = https://flyjigrijjjtcsvpgzvk.supabase.co
//   VITE_SUPABASE_ANON_KEY  = <publishable key from Supabase → Project Settings → API>
//
// For local development create a file at /home/claude/anura/.env.local with
// the same two variables. No fallback is hardcoded on purpose — the key
// should only live in environment variables, never in source.
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  // Surface a clear error at app start rather than letting queries fail
  // mysteriously later. The error will appear in the browser console and
  // the login screen will show a friendly message.
  console.error(
    'Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  )
}

const baseClient = createClient(url || '', key || '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

// ─── Cache invalidation on writes ────────────────────────────────────────
// Wrap the client's `.from(table)` so any insert/update/upsert/delete
// invalidates the read cache. Without this, the lazy-cache layer holds
// stale list views after edits — admin creates a record, navigates to
// the list, doesn't see it. Trade-off: every write nukes the cache,
// forcing a re-fetch on next navigation. For our scale this is the
// right trade — alternative (per-table tag registry) is far more code
// and a single bug means silent stale-data.
//
// Implementation note: we lazy-import invalidateAll to avoid a circular
// dependency (useCachedFetch is consumed by hooks that import supabase).
let _invalidateAll = null
async function fireInvalidate() {
  try {
    if (!_invalidateAll) {
      const mod = await import('./useCachedFetch')
      _invalidateAll = mod.invalidateAll
    }
    _invalidateAll()
  } catch {
    // Cache module not loaded yet (e.g. during initial auth flow).
    // No subscribers to notify; safe to swallow.
  }
}

// Wrap a PostgrestQueryBuilder so its write methods auto-invalidate
// once the eventual promise resolves successfully.
function wrapQueryBuilder(qb) {
  const WRITE_METHODS = ['insert', 'update', 'upsert', 'delete']
  return new Proxy(qb, {
    get(target, prop) {
      const value = Reflect.get(target, prop)
      if (typeof value !== 'function') return value
      if (!WRITE_METHODS.includes(prop)) return value.bind(target)
      // For write methods, return a wrapper that attaches a .then()
      // to fire invalidation after success. PostgREST query builders
      // are thenable themselves, so we just instrument the resulting
      // filter builder's .then by recursive proxy.
      return function (...args) {
        const result = value.apply(target, args)
        return wrapThenable(result)
      }
    },
  })
}

// PostgREST returns a chainable filter builder that's also thenable.
// We Proxy it so any await/.then() fires invalidation on success.
function wrapThenable(builder) {
  return new Proxy(builder, {
    get(target, prop) {
      const value = Reflect.get(target, prop)
      if (prop === 'then') {
        return (onFulfilled, onRejected) =>
          target.then(
            (res) => {
              // Only invalidate when the server didn't return an error.
              // PostgREST surfaces errors in res.error rather than throwing.
              if (!res?.error) fireInvalidate()
              return onFulfilled ? onFulfilled(res) : res
            },
            onRejected,
          )
      }
      if (typeof value !== 'function') return value
      // Re-wrap the result of chained methods (.eq, .select, etc.) so
      // the invalidation hook stays attached through the chain.
      return function (...args) {
        const next = value.apply(target, args)
        // Some chained calls return the same builder; others return a
        // new thenable. Either way, re-wrap.
        return next && typeof next === 'object' ? wrapThenable(next) : next
      }
    },
  })
}

// Public client. Looks identical to a normal Supabase client; the only
// difference is .from() returns a Proxy that auto-invalidates on writes.
export const supabase = new Proxy(baseClient, {
  get(target, prop) {
    if (prop === 'from') {
      return (table) => wrapQueryBuilder(target.from(table))
    }
    return Reflect.get(target, prop)
  },
})

export const hasSupabaseConfig = Boolean(url && key)

// =====================================================================
// fetchAllPaged — generic paginator for "load the entire table"
// fetchers that need to bypass the PostgREST 1000-row default cap.
//
// PostgREST applies a max-rows cap (1000 by default) to every query.
// Adding .limit(huge_number) does NOT bypass it — the server still
// returns at most max-rows. The only correct path is .range(from,to)
// in a loop until a short page comes back. This helper encapsulates
// that loop so every service uses the same pattern.
//
// Usage:
//   const rows = await fetchAllPaged((from, to) =>
//     supabase.from('properties').select('*').order('id').range(from, to)
//   )
//
// Important: include a stable .order(...) on the builder. PostgREST
// pagination is offset-based; without a deterministic order, pages
// may overlap or skip rows under concurrent writes.
//
// Defaults: pageSize=1000 (matches PostgREST default), maxPages=200
// → 200,000 row safety cap. Bump maxPages on the call site if a
// genuinely larger table needs full extraction (e.g. property_units
// once we have hundreds of thousands of units).
//
// NOTE: sequential. For tables with 5,000+ rows you almost certainly
// want fetchAllPagedParallel below — same interface, ~10× faster.
// fetchAllPaged is kept for cases where the caller intentionally
// wants sequential behavior (e.g. respecting an upstream rate limit).
// =====================================================================
export async function fetchAllPaged(buildQuery, { pageSize = 1000, maxPages = 200 } = {}) {
  const rows = []
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize
    const to   = from + pageSize - 1
    const { data, error } = await buildQuery(from, to)
    if (error) throw error
    const batch = data || []
    rows.push(...batch)
    if (batch.length < pageSize) return rows
  }
  throw new Error(
    `fetchAllPaged exceeded ${maxPages} pages × ${pageSize} = ${maxPages * pageSize} rows. ` +
    `If the table is genuinely this large, raise maxPages at the call site or add a server-side filter.`
  )
}

// =====================================================================
// fetchAllPagedParallel — parallel variant of fetchAllPaged.
//
// Fires all page requests concurrently after a single HEAD count to
// learn the row total. Same interface as fetchAllPaged (call site
// migration is a one-word change) but ~7× faster for 6,800-row
// tables — wall time becomes max(page_latency) instead of
// sum(page_latency).
//
// Two extra args beyond the builder:
//
//   countQuery   — required. A function that returns a HEAD/count
//                  request for the same filtered row set the page
//                  builder targets. Without this we'd have to fall
//                  back to "fire pages until a short one comes
//                  back" which can't parallelize.
//
//                  Example:
//                    countQuery: () => supabase
//                      .from('properties')
//                      .select('id', { count: 'exact', head: true })
//                      .eq('property_is_deleted', false)
//
//   concurrency  — max parallel page requests. Default 8. PostgREST
//                  can comfortably handle this many; pushing higher
//                  risks the platform's per-IP connection cap.
//
// Caller filters/joins MUST be identical between countQuery and the
// page buildQuery, or the parallel page fetches will miss or
// duplicate rows. The signature deliberately makes both explicit
// to force the caller to think about it.
//
// Fallback: if the HEAD count call fails (some views don't support
// HEAD/count requests), we automatically fall through to the
// sequential fetchAllPaged so the data still loads — just at the
// old speed. No silent data loss.
// =====================================================================
export async function fetchAllPagedParallel(buildQuery, countQuery, {
  pageSize    = 1000,
  maxPages    = 200,
  concurrency = 8,
} = {}) {
  if (typeof countQuery !== 'function') {
    throw new Error('fetchAllPagedParallel requires a countQuery function — pass a builder that returns a HEAD/count request.')
  }

  // HEAD count first. PostgREST returns the matched row count in the
  // Content-Range header; the JS client surfaces it as `count`.
  const { count, error: countErr } = await countQuery()

  // If the count query errored, fall back to the sequential paginator
  // rather than failing the whole load. The most common cause is a
  // view that doesn't expose HEAD/count semantics — we still want
  // the user to see their data.
  if (countErr || count == null) {
    if (countErr) {
      console.warn('fetchAllPagedParallel: count query failed, falling back to sequential.', countErr)
    }
    return fetchAllPaged(buildQuery, { pageSize, maxPages })
  }

  // Empty result set — skip the page fetches entirely.
  if (count === 0) return []

  const totalPages = Math.ceil(count / pageSize)
  if (totalPages > maxPages) {
    throw new Error(
      `fetchAllPagedParallel: ${count} rows would need ${totalPages} pages, exceeds maxPages=${maxPages}. ` +
      `Raise maxPages at the call site or filter the query.`
    )
  }

  // Page index pool consumed by a fixed number of workers. Caps the
  // concurrent in-flight request count without holding the entire
  // result array twice in memory.
  const pageIndexes = Array.from({ length: totalPages }, (_, i) => i)
  const results    = new Array(totalPages)
  let cursor       = 0

  const runWorker = async () => {
    while (cursor < pageIndexes.length) {
      const myIndex = cursor++
      if (myIndex >= pageIndexes.length) return
      const page = pageIndexes[myIndex]
      const from = page * pageSize
      const to   = from + pageSize - 1
      const { data, error } = await buildQuery(from, to)
      if (error) throw error
      results[page] = data || []
    }
  }

  // Launch up to `concurrency` workers; each pulls from the shared
  // cursor until pages are exhausted. Pages above the count we
  // already know about would return empty results, so we never
  // overshoot.
  const workers = []
  const workerCount = Math.min(concurrency, totalPages)
  for (let i = 0; i < workerCount; i++) workers.push(runWorker())
  await Promise.all(workers)

  // Flatten in page order — workers may complete out of order. Each
  // page already has its rows in the stable .order() the caller
  // requested, so concatenating by page index preserves overall sort.
  const out = []
  for (const page of results) {
    if (page) out.push(...page)
  }
  return out
}
