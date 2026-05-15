// ─── bookingService.js ───────────────────────────────────────────────────────
// Public-facing API wrapper for the customer booking flow.
//   - compute-availability + book-appointment: edge functions (fetch wrappers
//     below) because they run server-side input validation + advisory locks
//     and shape the response for the customer UI.
//   - lookup_booking_by_token + cancel_appointment + reschedule_appointment:
//     direct RPC calls. These RPCs are SECURITY DEFINER and granted to anon,
//     so they don't need an edge function wrapper — the supabase JS client
//     calls them directly using the publishable key.

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

export function bookAppointment({
  slug, start_iso, end_iso, resource_id,
  customer_first_name, customer_last_name, phone, email, address, intake,
}) {
  return call('book-appointment', {
    slug, start_iso, end_iso, resource_id,
    customer_first_name, customer_last_name, phone, email, address, intake,
  })
}

// ─── management RPCs ─────────────────────────────────────────────────────────
// These three call SECURITY DEFINER RPCs directly through the Supabase JS
// client using the publishable anon key. The RPCs verify the booking_token
// themselves — no JWT auth required. The token IS the auth.

export async function lookupBooking(token) {
  const { data, error } = await supabase.rpc('lookup_booking_by_token', { p_token: token })
  if (error) throw new Error(error.message || 'Lookup failed')
  return data
}

export async function cancelBooking(token) {
  const { data, error } = await supabase.rpc('cancel_appointment', { p_token: token })
  if (error) throw new Error(error.message || 'Cancel failed')
  return data
}

export async function rescheduleBooking({ token, start_iso, end_iso, resource_id }) {
  const { data, error } = await supabase.rpc('reschedule_appointment', {
    p_token:           token,
    p_new_start_iso:   start_iso,
    p_new_end_iso:     end_iso,
    p_new_resource_id: resource_id,
  })
  if (error) throw new Error(error.message || 'Reschedule failed')
  return data
}
