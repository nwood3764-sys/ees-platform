// ─── fire-notification ─────────────────────────────────────────────────
// Notification orchestrator. Given a service_appointment_id + trigger_event
// (and optionally a specific channel), resolves the full appointment
// context, picks the right notification_templates row, substitutes
// {{merge_field}} tokens against the resolved context, and POSTs the
// rendered body to send-notification-sms / send-notification-email.
//
// Pattern: orchestrator owns the merge-field semantics; the channel-
// specific senders just deliver pre-rendered text. This keeps the
// channel senders thin and lets the orchestrator be the single place
// that knows how to read an SA → contact → property → work_type graph.
//
// Auth: verify_jwt=false. Server-to-server only. Intended callers are
// Postgres triggers via supabase_functions.http_request and other edge
// functions (e.g. a future pg_cron-driven reminder dispatcher).
//
// Template precedence: when picking the template, prefer the most-
// specific row that matches:
//   1. trigger_event + channel + work_type_id matches SA's work_type
//   2. trigger_event + channel + work_type_id IS NULL (global default)
// Multiple rows at the same specificity is undefined; the seed avoids
// it by using one row per (trigger, channel) pair. Inactive rows
// (nt_is_active=false) are skipped.
//
// Channel selection: when the request omits `channel`, the orchestrator
// fires every active matching row for the trigger (SMS and email both
// if both exist). When `channel` is specified, only that channel fires.
//
// Returns:
//   200 { status: 'ok', fired: [{ channel, template_id, log_id, mode }] }
//   200 { status: 'no_templates_matched', trigger_event, channel? }
//   400 { error: '<validation message>' }
//   404 { error: 'service appointment not found' }
//   500 { status: 'error', message }

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://ees-ops.netlify.app"

const VALID_TRIGGER_EVENTS = new Set([
  "booking_confirmation",
  "reminder_48hr",
  "reminder_24hr",
  "reminder_morning_of",
  "on_my_way",
  "arrived",
  "completed",
  "rescheduled",
  "canceled",
  "dispatcher_followup_required",
])

const VALID_CHANNELS = new Set(["sms", "email"])

// Customer locale for date/time rendering. All current EES-WI customers
// are in Central time; future state mailboxes (MI, NC, CO, IN) will
// override per service territory. v1 hardcodes Chicago.
const RENDER_TIMEZONE = "America/Chicago"
const RENDER_LOCALE   = "en-US"

interface ReqBody {
  service_appointment_id: string
  trigger_event: string
  channel?: "sms" | "email"
  // Override the from-number for SMS / mailbox for email. Optional;
  // the senders fall back to env defaults when absent.
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

  // ─── 1. Build the appointment context ──────────────────────────────
  const context = await buildAppointmentContext(supabase, body.service_appointment_id)
  if (!context) return json({ error: "service appointment not found" }, 404)

  // ─── 2. Pick template rows ─────────────────────────────────────────
  // Most-specific-first: work_type-matching rows for this trigger,
  // optionally filtered to a single channel, then NULL-work_type fallbacks.
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

