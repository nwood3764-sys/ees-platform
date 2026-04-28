// =============================================================================
// resend-envelope-email (v1)
//
// Re-sends the signing-request email for an in-flight envelope to a single
// recipient. Reuses the existing signing token (URL is unchanged), so the
// recipient lands on the same portal view they would have if they'd clicked
// the original email.
//
// Auth model:
//   - JWT-authenticated (Anura logged-in user). The caller MUST be the
//     envelope owner or Admin; enforced server-side.
//   - The email itself is sent from the envelope OWNER's Outlook mailbox
//     (using stored refresh tokens), not the caller's. This keeps the
//     recipient's inbox thread coherent — the resend appears in the same
//     conversation as the original send and any prior resends.
//
// Validation:
//   - Envelope must exist, not deleted, and be in 'Sent' or 'Delivered' state
//   - Recipient must exist on this envelope, not signed, not declined,
//     not have a Voided or terminal status
//   - Recipient signing token must not have expired
//   - If recipient_id omitted, defaults to the lowest-order unsigned/
//     undeclined recipient (the "current" pending signer)
//
// Side effects:
//   - email_sends row written (Pending → Sent/Failed)
//   - envelope_events row written: event_type=Resent,
//     metadata={ recipient_id, attempt_n, email_send_id, signing_url }
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const REFRESH_HORIZON_MS = 5 * 60 * 1000

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface ReqBody {
  envelope_id:    string
  recipient_id?:  string | null
  signing_base_url?: string
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  let body: ReqBody
  try { body = await req.json() as ReqBody }
  catch { return json({ error: "Invalid JSON body" }, 400) }
  if (!body.envelope_id) return json({ error: "envelope_id required" }, 400)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Server misconfiguration" }, 500)

  const authHeader = req.headers.get("Authorization") || ""
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing Bearer token" }, 401)

  // Caller-scoped client validates the user; service-role client does the
  // privileged writes (email_sends, envelope_events) + reads stored OAuth
  // tokens out of user_outlook_connections.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: callerUserId, error: idErr } = await callerClient.rpc("current_app_user_id")
  if (idErr || !callerUserId) return json({ error: "Could not resolve caller's user id" }, 401)

  // ── Load envelope + status (service role; we've already gated on the JWT) ──
  const { data: env, error: envErr } = await adminClient
    .from("envelopes")
    .select(`
      id, env_record_number, env_name, env_subject, env_message,
      env_owner, env_parent_object, env_parent_record_id, is_deleted,
      status:env_status ( picklist_value )
    `)
    .eq("id", body.envelope_id)
    .maybeSingle()
  if (envErr) return json({ error: `Envelope lookup failed: ${envErr.message}` }, 500)
  if (!env || env.is_deleted) return json({ error: "Envelope not found" }, 404)

  const envStatus = (env as any).status?.picklist_value
  if (envStatus !== "Sent" && envStatus !== "Delivered") {
    return json({ error: `Cannot resend — envelope is ${envStatus}` }, 409)
  }

  // ── Permission: owner or admin only ───────────────────────────────────────
  const { data: isAdmin } = await callerClient.rpc("app_is_admin")
  const ownerMatches = (env as any).env_owner === callerUserId
  if (!isAdmin && !ownerMatches) {
    return json({ error: "Only the envelope owner or Admin may resend" }, 403)
  }

  // ── Resolve recipient ─────────────────────────────────────────────────────
  let recipientQuery = adminClient
    .from("envelope_recipients")
    .select(`
      id, recipient_order, recipient_name, recipient_email,
      recipient_signing_token, recipient_token_expires_at,
      recipient_signed_at, recipient_declined_at,
      status:recipient_status ( picklist_value )
    `)
    .eq("envelope_id", env.id)
    .eq("is_deleted", false)
    .order("recipient_order", { ascending: true })

  if (body.recipient_id) recipientQuery = recipientQuery.eq("id", body.recipient_id)

  const { data: recipientRows, error: recipErr } = await recipientQuery
  if (recipErr) return json({ error: `Recipient lookup failed: ${recipErr.message}` }, 500)
  if (!recipientRows || recipientRows.length === 0)
    return json({ error: "Recipient not found on this envelope" }, 404)

  // If specific recipient requested, take that row. Otherwise pick the lowest-
  // order unsigned/undeclined recipient — the "current pending signer."
  let target: any
  if (body.recipient_id) {
    target = recipientRows[0]
  } else {
    target = recipientRows.find(r => !r.recipient_signed_at && !r.recipient_declined_at)
    if (!target) return json({ error: "No pending recipient on this envelope" }, 409)
  }

  if (target.recipient_signed_at) return json({ error: "Recipient has already signed" }, 409)
  if (target.recipient_declined_at) return json({ error: "Recipient has declined" }, 409)
  const recipStatusVal = (target.status?.picklist_value) as string | undefined
  if (recipStatusVal === "Voided" || recipStatusVal === "Declined" || recipStatusVal === "Signed" || recipStatusVal === "Completed")
    return json({ error: `Recipient status is ${recipStatusVal}, cannot resend` }, 409)
  if (target.recipient_token_expires_at && new Date(target.recipient_token_expires_at) < new Date())
    return json({ error: "Signing link has expired — void this envelope and send a new one" }, 410)

  // ── Build signing URL (token is unchanged from the original send) ─────────
  const signingBase = body.signing_base_url
    || req.headers.get("Origin")
    || req.headers.get("Referer")?.split("/").slice(0, 3).join("/")
    || "https://ees-ops.netlify.app"
  const signingUrl = `${signingBase}/sign/${env.env_record_number}/${target.recipient_signing_token}`

  // ── Send via the envelope OWNER's Outlook (stored tokens) ─────────────────
  const sendResult = await sendResendEmail(adminClient, {
    envelopeOwnerUserId: (env as any).env_owner,
    envelopeId:          env.id,
    parentObject:        (env as any).env_parent_object,
    parentRecordId:      (env as any).env_parent_record_id,
    envName:             (env as any).env_name,
    customMessage:       (env as any).env_message || null,
    subject:             (env as any).env_subject || `Reminder: please sign ${(env as any).env_name}`,
    signingUrl,
    recipientId:         target.id,
    recipientName:       target.recipient_name,
    recipientEmail:      target.recipient_email,
  })

  // ── Audit: count prior Resent events for this recipient → attempt_n ───────
  const { count: priorResends } = await adminClient
    .from("envelope_events")
    .select("id", { count: "exact", head: true })
    .eq("envelope_id", env.id)
    .eq("recipient_id", target.id)
    .eq("event_type", await picklistId(adminClient, "envelope_events", "event_type", "Resent") || "")

  const eventResentId   = await picklistId(adminClient, "envelope_events", "event_type", "Resent")
  const standardEventRt = await picklistId(adminClient, "envelope_events", "record_type", "Standard")
  if (eventResentId) {
    await adminClient.from("envelope_events").insert({
      event_record_number: "",
      envelope_id:         env.id,
      recipient_id:        target.id,
      event_record_type:   standardEventRt,
      event_type:          eventResentId,
      event_metadata: {
        attempt_n:      (priorResends || 0) + 1,
        email_status:   sendResult.status,
        email_send_id:  sendResult.email_send_id || null,
        failure_reason: sendResult.failure_reason || null,
        resent_by_user_id: callerUserId,
        signing_url:    signingUrl,
      },
      created_by: callerUserId,
    })
  }

  if (sendResult.status === "Sent") {
    return json({
      ok:               true,
      envelope_id:      env.id,
      recipient_id:     target.id,
      attempt_n:        (priorResends || 0) + 1,
      email_send_id:    sendResult.email_send_id,
      signing_url:      signingUrl,
    }, 200)
  }
  return json({
    ok:               false,
    envelope_id:      env.id,
    recipient_id:     target.id,
    email_status:     sendResult.status,
    failure_reason:   sendResult.failure_reason,
    signing_url:      signingUrl,
  }, 502)
})

