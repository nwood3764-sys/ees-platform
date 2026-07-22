// ─── compute-availability ────────────────────────────────────────────────────
// v5 — per-resource home base, per-territory timezone, and true
//      inter-appointment drive-time routing.
//
// v4 delegated drive-time to compute-route-matrix but only charged travel for
// the FIRST stop of a resource's day (home base → customer), leaving true
// inter-appointment legs as a TODO, hardcoded a single Madison WI home base
// for every resource, and ran the whole slot calendar in America/Chicago.
//
// v5 fixes all three:
//   • Home base is read per-resource from contacts.contact_home_base_lat/lng
//     (falls back to last-known location, then the platform default).
//   • The territory's timezone (service_territories.service_territory_timezone)
//     drives slot generation and is returned to the client so it can render
//     slot times in the customer's local zone (NC = America/New_York).
//   • Every candidate slot now respects drive time on BOTH sides: from the
//     previous appointment (or home base) to the customer, and from the
//     customer to the next appointment. Slots whose one-way drive exceeds the
//     territory's max are dropped ("don't send the auditor 100 miles for a
//     visit 15 minutes after the last one"). All legs come from a single
//     batched compute-route-matrix call (Google Routes when the key is set,
//     estimated distance otherwise), so the request stays fast.
//
// Any drive-time failure degrades to zero-travel (permissive) — identical to
// v4's resilience posture. Public, unauthenticated. Response shape adds
// territory.timezone and territory.max_one_way_drive_minutes.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Ultimate fallback home base when a resource has neither a configured home
// base nor a last-known location. (EES HQ, Madison WI.)
const DEFAULT_HOME_BASE = { lat: 43.0731, lng: -89.3411 }

const DEFAULT_TIMEZONE = "America/Chicago"
const DEFAULT_MAX_ONE_WAY_DRIVE_MINUTES = 240   // used only when a territory sets none
const MAX_DAYS = 28
const DEFAULT_DAYS = 14
const SLOT_INCREMENT_MINUTES = 30
const BUFFER_MINUTES = 15
const LUNCH_MINUTES = 45
const LUNCH_WINDOW_START = "11:30"
const LUNCH_WINDOW_END   = "13:00"
const WORKDAY_PRE_START_OFFSET_MINUTES = 30

interface ReqBody {
  slug:        string
  address:     { street?: string; city?: string; state?: string; zip?: string }
  intake?:     Record<string, number>
  start_date?: string
  days?:       number
}

interface WorkType {
  id:                                    string
  work_type_name:                        string
  work_type_public_slug:                 string
  work_type_duration_minutes:            number
  work_type_duration_per_unit_minutes:   number | null
  work_type_unit_count_intake_field:     string | null
  work_type_customer_facing_description: string | null
  work_type_default_project_record_type: string | null
}

interface Territory {
  id:                          string
  service_territory_name:      string
  service_territory_state:     string
  service_territory_timezone:  string | null
  service_territory_max_one_way_drive_minutes: number | null
}

interface OperatingHours {
  oh_day_of_week:           number
  oh_first_slot_start_time: string
  oh_last_slot_start_time:  string
  oh_is_closed:             boolean
}

interface Resource {
  contact_id:         string
  contact_first_name: string
  contact_last_name:  string
  home_base_lat:      number
  home_base_lng:      number
}

interface ExistingAppt {
  start_iso:      string
  end_iso:        string
  address_street: string | null
  address_city:   string | null
  address_state:  string | null
  address_zip:    string | null
}

interface Absence { start_iso: string; end_iso: string }

interface Slot {
  start_iso:           string
  end_iso:             string
  resource_id:         string
  resource_first_name: string
}

interface LatLng { lat: number; lng: number }
interface CanonicalAddress { street: string; city: string; state: string; zip: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  let body: ReqBody
  try { body = await req.json() } catch { return json({ error: "Invalid JSON body" }, 400) }

  const validationError = validateInput(body)
  if (validationError) return json({ error: validationError }, 400)

