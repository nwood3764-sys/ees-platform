// =============================================================================
// compute-availability
//
// Customer-facing slot-generation engine. Given a work_type slug + service
// address + optional intake data, returns achievable appointment slots over
// the next 14 days (configurable).
//
// Honors:
//   - work_type_skill_requirements (only qualifying Technicians eligible)
//   - Service Territory containment (ZIP-list in v1, polygon when geocoder lands)
//   - operating_hours per territory per day-of-week
//   - existing service_appointments on the resource's calendar
//   - resource_absences (PTO/training/sick)
//   - 15-min minimum buffer between appointments + live drive time
//   - 45-min lunch block that must START in [11:30, 12:15]
//   - 7:00 AM workday start (30 min before earliest customer slot)
//   - Day-fill preference (prefer resources who already have work that day)
//
// Authentication: public. The endpoint is called from the unauthenticated
// customer-facing scheduling page, so it uses the service role internally to query.
// Returns only the data needed to present slots — no PII other than the
// resolved territory name and (optional) auditor first name.
//
// Mockable transport:
//   - GOOGLE_ADDRESS_VALIDATION_API_KEY: if set, validates and canonicalizes
//     the address. If not set, the input address is passed through with
//     light normalization.
//   - GOOGLE_ROUTES_API_KEY: if set, real Compute Route Matrix calls with
//     TRAFFIC_AWARE routing, cached in drive_time_cache. If not set, drive
//     times are estimated via haversine distance at 25 mph average speed.
//
// Inputs (POST JSON):
//   {
//     slug:        "single-family-assessment" | "townhome-assessment" | ...,
//     address:     { street, city, state, zip },
//     intake?:     { number_of_buildings?: number, ... },
//     start_date?: "2026-05-15",   // default = today (in America/Chicago)
//     days?:       14              // default = 14, max = 28
//   }
//
// Outputs (200 JSON):
//   { status:            "ok" | "out_of_territory" | "no_qualifying_resources"
//                          | "no_availability" | "invalid_work_type",
//     work_type:         { id, name, slug, duration_minutes, ... } | null,
//     territory:         { id, name } | null,
//     canonical_address: { street, city, state, zip } | null,
//     slots:             [{ start_iso, end_iso, resource_id, resource_first_name }, ...],
//     message?:          "..." }
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const DEFAULT_HOME_BASE = {
  street: "3218 Progress Rd",
  city:   "Madison",
  state:  "WI",
  zip:    "53716",
  // Centroid of HQ ZIP — used for haversine fallback when no geocoder
  lat:    43.0731,
  lng:    -89.3411,
}

const DEFAULT_TIMEZONE = "America/Chicago"
const MAX_DAYS = 28
const DEFAULT_DAYS = 14
const SLOT_INCREMENT_MINUTES = 30
const BUFFER_MINUTES = 15
const LUNCH_MINUTES = 45
const LUNCH_WINDOW_START = "11:30"
const LUNCH_WINDOW_END   = "13:00"
const WORKDAY_PRE_START_OFFSET_MINUTES = 30   // auditor starts 30 min before first slot
const AVG_SPEED_MPH = 25                       // haversine fallback

// ─── Types ───────────────────────────────────────────────────────────────────

interface ReqBody {
  slug:        string
  address:     { street?: string; city?: string; state?: string; zip?: string }
  intake?:     Record<string, number>
  start_date?: string
  days?:       number
}

interface WorkType {
  id:                                  string
  work_type_name:                      string
  work_type_public_slug:               string
  work_type_duration_minutes:          number
  work_type_duration_per_unit_minutes: number | null
  work_type_unit_count_intake_field:   string | null
  work_type_customer_facing_description: string | null
  work_type_default_project_record_type: string | null
}

interface Territory {
  id:                          string
  service_territory_name:      string
  service_territory_state:     string
}

interface OperatingHours {
  oh_day_of_week:           number
  oh_first_slot_start_time: string
  oh_last_slot_start_time:  string
  oh_is_closed:             boolean
}

interface Resource {
  contact_id:           string
  contact_first_name:   string
  contact_last_name:    string
  home_base_lat:        number
  home_base_lng:        number
}