// ─── Outlook send helper (mirrors signing-portal-submit pattern) ──────────────
async function sendResendEmail(
  supabase: SupabaseClient,
  p: {
    envelopeOwnerUserId: string
    envelopeId:     string
    parentObject:   string
    parentRecordId: string
    envName:        string
    customMessage:  string | null
    subject:        string
    signingUrl:     string
    recipientId:    string
    recipientName:  string
    recipientEmail: string
  },
): Promise<{ status: string, email_send_id?: string, failure_reason?: string }> {
  const clientId     = Deno.env.get("OUTLOOK_CLIENT_ID")
  const clientSecret = Deno.env.get("OUTLOOK_CLIENT_SECRET")
  const tenantId     = Deno.env.get("OUTLOOK_TENANT_ID")
  if (!clientId || !clientSecret || !tenantId)
    return { status: "not_configured", failure_reason: "OUTLOOK_* env vars not set" }

  const { data: conn } = await supabase
    .from("user_outlook_connections")
    .select("id, account_email, access_token, refresh_token, token_expires_at, is_active")
    .eq("user_id", p.envelopeOwnerUserId)
    .maybeSingle()
  if (!conn || !conn.is_active)
    return { status: "not_connected", failure_reason: "Envelope owner has no active Outlook connection" }

  let accessToken = conn.access_token
  if (new Date(conn.token_expires_at).getTime() - Date.now() < REFRESH_HORIZON_MS) {
    try {
      const refreshed = await refreshAccessToken(tenantId, clientId, clientSecret, conn.refresh_token)
      accessToken = refreshed.access_token
      await supabase.from("user_outlook_connections").update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token || conn.refresh_token,
        token_expires_at: new Date(Date.now() + (refreshed.expires_in * 1000) - 60_000).toISOString(),
        last_refreshed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", conn.id)
    } catch (e) {
      return { status: "refresh_failed", failure_reason: (e as Error).message }
    }
  }

  let senderName: string | null = null
  const { data: u } = await supabase.from("users")
    .select("user_first_name, user_last_name, user_name")
    .eq("id", p.envelopeOwnerUserId).maybeSingle()
  if (u) {
    const full = [(u as any).user_first_name, (u as any).user_last_name].filter(Boolean).join(" ").trim()
    senderName = full || (u as any).user_name || null
  }

  const bodyHtml = renderResendHtml({
    recipientName: p.recipientName,
    senderName: senderName || "Energy Efficiency Services",
    templateName: p.envName,
    customMessage: p.customMessage,
    signingUrl: p.signingUrl,
  })
  const bodyText = renderResendText({
    recipientName: p.recipientName,
    senderName: senderName || "Energy Efficiency Services",
    templateName: p.envName,
    customMessage: p.customMessage,
    signingUrl: p.signingUrl,
  })

  const { data: emailRow, error: insErr } = await supabase
    .from("email_sends")
    .insert({
      email_send_record_number: "",
      parent_object:    p.parentObject,
      parent_record_id: p.parentRecordId,
      sent_by_user_id:  p.envelopeOwnerUserId,
      sent_via:         "graph_outlook",
      sender_email:     conn.account_email,
      subject:          p.subject,
      body_html:        bodyHtml,
      body_text:        bodyText,
      recipients_to:    [{ name: p.recipientName, email: p.recipientEmail }],
      status:           "Pending",
      related_envelope_id:  p.envelopeId,
      related_recipient_id: p.recipientId,
      created_by:       p.envelopeOwnerUserId,
      updated_by:       p.envelopeOwnerUserId,
    })
    .select("id")
    .single()
  if (insErr || !emailRow) return { status: "failed", failure_reason: `email_sends insert failed: ${insErr?.message}` }

  let sendOk = false
  let failureReason: string | null = null
  try {
    const sendResp = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: p.subject,
          body:    { contentType: "HTML", content: bodyHtml },
          toRecipients: [{ emailAddress: { address: p.recipientEmail, name: p.recipientName } }],
        },
        saveToSentItems: true,
      }),
    })
    if (sendResp.status === 202) sendOk = true
    else failureReason = `Graph sendMail returned ${sendResp.status}: ${(await sendResp.text()).slice(0, 1500)}`
  } catch (e) {
    failureReason = (e as Error).message
  }

  await supabase.from("email_sends").update({
    status: sendOk ? "Sent" : "Failed",
    sent_at: sendOk ? new Date().toISOString() : null,
    failure_reason: failureReason,
    updated_at: new Date().toISOString(),
  }).eq("id", emailRow.id)

  if (sendOk) {
    await supabase.from("user_outlook_connections").update({
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", conn.id)
  }

  return { status: sendOk ? "Sent" : "Failed", email_send_id: emailRow.id, failure_reason: failureReason || undefined }
}

async function refreshAccessToken(
  tenantId: string, clientId: string, clientSecret: string, refreshToken: string,
): Promise<{ access_token: string, refresh_token?: string, expires_in: number }> {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
  const params = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    grant_type:    "refresh_token",
    refresh_token: refreshToken,
    scope:         "https://graph.microsoft.com/.default offline_access",
  })
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })
  if (!resp.ok) throw new Error(`Token refresh failed: ${resp.status} ${await resp.text()}`)
  return await resp.json()
}