  const supabaseUrl    = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server misconfiguration" }, 500)
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const workType = await fetchWorkType(supabase, body.slug)
  if (!workType) {
    return json({ status: "invalid_work_type",
                  message: `No customer-schedulable work type with slug "${body.slug}"`,
                  work_type: null, territory: null, canonical_address: null, slots: [] }, 200)
  }

  const canonicalAddress = await validateAddress(body.address)
  const customerLatLng   = await geocode(canonicalAddress)

  const territory = await resolveTerritory(supabase, canonicalAddress, customerLatLng)
  if (!territory) {
    return json({ status: "out_of_territory",
                  message: "This address is outside our current service area. Submit and a dispatcher will follow up.",
                  work_type: publicWorkType(workType), territory: null,
                  canonical_address: canonicalAddress, slots: [] }, 200)
  }

  const tz          = territory.service_territory_timezone || DEFAULT_TIMEZONE
  const maxDriveMin = territory.service_territory_max_one_way_drive_minutes ?? DEFAULT_MAX_ONE_WAY_DRIVE_MINUTES

  const effectiveDuration = computeEffectiveDuration(workType, body.intake || {})
  if (effectiveDuration <= 0) return json({ error: "Invalid intake — duration could not be computed" }, 400)

  const resources = await findQualifyingResources(supabase, workType.id, territory.id)
  if (resources.length === 0) {
    return json({ status: "no_qualifying_resources",
                  message: "No auditors currently qualified for this assessment type in your area.",
                  work_type: publicWorkType(workType), territory: publicTerritory(territory),
                  canonical_address: canonicalAddress, slots: [] }, 200)
  }

  const startDate = body.start_date ? new Date(body.start_date + "T00:00:00") : todayInZone(tz)
  const days      = Math.min(body.days || DEFAULT_DAYS, MAX_DAYS)
  const dates     = buildDateRange(startDate, days, tz)

  // ── Pass 1: gather each resource's booked appointments + absences per open
  // day. This lets us build ONE drive-time matrix covering every leg we could
  // possibly need before generating slots.
  const opHoursByDateIdx: (OperatingHours | null)[] = []
  for (let i = 0; i < dates.length; i++) {
    const dow = isoDayOfWeek(dates[i], tz)
    opHoursByDateIdx[i] = await fetchOperatingHours(supabase, territory.id, dow)
  }

  const dayData = new Map<string, { existing: ExistingAppt[]; absences: Absence[] }>()
  const apptAddrLabels = new Set<string>()
  for (const resource of resources) {
    for (let i = 0; i < dates.length; i++) {
      const oh = opHoursByDateIdx[i]
      if (!oh || oh.oh_is_closed) continue
      const existing = await fetchResourceDayAppointments(supabase, resource.contact_id, dates[i], tz)
      const absences = await fetchResourceDayAbsences(supabase, resource.contact_id, dates[i], tz)
      dayData.set(`${resource.contact_id}|${i}`, { existing, absences })
      for (const a of existing) {
        const label = apptLabel(a)
        if (label) apptAddrLabels.add(label)
      }
    }
  }

  // ── Drive-time matrix: origins = {home bases} ∪ {customer} ∪ {appt addrs};
  // destinations = {customer} ∪ {appt addrs}. One batched call resolves every
  // leg: home→customer, prevAppt→customer, and customer→nextAppt.
  const drive = await buildDriveTimeLookup({
    supabaseUrl, resources, canonicalAddress, customerLatLng, apptAddrLabels,
  })

  // ── Pass 2: generate slots using real drive times + the max-drive cap.
  const slots: Slot[] = []
  for (let i = 0; i < dates.length; i++) {
    const oh = opHoursByDateIdx[i]
    if (!oh || oh.oh_is_closed) continue
    const orderedResources = await orderByDayFill(supabase, resources, territory.id, dates[i], tz)
    for (const resource of orderedResources) {
      const dd = dayData.get(`${resource.contact_id}|${i}`) || { existing: [], absences: [] }
      const daySlots = generateSlotsForResourceDay({
        resource, date: dates[i], tz, opHours: oh,
        existing: dd.existing, absences: dd.absences,
        duration: effectiveDuration, maxDriveMin, drive,
      })
      slots.push(...daySlots)
    }
  }

