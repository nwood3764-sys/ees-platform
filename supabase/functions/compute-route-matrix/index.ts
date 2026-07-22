// ─── compute-route-matrix ────────────────────────────────────────────────────
// Wraps Google's Routes API ComputeRouteMatrix endpoint with
// `routingPreference: TRAFFIC_AWARE`. Computes drive durations for
// origin/destination pairs (1-to-1, 1-to-many, many-to-1, or many-to-many).
//
// Cache layer: every (origin, destination) result is keyed on
// SHA-256(canonicalized origin string + "→" + canonicalized destination
// string + traffic_aware flag + departure_time bucket) and stored in
// `drive_time_cache`. Cache hits within DEFAULT_TTL_MINUTES are returned
// without an outbound API call. Cache misses call Google and write back.
//
// Mock fallback: when GOOGLE_MAPS_API_KEY is absent, returns haversine
// straight-line distance × 1.3 ÷ 25 mph — matches the inline fallback in
// compute-availability v3. Mock results are not cached.
//
// Public, unauthenticated. Address inputs accept either coordinates
// ({lat, lng}) or full address objects; if only an address is provided
// the function resolves it to a ZIP centroid (mock) or hands the raw
// address string to Google (live). Coordinates are preferred when known.
//
// Returns 200 { status: 'ok', source: 'google'|'mock'|'cache_partial',
//               results: [ { origin_index, destination_index,
//                            duration_seconds, distance_meters, source } ] }
//         400 { error: '<validation message>' }
//         500 { status: 'error', message }

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const DEFAULT_TTL_MINUTES = 60          // cache freshness during business hours
const AVG_SPEED_MPH = 25                // mock-fallback travel speed
const ROUTE_DETOUR_FACTOR = 1.3         // straight-line → driving distance fudge

interface AddressInput {
  street?: string
  city?:   string
  state?:  string
  zip?:    string
}
interface LatLngInput { lat: number; lng: number }
type WaypointInput = { coordinates: LatLngInput } | { address: AddressInput }

interface ReqBody {
  origins:      WaypointInput[]
  destinations: WaypointInput[]
  traffic_aware?: boolean
  departure_time?: string  // ISO; defaults to now
}

interface RouteResult {
  origin_index:      number
  destination_index: number
  duration_seconds:  number
  distance_meters:   number
  source:            "google" | "mock" | "cache"
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  let body: ReqBody
  try { body = await req.json() } catch { return json({ error: "Invalid JSON body" }, 400) }

  const v = validateInput(body)
  if (v) return json({ error: v }, 400)

  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY")
  const supabaseUrl    = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  const supabase = (supabaseUrl && serviceRoleKey)
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null

  const origins      = await Promise.all(body.origins.map(normalizeWaypoint))
  const destinations = await Promise.all(body.destinations.map(normalizeWaypoint))

  const trafficAware  = body.traffic_aware !== false  // default true
  const departureTime = body.departure_time ? new Date(body.departure_time) : new Date()
  if (isNaN(departureTime.getTime())) return json({ error: "departure_time must be a valid ISO timestamp" }, 400)

  const pairs: Array<{ o: number; d: number; cached?: RouteResult }> = []
  for (let o = 0; o < origins.length; o++) {
    for (let d = 0; d < destinations.length; d++) {
      pairs.push({ o, d })
    }
  }

