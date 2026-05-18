// ─── send-notification-email v2 ────────────────────────────────────────
// v2 changes: accept BOTH the original nested-recipient + body_html schema
// AND the orchestrator-flavored flat schema (recipient_email + body_text).
// This brings the email sender in line with send-notification-sms v2's
// flat shape so fire-notification and request-dispatcher-followup can
// drive both channels with one consistent payload.
//
// When only body_text is provided, it's auto-wrapped in an HTML <div>
// with \n -> <br/> for Graph's HTML body requirement.
//
// Each send writes a row to notification_logs for audit. Mock mode (any
// OUTLOOK_* env var missing) writes the row with mock-<uuid> as the
// provider id without calling Graph.
//
// Auth: server-to-server only. Public verify_jwt=false.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const DEFAULT_SENDER_BY_STATE: Record<string, string> = {
  WI: "assessments.wi@EES-WI.org",
}
const FALLBACK_SENDER = "assessments.wi@EES-WI.org"

interface Recipient { name?: string; email: string }

interface ReqBody {
  trigger_event:  string

  // Recipient: nested (v1 style) OR flat (v2 / orchestrator style). At least one must be present.
  recipient?:       Recipient
  recipient_email?: string
  recipient_name?:  string

  subject:        string

  // Body: HTML (v1 style) OR text (v2 / orchestrator style). At least one must be present.
  body_html?: string
  body_text?: string

  // Audit context
  notification_template_id?: string
  service_appointment_id?:   string
  contact_id?:               string

  // Sender selection
  sender_state?:    string
  sender_mailbox?:  string
  from_mailbox?:    string  // alias used by some orchestrator callers

  cc?:  Recipient[]
  bcc?: Recipient[]
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  let body: ReqBody
  try { body = await req.json() as ReqBody }
  catch { return json({ error: "Invalid JSON body" }, 400) }

  // Normalize the two accepted shapes onto a single internal model.
  const recipientEmail = body.recipient?.email || body.recipient_email
  const recipientName  = body.recipient?.name  || body.recipient_name || recipientEmail || ""
  const bodyText = body.body_text || (body.body_html ? stripHtml(body.body_html) : "")
  const bodyHtml = body.body_html || textToHtml(body.body_text || "")

  const v = validate(body, recipientEmail, bodyHtml)
  if (v) return json({ error: v }, 400)

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const clientId     = Deno.env.get("OUTLOOK_CLIENT_ID")
  const clientSecret = Deno.env.get("OUTLOOK_CLIENT_SECRET")
  const tenantId     = Deno.env.get("OUTLOOK_TENANT_ID")
  if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfiguration: Supabase keys missing" }, 500)

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const sender =
    body.sender_mailbox
    || body.from_mailbox
    || (body.sender_state ? DEFAULT_SENDER_BY_STATE[body.sender_state.toUpperCase()] : null)
    || FALLBACK_SENDER

  const { data: logRow, error: insErr } = await supabase
    .from("notification_logs")
    .insert({
      nl_record_number:         "",
      notification_template_id: body.notification_template_id || null,
      service_appointment_id:   body.service_appointment_id   || null,
      contact_id:               body.contact_id               || null,
      nl_trigger_event:         body.trigger_event,
      nl_channel:               "email",
      nl_recipient_address:     recipientEmail!,
      nl_subject:               body.subject,
      nl_body:                  bodyText,
      nl_status:                "queued",
      nl_provider:              "microsoft_graph",
    })
    .select("id, nl_record_number")
    .single()
  if (insErr || !logRow) {
    console.error("send-notification-email: notification_logs insert failed", insErr)
    return json({ status: "error", message: insErr?.message || "Could not log notification" }, 500)
  }

