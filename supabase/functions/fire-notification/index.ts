// ─── fire-notification ─────────────────────────────────────────────────
// Notification orchestrator. Given a service_appointment_id + trigger_event
// (and optionally a specific channel), resolves the full appointment
// context, picks the right notification_templates row, substitutes
// {{merge_field}} tokens against the resolved context, and delivers.
//
// v2 — state-aware + Communications-integrated:
//   • Branding + timezone are derived from the appointment's PROPERTY STATE
//     (NC → "…of North Carolina", Eastern time), never hardcoded to WI/Central.
//     This is the rule that stops cross-state branding: an NC booking can only
//     render NC branding in the NC timezone.
//   • Customer EMAIL is delivered through send-email-v1 (not the notification-
//     only sender), anchored to the service appointment. That gives us, for
//     free: the correct STATE MAILBOX (resolve_outbound_mailbox_for_anchor),
//     logging to the contact's Communications, reply auto-threading, and the
//     program signature. SMS still goes through send-notification-sms.
//
// Auth: verify_jwt=false. Server-to-server only (Postgres triggers via
// supabase_functions.http_request, and the reminder cron). The send-email-v1
// call uses the service-role key + on_behalf_of_user_id (a system user), which
// send-email-v1 honors only for service-role callers.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://ees-ops.netlify.app"

// System user for the send-email-v1 audit trail (created_by on the message).
const SYSTEM_USER_ID = "c5a01ec8-960f-42ab-8a9e-a49822de89af"

const VALID_TRIGGER_EVENTS = new Set([
  "booking_confirmation", "reminder_48hr", "reminder_24hr", "reminder_morning_of",
  "on_my_way", "arrived", "completed", "rescheduled", "canceled",
  "dispatcher_followup_required",
])

const VALID_CHANNELS = new Set(["sms", "email"])
const DEFAULT_TIMEZONE = "America/Chicago"
const RENDER_LOCALE    = "en-US"

// Per-state timezone + branding. Slot/date rendering and the company name in
// every template are driven off the property's state so nothing can go out
// cross-branded again.
const STATE_TZ: Record<string, string> = {
  NC: "America/New_York",
  WI: "America/Chicago",
  CO: "America/Denver",
  MI: "America/Detroit",
  IN: "America/Indiana/Indianapolis",
}
const STATE_FULL: Record<string, string> = {
  NC: "North Carolina", WI: "Wisconsin", CO: "Colorado", MI: "Michigan", IN: "Indiana",
}
const STATE_PHONE: Record<string, string> = {
  NC: "(704) 990-5614",
}
const STATE_EMAIL: Record<string, string> = {
  NC: "ncira@ees-nc.org", WI: "ira@ees-wi.org",
}

function companyForState(state: string) {
  const s = (state || "").toUpperCase()
  const full = STATE_FULL[s]
  return {
    name:  full ? `Energy Efficiency Services of ${full}` : "Energy Efficiency Services",
    phone: STATE_PHONE[s] || Deno.env.get("COMPANY_PHONE") || "",
    email: STATE_EMAIL[s] || Deno.env.get("COMPANY_EMAIL") || "hello@ees-wi.org",
  }
}

interface ReqBody {
  service_appointment_id: string
  trigger_event: string
  channel?: "sms" | "email"
  override_from?: string
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
  if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfiguration: Supabase keys missing" }, 500)

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const context = await buildAppointmentContext(supabase, body.service_appointment_id)
  if (!context) return json({ error: "service appointment not found" }, 404)

  const templates = await pickTemplates(
    supabase,
    body.trigger_event,
    context.appointment.work_type_id,
    body.channel ?? null,
  )

  if (templates.length === 0) {
    return json({
      status: "no_templates_matched",
      trigger_event: body.trigger_event,
      channel: body.channel ?? null,
      work_type_id: context.appointment.work_type_id,
    }, 200)
  }

  const fired: Array<Record<string, unknown>> = []

  for (const tpl of templates) {
    const renderedBody    = substituteMergeFields(tpl.nt_body,            context)
    const renderedSubject = tpl.nt_subject_line
      ? substituteMergeFields(tpl.nt_subject_line, context)
      : null

    let dispatchResult: Record<string, unknown>
    if (tpl.nt_channel === "sms") {
      dispatchResult = await dispatchSms(supabaseUrl, serviceKey, {
        trigger_event: body.trigger_event,
        recipient_phone: context.contact.phone_e164 || "",
        body_text: renderedBody,
        notification_template_id: tpl.id,
        service_appointment_id:   context.appointment.id,
        contact_id:               context.contact.id,
        project_id:               context.appointment.project_id,
        from_number:              body.override_from,
      })
    } else if (tpl.nt_channel === "email") {
      // Deliver through send-email-v1: anchored to the SA so the state mailbox
      // is resolved automatically, the message logs to Communications, and
      // replies thread back onto the record.
      dispatchResult = await dispatchEmailViaSendEmailV1(supabaseUrl, serviceKey, {
        service_appointment_id: context.appointment.id,
        recipient_email: context.contact.email || "",
        recipient_name:  context.contact.full_name || "",
        subject:         renderedSubject || `${context.company.name}: ${body.trigger_event}`,
        body_html:       renderedBody,
        contact_id:      context.contact.id,
        state:           context.property.state,
      })
    } else {
      dispatchResult = { status: "skipped_unsupported_channel", channel: tpl.nt_channel }
    }

    fired.push({
      channel:     tpl.nt_channel,
      template_id: tpl.id,
      template_record_number: tpl.nt_record_number,
      ...dispatchResult,
    })
  }