  if (slots.length === 0) {
    return json({ status: "no_availability",
                  message: "No availability in the requested window. Try a later date range.",
                  work_type: publicWorkType(workType), territory: publicTerritory(territory),
                  canonical_address: canonicalAddress, slots: [] }, 200)
  }

  slots.sort((a, b) => a.start_iso < b.start_iso ? -1 : a.start_iso > b.start_iso ? 1 : 0)

  return json({ status: "ok",
                work_type: publicWorkType(workType),
                territory: publicTerritory(territory),
                canonical_address: canonicalAddress,
                slots,
                effective_duration_minutes: effectiveDuration }, 200)
})

function validateInput(body: ReqBody): string | null {
  if (!body || typeof body !== "object") return "Body must be a JSON object"
  if (!body.slug || typeof body.slug !== "string") return "slug is required"
  if (!body.address || typeof body.address !== "object") return "address is required"
  if (!body.address.street) return "address.street is required"
  if (!body.address.city)   return "address.city is required"
  if (!body.address.state)  return "address.state is required"
  if (!body.address.zip)    return "address.zip is required"
  if (body.days !== undefined && (body.days < 1 || body.days > MAX_DAYS)) {
    return `days must be between 1 and ${MAX_DAYS}`
  }
  return null
}

async function fetchWorkType(supabase: SupabaseClient, slug: string): Promise<WorkType | null> {
  const { data, error } = await supabase
    .from("work_types")
    .select(`id, work_type_name, work_type_public_slug, work_type_duration_minutes,
             work_type_duration_per_unit_minutes, work_type_unit_count_intake_field,
             work_type_customer_facing_description, work_type_default_project_record_type`)
    .eq("work_type_public_slug", slug)
    .eq("work_type_is_publicly_schedulable", true)
    .eq("work_type_is_deleted", false)
    .eq("work_type_is_active", true)
    .maybeSingle()
  if (error) { console.error("fetchWorkType error", error); return null }
  return data as WorkType | null
}

async function validateAddress(a: ReqBody["address"]): Promise<CanonicalAddress> {
  return {
    street: (a.street || "").trim(),
    city:   (a.city   || "").trim(),
    state:  (a.state  || "").trim().toUpperCase(),
    zip:    (a.zip    || "").trim().substring(0, 5),
  }
}

// Geocode the customer address to coordinates via the Google Geocoding API.
// With a coordinate, territory resolution uses the polygon (statewide), not
// just the seeded ZIP list, and routing uses the precise point. Without the
// GOOGLE_MAPS_API_KEY it returns null and we fall back to ZIP-based territory
// resolution + address-string routing — unchanged pre-key behavior.
async function geocode(addr: CanonicalAddress): Promise<LatLng | null> {
  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY")
  if (!apiKey) return null
  const q = [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(", ")
  if (!q) return null
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${apiKey}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json() as { results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }> }
    const loc = data?.results?.[0]?.geometry?.location
    if (loc && typeof loc.lat === "number" && typeof loc.lng === "number") {
      return { lat: loc.lat, lng: loc.lng }
    }
    return null
  } catch (e) {
    console.error("geocode failed; falling back to ZIP-based resolution", e)
    return null
  }
}

