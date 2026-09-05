import { createClient } from '@supabase/supabase-js'

// Both values must be provided via Vite env vars at build time.
// Set them in Netlify under Site settings → Environment variables:
//   VITE_SUPABASE_URL       = https://flyjigrijjjtcsvpgzvk.supabase.co
//   VITE_SUPABASE_ANON_KEY  = <publishable key from Supabase → Project Settings → API>
//
// For local development create a file at /home/claude/leap/.env.local with
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

// Errors we deliberately don't log to client_errors — they're either
// expected business outcomes or auth lifecycle, not diagnostic signal.
//   PGRST116 — "no rows" / single() returned zero rows; common in lookups
//   PGRST301 — auth lifecycle; user signed out mid-request
//   42501   — PostgreSQL insufficient_privilege; expected when RLS denies
//   23505   — unique_violation; surfaces as a user-facing form error
//   23503   — foreign_key_violation; surfaces as a user-facing form error
//   23514   — check_violation; surfaces as a user-facing form error
//   401     — auth lifecycle
//   403     — permission denied (same as 42501 surfaced differently)
const SILENT_ERROR_CODES = new Set([
  'PGRST116', 'PGRST301',
  '42501', '23505', '23503', '23514',
  '401', '403',
])

function shouldLogQueryError(err) {
  if (!err) return false
  const code = String(err.code || err.status || '')
  if (SILENT_ERROR_CODES.has(code)) return false
  // Network aborts (user navigated away). Not actionable.
  if (err.message && /aborted/i.test(err.message)) return false
  return true
}

// Lazy import the error logger to avoid a circular dependency.
let _logClientError = null
// Re-entry guard: the logger writes to client_errors via this same
// proxied client. If THAT write fails and we tried to log it, we'd
// infinite-loop. The guard makes the recursive call a no-op.
let _loggingInProgress = false
async function logQueryError(err, context) {
  if (_loggingInProgress) return
  _loggingInProgress = true
  try {
    if (!_logClientError) {
      const mod = await import('./clientErrorLogger')
      _logClientError = mod.logClientError
    }
    // Build a synthetic Error so the logger has a clean message + stack.
    const e = new Error(`Supabase query failed: ${err.message || 'unknown'}`)
    e.name = err.code ? `SupabaseError:${err.code}` : 'SupabaseError'
    await _logClientError(e, null, { severity: 'error', ...context })
  } catch {
    // Logger unavailable; nothing to do.
  } finally {
    _loggingInProgress = false
  }
}

// Slow-query threshold. Wall-clock time around the awaited .then() —
// includes network round-trip + server compute. Production target on
// fast pages is <300ms; user-perceivable lag starts around 1s; the
// 2000ms threshold is where we're confident this is a real regression
// not a transient network blip.
const SLOW_QUERY_MS = 2000

let _loggingSlowQuery = false
async function logSlowQuery(elapsedMs, context) {
  if (_loggingSlowQuery) return
  _loggingSlowQuery = true
  try {
    if (!_logClientError) {
      const mod = await import('./clientErrorLogger')
      _logClientError = mod.logClientError
    }
    // Severity=warning so this doesn't trigger an alert UI — just lands
    // in the triage pane for periodic review.
    const e = new Error(`Slow Supabase query: ${elapsedMs.toFixed(0)}ms`)
    e.name = 'SlowQuery'
    await _logClientError(e, null, { severity: 'warning', ...context })
  } catch {
    // Logger unavailable; nothing to do.
  } finally {
    _loggingSlowQuery = false
  }
}

