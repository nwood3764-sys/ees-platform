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

export const supabase = createClient(url || '', key || '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
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