  return json({ status: "ok", fired }, 200)
})

async function buildAppointmentContext(supabase: any, saId: string): Promise<any> {
  const { data: sa, error: saErr } = await supabase
    .from("service_appointments")
    .select(`
      id, sa_record_number, work_type_id, contact_id, project_id, work_order_id,
      sa_scheduled_start_time, sa_scheduled_end_time, sa_status,
      work_type:work_types!work_type_id ( id, work_type_name, work_type_customer_facing_name, work_type_customer_facing_description ),
      contact:contacts!contact_id ( id, contact_first_name, contact_last_name, contact_name, contact_phone, contact_mobile_phone, contact_email ),
      project:projects!project_id (
        id,
        property:properties!property_id ( id, property_name, property_street, property_city, property_state, property_zip )
      ),
      work_order:work_orders!work_order_id (
        id,
        property:properties!property_id ( id, property_name, property_street, property_city, property_state, property_zip ),
        project:projects!project_id (
          id,
          property:properties!property_id ( id, property_name, property_street, property_city, property_state, property_zip )
        )
      )
    `)
    .eq("id", saId)
    .eq("sa_is_deleted", false)
    .maybeSingle()

  if (saErr) { console.error("buildAppointmentContext: SA fetch error", saErr); return null }
  if (!sa) return null

  const { data: assignment } = await supabase
    .from("service_appointment_assignments")
    .select("contact_id, contact:contacts!contact_id ( id, contact_first_name, contact_last_name, contact_name, contact_phone, contact_mobile_phone, contact_email )")
    .eq("service_appointment_id", saId)
    .eq("saa_is_deleted", false)
    .order("saa_created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  const nowIso = new Date().toISOString()
  const { data: tokenRow } = await supabase
    .from("service_appointment_tokens")
    .select("sat_token")
    .eq("service_appointment_id", saId)
    .eq("sat_purpose", "manage")
    .is("sat_consumed_at", null)
    .gt("sat_expires_at", nowIso)
    .order("sat_created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const manageUrl = tokenRow?.sat_token
    ? `${APP_BASE_URL}/sa/manage/${tokenRow.sat_token}`
    : ""

  const c    = sa.contact
  const wt   = sa.work_type
  // Resolve the property through whichever parent this SA carries. Self-scheduled
  // SAs anchor to a work order (no project_id); dispatcher/seed SAs anchor to a
  // project. This mirrors resolve_outbound_mailbox_for_anchor so the email body's
  // state branding + timezone always agree with the mailbox that sent it.
  const prop = sa.project?.property
            || sa.work_order?.property
            || sa.work_order?.project?.property
  const a    = assignment?.contact

  // Timezone + branding follow the property's state (fallback Central/generic).
  const state = (prop?.property_state || "").toUpperCase()
  const tz    = STATE_TZ[state] || DEFAULT_TIMEZONE
  const company = companyForState(state)

  const startDate = sa.sa_scheduled_start_time ? formatDate(sa.sa_scheduled_start_time, tz) : ""
  const startTime = sa.sa_scheduled_start_time ? formatTime(sa.sa_scheduled_start_time, tz) : ""
  const endTime   = sa.sa_scheduled_end_time   ? formatTime(sa.sa_scheduled_end_time, tz)   : ""

  const contactPhone = pickPhone(c)
  const auditorPhone = pickPhone(a)

  const property_city_state_zip = [prop?.property_city, prop?.property_state]
    .filter(Boolean).join(", ") + (prop?.property_zip ? ` ${prop.property_zip}` : "")

  return {
    appointment: {
      id: sa.id, record_number: sa.sa_record_number,
      project_id: sa.project_id, work_type_id: sa.work_type_id,
      start_at: sa.sa_scheduled_start_time, end_at: sa.sa_scheduled_end_time,
      start_date: startDate, start_time: startTime, end_time: endTime,
      work_type_name: wt?.work_type_name || "site visit",
      // Friendly label for customer-facing copy; falls back to the internal
      // name, then a generic phrase.
      work_type_label: wt?.work_type_customer_facing_name || wt?.work_type_name || "home energy assessment",
      manage_url: manageUrl,
    },
    contact: {
      id: c?.id,
      first_name: c?.contact_first_name || "",
      last_name:  c?.contact_last_name  || "",
      full_name:  c?.contact_name       || joinName(c?.contact_first_name, c?.contact_last_name),
      phone:      formatPhoneDisplay(contactPhone),
      phone_e164: toE164OrEmpty(contactPhone),
      email:      c?.contact_email || "",
    },
    auditor: a ? {
      id: a.id,
      first_name: a.contact_first_name || "",
      last_name:  a.contact_last_name  || "",
      full_name:  a.contact_name       || joinName(a.contact_first_name, a.contact_last_name),
      phone:      formatPhoneDisplay(auditorPhone),
      phone_e164: toE164OrEmpty(auditorPhone),
      email:      a.contact_email || "",
    } : { id: null, first_name: "", last_name: "", full_name: "your auditor", phone: "", phone_e164: "", email: "" },
    property: {
      id: prop?.id || null, name: prop?.property_name || "",
      street: prop?.property_street || "", city: prop?.property_city || "",
      state: prop?.property_state || "", zip: prop?.property_zip || "",
      city_state_zip: property_city_state_zip.trim(),
    },
    work_type: {
      id: wt?.id || null, name: wt?.work_type_name || "",
      customer_facing_description: wt?.work_type_customer_facing_description || "",
    },
    company,
  }
}

function joinName(first?: string | null, last?: string | null): string {
  return [first, last].filter(Boolean).join(" ").trim()
}

function pickPhone(c: any): string {
  if (!c) return ""
  return (c.contact_mobile_phone || c.contact_phone || "").trim()
}

function toE164OrEmpty(raw: string): string {
  if (!raw) return ""
  if (raw.startsWith("+")) return raw
  const digits = raw.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return ""
}

function formatPhoneDisplay(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "")
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith("1")) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return raw
}