  // ─── 3. Render + dispatch per template ─────────────────────────────
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
      dispatchResult = await dispatchEmail(supabaseUrl, serviceKey, {
        trigger_event: body.trigger_event,
        recipient_email: context.contact.email || "",
        subject:         renderedSubject || `EES-WI: ${body.trigger_event}`,
        body_text:       renderedBody,
        notification_template_id: tpl.id,
        service_appointment_id:   context.appointment.id,
        contact_id:               context.contact.id,
        project_id:               context.appointment.project_id,
        from_mailbox:             body.override_from,
      })
    } else {
      // nt_channel === 'both' shouldn't be in the seed (the seed uses one
      // row per channel), but defensive handling: skip with a recorded
      // entry so the caller can see it.
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

// ─── Context resolver ────────────────────────────────────────────────────
// Single trip to assemble the full appointment context graph. Returns
// null when the SA is missing or soft-deleted.
async function buildAppointmentContext(
  supabase: ReturnType<typeof createClient>,
  saId: string,
): Promise<AppointmentContext | null> {
  // Service appointment row — also fetch the related work_type, contact,
  // project, and project.property in one PostgREST-embedded query.
  const { data: sa, error: saErr } = await supabase
    .from("service_appointments")
    .select(`
      id, sa_record_number, work_type_id, contact_id, project_id,
      sa_scheduled_start_time, sa_scheduled_end_time, sa_status,
      work_type:work_types!work_type_id ( id, work_type_name, work_type_customer_facing_description ),
      contact:contacts!contact_id ( id, contact_first_name, contact_last_name, contact_name, contact_phone, contact_mobile_phone, contact_email ),
      project:projects!project_id (
        id,
        property:properties!property_id ( id, property_name, property_street, property_city, property_state, property_zip )
      )
    `)
    .eq("id", saId)
    .eq("sa_is_deleted", false)
    .maybeSingle()

  if (saErr) {
    console.error("buildAppointmentContext: SA fetch error", saErr)
    return null
  }
  if (!sa) return null

  // Auditor — first non-deleted Service Appointment Assignment contact.
  const { data: assignment } = await supabase
    .from("service_appointment_assignments")
    .select("contact_id, contact:contacts!contact_id ( id, contact_first_name, contact_last_name, contact_name, contact_phone, contact_mobile_phone, contact_email )")
    .eq("service_appointment_id", saId)
    .eq("saa_is_deleted", false)
    .order("saa_created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  // Active manage token — the most-recent unconsumed, unexpired token
  // for sat_purpose='manage'. The customer's self-serve URL.
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

  // Format the scheduled window in customer locale.
  const startDate = sa.sa_scheduled_start_time
    ? formatDate(sa.sa_scheduled_start_time)
    : ""
  const startTime = sa.sa_scheduled_start_time
    ? formatTime(sa.sa_scheduled_start_time)
    : ""
  const endTime = sa.sa_scheduled_end_time
    ? formatTime(sa.sa_scheduled_end_time)
    : ""

  // Customer + auditor contact rows (auditor may be null if no SAA yet).
  const c  = (sa as Record<string, any>).contact
  const wt = (sa as Record<string, any>).work_type
  const prop = (sa as Record<string, any>).project?.property
  const a    = (assignment as Record<string, any> | null)?.contact

  const contactPhone = pickPhone(c)
  const auditorPhone = pickPhone(a)

  const property_city_state_zip = [
    prop?.property_city,
    prop?.property_state,
  ].filter(Boolean).join(", ") + (prop?.property_zip ? ` ${prop.property_zip}` : "")

  return {
    appointment: {
      id:                sa.id,
      record_number:     sa.sa_record_number,
      project_id:        sa.project_id,
      work_type_id:      sa.work_type_id,
      start_at:          sa.sa_scheduled_start_time,
      end_at:            sa.sa_scheduled_end_time,
      start_date:        startDate,
      start_time:        startTime,
      end_time:          endTime,
      work_type_name:    wt?.work_type_name || "service appointment",
      manage_url:        manageUrl,
    },
    contact: {
      id:         c?.id,
      first_name: c?.contact_first_name || "",
      last_name:  c?.contact_last_name  || "",
      full_name:  c?.contact_name       || joinName(c?.contact_first_name, c?.contact_last_name),
      phone:      formatPhoneDisplay(contactPhone),
      phone_e164: toE164OrEmpty(contactPhone),
      email:      c?.contact_email || "",
    },
    auditor: a ? {
      id:         a.id,
      first_name: a.contact_first_name || "",
      last_name:  a.contact_last_name  || "",
      full_name:  a.contact_name       || joinName(a.contact_first_name, a.contact_last_name),
      phone:      formatPhoneDisplay(auditorPhone),
      phone_e164: toE164OrEmpty(auditorPhone),
      email:      a.contact_email || "",
    } : {
      id: null, first_name: "", last_name: "",
      full_name: "your auditor", phone: "", phone_e164: "", email: "",
    },
    property: {
      id:                prop?.id || null,
      name:              prop?.property_name || "",
      street:            prop?.property_street || "",
      city:              prop?.property_city || "",
      state:             prop?.property_state || "",
      zip:               prop?.property_zip || "",
      city_state_zip:    property_city_state_zip.trim(),
    },
    work_type: {
      id:                          wt?.id || null,
      name:                        wt?.work_type_name || "",
      customer_facing_description: wt?.work_type_customer_facing_description || "",
    },
    company: {
      name:  "EES-WI",
      phone: Deno.env.get("COMPANY_PHONE") || "",
      email: Deno.env.get("COMPANY_EMAIL") || "hello@EES-WI.org",
    },
  }
}

function joinName(first?: string | null, last?: string | null): string {
  return [first, last].filter(Boolean).join(" ").trim()
}

// Prefer mobile over generic. Returns the raw value off the contact row;
// can be empty, formatted, or E.164. Downstream helpers normalize.
function pickPhone(c: Record<string, any> | null | undefined): string {
  if (!c) return ""
  return (c.contact_mobile_phone || c.contact_phone || "").trim()
}

// E.164 normalization — strip everything non-numeric, prepend +1 for
// 10-digit US, accept full E.164. Returns empty when input isn't a
// recognizable phone number (Twilio will reject the request anyway).
function toE164OrEmpty(raw: string): string {
  if (!raw) return ""
  if (raw.startsWith("+")) return raw
  const digits = raw.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return ""
}

// Human-readable phone format for body text rendering.
function formatPhoneDisplay(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "")
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return raw
}

// ─── Date/time rendering ────────────────────────────────────────────────
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

// ─── Template picker ────────────────────────────────────────────────────
async function pickTemplates(
  supabase: ReturnType<typeof createClient>,
  triggerEvent: string,
  workTypeId: string | null,
  channelFilter: string | null,
): Promise<NotificationTemplateRow[]> {
  // Step 1: try work_type-specific rows first (one query each side
  // because PostgREST OR with eq+is.null on the same column is awkward
  // and the two-trip cost is trivial).
  const specificRows = workTypeId
    ? (await loadTemplates(supabase, triggerEvent, channelFilter, workTypeId, false))
    : []

  if (specificRows.length > 0) return specificRows

  // Step 2: NULL-work_type global fallbacks.
  return await loadTemplates(supabase, triggerEvent, channelFilter, null, true)
}

async function loadTemplates(
  supabase: ReturnType<typeof createClient>,
  triggerEvent: string,
  channelFilter: string | null,
  workTypeId: string | null,
  isNullFilter: boolean,
): Promise<NotificationTemplateRow[]> {
  let q = supabase
    .from("notification_templates")
    .select("id, nt_record_number, nt_trigger_event, nt_channel, nt_subject_line, nt_body, work_type_id")
    .eq("nt_is_deleted", false)
    .eq("nt_is_active", true)
    .eq("nt_trigger_event", triggerEvent)

  if (isNullFilter) {
    q = q.is("work_type_id", null)
  } else if (workTypeId) {
    q = q.eq("work_type_id", workTypeId)
  }

  if (channelFilter) {
    q = q.eq("nt_channel", channelFilter)
  }

  const { data, error } = await q
  if (error) {
    console.error("loadTemplates error", error)
    return []
  }
  return (data || []) as NotificationTemplateRow[]
}

// ─── Merge field substitution ───────────────────────────────────────────
// {{path.to.value}} → context.path.to.value. Missing values render as
// empty string (orchestrator's job is to deliver something — a broken
// template shouldn't blank the whole message). Mirrors the PRG
// substituteMergeFields convention.
function substituteMergeFields(template: string, context: AppointmentContext): string {
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

// ─── Channel dispatchers ────────────────────────────────────────────────
async function dispatchSms(
  supabaseUrl: string,
  serviceKey:  string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // No recipient → skip cleanly. The send-notification-sms function
  // validates E.164 format and would 400 anyway; preempting here gives
  // the orchestrator caller a clearer signal.
  if (!payload.recipient_phone) return { status: "skipped_no_phone" }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-notification-sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => null)
    return { http_status: res.status, ...(data || {}) }
  } catch (e) {
    return { status: "dispatch_error", message: (e as Error).message }
  }
}

