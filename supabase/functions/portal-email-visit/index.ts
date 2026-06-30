// ─── portal-email-visit ───────────────────────────────────────────────────
// Emails the signed-in PORTAL USER a calendar invite for one or more of their
// site visits, via Microsoft Graph (same app-only sendMail path as
// send-notification-email), with the .ics ATTACHED so it lands as a real
// invite in their inbox. A copy is logged to notification_logs so EES keeps a
// record.
//
// Security: the recipient is ALWAYS the authenticated portal user's own email
// (resolved from their JWT → portal_users), never a client-supplied address.
// The requested appointments are re-resolved server-side and filtered to the
// visits the user is actually granted (portal_user_property_grants), so a user
// can only email visits they can already see.
//
// Mock mode (any OUTLOOK_* env var missing): logs the row and returns
// mode:"mock" without calling Graph — same convention as the other senders.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const FALLBACK_SENDER = "assessments.wi@EES-WI.org"

interface ReqBody { appointment_ids: string[] }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  let body: ReqBody
  try { body = await req.json() as ReqBody } catch { return json({ error: "Invalid JSON body" }, 400) }
  const ids = Array.isArray(body?.appointment_ids) ? body.appointment_ids.filter(Boolean) : []
  if (!ids.length) return json({ error: "appointment_ids required" }, 400)

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const clientId     = Deno.env.get("OUTLOOK_CLIENT_ID")
  const clientSecret = Deno.env.get("OUTLOOK_CLIENT_SECRET")
  const tenantId     = Deno.env.get("OUTLOOK_TENANT_ID")
  if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfiguration" }, 500)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // ── Resolve the caller → portal user (recipient is always their own email) ──
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")
  if (!jwt) return json({ error: "Not authenticated" }, 401)
  const { data: userData } = await admin.auth.getUser(jwt)
  const authUid = userData?.user?.id
  if (!authUid) return json({ error: "Not authenticated" }, 401)

  const { data: pu } = await admin
    .from("portal_users")
    .select("id, full_name, email, status")
    .eq("auth_user_id", authUid).eq("is_deleted", false).maybeSingle()
  if (!pu || pu.status !== "Active") return json({ error: "Not an active portal user" }, 403)
  if (!pu.email) return json({ error: "Your portal profile has no email address on file." }, 400)

  // ── Grants for this portal user ──
  const { data: grants } = await admin
    .from("portal_user_property_grants")
    .select("pug_property_id, pug_building_id")
    .eq("pug_portal_user_id", pu.id).eq("pug_is_deleted", false)
  const propIds = new Set((grants || []).map((g: any) => g.pug_property_id).filter(Boolean))
  const bldgIds = new Set((grants || []).map((g: any) => g.pug_building_id).filter(Boolean))

  // ── Re-resolve the requested appointments, scoped to the user's grants ──
  const { data: rows, error: qErr } = await admin
    .from("service_appointments")
    .select(`id, sa_subject, sa_name, sa_scheduled_start_time, sa_scheduled_end_time,
             work_orders!inner ( property_id, building_id, unit_id,
               properties ( property_name, property_street, property_city, property_state, property_zip ),
               buildings ( building_name, building_address ),
               units ( unit_number ) )`)
    .in("id", ids).eq("sa_is_deleted", false)
  if (qErr) return json({ error: qErr.message }, 500)

  const visits = (rows || []).filter((r: any) => {
    const wo = r.work_orders
    return wo && (propIds.has(wo.property_id) || bldgIds.has(wo.building_id))
  }).map((r: any) => {
    const wo = r.work_orders, p = wo.properties || {}, b = wo.buildings || {}, u = wo.units || {}
    const propAddr = [p.property_street, p.property_city, [p.property_state, p.property_zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    return {
      id: r.id,
      subject: r.sa_subject || r.sa_name || "Site Visit",
      start: r.sa_scheduled_start_time, end: r.sa_scheduled_end_time,
      location: [b.building_address || b.building_name, u.unit_number ? `Unit ${u.unit_number}` : "", propAddr].filter(Boolean).join(", "),
    }
  }).filter((v: any) => v.start)

  if (!visits.length) return json({ error: "No matching visits you're allowed to email." }, 404)

  const subject = visits.length === 1 ? `Site Visit — ${visits[0].subject}` : `${visits.length} Site Visits — Energy Efficiency Services`
  const ics = buildICS(visits)
  const bodyHtml = buildHtml(visits, pu.full_name)

  // Log (record for EES) regardless of mock/real
  const { data: logRow } = await admin.from("notification_logs").insert({
    nl_record_number: "", nl_trigger_event: "portal_email_site_visit", nl_channel: "email",
    nl_recipient_address: pu.email, nl_subject: subject, nl_body: `Site visit invite (${visits.length})`,
    nl_status: "queued", nl_provider: "microsoft_graph",
    service_appointment_id: visits.length === 1 ? visits[0].id : null,
  }).select("id").single()

  const mockMode = !clientId || !clientSecret || !tenantId
  if (mockMode) {
    if (logRow) await admin.from("notification_logs").update({ nl_status: "sent", nl_provider_message_id: `mock-${crypto.randomUUID()}`, nl_sent_at: new Date().toISOString() }).eq("id", logRow.id)
    return json({ status: "ok", mode: "mock", emailed_to: pu.email, count: visits.length }, 200)
  }

  try {
    const token = await getAppAccessToken(tenantId!, clientId!, clientSecret!)
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(FALLBACK_SENDER)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: bodyHtml },
          toRecipients: [{ emailAddress: { address: pu.email, name: pu.full_name || pu.email } }],
          attachments: [{
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: "site-visits.ics",
            contentType: "text/calendar; method=PUBLISH",
            contentBytes: b64(ics),
          }],
        },
        saveToSentItems: true,
      }),
    })
    if (res.status === 202) {
      if (logRow) await admin.from("notification_logs").update({ nl_status: "sent", nl_provider_message_id: `graph-${logRow.id}`, nl_sent_at: new Date().toISOString() }).eq("id", logRow.id)
      return json({ status: "ok", mode: "real", emailed_to: pu.email, count: visits.length }, 200)
    }
    const errText = await res.text().catch(() => "")
    if (logRow) await admin.from("notification_logs").update({ nl_status: "failed", nl_provider_error_message: `Graph ${res.status}: ${errText.slice(0, 800)}` }).eq("id", logRow.id)
    return json({ status: "failed", failure_reason: `Graph sendMail ${res.status}` }, 200)
  } catch (e) {
    if (logRow) await admin.from("notification_logs").update({ nl_status: "failed", nl_provider_error_message: (e as Error).message.slice(0, 800) }).eq("id", logRow.id)
    return json({ status: "failed", failure_reason: (e as Error).message }, 200)
  }
})