  // Cache lookup (if Supabase client + both waypoints have labels)
  if (supabase) {
    for (const p of pairs) {
      const origin = origins[p.o]
      const dest = destinations[p.d]
      if (!origin.label || !dest.label) continue
      const originHash = await sha256Hex(origin.label + "|t=" + trafficAware)
      const destHash   = await sha256Hex(dest.label + "|t=" + trafficAware)
      const { data } = await supabase
        .from("drive_time_cache")
        .select("dtc_duration_seconds, dtc_distance_meters, dtc_fetched_at")
        .eq("dtc_origin_hash", originHash)
        .eq("dtc_destination_hash", destHash)
        .eq("dtc_traffic_aware", trafficAware)
        .order("dtc_fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data && data.dtc_fetched_at) {
        const ageMs = Date.now() - new Date(data.dtc_fetched_at).getTime()
        if (ageMs <= DEFAULT_TTL_MINUTES * 60_000) {
          p.cached = {
            origin_index: p.o, destination_index: p.d,
            duration_seconds: data.dtc_duration_seconds,
            distance_meters:  data.dtc_distance_meters,
            source: "cache",
          }
        }
      }
    }
  }

  const missingPairs = pairs.filter(p => !p.cached)

  let computedResults: RouteResult[] = []
  let usedSource: "google" | "mock" | "cache_partial" = "cache_partial"

  if (missingPairs.length === 0) {
    usedSource = "cache_partial"
  } else if (!apiKey) {
    computedResults = missingPairs.map(p => mockRoute(origins[p.o], destinations[p.d], p.o, p.d))
    usedSource = pairs.every(p => p.cached) ? "cache_partial" : "mock"
  } else {
    try {
      computedResults = await callGoogleRouteMatrix({
        origins, destinations, pairs: missingPairs, departureTime, trafficAware, apiKey,
      })
      usedSource = "google"

      if (supabase) {
        for (const r of computedResults) {
          const origin = origins[r.origin_index]
          const dest   = destinations[r.destination_index]
          if (!origin.label || !dest.label) continue
          const originHash = await sha256Hex(origin.label + "|t=" + trafficAware)
          const destHash   = await sha256Hex(dest.label + "|t=" + trafficAware)
          await supabase.from("drive_time_cache").insert({
            dtc_origin_hash:         originHash,
            dtc_destination_hash:    destHash,
            dtc_origin_address:      origin.label,
            dtc_destination_address: dest.label,
            dtc_duration_seconds:    r.duration_seconds,
            dtc_distance_meters:     r.distance_meters,
            dtc_traffic_aware:       trafficAware,
            dtc_departure_time:      departureTime.toISOString(),
            dtc_fetched_at:          new Date().toISOString(),
          })
        }
      }
    } catch (e) {
      console.error("compute-route-matrix: Google API error, falling back to mock", e)
      computedResults = missingPairs.map(p => mockRoute(origins[p.o], destinations[p.d], p.o, p.d))
      usedSource = "mock"
    }
  }

  const results: RouteResult[] = []
  for (const p of pairs) {
    if (p.cached) {
      results.push(p.cached)
    } else {
      const fresh = computedResults.find(r => r.origin_index === p.o && r.destination_index === p.d)
      if (fresh) results.push(fresh)
    }
  }
  results.sort((a, b) => a.origin_index - b.origin_index || a.destination_index - b.destination_index)

  return json({ status: "ok", source: usedSource, results }, 200)
})

function validateInput(body: ReqBody): string | null {
  if (!body || typeof body !== "object") return "Body must be a JSON object"
  if (!Array.isArray(body.origins) || body.origins.length === 0) return "origins is required (array, min 1)"
  if (!Array.isArray(body.destinations) || body.destinations.length === 0) return "destinations is required (array, min 1)"
  if (body.origins.length > 25 || body.destinations.length > 25) return "origins and destinations max 25 each"
  for (const [i, w] of body.origins.entries()) {
    if (!isWaypoint(w)) return `origins[${i}] must have coordinates or address`
  }
  for (const [i, w] of body.destinations.entries()) {
    if (!isWaypoint(w)) return `destinations[${i}] must have coordinates or address`
  }
  return null
}

function isWaypoint(w: unknown): boolean {
  if (!w || typeof w !== "object") return false
  const wp = w as Record<string, unknown>
  if (wp.coordinates && typeof wp.coordinates === "object") {
    const c = wp.coordinates as Record<string, unknown>
    return typeof c.lat === "number" && typeof c.lng === "number"
  }
  if (wp.address && typeof wp.address === "object") {
    const a = wp.address as Record<string, unknown>
    return typeof a.street === "string" || typeof a.zip === "string"
  }
  return false
}

