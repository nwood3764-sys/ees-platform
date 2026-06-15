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
//   submit_work_order_for_verification(p_wo_id)     → In Progress → To Be Verified
//   clock_in_work_order / clock_out_work_order      → time entries w/ GPS + odo
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../lib/supabase'
import { uploadPhoto } from '../data/storageService'

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
  if (!['before', 'after', 'general'].includes(photoType)) {
    throw new Error(`captureStepPhoto: photoType must be before|after|general, got "${photoType}".`)
  }
  return uploadPhoto({
    file,
    relatedObject: 'work_steps',
    relatedId:     workStepId,
    workStepId,
    photoType,
    applyWatermark: true,
  })
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