async function resolveTerritory(
  supabase: SupabaseClient,
  address: CanonicalAddress,
  latLng:  LatLng | null,
): Promise<Territory | null> {
  const selectCols = `id, service_territory_name, service_territory_state,
                      service_territory_timezone, service_territory_max_one_way_drive_minutes`
  if (latLng) {
    const { data: polyMatches } = await supabase.rpc("resolve_territory_by_point", {
      p_lat: latLng.lat, p_lng: latLng.lng,
    })
    if (polyMatches && polyMatches.length > 0) {
      // resolve_territory_by_point may not project the new columns; re-fetch full row.
      const { data: full } = await supabase.from("service_territories")
        .select(selectCols).eq("id", (polyMatches[0] as any).id).maybeSingle()
      if (full) return full as Territory
      return polyMatches[0] as Territory
    }
  }
  const { data: zipMatches, error } = await supabase
    .from("service_territory_zips")
    .select(`service_territory_id,
             service_territories!inner (
               id, service_territory_name, service_territory_state,
               service_territory_timezone, service_territory_max_one_way_drive_minutes,
               service_territory_is_active, service_territory_is_deleted
             )`)
    .eq("stz_zip_code", address.zip)
    .eq("stz_is_deleted", false)
    .eq("service_territories.service_territory_is_active", true)
    .eq("service_territories.service_territory_is_deleted", false)
    .limit(1)
  if (error) { console.error("resolveTerritory ZIP error", error); return null }
  if (!zipMatches || zipMatches.length === 0) return null
  const t = (zipMatches[0] as any).service_territories
  return {
    id: t.id,
    service_territory_name: t.service_territory_name,
    service_territory_state: t.service_territory_state,
    service_territory_timezone: t.service_territory_timezone,
    service_territory_max_one_way_drive_minutes: t.service_territory_max_one_way_drive_minutes,
  }
}

function computeEffectiveDuration(wt: WorkType, intake: Record<string, number>): number {
  const base = Number(wt.work_type_duration_minutes) || 0
  if (wt.work_type_duration_per_unit_minutes && wt.work_type_unit_count_intake_field) {
    const unitCount = Number(intake[wt.work_type_unit_count_intake_field]) || 0
    if (unitCount > 0) return Math.max(1, unitCount * Number(wt.work_type_duration_per_unit_minutes))
  }
  return base
}

async function findQualifyingResources(
  supabase: SupabaseClient,
  workTypeId: string,
  territoryId: string,
): Promise<Resource[]> {
  const { data: reqs, error: reqsErr } = await supabase
    .from("work_type_skill_requirements")
    .select("skill_id")
    .eq("work_type_id", workTypeId)
    .eq("wtsr_is_deleted", false)
  if (reqsErr) { console.error("reqs error", reqsErr); return [] }
  const requiredSkillIds: string[] = (reqs || []).map((r: any) => r.skill_id)

  const { data: techIds, error: techErr } = await supabase.rpc("technicians_in_territory", { p_territory_id: territoryId })
  if (techErr) { console.error("technicians_in_territory error", techErr); return [] }
  const technicianContactIds: string[] = (techIds || []).map((r: any) => r.contact_id)
  if (technicianContactIds.length === 0) return []

  const qualifying: Resource[] = []
  for (const cid of technicianContactIds) {
    if (requiredSkillIds.length > 0) {
      const { count } = await supabase.from("contact_skills").select("id", { count: "exact", head: true })
        .eq("contact_id", cid).in("skill_id", requiredSkillIds).eq("cs_is_deleted", false)
      if ((count || 0) < requiredSkillIds.length) continue
    }
    const { data: c } = await supabase.from("contacts")
      .select(`id, contact_first_name, contact_last_name,
               contact_home_base_latitude, contact_home_base_longitude,
               contact_last_known_latitude, contact_last_known_longitude`)
      .eq("id", cid).eq("contact_is_deleted", false).maybeSingle()
    if (!c) continue
    const homeLat = numOr((c as any).contact_home_base_latitude,
                          numOr((c as any).contact_last_known_latitude, DEFAULT_HOME_BASE.lat))
    const homeLng = numOr((c as any).contact_home_base_longitude,
                          numOr((c as any).contact_last_known_longitude, DEFAULT_HOME_BASE.lng))
    qualifying.push({
      contact_id: (c as any).id,
      contact_first_name: (c as any).contact_first_name,
      contact_last_name: (c as any).contact_last_name,
      home_base_lat: homeLat,
      home_base_lng: homeLng,
    })
  }
  return qualifying
}