// PostgREST returns a chainable filter builder that's also thenable.
// We Proxy it so any await/.then() fires invalidation on success,
// logs to client_errors on a non-trivial failure, and tracks
// slow-query wall-clock time.
function wrapThenable(builder) {
  return new Proxy(builder, {
    get(target, prop) {
      const value = Reflect.get(target, prop)
      if (prop === 'then') {
        return (onFulfilled, onRejected) => {
          // Capture start time so we can compute elapsed in the resolution
          // handler. Using performance.now() since it's monotonic and not
          // affected by clock adjustments mid-flight.
          const t0 = (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now()
          return target.then(
            (res) => {
              const elapsed = ((typeof performance !== 'undefined' && performance.now)
                ? performance.now()
                : Date.now()) - t0
              // Only invalidate when the server didn't return an error.
              // PostgREST surfaces errors in res.error rather than throwing.
              if (!res?.error) {
                fireInvalidate()
                // Slow-query telemetry. Sample only on success — failures
                // are already logged as errors above and slow-failures
                // are likely network/timeout issues, not query problems.
                if (elapsed > SLOW_QUERY_MS) {
                  logSlowQuery(elapsed, {})
                }
              } else if (shouldLogQueryError(res.error)) {
                logQueryError(res.error, {
                  // The current URL gives the logger enough context to
                  // know what page the failure happened on. We don't
                  // try to infer the specific table here.
                })
              }
              return onFulfilled ? onFulfilled(res) : res
            },
            onRejected,
          )
        }
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
// difference is .from() returns a Proxy that auto-invalidates on writes,
// and .rpc() does the same after a successful call.
//
// On .rpc(): we can't tell from the call site whether the RPC is a read
// or a write — both look like supabase.rpc('foo', args). The safest
// default is to invalidate after every successful RPC. The cost is a
// re-fetch on next navigation after harmless read RPCs (current_app_user_id,
// ees_table_metadata, etc.); the benefit is no stale data after
// mutation RPCs (publish_project_report_template, cancel_appointment, etc.).
// On balance, the same trade-off as for .from() writes.
export const supabase = new Proxy(baseClient, {
  get(target, prop) {
    if (prop === 'from') {
      return (table) => wrapQueryBuilder(target.from(table))
    }
    if (prop === 'rpc') {
      return (fn, args, opts) => wrapThenable(target.rpc(fn, args, opts))
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
// want fetchAllKeyset below, which pages by primary key instead of by
// OFFSET. fetchAllPaged is fine for a set that fits in one or two pages —
// with no pages to skip, OFFSET costs nothing — and for callers that
// deliberately want sequential behaviour (e.g. an upstream rate limit).
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
// fetchAllKeyset — read every row of a filtered set, by PRIMARY KEY.
//
// WHY THIS EXISTS. fetchAllPaged and fetchAllPagedParallel above both page
// with OFFSET (`.range(from, to)`). OFFSET cannot skip rows without first
// producing them, so page 17 of the Properties list made Postgres sort all
// 16,665 live properties and then throw away the first 16,000 — and every
// other page did the same. Seventeen pages, seventeen full sorts, each
// spilling ~3 MB of temp file, fired eight at a time. Measured on production
// (2026-09-05): one page 612 ms in isolation, 4,096 ms mean under real
// concurrency, 13 GB of temp files written since Aug 29. Past the 8-second
// statement_timeout the `authenticated` role carries, the page comes back
// 57014 and the list renders "Could not load records" — 256 failed loads on
// Sep 2 alone, all of them this.
//
// Keyset paging asks for `WHERE id > <last id seen> ORDER BY id LIMIT n`
// instead. That is an index range scan the LIMIT stops early, so each page
// touches only the rows it returns. The same page measured 16 ms: 38× faster,
// no sort, no temp file, and the work is O(rows) across the whole read
// instead of O(rows²).
//
// It also removes the HEAD `count: 'exact'` request fetchAllPagedParallel
// needs to plan its pages — which is itself a full scan, and is exactly the
// request that threw the 500 on 2026-09-05T16:17Z.
//
// SEQUENTIAL, AND STILL FASTER. Page N+1 needs page N's last key, so these
// cannot be fired concurrently. That is not the regression it looks like: 17
// keyset pages cost ~270 ms of database time in total, against ~70 seconds of
// database work for the parallel-OFFSET read. Wall time is dominated by
// network round trips either way, and the database is no longer the thing
// that falls over — which is the whole point.
//
// ORDER. Rows come back ordered by the key column, NOT by whatever a person
// reads the list sorted by. A caller that used to pass `.order('name')` must
// restore that order itself with sortRowsByTextKey from src/lib/listOrder.js
// — ListView renders the fetch order verbatim when a view carries no sort, so
// skipping that step silently reorders the list. Sorting 16k rows once in the
// client is free; making Postgres do it 17 times is what broke.
//
// CONTRACT. `buildQuery()` returns the filtered query with NO order, NO range
// and NO limit — this function owns all three, so a caller cannot get the
// keyset mechanics subtly wrong. The key column must be in the SELECT (it is
// how the cursor advances); if it is missing this throws by name rather than
// looping on the same page forever.
//
//   const rows = await fetchAllKeyset(() =>
//     supabase.from('properties')
//       .select('id, property_name')
//       .eq('property_is_deleted', false))
//
// The key must be unique and non-null. Primary keys are both, which is why it
// defaults to 'id' and why nothing else should be passed without checking.
// =====================================================================
export async function fetchAllKeyset(buildQuery, {
  keyColumn = 'id',
  pageSize  = 1000,
  maxPages  = 200,
} = {}) {
  if (typeof buildQuery !== 'function') {
    throw new Error('fetchAllKeyset requires a buildQuery function returning an unordered, unpaged query.')
  }

  const rows = []
  const seen = new Set()
  let cursor = null

  for (let page = 0; page < maxPages; page++) {
    let q = buildQuery()
    if (cursor !== null) q = q.gt(keyColumn, cursor)
    const { data, error } = await q
      .order(keyColumn, { ascending: true })
      .limit(pageSize)
    if (error) throw error

    const batch = data || []

    // The key must be UNIQUE, and this is where that stops being a promise in
    // a comment. Two rows sharing a key at a page boundary would advance the
    // cursor past the second one and drop it silently — the worst thing a list
    // read can do. A primary key cannot collide, but a VIEW can fan out: give
    // a property a second property_source_data row and outreach_properties_v
    // starts emitting that property twice. Say so by name rather than hand
    // back a list quietly missing records.
    for (const row of batch) {
      const key = row?.[keyColumn]
      if (key === undefined || key === null) continue
      if (seen.has(key)) {
        throw new Error(
          `fetchAllKeyset: '${keyColumn}' is not unique in this result — saw ${JSON.stringify(key)} twice. ` +
          `Keyset paging would skip rows. Page by a unique key, or de-duplicate the query.`
        )
      }
      seen.add(key)
    }

    rows.push(...batch)

    // A short page is the last page. This is the only termination condition,
    // which is why the key must be unique: a duplicate key would make the
    // cursor skip every row sharing it.
    if (batch.length < pageSize) return rows

    const last = batch[batch.length - 1]
    const next = last ? last[keyColumn] : undefined
    if (next === undefined || next === null) {
      throw new Error(
        `fetchAllKeyset: the last row of a full page carries no '${keyColumn}'. ` +
        `The key column must be selected and non-null, or paging cannot advance.`
      )
    }
    cursor = next
  }

  throw new Error(
    `fetchAllKeyset exceeded ${maxPages} pages × ${pageSize} = ${maxPages * pageSize} rows. ` +
    `If the table is genuinely this large, raise maxPages at the call site or add a server-side filter.`
  )
}
