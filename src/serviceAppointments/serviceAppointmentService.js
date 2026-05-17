// ─── serviceAppointmentService.js ────────────────────────────────────────────
// Public-facing API wrapper for the customer scheduling flow.
//   - compute-availability + create-service-appointment: edge functions
//     (fetch wrappers below). Run server-side input validation + advisory
//     locks and shape the response for the customer UI.
//   - lookup_service_appointment_by_token + cancel_appointment +
//     reschedule_appointment: direct RPC calls. These RPCs are SECURITY
//     DEFINER and granted to anon, so the supabase JS client can call them
//     using the publishable key. The customer's manage token IS the auth.

import { supabase } from '../lib/supabase'

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const ANON_KEY      = import.meta.env.VITE_SUPABASE_ANON_KEY

async function call(name, payload) {
  let res
  try {
    res = await fetch(`${FUNCTIONS_URL}/${name}`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':         ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (networkErr) {
    throw new Error(`Network error reaching ${name}. Check your connection and try again.`)
  }

  let json
  try { json = await res.json() } catch { json = null }

  if (!res.ok) {
    const message = (json && (json.message || json.error)) || `Server returned ${res.status}`
    throw new Error(message)
  }
  return json
}

export function computeAvailability({ slug, address, intake, start_date, days }) {
  return call('compute-availability', { slug, address, intake, start_date, days })
}

// validate-address — wraps the Google Address Validation edge function. Used
// by the intake step before submitting to compute-availability so the user
// sees an "address looks wrong" message before the slot picker, not after.
// In mock mode (pre-Google-key) this still normalizes whitespace + state +
// ZIP, so callers can rely on canonical_address being present.
//
// Returns { status: 'ok'|'unverifiable',
//           canonical_address: {street, city, state, zip},
//           latlng: {lat, lng} | null,
//           source: 'google'|'mock',
//           verdict: {...} | null }
export function validateAddress({ address }) {
  return call('validate-address', { address })
}

// compute-route-matrix — wraps the Google Routes ComputeRouteMatrix edge
// function. The customer scheduling flow doesn't call this directly today
// (compute-availability does drive-time math inline), but it's exposed here
// so the future dispatcher map UI and the future Auditor PWA can use the
// same wrapper.
//
// origins and destinations are arrays of { coordinates: {lat,lng} } or
// { address: { street, city, state, zip } }. Returns drive durations + cache
// source per cell.
export function computeRouteMatrix({ origins, destinations, traffic_aware, departure_time }) {
  return call('compute-route-matrix', { origins, destinations, traffic_aware, departure_time })
}

export function createServiceAppointment({
  slug, start_iso, end_iso, resource_id,
  customer_first_name, customer_last_name, phone, email, address, intake,
}) {
  return call('create-service-appointment', {
    slug, start_iso, end_iso, resource_id,
    customer_first_name, customer_last_name, phone, email, address, intake,
  })
}

// ─── management RPCs ─────────────────────────────────────────────────────────
// All three call SECURITY DEFINER RPCs directly via supabase.rpc() using the
// publishable anon key. The RPCs verify the service_appointment_token
// themselves — no JWT auth required. The token IS the auth.

export async function lookupAppointment(token) {
  const { data, error } = await supabase.rpc('lookup_service_appointment_by_token', { p_token: token })
  if (error) throw new Error(error.message || 'Lookup failed')
  return data
}

export async function cancelAppointment(token) {
  const { data, error } = await supabase.rpc('cancel_appointment', { p_token: token })
  if (error) throw new Error(error.message || 'Cancel failed')
  return data
}

export async function rescheduleAppointment({ token, start_iso, end_iso, resource_id }) {
  const { data, error } = await supabase.rpc('reschedule_appointment', {
    p_token:           token,
    p_new_start_iso:   start_iso,
    p_new_end_iso:     end_iso,
    p_new_resource_id: resource_id,
  })
  if (error) throw new Error(error.message || 'Reschedule failed')
  return data
}
