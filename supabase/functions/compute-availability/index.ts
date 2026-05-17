// ─── compute-availability ────────────────────────────────────────────────────
// v4 — drive-time computation delegated to the compute-route-matrix edge fn.
//
// v3 maintained an inline haversine + ZIP_CENTROIDS table to estimate travel
// from each resource's home base to the customer address. That duplicated the
// math compute-route-matrix already owns, and meant Google Routes results
// would never reach this surface even with the API key configured.
//
// v4 makes a single batched call to compute-route-matrix at request start
// with the unique set of resource home bases as origins and the customer
// address as the destination. Results land in a Map<contact_id, minutes>
// that the slot generator looks up inline. When the Google key is absent
// the route-matrix mock fallback is identical math to v3's inline haversine,
// so slot ordering and counts do not change in pre-launch mode. When the
// key is present, travel estimates become live + cached without further
// changes here.
//
// Public, unauthenticated. Same request/response shape as v3.

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
  id:                       string
  service_territory_name:   string
  service_territory_state:  string
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
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server misconfiguration" }, 500)
  }
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

  const effectiveDuration = computeEffectiveDuration(workType, body.intake || {})
  if (effectiveDuration <= 0) return json({ error: "Invalid intake \u2014 duration could not be computed" }, 400)

  const resources = await findQualifyingResources(supabase, workType.id, territory.id)
  if (resources.length === 0) {
    return json({ status: "no_qualifying_resources",
                  message: "No auditors currently qualified for this assessment type in your area.",
                  work_type: publicWorkType(workType), territory: publicTerritory(territory),
                  canonical_address: canonicalAddress, slots: [] }, 200)
  }

  // ── Drive-time precompute via compute-route-matrix ─────────────────────
  // Single batched call: every distinct resource home base → customer.
  // Resilient: any failure falls through to a zero-travel Map (matches v3
  // behavior when customerForDrive degraded to homeBaseLatLng).
  const driveTimesByResource = await precomputeDriveTimes({
    supabaseUrl, resources, canonicalAddress, customerLatLng,
  })

  const startDate = body.start_date ? new Date(body.start_date + "T00:00:00") : todayInChicago()
  const days      = Math.min(body.days || DEFAULT_DAYS, MAX_DAYS)
  const dates     = buildDateRange(startDate, days)

  const slots: Slot[] = []
  for (const date of dates) {
    const dow = isoDayOfWeek(date)
    const opHours = await fetchOperatingHours(supabase, territory.id, dow)
    if (!opHours || opHours.oh_is_closed) continue

    const orderedResources = await orderByDayFill(supabase, resources, territory.id, date)
    for (const resource of orderedResources) {
      const existing  = await fetchResourceDayAppointments(supabase, resource.contact_id, date)
      const absences  = await fetchResourceDayAbsences(supabase, resource.contact_id, date)
      const daySlots  = generateSlotsForResourceDay({
        resource, date, opHours, existing, absences,
        duration: effectiveDuration,
        customerZip: canonicalAddress.zip,
        driveTimesByResource,
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

async function geocode(_addr: CanonicalAddress): Promise<LatLng | null> { return null }

async function resolveTerritory(
  supabase: SupabaseClient,
  address: CanonicalAddress,
  latLng:  LatLng | null,
): Promise<Territory | null> {
  if (latLng) {
    const { data: polyMatches } = await supabase.rpc("resolve_territory_by_point", {
      p_lat: latLng.lat, p_lng: latLng.lng,
    })
    if (polyMatches && polyMatches.length > 0) return polyMatches[0] as Territory
  }
  const { data: zipMatches, error } = await supabase
    .from("service_territory_zips")
    .select(`service_territory_id,
             service_territories!inner (
               id, service_territory_name, service_territory_state,
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
  return { id: t.id, service_territory_name: t.service_territory_name, service_territory_state: t.service_territory_state }
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
    const { data: c } = await supabase.from("contacts").select("id, contact_first_name, contact_last_name")
      .eq("id", cid).eq("contact_is_deleted", false).maybeSingle()
    if (!c) continue
    qualifying.push({
      contact_id: (c as any).id,
      contact_first_name: (c as any).contact_first_name,
      contact_last_name: (c as any).contact_last_name,
      home_base_lat: DEFAULT_HOME_BASE.lat,
      home_base_lng: DEFAULT_HOME_BASE.lng,
    })
  }
  return qualifying
}

// ─── Drive-time precompute ───────────────────────────────────────────────
// One POST to compute-route-matrix with the unique resource home bases as
// origins and the customer address as the single destination. The matrix
// fn caches per (origin, destination) pair in drive_time_cache, so a second
// customer-scheduling request from the same neighborhood reuses the result.
//
// Failure modes are all non-fatal: if the call fails or the response is
// malformed we return a Map of zeros and slot generation proceeds with
// no morning-travel constraint. The same outcome happens today when v3's
// customerForDrive degrades to homeBaseLatLng (haversine of 0).
interface DriveTimesArgs {
  supabaseUrl:      string
  resources:        Resource[]
  canonicalAddress: CanonicalAddress
  customerLatLng:   LatLng | null
}

async function precomputeDriveTimes(args: DriveTimesArgs): Promise<Map<string, number>> {
  const { supabaseUrl, resources, canonicalAddress, customerLatLng } = args
  const result = new Map<string, number>()
  if (resources.length === 0) return result

  // Build the set of unique home-base origins, keyed by 5-decimal lat/lng so
  // multiple resources at the same shop don't expand the matrix.
  const originKeyFor = (r: Resource) =>
    `${r.home_base_lat.toFixed(5)},${r.home_base_lng.toFixed(5)}`
  const uniqueOriginKeys: string[] = []
  const uniqueOriginCoords: Record<string, LatLng> = {}
  for (const r of resources) {
    const k = originKeyFor(r)
    if (!(k in uniqueOriginCoords)) {
      uniqueOriginKeys.push(k)
      uniqueOriginCoords[k] = { lat: r.home_base_lat, lng: r.home_base_lng }
    }
  }

  const destination = customerLatLng
    ? { coordinates: { lat: customerLatLng.lat, lng: customerLatLng.lng } }
    : { address: {
        street: canonicalAddress.street,
        city:   canonicalAddress.city,
        state:  canonicalAddress.state,
        zip:    canonicalAddress.zip,
      } }

  const origins = uniqueOriginKeys.map(k => ({ coordinates: uniqueOriginCoords[k] }))

  try {
    const url = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/compute-route-matrix`
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origins,
        destinations: [destination],
        traffic_aware: true,
      }),
    })
    if (!res.ok) {
      console.error(`compute-route-matrix returned ${res.status}; using zero-travel fallback`)
      for (const r of resources) result.set(r.contact_id, 0)
      return result
    }
    const data = await res.json() as {
      status: string
      results: Array<{ origin_index: number; destination_index: number; duration_seconds: number }>
    }
    if (data?.status !== "ok" || !Array.isArray(data.results)) {
      console.error("compute-route-matrix malformed response; using zero-travel fallback", data)
      for (const r of resources) result.set(r.contact_id, 0)
      return result
    }
    // Build a key → minutes map from the matrix response, then explode back
    // out per resource. Multiple resources at the same shop share a row.
    const minutesByKey = new Map<string, number>()
    for (const cell of data.results) {
      if (cell.destination_index !== 0) continue
      const key = uniqueOriginKeys[cell.origin_index]
      if (!key) continue
      minutesByKey.set(key, Math.round((cell.duration_seconds || 0) / 60))
    }
    for (const r of resources) {
      const m = minutesByKey.get(originKeyFor(r))
      result.set(r.contact_id, m ?? 0)
    }
    return result
  } catch (e) {
    console.error("compute-route-matrix call threw; using zero-travel fallback", e)
    for (const r of resources) result.set(r.contact_id, 0)
    return result
  }
}