interface Waypoint { lat: number | null; lng: number | null; label: string | null }

async function normalizeWaypoint(w: WaypointInput): Promise<Waypoint> {
  if ("coordinates" in w && w.coordinates) {
    const { lat, lng } = w.coordinates
    return { lat, lng, label: `${lat.toFixed(5)},${lng.toFixed(5)}` }
  }
  if ("address" in w && w.address) {
    const a = w.address
    const street = (a.street || "").trim()
    const city   = (a.city   || "").trim()
    const state  = (a.state  || "").trim().toUpperCase()
    const zip    = (a.zip    || "").trim().substring(0, 5)
    const label  = [street, city, state, zip].filter(Boolean).join(", ")
    const ll = zipCentroid(zip)
    return { lat: ll?.lat ?? null, lng: ll?.lng ?? null, label: label || null }
  }
  return { lat: null, lng: null, label: null }
}

function mockRoute(origin: Waypoint, dest: Waypoint, o: number, d: number): RouteResult {
  if (origin.lat == null || origin.lng == null || dest.lat == null || dest.lng == null) {
    return { origin_index: o, destination_index: d, duration_seconds: 0, distance_meters: 0, source: "mock" }
  }
  const distMiles = haversineMiles(
    { lat: origin.lat, lng: origin.lng },
    { lat: dest.lat,   lng: dest.lng },
  )
  const drivingMiles = distMiles * ROUTE_DETOUR_FACTOR
  const hours = drivingMiles / AVG_SPEED_MPH
  return {
    origin_index: o, destination_index: d,
    duration_seconds: Math.round(hours * 3600),
    distance_meters:  Math.round(drivingMiles * 1609.344),
    source: "mock",
  }
}

interface MatrixCallArgs {
  origins: Waypoint[]; destinations: Waypoint[]
  pairs: Array<{ o: number; d: number }>
  departureTime: Date; trafficAware: boolean
  apiKey: string
}