  const mockMode = !clientId || !clientSecret || !tenantId
  if (mockMode) {
    const mockId = `mock-${crypto.randomUUID()}`
    await supabase.from("notification_logs").update({
      nl_status:              "sent",
      nl_provider_message_id: mockId,
      nl_sent_at:             new Date().toISOString(),
      nl_updated_at:          new Date().toISOString(),
    }).eq("id", logRow.id)
    return json({
      status: "ok",
      notification_log_id: logRow.id,
      nl_record_number:    logRow.nl_record_number,
      provider_message_id: mockId,
      mode: "mock",
      sender,
    }, 200)
  }

  try {
    const accessToken = await getAppAccessToken(tenantId!, clientId!, clientSecret!)
    const graphRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            subject: body.subject,
            body: { contentType: "HTML", content: bodyHtml },
            toRecipients:  [toGraphRecipient({ email: recipientEmail!, name: recipientName })],
            ccRecipients:  (body.cc  || []).map(toGraphRecipient),
            bccRecipients: (body.bcc || []).map(toGraphRecipient),
          },
          saveToSentItems: true,
        }),
      },
    )

    if (graphRes.status === 202) {
      const syntheticId = `graph-${logRow.id}`
      await supabase.from("notification_logs").update({
        nl_status:              "sent",
        nl_provider_message_id: syntheticId,
        nl_sent_at:             new Date().toISOString(),
        nl_updated_at:          new Date().toISOString(),
      }).eq("id", logRow.id)
      return json({
        status: "ok",
        notification_log_id: logRow.id,
        nl_record_number:    logRow.nl_record_number,
        provider_message_id: syntheticId,
        mode: "real",
        sender,
      }, 200)
    }

    const errText = await graphRes.text().catch(() => "")
    const reason = `Graph sendMail returned ${graphRes.status}: ${errText.slice(0, 1500)}`
    await markFailed(supabase, logRow.id, reason, graphRes.status.toString())
    return json({
      status: "failed",
      notification_log_id: logRow.id,
      nl_record_number:    logRow.nl_record_number,
      failure_reason: reason,
    }, 200)
  } catch (e) {
    const reason = `Send threw: ${(e as Error).message}`.slice(0, 1500)
    await markFailed(supabase, logRow.id, reason, null)
    return json({
      status: "failed",
      notification_log_id: logRow.id,
      nl_record_number:    logRow.nl_record_number,
      failure_reason: reason,
    }, 200)
  }
})

function validate(b: ReqBody, recipientEmail: string | undefined, bodyHtml: string): string | null {
  if (!b || typeof b !== "object") return "Body must be a JSON object"
  if (!b.trigger_event) return "trigger_event required"
  if (!b.subject) return "subject required"
  if (!recipientEmail) return "recipient.email or recipient_email required"
  if (!bodyHtml) return "body_html or body_text required"
  if (b.sender_state && typeof b.sender_state !== "string") return "sender_state must be a string"
  if (b.sender_mailbox && !b.sender_mailbox.includes("@")) return "sender_mailbox must be an email address"
  return null
}

async function getAppAccessToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const resp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }).toString(),
  })
  const j = await resp.json()
  if (!resp.ok) throw new Error(j.error_description || j.error || `Token endpoint HTTP ${resp.status}`)
  if (!j.access_token) throw new Error("Token response missing access_token")
  return j.access_token as string
}

function toGraphRecipient(r: Recipient) {
  return { emailAddress: { address: r.email, name: r.name || r.email } }
}

async function markFailed(supabase: any, logId: string, reason: string, errorCode: string | null): Promise<void> {
  await supabase.from("notification_logs").update({
    nl_status: "failed",
    nl_provider_error_message: reason,
    nl_provider_error_code: errorCode,
    nl_updated_at: new Date().toISOString(),
  }).eq("id", logId)
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/\s+/g, " ")
    .trim().slice(0, 50_000)
}

// Auto-convert plain text to minimal HTML for Graph. Preserves line breaks,
// escapes &<> to entities. Wraps in a single <div> so Graph treats it as
// well-formed HTML.
function textToHtml(text: string): string {
  if (!text) return ""
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111;white-space:pre-wrap;">${escaped}</div>`
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