async function fetchOperatingHours(supabase: SupabaseClient, territoryId: string, dayOfWeek: number): Promise<OperatingHours | null> {
  const { data } = await supabase.from("operating_hours")
    .select("oh_day_of_week, oh_first_slot_start_time, oh_last_slot_start_time, oh_is_closed")
    .eq("service_territory_id", territoryId).eq("oh_day_of_week", dayOfWeek).eq("oh_is_deleted", false).maybeSingle()
  return data as OperatingHours | null
}

async function fetchResourceDayAppointments(supabase: SupabaseClient, contactId: string, date: Date): Promise<ExistingAppt[]> {
  const { start, end } = chicagoDayBounds(date)
  const { data, error } = await supabase.rpc("appointments_for_resource_in_window", {
    p_contact_id: contactId, p_window_start: start.toISOString(), p_window_end: end.toISOString(),
  })
  if (error) { console.error("appointments rpc error", error); return [] }
  return (data || []) as ExistingAppt[]
}

async function fetchResourceDayAbsences(supabase: SupabaseClient, contactId: string, date: Date): Promise<Absence[]> {
  const { start, end } = chicagoDayBounds(date)
  const { data } = await supabase.from("resource_absences")
    .select("ra_start_datetime, ra_end_datetime")
    .eq("contact_id", contactId).eq("ra_is_deleted", false)
    .lte("ra_start_datetime", end.toISOString()).gte("ra_end_datetime", start.toISOString())
  return (data || []).map((a: any) => ({ start_iso: a.ra_start_datetime, end_iso: a.ra_end_datetime }))
}

async function orderByDayFill(supabase: SupabaseClient, resources: Resource[], territoryId: string, date: Date): Promise<Resource[]> {
  const { start, end } = chicagoDayBounds(date)
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
  resource: Resource; date: Date; opHours: OperatingHours;
  existing: ExistingAppt[]; absences: Absence[]; duration: number;
  customerZip: string;
  driveTimesByResource: Map<string, number>;
}