// Google Routes API ComputeRouteMatrix
// https://developers.google.com/maps/documentation/routes/compute_route_matrix
async function callGoogleRouteMatrix(args: MatrixCallArgs): Promise<RouteResult[]> {
  const uniqueOrigins      = uniqueWaypoints(args.pairs.map(p => args.origins[p.o]))
  const uniqueDestinations = uniqueWaypoints(args.pairs.map(p => args.destinations[p.d]))

  // Google Routes rejects a departureTime that isn't clearly in the future
  // ("Timestamp must be set to a future time"), and a plain "now" is already
  // in the past by the time the request lands. TRAFFIC_AWARE works without a
  // departureTime (Google uses current traffic), so only send one when the
  // caller explicitly asked for a future departure; otherwise omit it.
  const reqBody: Record<string, unknown> = {
    origins:      uniqueOrigins.map(asGoogleWaypoint),
    destinations: uniqueDestinations.map(asGoogleWaypoint),
    travelMode: "DRIVE",
    routingPreference: args.trafficAware ? "TRAFFIC_AWARE" : "TRAFFIC_UNAWARE",
  }
  if (args.departureTime.getTime() > Date.now() + 60_000) {
    reqBody.departureTime = args.departureTime.toISOString()
  }

  const res = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": args.apiKey,
      "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,status,condition",
    },
    body: JSON.stringify(reqBody),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Google Routes ${res.status}: ${text.substring(0, 200)}`)
  }
  const data = await res.json() as Array<{
    originIndex: number; destinationIndex: number;
    duration?: string; distanceMeters?: number;
    status?: { code?: number }; condition?: string;
  }>

  const out: RouteResult[] = []
  for (const p of args.pairs) {
    const ourO = args.origins[p.o]; const ourD = args.destinations[p.d]
    const gOIdx = uniqueOrigins.findIndex(w => w.label === ourO.label)
    const gDIdx = uniqueDestinations.findIndex(w => w.label === ourD.label)
    const cell = data.find(c => c.originIndex === gOIdx && c.destinationIndex === gDIdx)
    if (!cell) continue
    if (cell.condition && cell.condition !== "ROUTE_EXISTS") continue
    const durSec = parseGoogleDuration(cell.duration)
    out.push({
      origin_index: p.o, destination_index: p.d,
      duration_seconds: durSec,
      distance_meters:  cell.distanceMeters ?? 0,
      source: "google",
    })
  }
  return out
}

function asGoogleWaypoint(w: Waypoint) {
  if (w.lat != null && w.lng != null) {
    return { waypoint: { location: { latLng: { latitude: w.lat, longitude: w.lng } } } }
  }
  return { waypoint: { address: w.label || "" } }
}

function uniqueWaypoints(list: Waypoint[]): Waypoint[] {
  const seen = new Set<string>(); const out: Waypoint[] = []
  for (const w of list) {
    const k = w.label || `${w.lat},${w.lng}`
    if (seen.has(k)) continue
    seen.add(k); out.push(w)
  }
  return out
}

function parseGoogleDuration(s: string | undefined): number {
  if (!s) return 0
  const m = /^(\d+(?:\.\d+)?)s$/.exec(s)
  return m ? Math.round(parseFloat(m[1])) : 0
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest("SHA-256", buf)
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("")
}

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat); const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function zipCentroid(zip: string): { lat: number; lng: number } | null {
  return ZIP_CENTROIDS[zip] || null
}
// Mock-mode ZIP centroids. Used ONLY when GOOGLE_MAPS_API_KEY is absent (the
// estimated-drive-time fallback). With the Google key set, raw address strings
// are geocoded by Google and this table is unused. Wisconsin (Madison /
// Milwaukee metro) + North Carolina (Charlotte metro / Piedmont) coverage.
const ZIP_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  // ── Wisconsin ──
  "53703":{lat:43.0775,lng:-89.3838},"53704":{lat:43.1226,lng:-89.3389},"53705":{lat:43.0682,lng:-89.4419},
  "53706":{lat:43.0750,lng:-89.4097},"53711":{lat:43.0317,lng:-89.4427},"53713":{lat:43.0244,lng:-89.3939},
  "53714":{lat:43.0950,lng:-89.3236},"53715":{lat:43.0654,lng:-89.4011},"53716":{lat:43.0731,lng:-89.3411},
  "53717":{lat:43.0795,lng:-89.5142},"53718":{lat:43.1147,lng:-89.2728},"53719":{lat:43.0420,lng:-89.4853},
  "53562":{lat:43.1003,lng:-89.5078},"53590":{lat:43.1839,lng:-89.2137},"53575":{lat:42.9319,lng:-89.3839},
  "53527":{lat:43.0814,lng:-89.2003},"53558":{lat:43.0150,lng:-89.2895},"53531":{lat:43.0506,lng:-89.0792},
  "53589":{lat:42.9170,lng:-89.2181},"53593":{lat:42.9908,lng:-89.5326},"53528":{lat:43.1158,lng:-89.6492},
  "53523":{lat:43.0089,lng:-89.0156},"53581":{lat:43.3328,lng:-90.3859},
  "53202":{lat:43.0420,lng:-87.9061},"53203":{lat:43.0428,lng:-87.9219},"53204":{lat:43.0153,lng:-87.9303},
  "53205":{lat:43.0556,lng:-87.9347},"53206":{lat:43.0900,lng:-87.9325},"53207":{lat:42.9925,lng:-87.8881},
  "53208":{lat:43.0508,lng:-87.9647},"53209":{lat:43.1322,lng:-87.9633},"53210":{lat:43.0750,lng:-87.9603},
  "53211":{lat:43.0892,lng:-87.8856},"53212":{lat:43.0697,lng:-87.9047},"53213":{lat:43.0617,lng:-88.0078},
  "53214":{lat:43.0153,lng:-87.9897},"53005":{lat:43.0586,lng:-88.1062},"53045":{lat:43.0794,lng:-88.1525},
  "53151":{lat:42.9789,lng:-88.1078},"53066":{lat:43.1117,lng:-88.5037},"53186":{lat:43.0117,lng:-88.2314},
  "53188":{lat:43.0500,lng:-88.2492},"53189":{lat:42.9456,lng:-88.2742},"53105":{lat:42.6822,lng:-88.2789},
  "53144":{lat:42.5847,lng:-87.8636},
  // ── North Carolina — Charlotte metro / Piedmont ──
  "28202":{lat:35.2280,lng:-80.8420},"28203":{lat:35.2090,lng:-80.8580},"28204":{lat:35.2130,lng:-80.8260},
  "28205":{lat:35.2220,lng:-80.8030},"28206":{lat:35.2530,lng:-80.8220},"28207":{lat:35.1960,lng:-80.8260},
  "28208":{lat:35.2290,lng:-80.8970},"28209":{lat:35.1740,lng:-80.8510},"28210":{lat:35.1260,lng:-80.8550},
  "28211":{lat:35.1800,lng:-80.8030},"28212":{lat:35.1960,lng:-80.7400},"28213":{lat:35.2910,lng:-80.7410},
  "28214":{lat:35.2830,lng:-80.9550},"28215":{lat:35.2430,lng:-80.7120},"28216":{lat:35.2810,lng:-80.8830},
  "28217":{lat:35.1710,lng:-80.9020},"28226":{lat:35.1060,lng:-80.8120},"28227":{lat:35.1850,lng:-80.6800},
  "28262":{lat:35.3200,lng:-80.7400},"28269":{lat:35.3200,lng:-80.8050},"28270":{lat:35.1280,lng:-80.7600},
  "28273":{lat:35.1400,lng:-80.9450},"28277":{lat:35.0520,lng:-80.8150},"28278":{lat:35.1300,lng:-81.0200},
  "28078":{lat:35.4060,lng:-80.8660},"28031":{lat:35.4720,lng:-80.8760},"28036":{lat:35.4990,lng:-80.8480},
  "28037":{lat:35.5000,lng:-81.0300},"28115":{lat:35.5850,lng:-80.8100},"28117":{lat:35.5600,lng:-80.9000},
  "28625":{lat:35.7900,lng:-80.8700},"28677":{lat:35.7900,lng:-80.9900},"28025":{lat:35.4000,lng:-80.5600},
  "28027":{lat:35.4300,lng:-80.6400},"28081":{lat:35.4870,lng:-80.6210},"28083":{lat:35.4900,lng:-80.5900},
  "28075":{lat:35.3230,lng:-80.6570},"28107":{lat:35.2350,lng:-80.5100},"28104":{lat:35.0860,lng:-80.6800},
  "28105":{lat:35.1300,lng:-80.7200},"28110":{lat:35.0100,lng:-80.5600},"28112":{lat:34.9600,lng:-80.5200},
  "28079":{lat:35.0760,lng:-80.6400},"28173":{lat:34.9250,lng:-80.7600},"28134":{lat:35.0830,lng:-80.8880},
  "28052":{lat:35.2400,lng:-81.2000},"28054":{lat:35.2700,lng:-81.1500},"28056":{lat:35.2300,lng:-81.1000},
  "28012":{lat:35.2450,lng:-81.0450},"28120":{lat:35.3000,lng:-81.0200},"28092":{lat:35.4700,lng:-81.2300},
  "28144":{lat:35.6400,lng:-80.4500},"28146":{lat:35.6400,lng:-80.4000},
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
