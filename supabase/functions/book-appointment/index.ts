// =============================================================================
// book-appointment
//
// Customer-facing booking endpoint. Takes a slot the customer chose (from a
// compute-availability response) plus their contact details and service
// address, atomically creates the full record cascade via the book_appointment
// PG function (Account → Contact → Property → Building → Unit → Opportunity →
// Project → Work Order → Service Appointment → SAA → Booking Token), and
// returns the appointment IDs + a customer-facing manage URL.
//
// Authentication: public (verify_jwt=false). The edge function uses the
// service role internally to call the book_appointment RPC, which is the
// only role granted EXECUTE.
//
// Concurrency: book_appointment acquires a pg_advisory_xact_lock on the
// (resource_id, calendar_day) pair, so two simultaneous bookings against the
// same resource on the same day serialize. The function then re-checks for
// slot conflicts under that lock; if a conflicting appointment exists, it
// returns status="slot_taken" and the customer is asked to pick another slot.
//
// Notification: in v1, no SMS or email is fired (no transport configured
// yet — A2P 10DLC and Mail.Send permissions are parallel workstreams). The
// response includes a `manage_url` the customer can save to view/reschedule
// the appointment once those pages ship.
//
// Inputs (POST JSON):
//   {
//     slug:                 "single-family-assessment" | ...,
//     start_iso:            "2026-05-15T12:30:00Z",
//     end_iso:              "2026-05-15T14:00:00Z",
//     resource_id:          "<uuid of chosen Technician contact>",
//     customer_first_name:  "Edna",
//     customer_last_name:   "Krabappel",
//     phone:                "608-555-1234" or "+16085551234" (any format),
//     email:                "edna@example.com",
//     address: {
//       street: "742 Evergreen Terrace",
//       city:   "Madison",
//       state:  "WI",
//       zip:    "53703"
//     },
//     intake?: { number_of_buildings?: int, ... }   // optional per-WT
//   }
//
// Outputs (200 JSON):
//   { status:                 "ok" | "slot_taken" | "invalid_work_type"
//                             | "out_of_territory" | "invalid_resource"
//                             | "invalid_phone" | "invalid_zip"
//                             | "invalid_state" | "error",
//     message?:               "...",
//     service_appointment_id?, work_order_id?, project_id?, opportunity_id?,
//     account_id?, contact_id?, property_id?,
//     booking_token?:         "<32-hex-char URL-safe token>",
//     manage_url?:            "https://ees-ops.netlify.app/book/manage/<token>" }
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://ees-ops.netlify.app"

interface ReqBody {
  slug:                string
  start_iso:           string
  end_iso:             string
  resource_id:         string
  customer_first_name: string
  customer_last_name:  string
  phone:               string
  email:               string
  address: {
    street: string
    city:   string
    state:  string
    zip:    string
  }
  intake?: Record<string, unknown>
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  let body: ReqBody
  try { body = await req.json() } catch { return json({ error: "Invalid JSON body" }, 400) }

  const v = validateInput(body)
  if (v) return json({ error: v }, 400)

  const supabaseUrl    = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server misconfiguration — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set" }, 500)
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Validate the ISO timestamps parse correctly before sending to PG.
  const startDate = new Date(body.start_iso)
  const endDate   = new Date(body.end_iso)
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return json({ error: "start_iso and end_iso must be valid ISO timestamps" }, 400)
  }
  if (endDate.getTime() <= startDate.getTime()) {
    return json({ error: "end_iso must be after start_iso" }, 400)
  }

  // Hand off the entire booking transaction to the PG function. Atomic by
  // virtue of being inside one PL/pgSQL function call.
  const { data, error } = await supabase.rpc("book_appointment", { payload: body })

  if (error) {
    console.error("book_appointment RPC error", error)
    return json({ status: "error", message: error.message || "Booking failed" }, 500)
  }

  const result = (data ?? {}) as Record<string, unknown>

  // Attach the customer-facing manage URL when the booking succeeded.
  if (result.status === "ok" && result.booking_token) {
    result.manage_url = `${APP_BASE_URL}/book/manage/${result.booking_token}`
  }

  // TODO: fire booking_confirmation notification once SMS / Mail.Send is wired.
  // Spec: lookup notification_templates by event='booking_confirmation' +
  // territory state, populate template variables, enqueue via Twilio + Resend.

  return json(result, 200)
})

function validateInput(body: ReqBody): string | null {
  if (!body || typeof body !== "object") return "Body must be a JSON object"
  if (!body.slug) return "slug is required"
  if (!body.start_iso || !body.end_iso) return "start_iso and end_iso are required"
  if (!body.resource_id) return "resource_id is required"
  if (!body.customer_first_name) return "customer_first_name is required"
  if (!body.customer_last_name)  return "customer_last_name is required"
  if (!body.phone) return "phone is required"
  if (!body.email) return "email is required"
  if (!body.address || typeof body.address !== "object") return "address is required"
  if (!body.address.street) return "address.street is required"
  if (!body.address.city)   return "address.city is required"
  if (!body.address.state)  return "address.state is required"
  if (!body.address.zip)    return "address.zip is required"
  return null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}
