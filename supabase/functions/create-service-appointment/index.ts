// =============================================================================
// create-service-appointment
//
// Customer-facing endpoint that creates a Service Appointment from a slot the
// customer chose (returned by compute-availability) plus their contact +
// address details. Calls the create_service_appointment(payload jsonb) RPC,
// which runs the full record cascade (Account → Contact → Property →
// Opportunity → Project → Work Order → Service Appointment → SAA → Service
// Appointment Token) inside a single transaction protected by
// pg_advisory_xact_lock on (resource_id, Chicago calendar day).
//
// Public, unauthenticated (verify_jwt=false). Validates input client-side
// in the React app and again in this function before handing off to the RPC,
// which does its own CHECK-constraint validation.
//
// Returns:
//   200 { status: 'ok',
//         service_appointment_id, sa_record_number,
//         service_appointment_token, manage_url }
//   200 { status: 'slot_taken', message }
//   200 { status: 'error',      message }
//   400 { error: '<validation message>' }
//   500 { status: 'error', message }
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
  slug: string
  start_iso: string
  end_iso: string
  resource_id: string
  customer_first_name: string
  customer_last_name: string
  phone: string
  email: string
  address: { street: string; city: string; state: string; zip: string }
  intake?: Record<string, unknown>
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json({ error: "POST required" }, 405)

  let body: ReqBody
  try { body = await req.json() } catch { return json({ error: "Invalid JSON body" }, 400) }

  const v = validateInput(body)
  if (v) return json({ error: v }, 400)

  const supabaseUrl    = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server misconfiguration" }, 500)

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const startDate = new Date(body.start_iso)
  const endDate   = new Date(body.end_iso)
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return json({ error: "start_iso and end_iso must be valid ISO timestamps" }, 400)
  }
  if (endDate.getTime() <= startDate.getTime()) {
    return json({ error: "end_iso must be after start_iso" }, 400)
  }

  const { data, error } = await supabase.rpc("create_service_appointment", { payload: body })

  if (error) {
    console.error("create_service_appointment RPC error", error)
    return json({ status: "error", message: error.message || "Scheduling failed" }, 500)
  }

  const result = (data ?? {}) as Record<string, unknown>

  // Customer-facing self-serve manage URL. /sa/manage/<token> matches the
  // React route at src/serviceAppointments/ManagePage.jsx.
  if (result.status === "ok" && result.service_appointment_token) {
    result.manage_url = `${APP_BASE_URL}/sa/manage/${result.service_appointment_token}`
  }

  return json(result, 200)
})

function validateInput(body: ReqBody): string | null {
  if (!body || typeof body !== "object") return "Body must be a JSON object"
  if (!body.slug) return "slug is required"
  if (!body.start_iso || !body.end_iso) return "start_iso and end_iso are required"
  if (!body.resource_id) return "resource_id is required"
  if (!body.customer_first_name) return "customer_first_name is required"
  if (!body.customer_last_name) return "customer_last_name is required"
  if (!body.phone) return "phone is required"
  if (!body.email) return "email is required"
  if (!body.address || typeof body.address !== "object") return "address is required"
  if (!body.address.street) return "address.street is required"
  if (!body.address.city) return "address.city is required"
  if (!body.address.state) return "address.state is required"
  if (!body.address.zip) return "address.zip is required"
  return null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
