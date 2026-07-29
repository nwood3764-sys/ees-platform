// =============================================================================
// geocode-property-coordinates
//
// Turns a property's mailing address into map coordinates via the US Census
// Bureau geocoder (free, no API key, US-only — every EES property is US), and
// writes property_latitude / property_longitude back so the record page's Map
// card can pin the property.
//
// Two entry paths:
//
//   1. Cron sweep (shared secret, service role, batch). Finds active
//      properties that have a usable address but no stored coordinates and
//      geocodes them in bulk through the Census *batch* geocoder. Auth: the
//      x-internal-cron-secret header matched (constant-time) against
//      internal_cron_auth name='geocode'. Inputs (POST JSON, all optional):
//        { limit?, property_id?, retry_no_match? }
//      Output: { scanned, matched, no_match, errors, remaining }
//
//   2. Caller-JWT single property (on-demand). When the Map card opens a
//      property that has no coordinates yet, the browser calls this function
//      with the signed-in user's JWT and a single property_id so the property
//      is pinned immediately instead of waiting up to 15 minutes for the next
//      cron sweep. Uses the Census *one-line* geocoder (single address, so the
//      coordinates can be returned synchronously to the caller). Auth: a valid
//      Supabase user JWT; the property must be visible to that user under RLS.
//      Input: { property_id }.
//      Output: { matched: true, lat, lng } | { matched: false, status }.
//
// Every attempted property gets property_geocode_attempted_at stamped and a
// property_geocode_status of 'Geocode Matched' or 'Geocode No Match', so the
// cron sweep never re-hammers addresses the geocoder can't resolve. A BEFORE
// UPDATE trigger on properties clears coordinates + tracking when an address
// component changes without new coordinates in the same update, which
// re-queues the row for the next sweep.
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-cron-secret",
}

const CENSUS_BATCH_URL   = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
const CENSUS_ONELINE_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
const CENSUS_BENCHMARK   = "Public_AR_Current"
const CENSUS_CHUNK       = 150   // addresses per batch call (API cap is 10k; small chunks keep calls fast)

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

// Build the single-line address a geocoder expects. Returns "" when there is
// nothing usable (no street, or street with neither zip nor city+state).
function onelineAddress(p: {
  property_street: string | null; property_city: string | null
  property_state: string | null;  property_zip: string | null
}): string {
  const street = (p.property_street ?? "").trim()
  if (!street) return ""
  const hasZip       = !!(p.property_zip && p.property_zip.trim())
  const hasCityState = !!(p.property_city && p.property_city.trim() &&
                          p.property_state && p.property_state.trim())
  if (!hasZip && !hasCityState) return ""
  return [p.property_street, p.property_city, p.property_state, p.property_zip]
    .map(x => (x ?? "").trim())
    .filter(Boolean)
    .join(", ")
}

// One-line Census geocode of a single address. Returns coordinates on a match,
// null on No_Match. Throws on transport/HTTP failure so the caller can report
// an error distinct from a clean no-match (and leave the row for a retry).
async function geocodeOneline(p: PropertyRow): Promise<{ lat: number; lng: number } | null> {
  const address = onelineAddress(p)
  if (!address) return null
  const url = `${CENSUS_ONELINE_URL}?address=${encodeURIComponent(address)}` +
              `&benchmark=${CENSUS_BENCHMARK}&format=json`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Census geocoder HTTP ${resp.status}`)
  const data = await resp.json().catch(() => null) as
    { result?: { addressMatches?: Array<{ coordinates?: { x: number; y: number } }> } } | null
  const match = data?.result?.addressMatches?.[0]
  if (!match?.coordinates) return null   // No_Match
  const lat = Number(match.coordinates.y), lng = Number(match.coordinates.x)
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  const supabaseUrl    = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const anonKey        = Deno.env.get("SUPABASE_ANON_KEY")
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server misconfiguration — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500)
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const body = await req.json().catch(() => ({})) as {
    limit?: number; property_id?: string; retry_no_match?: boolean
  }

  // ── Authorization ──────────────────────────────────────────────────
  // Cron mode: shared secret present → service-role batch sweep. Otherwise
  // the caller must present a valid user JWT and may only geocode a single
  // property they can see (the on-demand path from the Map card).
  const presentedSecret = req.headers.get("x-internal-cron-secret") || ""
  let cronMode = false
  if (presentedSecret) {
    const { data: cronAuth } = await supabase
      .from("internal_cron_auth").select("secret").eq("name", "geocode").maybeSingle()
    if (!cronAuth?.secret || !timingSafeEqualStr(presentedSecret, cronAuth.secret)) {
      return json({ error: "Unauthorized" }, 401)
    }
    cronMode = true
  }

  // ── On-demand single-property path (caller JWT) ────────────────────
  if (!cronMode) {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader)       return json({ error: "missing authorization" }, 401)
    if (!body.property_id) return json({ error: "property_id required" }, 400)
    if (!anonKey)          return json({ error: "Server misconfiguration — missing SUPABASE_ANON_KEY" }, 500)

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user) return json({ error: "invalid token" }, 401)

    // RLS-checked read: authorizes the caller and fetches the address.
    const { data: prop } = await userClient
      .from("properties")
      .select("id, property_record_number, property_street, property_city, property_state, property_zip, property_latitude, property_longitude")
      .eq("id", body.property_id)
      .maybeSingle()
    if (!prop) return json({ error: "forbidden or not found" }, 403)

    // Already pinned — nothing to do (a concurrent sweep may have filled it in).
    if (prop.property_latitude != null && prop.property_longitude != null) {
      return json({ matched: true, already: true,
        lat: Number(prop.property_latitude), lng: Number(prop.property_longitude) })
    }

    if (!onelineAddress(prop as PropertyRow)) {
      return json({ matched: false, status: "Insufficient Address",
        reason: "Property has no street plus ZIP or city/state to geocode." })
    }

    let hit: { lat: number; lng: number } | null
    try {
      hit = await geocodeOneline(prop as PropertyRow)
    } catch (e) {
      // Transport/HTTP failure: leave the row untouched so a later attempt
      // (this path or the sweep) can retry, and report the error.
      console.error("oneline geocode failed:", e)
      return json({ error: `Geocoder unavailable: ${(e as Error).message}` }, 502)
    }

    const patch = hit
      ? { property_latitude: hit.lat, property_longitude: hit.lng,
          property_geocode_attempted_at: new Date().toISOString(),
          property_geocode_status: "Geocode Matched",
          property_geocode_source: "US_CENSUS" }
      : { property_geocode_attempted_at: new Date().toISOString(),
          property_geocode_status: "Geocode No Match",
          property_geocode_source: "US_CENSUS" }
    const { error: upErr } = await supabase.from("properties").update(patch).eq("id", prop.id)
    if (upErr) return json({ error: `failed to save coordinates: ${upErr.message}` }, 500)

    return hit
      ? json({ matched: true, lat: hit.lat, lng: hit.lng })
      : json({ matched: false, status: "Geocode No Match" })
  }

  // ── Cron sweep (batch, service role) ───────────────────────────────
  const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 1000)

  // Find properties needing coordinates.
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
