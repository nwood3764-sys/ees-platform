// ─── fieldMobileService.js ───────────────────────────────────────────────────
// Data layer for the technician PWA (/field/*). Thin wrappers over the
// verified production RPCs plus a geolocation helper and the photo-capture
// path that writes the before/after photo_type tokens the approval gate
// keys off.
//
// RPCs used (all live on flyjigrijjjtcsvpgzvk, verified this build):
//   my_service_appointments(p_date)                → today's stops
//   work_order_detail_for_technician(p_wo_id)       → header + steps + gap state
//   complete_work_step(p_step_id)                   → evidence-gated step close
//   mark_work_step_not_applicable(p_step_id, p_reason) → step N/A w/ required reason
//   submit_work_order_for_verification(p_wo_id)     → In Progress → To Be Verified
//   clock_in_work_order / clock_out_work_order      → time entries w/ GPS + odo
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../lib/supabase'
import { uploadPhoto, uploadDocument } from '../data/storageService'

// ───────────────────────────────────────────────────────────────────────────
// Geolocation
//
// Wraps navigator.geolocation in a promise. Never rejects hard — a clock
// action must still be possible in a basement with no GPS fix. On failure
// we resolve { latitude: null, longitude: null } and let the caller record
// the time entry without coordinates rather than block the technician.
// ───────────────────────────────────────────────────────────────────────────
export function getPosition({ timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ latitude: null, longitude: null, accuracy: null })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude:  pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy:  pos.coords.accuracy,
      }),
      () => resolve({ latitude: null, longitude: null, accuracy: null }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    )
  })
}

// ───────────────────────────────────────────────────────────────────────────
// Today's Schedule
// ───────────────────────────────────────────────────────────────────────────

// p_date is a YYYY-MM-DD string in America/Chicago (the RPC compares against
// that zone). Default to today in Chicago time.
export function chicagoToday() {
  // en-CA gives YYYY-MM-DD; timeZone shifts to Chicago before formatting.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export async function fetchTodaySchedule(dateStr) {
  const p_date = dateStr || chicagoToday()
  const { data, error } = await supabase.rpc('my_service_appointments', { p_date })
  if (error) throw error
  return data || []
}

// ───────────────────────────────────────────────────────────────────────────
// Work Order detail
// ───────────────────────────────────────────────────────────────────────────

export async function fetchWorkOrderDetail(woId) {
  const { data, error } = await supabase.rpc('work_order_detail_for_technician', { p_wo_id: woId })
  if (error) throw error
  if (!data || data.outcome !== 'ok') {
    throw new Error(data?.message || 'Failed to load work order.')
  }
  return data
}

// ───────────────────────────────────────────────────────────────────────────
// Step completion + WO submission
// ───────────────────────────────────────────────────────────────────────────

// RPC outcome vocabularies differ across the platform:
//   • Task A step/WO RPCs return 'success' | 'noop' | 'blocked' | 'error'
//   • The clock RPCs (this module) return 'ok' | 'error'
// Treat ok/success/noop as success (noop = already in target state, benign).
// Treat blocked/error (or anything unrecognized) as a surfaced failure
// carrying the server's own message. A 'blocked' is a real precondition the
// user must resolve (e.g. evidence gap) — surfaced as an Error so the screen
// shows the message, but it is not a crash.
const SUCCESS_OUTCOMES = new Set(['ok', 'success', 'noop'])

function unwrapRpcRow(data) {
  return Array.isArray(data) ? data[0] : data
}

function assertOutcome(row, fallbackMsg) {
  if (!row) return row
  if (!SUCCESS_OUTCOMES.has(row.outcome)) {
    throw new Error(row.message || fallbackMsg)
  }
  return row
}

export async function completeWorkStep(stepId) {
  const { data, error } = await supabase.rpc('complete_work_step', { p_step_id: stepId })
  if (error) throw error
  return assertOutcome(unwrapRpcRow(data), 'Step could not be completed.')
}

// Save a measurement/field value on a step (e.g. Square Feet Removed).
// Server validates the field belongs to the step, numbers parse and are
// >= 0, and the step isn't already closed. Required fields hard-gate step
// completion via _work_step_evidence_gap, same as photos and videos.
export async function saveWorkStepFieldValue(stepId, templateFieldId, value) {
  const { data, error } = await supabase.rpc('save_work_step_field_value', {
    p_step_id: stepId, p_template_field_id: templateFieldId, p_value: value,
  })
  if (error) throw error
  return assertOutcome(unwrapRpcRow(data), 'Could not save the value.')
}