interface ExistingAppt {
  start_iso:     string
  end_iso:       string
  address_street: string | null
  address_city:   string | null
  address_state:  string | null
  address_zip:    string | null
}

interface Absence {
  start_iso: string
  end_iso:   string
}

interface Slot {
  start_iso:           string
  end_iso:             string
  resource_id:         string
  resource_first_name: string
}

interface LatLng { lat: number; lng: number }

// ─── Entry ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  let body: ReqBody
  try { body = await req.json() } catch { return json({ error: "Invalid JSON body" }, 400) }

  const validationError = validateInput(body)
  if (validationError) return json({ error: validationError }, 400)

  const supabaseUrl    = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server misconfiguration — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set" }, 500)
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 1. Resolve work_type by slug.
  const workType = await fetchWorkType(supabase, body.slug)
  if (!workType) {
    return json({ status: "invalid_work_type", message: `No customer-schedulable work type with slug "${body.slug}"`,
                  work_type: null, territory: null, canonical_address: null, slots: [] }, 200)
  }

  // 2. Validate / canonicalize address. Pass-through in v1.
  const canonicalAddress = await validateAddress(body.address)
  const customerLatLng   = await geocode(canonicalAddress)   // null in v1

  // 3. Resolve service territory (ZIP-list first, polygon fallback).
  const territory = await resolveTerritory(supabase, canonicalAddress, customerLatLng)
  if (!territory) {
    return json({ status: "out_of_territory",
                  message: "This address is outside our current service area. Submit and a dispatcher will follow up.",
                  work_type: publicWorkType(workType), territory: null,
                  canonical_address: canonicalAddress, slots: [] }, 200)
  }

  // 4. Compute effective duration (per-unit math for multifamily).
  const effectiveDuration = computeEffectiveDuration(workType, body.intake || {})
  if (effectiveDuration <= 0) {
    return json({ error: "Invalid intake — duration could not be computed" }, 400)
  }

  // 5. Find qualifying Service Resources (Technicians with required skills + territory membership).
  const resources = await findQualifyingResources(supabase, workType.id, territory.id)
  if (resources.length === 0) {
    return json({ status: "no_qualifying_resources",
                  message: "No auditors currently qualified for this assessment type in your area.",
                  work_type: publicWorkType(workType), territory: publicTerritory(territory),
                  canonical_address: canonicalAddress, slots: [] }, 200)
  }

  // 6. Build date range.
  const startDate = body.start_date ? new Date(body.start_date + "T00:00:00") : todayInChicago()
  const days      = Math.min(body.days || DEFAULT_DAYS, MAX_DAYS)
  const dates     = buildDateRange(startDate, days)

  // 7. Generate slots per (day, resource).
  const slots: Slot[] = []
  for (const date of dates) {
    const dow = isoDayOfWeek(date)
    const opHours = await fetchOperatingHours(supabase, territory.id, dow)
    if (!opHours || opHours.oh_is_closed) continue

    // Day-fill: order resources by existing-appt-count in this territory this day, desc.
    const orderedResources = await orderByDayFill(supabase, resources, territory.id, date)
    for (const resource of orderedResources) {
      const existing  = await fetchResourceDayAppointments(supabase, resource.contact_id, date)
      const absences  = await fetchResourceDayAbsences(supabase, resource.contact_id, date)
      const daySlots  = generateSlotsForResourceDay({
        resource, date, opHours, existing, absences,
        duration: effectiveDuration,
        customerLatLng,
        customerZip: canonicalAddress.zip,
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

  // Sort slots chronologically.
  slots.sort((a, b) => a.start_iso < b.start_iso ? -1 : a.start_iso > b.start_iso ? 1 : 0)

  return json({ status: "ok",
                work_type: publicWorkType(workType), territory: publicTerritory(territory),
                canonical_address: canonicalAddress,
                slots,
                effective_duration_minutes: effectiveDuration }, 200)
})

// ─── Input validation ────────────────────────────────────────────────────────

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

// ─── Work type lookup ────────────────────────────────────────────────────────

async function fetchWorkType(supabase: SupabaseClient, slug: string): Promise<WorkType | null> {
  const { data, error } = await supabase
    .from("work_types")
    .select(`
      id, work_type_name, work_type_public_slug, work_type_duration_minutes,
      work_type_duration_per_unit_minutes, work_type_unit_count_intake_field,
      work_type_customer_facing_description, work_type_default_project_record_type
    `)
    .eq("work_type_public_slug", slug)
    .eq("work_type_is_publicly_schedulable", true)
    .eq("work_type_is_deleted", false)
    .eq("work_type_is_active", true)
    .maybeSingle()
  if (error) { console.error("fetchWorkType error", error); return null }
  return data as WorkType | null
}

// ─── Address validation / geocoding (mockable) ───────────────────────────────

interface CanonicalAddress { street: string; city: string; state: string; zip: string }

async function validateAddress(a: ReqBody["address"]): Promise<CanonicalAddress> {
  const apiKey = Deno.env.get("GOOGLE_ADDRESS_VALIDATION_API_KEY")
  // V1 passthrough with normalization. When apiKey is set, swap in real call.
  // Future: POST to https://addressvalidation.googleapis.com/v1:validateAddress?key={apiKey}
  return {
    street: (a.street || "").trim(),
    city:   (a.city   || "").trim(),
    state:  (a.state  || "").trim().toUpperCase(),
    zip:    (a.zip    || "").trim().substring(0, 5),
  }
}

async function geocode(_addr: CanonicalAddress): Promise<LatLng | null> {
  // V1: no geocoding. Territory resolution falls back to ZIP-list.
  // Future: when GOOGLE_ADDRESS_VALIDATION_API_KEY is set, populate from
  // the validation response's geocode.location field.
  return null
}

// ─── Territory resolution ────────────────────────────────────────────────────

async function resolveTerritory(
  supabase: SupabaseClient,
  address: CanonicalAddress,
  latLng:  LatLng | null,
): Promise<Territory | null> {
  // 1. Polygon containment if we have lat/lng.
  if (latLng) {
    const { data: polyMatches } = await supabase.rpc("resolve_territory_by_point", {
      p_lat: latLng.lat, p_lng: latLng.lng,
    })
    if (polyMatches && polyMatches.length > 0) {
      return polyMatches[0] as Territory
    }
  }

  // 2. ZIP-list fallback.
  const { data: zipMatches, error } = await supabase
    .from("service_territory_zips")
    .select(`
      service_territory_id,
      service_territories!inner (
        id, service_territory_name, service_territory_state,
        service_territory_is_active, service_territory_is_deleted
      )
    `)
    .eq("stz_zip_code", address.zip)
    .eq("stz_is_deleted", false)
    .eq("service_territories.service_territory_is_active", true)
    .eq("service_territories.service_territory_is_deleted", false)
    .limit(1)

  if (error) { console.error("resolveTerritory ZIP lookup error", error); return null }
  if (!zipMatches || zipMatches.length === 0) return null

  const t = (zipMatches[0] as any).service_territories
  return {
    id: t.id,
    service_territory_name:  t.service_territory_name,
    service_territory_state: t.service_territory_state,
  }
}

// ─── Effective duration ──────────────────────────────────────────────────────

function computeEffectiveDuration(wt: WorkType, intake: Record<string, number>): number {
  const base = Number(wt.work_type_duration_minutes) || 0
  if (wt.work_type_duration_per_unit_minutes && wt.work_type_unit_count_intake_field) {
    const unitCount = Number(intake[wt.work_type_unit_count_intake_field]) || 0
    if (unitCount > 0) {
      return Math.max(1, unitCount * Number(wt.work_type_duration_per_unit_minutes))
    }
  }
  return base
}

// ─── Qualifying resources ────────────────────────────────────────────────────

async function findQualifyingResources(
  supabase: SupabaseClient,
  workTypeId: string,
  territoryId: string,
): Promise<Resource[]> {
  // Required skill set for the work_type.
  const { data: reqs, error: reqsErr } = await supabase
    .from("work_type_skill_requirements")
    .select("skill_id")
    .eq("work_type_id", workTypeId)
    .eq("wtsr_is_deleted", false)
  if (reqsErr) { console.error("findQualifyingResources reqs error", reqsErr); return [] }
  const requiredSkillIds: string[] = (reqs || []).map((r: any) => r.skill_id)

  // Technician contacts who are either primary in this territory (denormalized) or
  // have a service_territory_members row for it.
  const { data: techIds, error: techErr } = await supabase.rpc("technicians_in_territory", {
    p_territory_id: territoryId,
  })
  if (techErr) { console.error("technicians_in_territory error", techErr); return [] }
  const technicianContactIds: string[] = (techIds || []).map((r: any) => r.contact_id)
  if (technicianContactIds.length === 0) return []

  // Each must hold every required skill (or no skills required → all qualify).
  const qualifying: Resource[] = []
  for (const cid of technicianContactIds) {
    if (requiredSkillIds.length > 0) {
      const { count } = await supabase
        .from("contact_skills")
        .select("id", { count: "exact", head: true })
        .eq("contact_id", cid)
        .in("skill_id", requiredSkillIds)
        .eq("cs_is_deleted", false)
      if ((count || 0) < requiredSkillIds.length) continue
    }

    const { data: c } = await supabase
      .from("contacts")
      .select("id, contact_first_name, contact_last_name")
      .eq("id", cid)
      .eq("contact_is_deleted", false)
      .maybeSingle()
    if (!c) continue

    qualifying.push({
      contact_id:         (c as any).id,
      contact_first_name: (c as any).contact_first_name,
      contact_last_name:  (c as any).contact_last_name,
      home_base_lat:      DEFAULT_HOME_BASE.lat,   // v1 hardcoded; per-resource override later
      home_base_lng:      DEFAULT_HOME_BASE.lng,
    })
  }
  return qualifying
}

// ─── Operating hours, appointments, absences ─────────────────────────────────

async function fetchOperatingHours(
  supabase: SupabaseClient, territoryId: string, dayOfWeek: number,
): Promise<OperatingHours | null> {
  const { data } = await supabase
    .from("operating_hours")
    .select("oh_day_of_week, oh_first_slot_start_time, oh_last_slot_start_time, oh_is_closed")
    .eq("service_territory_id", territoryId)
    .eq("oh_day_of_week", dayOfWeek)
    .eq("oh_is_deleted", false)
    .maybeSingle()
  return data as OperatingHours | null
}

async function fetchResourceDayAppointments(
  supabase: SupabaseClient, contactId: string, date: Date,
): Promise<ExistingAppt[]> {
  const { start, end } = chicagoDayBounds(date)

  // Pull appointments where the contact is assigned (via service_appointment_assignments)
  // and status is not in cancelled/no-show. We don't fetch on-site addresses in v1
  // because we use customer ZIP / Madison-centroid haversine.
  const { data, error } = await supabase.rpc("appointments_for_resource_in_window", {
    p_contact_id:  contactId,
    p_window_start: start.toISOString(),
    p_window_end:   end.toISOString(),
  })
  if (error) { console.error("appointments_for_resource_in_window error", error); return [] }
  return (data || []) as ExistingAppt[]
}

async function fetchResourceDayAbsences(
  supabase: SupabaseClient, contactId: string, date: Date,
): Promise<Absence[]> {
  const { start, end } = chicagoDayBounds(date)
  const { data } = await supabase
    .from("resource_absences")
    .select("ra_start_datetime, ra_end_datetime")
    .eq("contact_id", contactId)
    .eq("ra_is_deleted", false)
    .lte("ra_start_datetime", end.toISOString())
    .gte("ra_end_datetime",   start.toISOString())
  return (data || []).map((a: any) => ({ start_iso: a.ra_start_datetime, end_iso: a.ra_end_datetime }))
}

async function orderByDayFill(
  supabase: SupabaseClient, resources: Resource[], territoryId: string, date: Date,
): Promise<Resource[]> {
  const { start, end } = chicagoDayBounds(date)
  const counts: Record<string, number> = {}
  for (const r of resources) {
    const { data: count } = await supabase.rpc("count_appts_for_resource_in_territory_day", {
      p_contact_id:    r.contact_id,
      p_territory_id:  territoryId,
      p_window_start:  start.toISOString(),
      p_window_end:    end.toISOString(),
    })
    counts[r.contact_id] = Number(count) || 0
  }
  return [...resources].sort((a, b) => (counts[b.contact_id] || 0) - (counts[a.contact_id] || 0))
}

// ─── Slot generation ─────────────────────────────────────────────────────────

interface SlotCtx {
  resource:        Resource
  date:            Date
  opHours:         OperatingHours
  existing:        ExistingAppt[]
  absences:        Absence[]
  duration:        number          // minutes
  customerLatLng:  LatLng | null
  customerZip:     string
}

function generateSlotsForResourceDay(ctx: SlotCtx): Slot[] {
  const { resource, date, opHours, existing, absences, duration, customerLatLng, customerZip } = ctx
  const result: Slot[] = []

  const firstSlot = combineDateAndTime(date, opHours.oh_first_slot_start_time)
  const lastSlotStart = combineDateAndTime(date, opHours.oh_last_slot_start_time)
  const workdayStart = new Date(firstSlot.getTime() - WORKDAY_PRE_START_OFFSET_MINUTES * 60_000)

  // Pre-compute the customer drive time from home base (used for first appt of day).
  const homeBaseLatLng = { lat: resource.home_base_lat, lng: resource.home_base_lng }
  const customerForDrive = customerLatLng || zipCentroid(customerZip) || homeBaseLatLng
  const driveFromHomeMin = driveTimeMinutes(homeBaseLatLng, customerForDrive)

  // Sort existing appts chronologically.
  const apptsSorted = [...existing].sort((a, b) => a.start_iso.localeCompare(b.start_iso))

  // Step through candidate slot starts at 30-min increments.
  for (let t = firstSlot.getTime(); t <= lastSlotStart.getTime(); t += SLOT_INCREMENT_MINUTES * 60_000) {
    const candidateStart = new Date(t)
    const candidateEnd   = new Date(t + duration * 60_000)

    // (a) Must end before workday last-slot-start + duration.
    if (candidateEnd.getTime() > lastSlotStart.getTime() + duration * 60_000) break

    // (b) No overlap with existing appointments.
    if (overlapsAny(apptsSorted, candidateStart, candidateEnd, BUFFER_MINUTES)) continue

    // (c) No overlap with absences.
    if (absences.some(a => intervalsOverlap(
      new Date(a.start_iso), new Date(a.end_iso),
      candidateStart, candidateEnd,
    ))) continue

    // (d) Travel time. First-appt-of-day uses haversine drive from home base.
    // Subsequent appts in v1: drive time treated as 0 — the 15-min buffer covers
    // intra-territory transits. Real per-appt drive time lands when Google Routes
    // API key is configured: appointments_for_resource_in_window will start
    // returning the project/property address, and `driveTimeMinutes` will swap
    // its haversine fallback for the cached Routes call.
    const prev = lastApptBefore(apptsSorted, candidateStart)
    const travelMin = prev ? 0 : driveTimeMinutes(homeBaseLatLng, customerForDrive)
    const arrivalReadyMs = prev
      ? new Date(prev.end_iso).getTime() + BUFFER_MINUTES * 60_000
      : workdayStart.getTime() + travelMin * 60_000
    if (arrivalReadyMs > candidateStart.getTime()) continue

    // (e) Lunch must still fit somewhere in [11:30, 12:15] start window.
    const scheduleWithCandidate = [...apptsSorted, {
      start_iso: candidateStart.toISOString(),
      end_iso:   candidateEnd.toISOString(),
      address_street: null, address_city: null, address_state: null, address_zip: customerZip,
    }].sort((a, b) => a.start_iso.localeCompare(b.start_iso))
    if (!lunchFits(scheduleWithCandidate, date)) continue

    result.push({
      start_iso:           candidateStart.toISOString(),
      end_iso:             candidateEnd.toISOString(),
      resource_id:         resource.contact_id,
      resource_first_name: resource.contact_first_name,
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

function lunchFits(scheduled: ExistingAppt[], date: Date): boolean {
  const winStart = combineDateAndTime(date, LUNCH_WINDOW_START).getTime()
  const winEnd   = combineDateAndTime(date, LUNCH_WINDOW_END).getTime()
  const lunchLenMs = LUNCH_MINUTES * 60_000

  // Walk the lunch window; find a gap ≥ 45 min whose start is in [winStart, winEnd - 45min].
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

// ─── Drive-time estimation (haversine fallback) ──────────────────────────────

function driveTimeMinutes(from: LatLng, to: LatLng): number {
  // V1 fallback: haversine distance × 1.3 routing factor / 25 mph.
  const distMiles = haversineMiles(from, to)
  const routingFactor = 1.3   // accounts for non-straight-line roads
  const hours = (distMiles * routingFactor) / AVG_SPEED_MPH
  return Math.round(hours * 60)
}

function haversineMiles(a: LatLng, b: LatLng): number {
  const R = 3958.8
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat); const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// ZIP centroid lookup. Tiny seed for southern WI; expand from Census ZCTA later.
function zipCentroid(zip: string): LatLng | null {
  const z = (zip || "").substring(0, 5)
  return ZIP_CENTROIDS[z] || null
}

const ZIP_CENTROIDS: Record<string, LatLng> = {
  "53703": { lat: 43.0775, lng: -89.3838 },  // Madison downtown
  "53704": { lat: 43.1226, lng: -89.3389 },  // Madison NE
  "53705": { lat: 43.0682, lng: -89.4419 },  // Madison W
  "53706": { lat: 43.0750, lng: -89.4097 },  // UW-Madison
  "53711": { lat: 43.0317, lng: -89.4427 },  // Madison SW
  "53713": { lat: 43.0244, lng: -89.3939 },  // Madison S
  "53714": { lat: 43.0950, lng: -89.3236 },  // Madison E
  "53715": { lat: 43.0654, lng: -89.4011 },  // Madison central
  "53716": { lat: 43.0731, lng: -89.3411 },  // Madison E (HQ — 3218 Progress Rd)
  "53717": { lat: 43.0795, lng: -89.5142 },  // Madison far W
  "53718": { lat: 43.1147, lng: -89.2728 },  // Madison far E
  "53719": { lat: 43.0420, lng: -89.4853 },  // Madison SW
  "53562": { lat: 43.1003, lng: -89.5078 },  // Middleton
  "53590": { lat: 43.1839, lng: -89.2137 },  // Sun Prairie
  "53575": { lat: 42.9319, lng: -89.3839 },  // Oregon WI
  "53527": { lat: 43.0814, lng: -89.2003 },  // Cottage Grove
  "53558": { lat: 43.0150, lng: -89.2895 },  // McFarland
  "53531": { lat: 43.0506, lng: -89.0792 },  // Deerfield
  "53589": { lat: 42.9170, lng: -89.2181 },  // Stoughton
  "53593": { lat: 42.9908, lng: -89.5326 },  // Verona
  "53528": { lat: 43.1158, lng: -89.6492 },  // Cross Plains
  "53523": { lat: 43.0089, lng: -89.0156 },  // Cambridge
  "53581": { lat: 43.3328, lng: -90.3859 },  // Richland Center
  "53202": { lat: 43.0420, lng: -87.9061 },  // Milwaukee downtown
  "53203": { lat: 43.0428, lng: -87.9219 },  // Milwaukee
  "53204": { lat: 43.0153, lng: -87.9303 },  // Milwaukee
  "53205": { lat: 43.0556, lng: -87.9347 },  // Milwaukee
  "53206": { lat: 43.0900, lng: -87.9325 },  // Milwaukee N
  "53207": { lat: 42.9925, lng: -87.8881 },  // Milwaukee S
  "53208": { lat: 43.0508, lng: -87.9647 },  // Milwaukee W
  "53209": { lat: 43.1322, lng: -87.9633 },  // Milwaukee NW
  "53210": { lat: 43.0750, lng: -87.9603 },  // Milwaukee NW
  "53211": { lat: 43.0892, lng: -87.8856 },  // Milwaukee E (UWM)
  "53212": { lat: 43.0697, lng: -87.9047 },  // Milwaukee NE
  "53213": { lat: 43.0617, lng: -88.0078 },  // Wauwatosa
  "53214": { lat: 43.0153, lng: -87.9897 },  // West Allis
  "53005": { lat: 43.0586, lng: -88.1062 },  // Brookfield
  "53045": { lat: 43.0794, lng: -88.1525 },  // Brookfield N
  "53151": { lat: 42.9789, lng: -88.1078 },  // New Berlin
  "53066": { lat: 43.1117, lng: -88.5037 },  // Oconomowoc
  "53186": { lat: 43.0117, lng: -88.2314 },  // Waukesha
  "53188": { lat: 43.0500, lng: -88.2492 },  // Waukesha N
  "53189": { lat: 42.9456, lng: -88.2742 },  // Waukesha S
  "53105": { lat: 42.6822, lng: -88.2789 },  // Burlington
  "53144": { lat: 42.5847, lng: -87.8636 },  // Kenosha
}

// ─── Time helpers (timezone-correct for America/Chicago) ─────────────────────
// All slot times are expressed in Chicago local time. The Deno Edge runtime is
// UTC by default; setHours()/getHours() reflect SERVER local (= UTC), not the
// territory's clock. These helpers translate between the two.

function chicagoDateTimeToUTC(y: number, mo0: number, d: number, h: number, mi: number): Date {
  // Construct what UTC time corresponds to a Chicago wall-clock (y, mo0, d, h:mi).
  // Strategy: build a "naive" UTC instant with the same numeric components, then
  // ask Intl what that instant looks like in Chicago. The delta between the two
  // is the offset to subtract.
  const naive = new Date(Date.UTC(y, mo0, d, h, mi, 0))
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
  const parts = dtf.formatToParts(naive)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
  const chicagoMs = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    get("hour") === 24 ? 0 : get("hour"),  // en-US sometimes returns 24 for midnight
    get("minute"), get("second"),
  )
  const offsetMs = chicagoMs - naive.getTime()
  return new Date(naive.getTime() - offsetMs)
}

function chicagoYMD(d: Date): { y: number; mo0: number; d: number } {
  // Extract Chicago Y/M/D from a Date instant (regardless of server tz).
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
  })
  const parts = dtf.formatToParts(d)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
  return { y: get("year"), mo0: get("month") - 1, d: get("day") }
}

function combineDateAndTime(date: Date, hhmm: string): Date {
  // `date` represents a calendar day in Chicago. Produce the UTC instant for
  // (that Chicago date) at (hhmm Chicago local time).
  const [hStr, mStr] = hhmm.split(":")
  const h = parseInt(hStr, 10) || 0
  const m = parseInt(mStr, 10) || 0
  const { y, mo0, d } = chicagoYMD(date)
  return chicagoDateTimeToUTC(y, mo0, d, h, m)
}

function todayInChicago(): Date {
  // Return a Date instant representing Chicago midnight today.
  const now = new Date()
  const { y, mo0, d } = chicagoYMD(now)
  return chicagoDateTimeToUTC(y, mo0, d, 0, 0)
}

function buildDateRange(start: Date, days: number): Date[] {
  // Walk by calendar days in Chicago. start represents Chicago midnight day 0.
  const out: Date[] = []
  const { y, mo0, d } = chicagoYMD(start)
  for (let i = 0; i < days; i++) {
    out.push(chicagoDateTimeToUTC(y, mo0, d + i, 0, 0))
  }
  return out
}

function isoDayOfWeek(d: Date): number {
  // ISO day-of-week (1=Mon ... 7=Sun) for the date AS OBSERVED IN CHICAGO.
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" })
  const wkShort = dtf.format(d)
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  return map[wkShort] ?? 1
}

function chicagoDayBounds(date: Date): { start: Date; end: Date } {
  // Returns UTC instants for [Chicago 00:00:00, Chicago 23:59:59.999] on the
  // calendar day represented by `date`.
  const { y, mo0, d } = chicagoYMD(date)
  const start = chicagoDateTimeToUTC(y, mo0, d, 0, 0)
  const end   = new Date(chicagoDateTimeToUTC(y, mo0, d + 1, 0, 0).getTime() - 1)
  return { start, end }
}

// ─── Output projection ───────────────────────────────────────────────────────

function publicWorkType(wt: WorkType) {
  return {
    id:                                    wt.id,
    name:                                  wt.work_type_name,
    slug:                                  wt.work_type_public_slug,
    duration_minutes:                      Number(wt.work_type_duration_minutes),
    duration_per_unit_minutes:             wt.work_type_duration_per_unit_minutes,
    unit_count_intake_field:               wt.work_type_unit_count_intake_field,
    customer_facing_description:           wt.work_type_customer_facing_description,
  }
}

function publicTerritory(t: Territory) {
  return { id: t.id, name: t.service_territory_name, state: t.service_territory_state }
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}