function numOr(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) && v !== null && v !== undefined && v !== "" ? n : fallback
}

// ─── Drive-time lookup ───────────────────────────────────────────────────────
// One batched compute-route-matrix call, exposed as drive.minutes(fromKey,
// toKey). Keys:
//   'home:<contact_id>'  home base of a resource (sent as coordinates)
//   'cust'               the customer address (sent as address or coordinates)
//   'appt:<label>'       an existing appointment address (sent as address)
// A missing pair, or any matrix failure, yields 0 minutes — permissive, so a
// data gap never blocks a booking.
interface DriveLookup {
  minutes(fromKey: string, toKey: string): number
  homeKey(contactId: string): string
  apptKey(label: string): string
  custKey: string
}

interface DriveArgs {
  supabaseUrl:      string
  resources:        Resource[]
  canonicalAddress: CanonicalAddress
  customerLatLng:   LatLng | null
  apptAddrLabels:   Set<string>
}

async function buildDriveTimeLookup(args: DriveArgs): Promise<DriveLookup> {
  const { supabaseUrl, resources, canonicalAddress, customerLatLng, apptAddrLabels } = args

  const homeKey = (cid: string) => `home:${cid}`
  const apptKey = (label: string) => `appt:${label}`
  const custKey = "cust"

  const custWaypoint = customerLatLng
    ? { coordinates: { lat: customerLatLng.lat, lng: customerLatLng.lng } }
    : { address: { street: canonicalAddress.street, city: canonicalAddress.city,
                   state: canonicalAddress.state, zip: canonicalAddress.zip } }

  const labelToAddress = (label: string) => {
    const [street, city, stZip] = splitLabel(label)
    return { address: { street, city, state: stZip.state, zip: stZip.zip } }
  }

  // Origins: each distinct home base + customer + each appt address.
  const originKeys: string[] = []
  const originWps: any[] = []
  const seenOrigin = new Set<string>()
  for (const r of resources) {
    const k = homeKey(r.contact_id)
    if (!seenOrigin.has(k)) {
      seenOrigin.add(k); originKeys.push(k)
      originWps.push({ coordinates: { lat: r.home_base_lat, lng: r.home_base_lng } })
    }
  }
  originKeys.push(custKey); originWps.push(custWaypoint)
  for (const label of apptAddrLabels) {
    originKeys.push(apptKey(label)); originWps.push(labelToAddress(label))
  }

  // Destinations: customer + each appt address.
  const destKeys: string[] = [custKey]
  const destWps: any[] = [custWaypoint]
  for (const label of apptAddrLabels) {
    destKeys.push(apptKey(label)); destWps.push(labelToAddress(label))
  }

  const originIdx = new Map(originKeys.map((k, i) => [k, i]))
  const destIdx   = new Map(destKeys.map((k, i) => [k, i]))
  const mins: number[][] = []   // mins[originIndex][destIndex]

  // compute-route-matrix caps at 25 origins/destinations. For a single-auditor
  // territory this is never hit, but guard rather than send an over-limit call.
  if (originWps.length <= 25 && destWps.length <= 25) {
    try {
      const base = supabaseUrl.endsWith("/") ? supabaseUrl.slice(0, -1) : supabaseUrl
      const url = `${base}/functions/v1/compute-route-matrix`
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origins: originWps, destinations: destWps, traffic_aware: true }),
      })
      if (res.ok) {
        const data = await res.json() as {
          status: string
          results: Array<{ origin_index: number; destination_index: number; duration_seconds: number }>
        }
        if (data?.status === "ok" && Array.isArray(data.results)) {
          for (const cell of data.results) {
            if (!mins[cell.origin_index]) mins[cell.origin_index] = []
            mins[cell.origin_index][cell.destination_index] = Math.round((cell.duration_seconds || 0) / 60)
          }
        }
      } else {
        console.error(`compute-route-matrix returned ${res.status}; zero-travel fallback`)
      }
    } catch (e) {
      console.error("compute-route-matrix threw; zero-travel fallback", e)
    }
  } else {
    console.error(`route matrix skipped: ${originWps.length} origins x ${destWps.length} dests exceeds cap`)
  }

  return {
    homeKey, apptKey, custKey,
    minutes(fromKey: string, toKey: string): number {
      const oi = originIdx.get(fromKey)
      const di = destIdx.get(toKey)
      if (oi == null || di == null) return 0
      return mins[oi]?.[di] ?? 0
    },
  }
}