// A step that doesn't apply on this site (e.g. "photograph can lights" in an
// attic with no can lights) is closed as Not Applicable WITH a reason — the
// reason is mandatory server-side and shows to the verifier. Distinct from
// the work-order-level Unable to Complete, which is for real blockers.
export async function markWorkStepNotApplicable(stepId, reason) {
  const { data, error } = await supabase.rpc('mark_work_step_not_applicable', {
    p_step_id: stepId, p_reason: reason,
  })
  if (error) throw error
  return assertOutcome(unwrapRpcRow(data), 'Could not mark step Not Applicable.')
}

export async function submitWorkOrder(woId) {
  const { data, error } = await supabase.rpc('submit_work_order_for_verification', { p_wo_id: woId })
  if (error) throw error
  return assertOutcome(unwrapRpcRow(data), 'Work order could not be submitted.')
}

export async function markUnableToComplete(woId, { reason, note = null } = {}) {
  const { data, error } = await supabase.rpc('mark_work_order_unable_to_complete', {
    p_wo_id: woId, p_reason: reason, p_note: note,
  })
  if (error) throw error
  return assertOutcome(unwrapRpcRow(data), 'Could not mark work order Unable to Complete.')
}

// Sign a private storage object for viewing. Photos live in work-evidence
// (private bucket); a short-lived signed URL lets the technician view what
// they captured. Returns null on failure rather than throwing — a thumbnail
// that won't load shouldn't break the screen.
export async function signedPhotoUrl(bucket, path, { expiresIn = 3600 } = {}) {
  if (!bucket || !path) return null
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn)
    if (error) return null
    return data?.signedUrl || null
  } catch {
    return null
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Clock in / out  (captures GPS automatically)
// ───────────────────────────────────────────────────────────────────────────

export async function clockIn(woId, { saId = null } = {}) {
  const pos = await getPosition()
  const { data, error } = await supabase.rpc('clock_in_work_order', {
    p_wo_id:     woId,
    p_latitude:  pos.latitude,
    p_longitude: pos.longitude,
    p_odometer:  null,
    p_sa_id:     saId,
  })
  if (error) throw error
  return assertOutcome(unwrapRpcRow(data), 'Clock in failed.')
}

export async function clockOut(woId) {
  const pos = await getPosition()
  const { data, error } = await supabase.rpc('clock_out_work_order', {
    p_wo_id:     woId,
    p_latitude:  pos.latitude,
    p_longitude: pos.longitude,
    p_odometer:  null,
  })
  if (error) throw error
  return assertOutcome(unwrapRpcRow(data), 'Clock out failed.')
}

// ───────────────────────────────────────────────────────────────────────────
// Photo capture
//
// photoType MUST be 'before' | 'after' | 'general' to match the evidence
// gate. The detail screen passes the leg the step requires. Reuses the
// canonical uploadPhoto (bucket-routed to work-evidence, EXIF/watermark via
// the process-photo edge function).
// ───────────────────────────────────────────────────────────────────────────
export async function captureStepPhoto({ file, workStepId, photoType }) {
  // 'before' | 'after' | 'general' are the legacy legs; named photo prompts
  // (the 'photo' field type) pass the field name as the photo_type tag.
  const type = (photoType && String(photoType).trim()) || 'general'
  return uploadPhoto({
    file,
    relatedObject: 'work_steps',
    relatedId:     workStepId,
    workStepId,
    photoType:     type,
    applyWatermark: true,
  })
}

// Resolves true when the captured photo carries no GPS coordinates —
// evidence photos are expected to be geolocated, so the screen warns the
// technician. Deliberately NOT awaited before the UI updates: EXIF
// processing takes a few seconds server-side, and the capture flow must
// feel instant. If processing hasn't answered within the window we can't
// tell either way, so no warning (resolves false).
export async function photoGpsMissing(photoRow, { timeoutMs = 15000 } = {}) {
  if (!photoRow?._processing) return false
  const result = await Promise.race([
    photoRow._processing,
    new Promise((resolve) => setTimeout(resolve, timeoutMs, undefined)),
  ])
  return !!(result?.ok && result.latitude == null && result.longitude == null)
}

// ───────────────────────────────────────────────────────────────────────────
// Video capture
//
// Video-evidence steps (e.g. the attic 360 pan) store the recording as a
// documents row on the step with its video/* mime type — that mime type is
// exactly what the server evidence gate counts, so a step cannot be
// completed until the video row exists. Bucket-routed to work-evidence via
// DOCUMENT_BUCKET_BY_OBJECT.work_steps.
// ───────────────────────────────────────────────────────────────────────────
export async function captureStepVideo({ file, workStepId, stepName = null }) {
  if (!file) throw new Error('captureStepVideo: file is required')
  if (!(file.type || '').toLowerCase().startsWith('video/')) {
    throw new Error('That file is not a video. Record a video and try again.')
  }
  return uploadDocument({
    file,
    relatedObject: 'work_steps',
    relatedId:     workStepId,
    documentType:  'video',
    name:          stepName ? `${stepName} — video` : (file.name || 'Step video'),
  })
}

// ───────────────────────────────────────────────────────────────────────────
// Technician-created work orders
//
// Certain work order types are created by the technician in the field —
// Building Access, and the growing family behind it (Post Notice of Entry,
// Incident Report, Vehicle Inspection, Damaged Equipment, Material
// Delivery, ...). The list is DATA: work types flagged
// work_type_is_technician_creatable in LEAP Admin. Creation clones the
// project/opportunity/building chain from the work order the tech is
// on-site for, is owned by and assigned to the technician, and lands on
// their Today view; the instantiate trigger builds the plan.
// ───────────────────────────────────────────────────────────────────────────
export async function fetchTechnicianCreatableWorkTypes() {
  const { data, error } = await supabase
    .from('work_types')
    .select('id, work_type_name, work_type_description')
    .eq('work_type_is_technician_creatable', true)
    .eq('work_type_is_active', true)
    .eq('work_type_is_deleted', false)
    .order('work_type_name')
  if (error) throw error
  return data || []
}

export async function createTechnicianWorkOrder(sourceWorkOrderId, workTypeId) {
  const { data, error } = await supabase.rpc('create_technician_work_order', {
    p_source_work_order_id: sourceWorkOrderId, p_work_type_id: workTypeId,
  })
  if (error) throw error
  return assertOutcome(unwrapRpcRow(data), 'Could not create the work order.')
}

// Ad hoc path — the event happened outside today's schedule. The technician
// selects everything explicitly: property, building, unit (always required —
// pick or type a new one), and project (pick, or Create New Project → a
// Field Documentation project under the property's Field Operations
// opportunity). Documentation is never blocked.
export async function createTechnicianWorkOrderForProperty({
  workTypeId, propertyId, buildingId = null, unitId = null, newUnitName = null,
  projectId = null, createProject = false,
}) {
  const { data, error } = await supabase.rpc('create_technician_work_order_for_property', {
    p_work_type_id: workTypeId,
    p_property_id: propertyId,
    p_building_id: buildingId,
    p_unit_id: unitId,
    p_new_unit_name: newUnitName,
    p_project_id: projectId,
    p_create_project: createProject,
  })
  if (error) throw error
  return assertOutcome(unwrapRpcRow(data), 'Could not create the work order.')
}

export async function fetchBuildingsForProperty(propertyId) {
  const { data, error } = await supabase
    .from('buildings')
    .select('id, building_number_or_name, building_name')
    .eq('property_id', propertyId)
    .eq('building_is_deleted', false)
    .order('building_number_or_name')
  if (error) throw error
  return data || []
}

export async function fetchUnitsForBuilding(buildingId) {
  const { data, error } = await supabase
    .from('units')
    .select('id, unit_number')
    .eq('building_id', buildingId)
    .eq('unit_is_deleted', false)
    .order('unit_number')
  if (error) throw error
  return data || []
}

export async function fetchProjectsForProperty(propertyId) {
  const { data, error } = await supabase
    .from('projects')
    .select('id, project_record_number, project_name')
    .eq('property_id', propertyId)
    .eq('project_is_deleted', false)
    .order('project_created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Property search for the ad hoc path. Name/street match, small page.
export async function searchProperties(q) {
  const term = (q || '').trim()
  if (term.length < 2) return []
  const like = `%${term.replace(/[%_]/g, '')}%`
  const { data, error } = await supabase
    .from('properties')
    .select('id, property_name, property_street, property_city, property_state')
    .or(`property_name.ilike.${like},property_street.ilike.${like}`)
    .eq('property_is_deleted', false)
    .order('property_name')
    .limit(15)
  if (error) throw error
  return data || []
}

// Active users for the Technicians On-Site multi-select. All active users —
// no role filter, so Project Site Leads / auditors doing a solo visit are
// selectable. RLS scopes what is readable.
export async function fetchActiveUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('id, user_name')
    .eq('user_is_active', true)
    .eq('user_is_deleted', false)
    .order('user_name')
  if (error) throw error
  return data || []
}

// Contacts on the work order's account, for the key_source Person picker
// (e.g. the property manager handing over keys). Returns [] when the work
// order has no account or the account has no contacts.
export async function fetchAccountContactsForWorkOrder(woId) {
  const { data: wo, error: woErr } = await supabase
    .from('work_orders')
    .select('work_order_account_id')
    .eq('id', woId)
    .maybeSingle()
  if (woErr) throw woErr
  if (!wo?.work_order_account_id) return []
  const { data, error } = await supabase
    .from('contacts')
    .select('id, contact_name')
    .eq('contact_account_id', wo.work_order_account_id)
    .eq('contact_is_deleted', false)
    .order('contact_name')
  if (error) throw error
  return data || []
}

// ───────────────────────────────────────────────────────────────────────────
// Session / identity
// ───────────────────────────────────────────────────────────────────────────
export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data?.session || null
}

export async function signOut() {
  await supabase.auth.signOut()
}

// ───────────────────────────────────────────────────────────────────────────
// Knowledge base
//
// Published help articles scoped to the technician's audience ('all' +
// 'internal'). RLS gates what's readable; we additionally filter to published,
// non-deleted rows. List returns lightweight rows (no body) grouped client-side
// by category; fetchArticle pulls the full markdown body on demand.
// ───────────────────────────────────────────────────────────────────────────

export async function fetchKnowledgeArticles() {
  const { data, error } = await supabase
    .from('help_articles')
    .select('id, ha_slug, ha_title, ha_summary, ha_category, ha_audience')
    .in('ha_audience', ['all', 'internal'])
    .eq('ha_is_published', true)
    .eq('ha_is_deleted', false)
    .order('ha_category', { ascending: true })
    .order('ha_title', { ascending: true })
  if (error) throw error
  return data || []
}

export async function fetchKnowledgeArticle(slug) {
  const { data, error } = await supabase
    .from('help_articles')
    .select('id, ha_slug, ha_title, ha_summary, ha_category, ha_body_markdown')
    .eq('ha_slug', slug)
    .eq('ha_is_published', true)
    .eq('ha_is_deleted', false)
    .maybeSingle()
  if (error) throw error
  return data || null
}

// ───────────────────────────────────────────────────────────────────────────
// Fleet — Daily Vehicle Inspections
//
// Vehicles are company-level records (no project/building/unit). The daily
// inspection is a vehicle_activities record whose checklist items are
// instantiated server-side from vehicle_inspection_item_templates per the
// vehicle's type (box trucks get the 6-tire dual-rear set). Item photos go
// through the canonical uploadPhoto (EXIF-preserving compression, watermark
// pipeline) into the fleet-evidence bucket.
// ───────────────────────────────────────────────────────────────────────────

export async function fetchFleetVehicles() {
  const { data, error } = await supabase
    .from('vehicles')
    .select(`
      id, vehicle_record_number, vehicle_name, vehicle_license_plate,
      vehicle_current_odometer,
      vehicle_type:picklist_values!vehicles_vehicle_type_fkey ( picklist_label )
    `)
    .eq('vehicle_is_deleted', false)
    .order('vehicle_name', { ascending: true })
  if (error) throw error
  return (data || []).map(v => ({
    id: v.id,
    recordNumber: v.vehicle_record_number,
    name: v.vehicle_name,
    plate: v.vehicle_license_plate,
    odometer: v.vehicle_current_odometer,
    typeLabel: v.vehicle_type?.picklist_label || null,
  }))
}

export async function startVehicleInspection(vehicleId) {
  const { data, error } = await supabase.rpc('create_vehicle_daily_inspection', { p_vehicle_id: vehicleId })
  if (error) throw error
  return data
}

export async function fetchVehicleInspection(activityId) {
  const { data, error } = await supabase.rpc('vehicle_inspection_detail', { p_activity_id: activityId })
  if (error) throw error
  return data
}

export async function saveVehicleInspectionLeg({ activityId, leg, odometer, gasLevel }) {
  const { data, error } = await supabase.rpc('record_vehicle_inspection_leg', {
    p_activity_id: activityId, p_leg: leg, p_odometer: odometer, p_gas_level: gasLevel,
  })
  if (error) throw error
  return data
}

export async function saveVehicleInspectionItem({ itemId, condition, comment }) {
  const { data, error } = await supabase.rpc('save_vehicle_inspection_item', {
    p_item_id: itemId, p_condition: condition ?? null, p_comment: comment ?? null,
  })
  if (error) throw error
  return data
}

export async function completeVehicleInspection({ activityId, notes }) {
  const { data, error } = await supabase.rpc('complete_vehicle_inspection', {
    p_activity_id: activityId, p_notes: notes ?? null,
  })
  if (error) throw error
  return data
}

export async function captureInspectionPhoto({ file, itemId }) {
  return uploadPhoto({
    file,
    relatedObject: 'vehicle_activity_items',
    relatedId: itemId,
    photoType: 'general',
  })
}