function generateSlotsForResourceDay(ctx: SlotCtx): Slot[] {
  const { resource, date, opHours, existing, absences, duration, customerZip, driveTimesByResource } = ctx
  const result: Slot[] = []
  const firstSlot = combineDateAndTime(date, opHours.oh_first_slot_start_time)
  const lastSlotStart = combineDateAndTime(date, opHours.oh_last_slot_start_time)
  const workdayStart = new Date(firstSlot.getTime() - WORKDAY_PRE_START_OFFSET_MINUTES * 60_000)
  const apptsSorted = [...existing].sort((a, b) => a.start_iso.localeCompare(b.start_iso))
  const morningTravelMinutes = driveTimesByResource.get(resource.contact_id) ?? 0

  for (let t = firstSlot.getTime(); t <= lastSlotStart.getTime(); t += SLOT_INCREMENT_MINUTES * 60_000) {
    const candidateStart = new Date(t)
    const candidateEnd   = new Date(t + duration * 60_000)
    if (candidateEnd.getTime() > lastSlotStart.getTime() + duration * 60_000) break
    if (overlapsAny(apptsSorted, candidateStart, candidateEnd, BUFFER_MINUTES)) continue
    if (absences.some(a => intervalsOverlap(new Date(a.start_iso), new Date(a.end_iso), candidateStart, candidateEnd))) continue
    const prev = lastApptBefore(apptsSorted, candidateStart)
    // First-slot-of-the-day candidates pay the precomputed home-base→customer
    // travel cost. Slots that follow an existing appointment assume zero
    // travel — Phase 2 work will compute true inter-appointment legs.
    const travelMin = prev ? 0 : morningTravelMinutes
    const arrivalReadyMs = prev
      ? new Date(prev.end_iso).getTime() + BUFFER_MINUTES * 60_000
      : workdayStart.getTime() + travelMin * 60_000
    if (arrivalReadyMs > candidateStart.getTime()) continue
    const scheduleWithCandidate = [...apptsSorted, {
      start_iso: candidateStart.toISOString(), end_iso: candidateEnd.toISOString(),
      address_street: null, address_city: null, address_state: null, address_zip: customerZip,
    }].sort((a, b) => a.start_iso.localeCompare(b.start_iso))
    if (!lunchFits(scheduleWithCandidate, date)) continue
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

function lunchFits(scheduled: ExistingAppt[], date: Date): boolean {
  const winStart = combineDateAndTime(date, LUNCH_WINDOW_START).getTime()
  const winEnd   = combineDateAndTime(date, LUNCH_WINDOW_END).getTime()
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

function chicagoDateTimeToUTC(y: number, mo0: number, d: number, h: number, mi: number): Date {
  const naive = new Date(Date.UTC(y, mo0, d, h, mi, 0))
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
  const parts = dtf.formatToParts(naive)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
  const hh = get("hour")
  const chicagoMs = Date.UTC(get("year"), get("month") - 1, get("day"), hh === 24 ? 0 : hh, get("minute"), get("second"))
  const offsetMs = chicagoMs - naive.getTime()
  return new Date(naive.getTime() - offsetMs)
}

function chicagoYMD(d: Date): { y: number; mo0: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
  })
  const parts = dtf.formatToParts(d)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
  return { y: get("year"), mo0: get("month") - 1, d: get("day") }
}

function combineDateAndTime(date: Date, hhmm: string): Date {
  const [hStr, mStr] = hhmm.split(":")
  const h = parseInt(hStr, 10) || 0
  const m = parseInt(mStr, 10) || 0
  const { y, mo0, d } = chicagoYMD(date)
  return chicagoDateTimeToUTC(y, mo0, d, h, m)
}

function todayInChicago(): Date {
  const now = new Date()
  const { y, mo0, d } = chicagoYMD(now)
  return chicagoDateTimeToUTC(y, mo0, d, 0, 0)
}

function buildDateRange(start: Date, days: number): Date[] {
  const out: Date[] = []
  const { y, mo0, d } = chicagoYMD(start)
  for (let i = 0; i < days; i++) out.push(chicagoDateTimeToUTC(y, mo0, d + i, 0, 0))
  return out
}

function isoDayOfWeek(d: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" })
  const wkShort = dtf.format(d)
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  return map[wkShort] ?? 1
}

function chicagoDayBounds(date: Date): { start: Date; end: Date } {
  const { y, mo0, d } = chicagoYMD(date)
  const start = chicagoDateTimeToUTC(y, mo0, d, 0, 0)
  const end   = new Date(chicagoDateTimeToUTC(y, mo0, d + 1, 0, 0).getTime() - 1)
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
  return { id: t.id, name: t.service_territory_name, state: t.service_territory_state }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