function formatDate(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat(RENDER_LOCALE, {
      weekday: "long", month: "long", day: "numeric",
      timeZone: tz,
    }).format(new Date(iso))
  } catch { return "" }
}

function formatTime(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat(RENDER_LOCALE, {
      hour: "numeric", minute: "2-digit",
      timeZone: tz,
    }).format(new Date(iso))
  } catch { return "" }
}

async function pickTemplates(supabase: any, triggerEvent: string, workTypeId: string | null, channelFilter: string | null): Promise<any[]> {
  const specificRows = workTypeId
    ? (await loadTemplates(supabase, triggerEvent, channelFilter, workTypeId, false))
    : []
  if (specificRows.length > 0) return specificRows
  return await loadTemplates(supabase, triggerEvent, channelFilter, null, true)
}

async function loadTemplates(supabase: any, triggerEvent: string, channelFilter: string | null, workTypeId: string | null, isNullFilter: boolean): Promise<any[]> {
  let q = supabase
    .from("notification_templates")
    .select("id, nt_record_number, nt_trigger_event, nt_channel, nt_subject_line, nt_body, work_type_id")
    .eq("nt_is_deleted", false)
    .eq("nt_is_active", true)
    .eq("nt_trigger_event", triggerEvent)
  if (isNullFilter) q = q.is("work_type_id", null)
  else if (workTypeId) q = q.eq("work_type_id", workTypeId)
  if (channelFilter) q = q.eq("nt_channel", channelFilter)
  const { data, error } = await q
  if (error) { console.error("loadTemplates error", error); return [] }
  return data || []
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

async function dispatchSms(supabaseUrl: string, serviceKey: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!payload.recipient_phone) return { status: "skipped_no_phone" }
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-notification-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => null)
    return { http_status: res.status, ...(data || {}) }
  } catch (e) {
    return { status: "dispatch_error", message: (e as Error).message }
  }
}

// Deliver a customer email through send-email-v1. Anchoring to the service
// appointment lets send-email-v1 resolve the correct state mailbox, log the
// message to the contact's Communications, and thread replies. Service-role
// key + on_behalf_of_user_id is the trusted server-to-server path.
async function dispatchEmailViaSendEmailV1(
  supabaseUrl: string, serviceKey: string,
  args: {
    service_appointment_id: string
    recipient_email: string
    recipient_name: string
    subject: string
    body_html: string
    contact_id: string | null
    state: string
  },
): Promise<Record<string, unknown>> {
  if (!args.recipient_email) return { status: "skipped_no_email" }
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email-v1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
      body: JSON.stringify({
        anchor_object:    "service_appointments",
        anchor_record_id: args.service_appointment_id,
        to:               { email: args.recipient_email, name: args.recipient_name || args.recipient_email },
        subject:          args.subject,
        body_html:        args.body_html,
        contact_id:       args.contact_id || undefined,
        state:            args.state || undefined,
        on_behalf_of_user_id: SYSTEM_USER_ID,
      }),
    })
    const data = await res.json().catch(() => null)
    return { http_status: res.status, ...(data || {}) }
  } catch (e) {
    return { status: "dispatch_error", message: (e as Error).message }
  }
}

function validate(b: ReqBody): string | null {
  if (!b || typeof b !== "object") return "Body must be a JSON object"
  if (!b.service_appointment_id) return "service_appointment_id required"
  if (!b.trigger_event) return "trigger_event required"
  if (!VALID_TRIGGER_EVENTS.has(b.trigger_event)) {
    return `trigger_event must be one of: ${[...VALID_TRIGGER_EVENTS].join(", ")}`
  }
  if (b.channel && !VALID_CHANNELS.has(b.channel)) {
    return `channel must be 'sms' or 'email' when specified`
  }
  return null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
