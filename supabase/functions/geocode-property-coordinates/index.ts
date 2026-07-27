// =============================================================================
// geocode-property-coordinates
//
// Cron-driven geocoding sweep. Finds active properties that have a usable
// address (street + zip, or street + city + state) but no stored
// property_latitude / property_longitude, geocodes them through the US
// Census Bureau batch geocoder (free, no API key, US-only — every EES
// property is US), and writes the coordinates back so the record page's
// Map card can pin them.
//
// Every attempted property gets property_geocode_attempted_at stamped and
// a property_geocode_status of 'Geocode Matched' or 'Geocode No Match', so
// the sweep never re-hammers addresses the geocoder can't resolve. A
// BEFORE UPDATE trigger on properties clears coordinates + tracking when an
// address component changes without new coordinates in the same update,
// which re-queues the row for the next sweep.
//
// Authentication: shared secret in the x-internal-cron-secret header,
// matched (constant-time) against internal_cron_auth name='geocode' —
// the same pattern as dispatch-scheduled-reports. The paired pg_cron job
// also sends the anon key as a Bearer token to satisfy the gateway.
//
// Inputs (POST JSON, all optional):
//   { limit?: number,          // max properties this invocation (default 200, cap 1000)
//     property_id?: <uuid>,    // geocode just this property (ignores attempted_at)
//     retry_no_match?: boolean // also retry rows previously marked No Match
//   }
//
// Outputs (200 JSON):
//   { scanned, matched, no_match, errors, remaining }
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-cron-secret",
}

const CENSUS_BATCH_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
const CENSUS_BENCHMARK = "Public_AR_Current"
const CENSUS_CHUNK     = 150   // addresses per batch call (API cap is 10k; small chunks keep calls fast)

interface PropertyRow {
  id: string
  property_record_number: string
  property_street: string | null
  property_city:   string | null
  property_state:  string | null
  property_zip:    string | null
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i]
  return diff === 0
}

function csvField(v: string | null | undefined): string {
  const s = (v ?? "").replace(/"/g, '""').replace(/[\r\n]+/g, " ").trim()
  return `"${s}"`
}

// Minimal CSV line parser (handles quoted fields with embedded commas/quotes).
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = "", inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQuotes = false
      } else cur += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      out.push(cur); cur = ""
    } else cur += ch
  }
  out.push(cur)
  return out
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  const supabaseUrl    = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server misconfiguration — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500)
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // Authorization gate — shared secret only; never reachable with the anon key
  // alone (this function writes properties with the service role).
  const { data: cronAuth } = await supabase
    .from("internal_cron_auth").select("secret").eq("name", "geocode").maybeSingle()
  const presentedSecret = req.headers.get("x-internal-cron-secret") || ""
  if (!cronAuth?.secret || !timingSafeEqualStr(presentedSecret, cronAuth.secret)) {
    return json({ error: "Unauthorized" }, 401)
  }

  const body = await req.json().catch(() => ({})) as {
    limit?: number; property_id?: string; retry_no_match?: boolean
  }
  const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 1000)

  // ── Find properties needing coordinates ─────────────────────────────
  let query = supabase
    .from("properties")
    .select("id, property_record_number, property_street, property_city, property_state, property_zip")
    .is("property_latitude", null)
    .not("property_street", "is", null)
    .neq("property_street", "")

  if (body.property_id) {
    query = query.eq("id", body.property_id)
  } else {
    query = query.filter("property_is_deleted", "not.is", true)
    if (body.retry_no_match) {
      query = query.or('property_geocode_attempted_at.is.null,property_geocode_status.eq."Geocode No Match"')
    } else {
      query = query.is("property_geocode_attempted_at", null)
    }
    query = query.order("property_created_at", { ascending: true }).limit(limit)
  }

  const { data: rows, error: loadErr } = await query
  if (loadErr) return json({ error: `failed to load properties: ${loadErr.message}` }, 500)

  // Only rows the geocoder can plausibly resolve: street + (zip or city+state).
  const candidates = ((rows || []) as PropertyRow[]).filter(p =>
    (p.property_zip && p.property_zip.trim() !== "") ||
    (p.property_city && p.property_city.trim() !== "" && p.property_state && p.property_state.trim() !== ""))

  let matched = 0, noMatch = 0, errors = 0
  const now = () => new Date().toISOString()

  for (let i = 0; i < candidates.length; i += CENSUS_CHUNK) {
    const chunk = candidates.slice(i, i + CENSUS_CHUNK)
    const byId = new Map(chunk.map(p => [p.id, p]))

    // Census batch CSV: Unique ID, Street address, City, State, ZIP (no header)
    const csv = chunk.map(p => [
      csvField(p.id), csvField(p.property_street), csvField(p.property_city),
      csvField(p.property_state), csvField(p.property_zip),
    ].join(",")).join("\n")

    let results: Map<string, { lat: number; lng: number } | null>
    try {
      const form = new FormData()
      form.append("benchmark", CENSUS_BENCHMARK)
      form.append("addressFile", new File([csv], "addresses.csv", { type: "text/csv" }))
      const resp = await fetch(CENSUS_BATCH_URL, { method: "POST", body: form })
      if (!resp.ok) throw new Error(`Census geocoder HTTP ${resp.status}`)
      const text = await resp.text()

      // Response CSV per row: id, input address, "Match"/"No_Match"/"Tie",
      // "Exact"/"Non_Exact", matched address, "lng,lat", tigerline id, side.
      results = new Map()
      for (const line of text.split("\n")) {
        if (!line.trim()) continue
        const f = parseCsvLine(line.trim())
        const id = f[0]
        if (!byId.has(id)) continue
        if (f[2] === "Match" && f[5]) {
          const [lngS, latS] = f[5].split(",")
          const lat = Number(latS), lng = Number(lngS)
          results.set(id, Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null)
        } else {
          results.set(id, null)  // No_Match / Tie — no usable coordinates
        }
      }
    } catch (e) {
      // Whole-chunk failure (network/outage): leave rows untouched so the
      // next sweep retries them, but report the error.
      console.error("census batch failed:", e)
      errors += chunk.length
      continue
    }

    for (const p of chunk) {
      const hit = results.get(p.id) ?? null
      const patch = hit
        ? { property_latitude: hit.lat, property_longitude: hit.lng,
            property_geocode_attempted_at: now(),
            property_geocode_status: "Geocode Matched",
            property_geocode_source: "US_CENSUS" }
        : { property_geocode_attempted_at: now(),
            property_geocode_status: "Geocode No Match",
            property_geocode_source: "US_CENSUS" }
      const { error: upErr } = await supabase.from("properties").update(patch).eq("id", p.id)
      if (upErr) { console.error(`update failed for ${p.property_record_number}: ${upErr.message}`); errors++ }
      else if (hit) matched++
      else noMatch++
    }
  }

  // How many geocodable rows still await a first attempt (for backfill loops).
  const { count: remaining } = await supabase
    .from("properties")
    .select("id", { count: "exact", head: true })
    .is("property_latitude", null)
    .is("property_geocode_attempted_at", null)
    .not("property_street", "is", null)
    .neq("property_street", "")
    .filter("property_is_deleted", "not.is", true)

  return json({ scanned: candidates.length, matched, no_match: noMatch, errors, remaining: remaining ?? null })
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  })
}
