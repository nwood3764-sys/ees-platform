// ─── request-dispatcher-followup ───────────────────────────────────────
// Public endpoint called from the customer scheduling pages
// (/sa/<slug>) when auto-scheduling fails for one of four reasons:
//   • out_of_territory          — address outside any active polygon
//   • no_qualifying_resources   — no skilled auditor with capacity
//   • no_availability           — capacity exists but all slots blocked
//   • general_inquiry           — generic "contact us" form path
//
// On success: writes a dispatcher_followup_requests row (DFR-####),
// resolves the dispatcher_followup_required email template (NT-00014
// by default, or any work_type-specific override), substitutes merge
// fields against the DFR context, and POSTs to send-notification-email
// addressed to the dispatcher mailbox. A dispatcher picks the row up
// off the open-DFR list view and reaches out to the customer.
//
// Auth: verify_jwt=false. Same public surface as compute-availability /
// create-service-appointment — anyone can POST to it, intentionally,
// because legitimate customers on the public scheduling page need to.
// Validation is applied client-side (anti-bot honeypot is a future
// enhancement) and again server-side.
//
// Returns:
//   200 { status: 'ok', dfr_id, dfr_record_number, dispatcher_notified: bool }
//   400 { error: '<validation message>' }
//   500 { status: 'error', message }

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const VALID_REASONS = new Set([
  "out_of_territory",
  "no_qualifying_resources",
  "no_availability",
  "general_inquiry",
])

const RENDER_TIMEZONE = "America/Chicago"
const RENDER_LOCALE   = "en-US"

const DISPATCHER_EMAIL = Deno.env.get("DISPATCHER_FOLLOWUP_EMAIL") || "assessments.wi@ees-wi.org"

interface ReqBody {
  customer_first_name: string
  customer_last_name:  string
  phone:               string
  email:               string
  address: { street: string; city: string; state: string; zip: string }
  work_type_slug?:     string
  preferred_start_at?: string  // ISO; optional — customer may not have a preferred time
  reason:              string
  extra_notes?:        string  // future contact-form free-text
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  let body: ReqBody
  try { body = await req.json() as ReqBody }
  catch { return json({ error: "Invalid JSON body" }, 400) }

  const v = validate(body)
  if (v) return json({ error: v }, 400)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfiguration" }, 500)

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 1. Resolve work_type by slug (optional — general_inquiry has no slug)
  let workTypeId: string | null = null
  let workTypeName = ""
  if (body.work_type_slug) {
    const { data: wt } = await supabase
      .from("work_types")
      .select("id, work_type_name")
      .eq("work_type_public_slug", body.work_type_slug)
      .eq("work_type_is_deleted", false)
      .limit(1)
      .maybeSingle()
    if (wt) {
      workTypeId   = wt.id as string
      workTypeName = (wt.work_type_name as string) || ""
    }
  }

  // 2. Look up picklist UUIDs for reason + status='Open'
  const { data: reasonPv } = await supabase
    .from("picklist_values")
    .select("id")
    .eq("picklist_object", "dispatcher_followup_requests")
    .eq("picklist_field", "dfr_reason")
    .eq("picklist_value", body.reason)
    .limit(1)
    .maybeSingle()

  const { data: statusPv } = await supabase
    .from("picklist_values")
    .select("id")
    .eq("picklist_object", "dispatcher_followup_requests")
    .eq("picklist_field", "dfr_status")
    .eq("picklist_value", "Open")
    .limit(1)
    .maybeSingle()

  if (!reasonPv || !statusPv) {
    return json({ status: "error", message: "Required picklist values not configured" }, 500)
  }

  // 3. Insert the DFR row
  const { data: dfr, error: insErr } = await supabase
    .from("dispatcher_followup_requests")
    .insert({
      dfr_record_number:       "",
      dfr_customer_first_name: body.customer_first_name,
      dfr_customer_last_name:  body.customer_last_name,
      dfr_phone:               body.phone || null,
      dfr_email:               body.email || null,
      dfr_address_street:      body.address.street || null,
      dfr_address_city:        body.address.city   || null,
      dfr_address_state:       body.address.state  || null,
      dfr_address_zip:         body.address.zip    || null,
      work_type_id:            workTypeId,
      dfr_work_type_slug:      body.work_type_slug || null,
      dfr_preferred_start_at:  body.preferred_start_at || null,
      dfr_reason:              reasonPv.id,
      dfr_status:              statusPv.id,
      dfr_dispatcher_notes:    body.extra_notes || null,
    })
    .select("id, dfr_record_number")
    .single()

  if (insErr || !dfr) {
    console.error("DFR insert failed", insErr)
    return json({ status: "error", message: insErr?.message || "Could not create dispatcher follow-up request" }, 500)
  }

  // 4. Load the dispatcher_followup_required email template
  //    work-type-specific row first, then NULL global fallback.
  const tpl = await loadDispatcherTemplate(supabase, workTypeId)
  let dispatcherNotified = false