async function picklistId(
  supabase: SupabaseClient, obj: string, field: string, value: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("picklist_values").select("id")
    .eq("picklist_object", obj)
    .eq("picklist_field", field)
    .eq("picklist_value", value)
    .eq("picklist_is_active", true)
    .maybeSingle()
  return data?.id || null
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  })
}

// Resend body — visually identical to the original signing-request email
// from send-envelope, plus a small "Reminder" framing line so the recipient
// understands this isn't a new envelope.
function renderResendHtml(p: {
  recipientName: string, senderName: string, templateName: string,
  customMessage: string | null, signingUrl: string,
}): string {
  const safe = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const customBlock = p.customMessage
    ? `<p style="white-space:pre-wrap;">${safe(p.customMessage)}</p>`
    : `<p>This is a reminder that <strong>${safe(p.templateName)}</strong> is still waiting for your signature.</p>`
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.55;color:#1a202c;max-width:600px;margin:0 auto;padding:24px;background:#fff;">
<p style="font-size:15px;">Hi ${safe(p.recipientName.split(" ")[0] || p.recipientName)},</p>
<div style="font-size:14px;">${customBlock}</div>
<div style="margin:28px 0;">
  <a href="${p.signingUrl}" style="background:#1f7ae0;color:#fff;padding:13px 28px;text-decoration:none;border-radius:6px;font-weight:600;display:inline-block;font-size:14px;">Review and Sign</a>
</div>
<p style="font-size:12px;color:#666;">If the button doesn't work, paste this URL into your browser:<br><a href="${p.signingUrl}" style="color:#1f7ae0;word-break:break-all;">${p.signingUrl}</a></p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
<p style="font-size:11px;color:#888;">Sent on behalf of ${safe(p.senderName)} from Energy Efficiency Services. Your original signing link is unchanged and still valid.</p>
</body></html>`
}

function renderResendText(p: {
  recipientName: string, senderName: string, templateName: string,
  customMessage: string | null, signingUrl: string,
}): string {
  const greeting = `Hi ${p.recipientName.split(" ")[0] || p.recipientName},`
  const intro = p.customMessage || `This is a reminder that ${p.templateName} is still waiting for your signature.`
  return `${greeting}\n\n${intro}\n\nReview and sign:\n${p.signingUrl}\n\n—\nSent on behalf of ${p.senderName} from Energy Efficiency Services. Your original signing link is unchanged and still valid.`
}