function apptLabel(a: ExistingAppt): string {
  return [a.address_street, a.address_city, a.address_state, a.address_zip].filter(Boolean).join(", ")
}

// Inverse of apptLabel — recover the address parts. The label is
// "street, city, ST, zip" but any part may be missing; reconstruct best-effort.
function splitLabel(label: string): [string, string, { state: string; zip: string }] {
  const parts = label.split(",").map(s => s.trim())
  const looksZip   = (s: string) => s.length >= 3 && s.length <= 5 && [...s].every(ch => ch >= "0" && ch <= "9")
  const looksState = (s: string) => s.length === 2 && [...s].every(ch => (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z"))
  const zip   = parts.length && looksZip(parts[parts.length - 1]) ? parts.pop()! : ""
  const state = parts.length && looksState(parts[parts.length - 1]) ? parts.pop()! : ""
  const street = parts.shift() || ""
  const city   = parts.join(", ")
  return [street, city, { state, zip }]
}

async function fetchOperatingHours(supabase: SupabaseClient, territoryId: string, dayOfWeek: number): Promise<OperatingHours | null> {
  const { data } = await supabase.from("operating_hours")
    .select("oh_day_of_week, oh_first_slot_start_time, oh_last_slot_start_time, oh_is_closed")
    .eq("service_territory_id", territoryId).eq("oh_day_of_week", dayOfWeek).eq("oh_is_deleted", false).maybeSingle()
  return data as OperatingHours | null
}

async function fetchResourceDayAppointments(supabase: SupabaseClient, contactId: string, date: Date, tz: string): Promise<ExistingAppt[]> {
  const { start, end } = zonedDayBounds(date, tz)
  const { data, error } = await supabase.rpc("appointments_for_resource_in_window", {
    p_contact_id: contactId, p_window_start: start.toISOString(), p_window_end: end.toISOString(),
  })
  if (error) { console.error("appointments rpc error", error); return [] }
  return (data || []) as ExistingAppt[]
}

async function fetchResourceDayAbsences(supabase: SupabaseClient, contactId: string, date: Date, tz: string): Promise<Absence[]> {
  const { start, end } = zonedDayBounds(date, tz)
  const { data } = await supabase.from("resource_absences")
    .select("ra_start_datetime, ra_end_datetime")
    .eq("contact_id", contactId).eq("ra_is_deleted", false)
    .lte("ra_start_datetime", end.toISOString()).gte("ra_end_datetime", start.toISOString())
  return (data || []).map((a: any) => ({ start_iso: a.ra_start_datetime, end_iso: a.ra_end_datetime }))
}

async function orderByDayFill(supabase: SupabaseClient, resources: Resource[], territoryId: string, date: Date, tz: string): Promise<Resource[]> {
  const { start, end } = zonedDayBounds(date, tz)
  const counts: Record<string, number> = {}
  for (const r of resources) {
    const { data: count } = await supabase.rpc("count_appts_for_resource_in_territory_day", {
      p_contact_id: r.contact_id, p_territory_id: territoryId,
      p_window_start: start.toISOString(), p_window_end: end.toISOString(),
    })
    counts[r.contact_id] = Number(count) || 0
  }
  return [...resources].sort((a, b) => (counts[b.contact_id] || 0) - (counts[a.contact_id] || 0))
}

interface SlotCtx {
  resource: Resource; date: Date; tz: string; opHours: OperatingHours;
  existing: ExistingAppt[]; absences: Absence[]; duration: number;
  maxDriveMin: number; drive: DriveLookup;
}

function generateSlotsForResourceDay(ctx: SlotCtx): Slot[] {
  const { resource, date, tz, opHours, existing, absences, duration, maxDriveMin, drive } = ctx
  const result: Slot[] = []
  const firstSlot = combineDateAndTime(date, opHours.oh_first_slot_start_time, tz)
  const lastSlotStart = combineDateAndTime(date, opHours.oh_last_slot_start_time, tz)
  const workdayStart = new Date(firstSlot.getTime() - WORKDAY_PRE_START_OFFSET_MINUTES * 60_000)
  const apptsSorted = [...existing].sort((a, b) => a.start_iso.localeCompare(b.start_iso))

  for (let t = firstSlot.getTime(); t <= lastSlotStart.getTime(); t += SLOT_INCREMENT_MINUTES * 60_000) {
    const candidateStart = new Date(t)
    const candidateEnd   = new Date(t + duration * 60_000)
    if (candidateEnd.getTime() > lastSlotStart.getTime() + duration * 60_000) break
    if (overlapsAny(apptsSorted, candidateStart, candidateEnd, BUFFER_MINUTES)) continue
    if (absences.some(a => intervalsOverlap(new Date(a.start_iso), new Date(a.end_iso), candidateStart, candidateEnd))) continue

    const prev = lastApptBefore(apptsSorted, candidateStart)
    const next = firstApptAfter(apptsSorted, candidateEnd)

    // Leg INTO the candidate: from the previous appointment (or, for the first
    // stop of the day, from the resource's home base) to the customer.
    const originKey  = prev ? drive.apptKey(apptLabel(prev)) : drive.homeKey(resource.contact_id)
    const driveIn    = drive.minutes(originKey, drive.custKey)
    if (driveIn > maxDriveMin) continue    // too far to send them for this stop

    const readyBaseMs = prev
      ? new Date(prev.end_iso).getTime() + BUFFER_MINUTES * 60_000
      : workdayStart.getTime()
    if (readyBaseMs + driveIn * 60_000 > candidateStart.getTime()) continue

    // Leg OUT of the candidate: from the customer to the next appointment.
    if (next) {
      const driveOut = drive.minutes(drive.custKey, drive.apptKey(apptLabel(next)))
      if (driveOut > maxDriveMin) continue
      const nextReadyMs = candidateEnd.getTime() + (BUFFER_MINUTES + driveOut) * 60_000
      if (nextReadyMs > new Date(next.start_iso).getTime()) continue
    }

    const scheduleWithCandidate = [...apptsSorted, {
      start_iso: candidateStart.toISOString(), end_iso: candidateEnd.toISOString(),
      address_street: null, address_city: null, address_state: null, address_zip: null,
    }].sort((a, b) => a.start_iso.localeCompare(b.start_iso))
    if (!lunchFits(scheduleWithCandidate, date, tz)) continue

    result.push({
      start_iso: candidateStart.toISOString(), end_iso: candidateEnd.toISOString(),
      resource_id: resource.contact_id, resource_first_name: resource.contact_first_name,
    })
  }
  return result
}

function overlapsAny(appts: ExistingAppt[], start: Date, end: Date, bufferMin: number): boolean {
  const bMs = bufferMin * 60_000
  for (const a of appts) {
    const aS = new Date(a.start_iso).getTime() - bMs
    const aE = new Date(a.end_iso).getTime()   + bMs
    if (start.getTime() < aE && end.getTime() > aS) return true
  }
  return false
}

function intervalsOverlap(aS: Date, aE: Date, bS: Date, bE: Date): boolean {
  return aS.getTime() < bE.getTime() && bS.getTime() < aE.getTime()
}

function lastApptBefore(appts: ExistingAppt[], when: Date): ExistingAppt | null {
  let last: ExistingAppt | null = null
  for (const a of appts) {
    if (new Date(a.end_iso).getTime() <= when.getTime()) last = a
    else break
  }
  return last
}

function firstApptAfter(appts: ExistingAppt[], when: Date): ExistingAppt | null {
  for (const a of appts) {
    if (new Date(a.start_iso).getTime() >= when.getTime()) return a
  }
  return null
}

function lunchFits(scheduled: ExistingAppt[], date: Date, tz: string): boolean {
  const winStart = combineDateAndTime(date, LUNCH_WINDOW_START, tz).getTime()
  const winEnd   = combineDateAndTime(date, LUNCH_WINDOW_END, tz).getTime()
  const lunchLenMs = LUNCH_MINUTES * 60_000
  let cursor = winStart
  for (const a of scheduled) {
    const aS = new Date(a.start_iso).getTime()
    const aE = new Date(a.end_iso).getTime()
    if (aE <= cursor) continue
    if (aS >= winEnd) break
    if (aS - cursor >= lunchLenMs && cursor + lunchLenMs <= winEnd) return true
    cursor = Math.max(cursor, aE)
  }
  return cursor + lunchLenMs <= winEnd
}

// ─── timezone-aware date helpers (parameterized by IANA tz) ──────────────────

function zonedDateTimeToUTC(tz: string, y: number, mo0: number, d: number, h: number, mi: number): Date {
  const naive = new Date(Date.UTC(y, mo0, d, h, mi, 0))
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
  const parts = dtf.formatToParts(naive)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
  const hh = get("hour")
  const zonedMs = Date.UTC(get("year"), get("month") - 1, get("day"), hh === 24 ? 0 : hh, get("minute"), get("second"))
  const offsetMs = zonedMs - naive.getTime()
  return new Date(naive.getTime() - offsetMs)
}

function zonedYMD(d: Date, tz: string): { y: number; mo0: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  })
  const parts = dtf.formatToParts(d)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
  return { y: get("year"), mo0: get("month") - 1, d: get("day") }
}