function icsStamp(s: string) { return new Date(s).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "") }
function icsEsc(t: string) { return String(t || "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n") }
function buildICS(visits: any[]) {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EES//Project Portal//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"]
  for (const v of visits) {
    L.push("BEGIN:VEVENT", `UID:${v.id}@ees-portal`, `DTSTAMP:${icsStamp(new Date().toISOString())}`,
      `DTSTART:${icsStamp(v.start)}`, `DTEND:${icsStamp(v.end || v.start)}`,
      `SUMMARY:${icsEsc(v.subject)}`, `LOCATION:${icsEsc(v.location)}`, "END:VEVENT")
  }
  L.push("END:VCALENDAR")
  return L.join("\r\n")
}
function buildHtml(visits: any[], name: string) {
  const rows = visits.map((v) => {
    const d = new Date(v.start)
    const when = d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    return `<tr><td style="padding:8px 12px;border-bottom:1px solid #e4e9f2"><strong>${esc(v.subject)}</strong><br><span style="color:#4a5e7a;font-size:13px">${esc(when)} · ${esc(v.location)}</span></td></tr>`
  }).join("")
  return `<div style="font-family:Arial,sans-serif;color:#0d1a2e">
    <p>Hi ${esc(name || "there")},</p>
    <p>Here ${visits.length === 1 ? "is your scheduled site visit" : "are your scheduled site visits"} from Energy Efficiency Services. The calendar invite is attached (open <strong>site-visits.ics</strong> to add ${visits.length === 1 ? "it" : "them"} to your calendar).</p>
    <table style="border-collapse:collapse;width:100%;max-width:560px;border:1px solid #e4e9f2;border-radius:8px">${rows}</table>
    <p style="color:#8fa0b8;font-size:12px;margin-top:18px">Energy Efficiency Services of Wisconsin · Project Portal</p>
  </div>`
}
function esc(t: string) { return String(t || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string)) }
function b64(s: string) { const bytes = new TextEncoder().encode(s); let bin = ""; bytes.forEach((x) => bin += String.fromCharCode(x)); return btoa(bin) }

async function getAppAccessToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const resp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" }).toString(),
  })
  const j = await resp.json()
  if (!resp.ok) throw new Error(j.error_description || j.error || `Token HTTP ${resp.status}`)
  if (!j.access_token) throw new Error("Token response missing access_token")
  return j.access_token as string
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