async function dispatchEmail(
  supabaseUrl: string,
  serviceKey:  string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!payload.recipient_email) return { status: "skipped_no_email" }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => null)
    return { http_status: res.status, ...(data || {}) }
  } catch (e) {
    return { status: "dispatch_error", message: (e as Error).message }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────
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

// ─── Types ──────────────────────────────────────────────────────────────
interface NotificationTemplateRow {
  id: string
  nt_record_number: string
  nt_trigger_event: string
  nt_channel: string
  nt_subject_line: string | null
  nt_body: string
  work_type_id: string | null
}

interface AppointmentContext {
  appointment: {
    id: string
    record_number: string
    project_id: string | null
    work_type_id: string | null
    start_at: string | null
    end_at: string | null
    start_date: string
    start_time: string
    end_time: string
    work_type_name: string
    manage_url: string
  }
  contact: {
    id: string | null
    first_name: string
    last_name: string
    full_name: string
    phone: string
    phone_e164: string
    email: string
  }
  auditor: {
    id: string | null
    first_name: string
    last_name: string
    full_name: string
    phone: string
    phone_e164: string
    email: string
  }
  property: {
    id: string | null
    name: string
    street: string
    city: string
    state: string
    zip: string
    city_state_zip: string
  }
  work_type: {
    id: string | null
    name: string
    customer_facing_description: string
  }
  company: {
    name: string
    phone: string
    email: string
  }
}