  if (tpl) {
    const context = buildDfrContext({ body, workTypeName, dfrRecordNumber: dfr.dfr_record_number })
    const renderedSubject = tpl.nt_subject_line
      ? substituteMergeFields(tpl.nt_subject_line, context)
      : `EES-WI: Dispatcher follow-up needed (${dfr.dfr_record_number})`
    const renderedBody = substituteMergeFields(tpl.nt_body, context)

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          trigger_event: "dispatcher_followup_required",
          recipient_email: DISPATCHER_EMAIL,
          subject: renderedSubject,
          body_text: renderedBody,
          notification_template_id: tpl.id,
        }),
      })
      dispatcherNotified = res.ok
      if (!res.ok) {
        const errBody = await res.text().catch(() => "")
        console.error("send-notification-email failed", res.status, errBody.slice(0, 500))
      }
    } catch (e) {
      console.error("Dispatcher notification dispatch error", (e as Error).message)
    }
  } else {
    console.warn("No dispatcher_followup_required template found; DFR row created but email skipped")
  }

  return json({
    status: "ok",
    dfr_id: dfr.id,
    dfr_record_number: dfr.dfr_record_number,
    dispatcher_notified: dispatcherNotified,
  }, 200)
})

// ─── Template lookup: work-type-specific then NULL global ────────────────
async function loadDispatcherTemplate(supabase: any, workTypeId: string | null) {
  if (workTypeId) {
    const { data } = await supabase
      .from("notification_templates")
      .select("id, nt_subject_line, nt_body")
      .eq("nt_is_deleted", false)
      .eq("nt_is_active", true)
      .eq("nt_trigger_event", "dispatcher_followup_required")
      .eq("nt_channel", "email")
      .eq("work_type_id", workTypeId)
      .limit(1)
      .maybeSingle()
    if (data) return data
  }
  const { data: globalRow } = await supabase
    .from("notification_templates")
    .select("id, nt_subject_line, nt_body")
    .eq("nt_is_deleted", false)
    .eq("nt_is_active", true)
    .eq("nt_trigger_event", "dispatcher_followup_required")
    .eq("nt_channel", "email")
    .is("work_type_id", null)
    .limit(1)
    .maybeSingle()
  return globalRow
}

// ─── DFR-shaped context for merge fields ────────────────────────────────
// Mirrors the fire-notification context shape so the same merge-field
// vocabulary works. Empty placeholders where DFR doesn't have data
// (e.g. no auditor at this stage).
function buildDfrContext(args: {
  body: ReqBody
  workTypeName: string
  dfrRecordNumber: string
}) {
  const { body, workTypeName, dfrRecordNumber } = args

  const startDate = body.preferred_start_at ? formatDate(body.preferred_start_at) : ""
  const startTime = body.preferred_start_at ? formatTime(body.preferred_start_at) : ""
  const cityStateZip = [body.address.city, body.address.state]
    .filter(Boolean).join(", ") + (body.address.zip ? ` ${body.address.zip}` : "")
  const fullName = [body.customer_first_name, body.customer_last_name].filter(Boolean).join(" ").trim()

  return {
    appointment: {
      id: null,
      record_number: dfrRecordNumber,
      work_type_name: workTypeName || (body.work_type_slug || "service appointment"),
      start_date: startDate,
      start_time: startTime,
      end_time: "",
      start_at: body.preferred_start_at || null,
      end_at: null,
      project_id: null,
      work_type_id: null,
      manage_url: "",
    },
    contact: {
      first_name: body.customer_first_name,
      last_name:  body.customer_last_name,
      full_name:  fullName,
      phone:      body.phone || "",
      phone_e164: body.phone || "",
      email:      body.email || "",
      id:         null,
    },
    auditor: { id: null, first_name: "", last_name: "", full_name: "", phone: "", phone_e164: "", email: "" },
    property: {
      id:     null,
      name:   "",
      street: body.address.street || "",
      city:   body.address.city   || "",
      state:  body.address.state  || "",
      zip:    body.address.zip    || "",
      city_state_zip: cityStateZip.trim(),
    },
    work_type: {
      id: null,
      name: workTypeName,
      customer_facing_description: "",
    },
    company: {
      name: "EES-WI",
      phone: Deno.env.get("COMPANY_PHONE") || "",
      email: Deno.env.get("COMPANY_EMAIL") || "hello@ees-wi.org",
    },
  }
}

function substituteMergeFields(template: string, context: any): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, path: string) => {
    const trimmed = path.trim()
    const value = resolvePath(context, trimmed)
    if (value === null || value === undefined) return ""
    return String(value)
  })
}

function resolvePath(obj: any, path: string): any {
  if (!obj || !path) return null
  const parts = path.split(".")
  let cur: any = obj
  for (const p of parts) {
    if (cur === null || cur === undefined) return null
    cur = cur[p]
  }
  return cur
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(RENDER_LOCALE, {
      weekday: "short", month: "short", day: "numeric",
      timeZone: RENDER_TIMEZONE,
    }).format(new Date(iso))
  } catch { return "" }
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat(RENDER_LOCALE, {
      hour: "numeric", minute: "2-digit",
      timeZone: RENDER_TIMEZONE,
    }).format(new Date(iso))
  } catch { return "" }
}

function validate(b: ReqBody): string | null {
  if (!b || typeof b !== "object") return "Body must be a JSON object"
  if (!b.customer_first_name) return "customer_first_name required"
  if (!b.customer_last_name)  return "customer_last_name required"
  if (!b.phone && !b.email) return "Either phone or email required"
  if (!b.address || typeof b.address !== "object") return "address required"
  if (!b.address.street && !b.address.city && !b.address.state && !b.address.zip) {
    return "address must include at least street/city/state/zip"
  }
  if (!b.reason) return "reason required"
  if (!VALID_REASONS.has(b.reason)) {
    return `reason must be one of: ${[...VALID_REASONS].join(", ")}`
  }
  return null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