function combineDateAndTime(date: Date, hhmm: string, tz: string): Date {
  const [hStr, mStr] = hhmm.split(":")
  const h = parseInt(hStr, 10) || 0
  const m = parseInt(mStr, 10) || 0
  const { y, mo0, d } = zonedYMD(date, tz)
  return zonedDateTimeToUTC(tz, y, mo0, d, h, m)
}

function todayInZone(tz: string): Date {
  const { y, mo0, d } = zonedYMD(new Date(), tz)
  return zonedDateTimeToUTC(tz, y, mo0, d, 0, 0)
}

function buildDateRange(start: Date, days: number, tz: string): Date[] {
  const out: Date[] = []
  const { y, mo0, d } = zonedYMD(start, tz)
  for (let i = 0; i < days; i++) out.push(zonedDateTimeToUTC(tz, y, mo0, d + i, 0, 0))
  return out
}

function isoDayOfWeek(d: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" })
  const wkShort = dtf.format(d)
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  return map[wkShort] ?? 1
}

function zonedDayBounds(date: Date, tz: string): { start: Date; end: Date } {
  const { y, mo0, d } = zonedYMD(date, tz)
  const start = zonedDateTimeToUTC(tz, y, mo0, d, 0, 0)
  const end   = new Date(zonedDateTimeToUTC(tz, y, mo0, d + 1, 0, 0).getTime() - 1)
  return { start, end }
}

function publicWorkType(wt: WorkType) {
  return {
    id: wt.id, name: wt.work_type_name, slug: wt.work_type_public_slug,
    duration_minutes: Number(wt.work_type_duration_minutes),
    duration_per_unit_minutes: wt.work_type_duration_per_unit_minutes,
    unit_count_intake_field: wt.work_type_unit_count_intake_field,
    customer_facing_description: wt.work_type_customer_facing_description,
  }
}

function publicTerritory(t: Territory) {
  return {
    id: t.id, name: t.service_territory_name, state: t.service_territory_state,
    timezone: t.service_territory_timezone || DEFAULT_TIMEZONE,
    max_one_way_drive_minutes: t.service_territory_max_one_way_drive_minutes ?? DEFAULT_MAX_ONE_WAY_DRIVE_MINUTES,
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
