// ─── admin-test-send-email ─────────────────────────────────────────────────
// Self-test harness for the email pipeline (same spirit as
// _admin-test-setup-envelope). Lets an operator/agent exercise the REAL
// send → deliver → reply → auto-thread loop without a human mailbox:
//
//   action "send"       — invoke send-email-v1 (service-role, on-behalf-of an
//                         explicit app user), optionally generating and
//                         pre-uploading a small test attachment. Sending the
//                         shared mailbox TO ITSELF keeps the loop machine-only.
//   action "reply_sim"  — simulate a customer reply: Graph-send a message
//                         addressed to the plus-tokenized alias
//                         (mailbox+c_xxxxxxxx@…) so the inbound webhook's
//                         tier-1 token match must thread it.
//   action "inspect"    — read recent messages from the mailbox via Graph
//                         ($select subject/hasAttachments/bodyPreview) so
//                         assertions (merge fields resolved? attachment
//                         present?) run against what ACTUALLY arrived.
//
// Auth: fail-closed shared secret (x-graph-renewal-secret), same gate as
// renew-graph-subscriptions — GRAPH_RENEWAL_CRON_SECRET falling back to
// GRAPH_WEBHOOK_CLIENT_STATE. verify_jwt=false because callers are pg_net /
// operators, not browsers.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const GRAPH_BASE = "https://graph.microsoft.com/v1.0"
const ATTACHMENT_BUCKET = "communications-attachments"

interface ReqBody {
  action: "send" | "reply_sim" | "inspect"
  // send
  anchor_object?: string
  anchor_record_id?: string
  on_behalf_of_user_id?: string
  to_email?: string
  subject?: string
  body_html?: string
  with_attachment?: boolean
  conversation_id?: string
  contact_id?: string
  // reply_sim
  mailbox?: string
  token?: string
  reply_body?: string
  // inspect
  subject_contains?: string
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405)

  const expectedSecret = Deno.env.get("GRAPH_RENEWAL_CRON_SECRET")
                      || Deno.env.get("GRAPH_WEBHOOK_CLIENT_STATE")
  if (!expectedSecret) return json({ error: "Server misconfigured: no shared secret set" }, 500)
  if ((req.headers.get("x-graph-renewal-secret") || "") !== expectedSecret) {
    return json({ error: "Forbidden" }, 401)
  }

  let body: ReqBody
  try { body = await req.json() as ReqBody }
  catch { return json({ error: "Invalid JSON body" }, 400) }

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")!
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const clientId     = Deno.env.get("OUTLOOK_CLIENT_ID")
  const clientSecret = Deno.env.get("OUTLOOK_CLIENT_SECRET")
  const tenantId     = Deno.env.get("OUTLOOK_TENANT_ID")
  if (!clientId || !clientSecret || !tenantId) {
    return json({ error: "Graph credentials not configured; self-test requires real mode" }, 500)
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  try {
    if (body.action === "send") {
      if (!body.anchor_object || !body.anchor_record_id || !body.on_behalf_of_user_id || !body.to_email) {
        return json({ error: "send requires anchor_object, anchor_record_id, on_behalf_of_user_id, to_email" }, 400)
      }
      let attachments: Array<Record<string, unknown>> | undefined
      let attachmentPath: string | null = null
      if (body.with_attachment) {
        attachmentPath = `staged/selftest-${crypto.randomUUID()}.txt`
        const content = new TextEncoder().encode(
          `LEAP email pipeline self-test attachment\ngenerated at ${new Date().toISOString()}\n`,
        )
        const { error: upErr } = await admin.storage
          .from(ATTACHMENT_BUCKET)
          .upload(attachmentPath, content, { contentType: "text/plain", upsert: false })
        if (upErr) return json({ error: `test attachment upload failed: ${upErr.message}` }, 500)
        attachments = [{
          storage_path: attachmentPath,
          file_name:    "leap-selftest.txt",
          mime_type:    "text/plain",
          size_bytes:   content.byteLength,
        }]
      }
      const resp = await fetch(`${supabaseUrl}/functions/v1/send-email-v1`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          anchor_object:        body.anchor_object,
          anchor_record_id:     body.anchor_record_id,
          on_behalf_of_user_id: body.on_behalf_of_user_id,
          to: { email: body.to_email, name: "LEAP Self-Test" },
          subject:   body.subject || "[LEAP self-test] email pipeline",
          body_html: body.body_html || "<p>[LEAP self-test] hello</p>",
          contact_id:      body.contact_id || undefined,
          conversation_id: body.conversation_id || undefined,
          attachments,
        }),
      })
      const sendResult = await resp.json().catch(() => ({})) as Record<string, unknown>
      // Mirror the composer's post-send bookkeeping: link the uploaded file to
      // the new message so the thread shows the paperclip in LEAP.
      if (resp.ok && attachments && sendResult?.message_id) {
        await admin.from("message_attachments").insert({
          ma_message_id:        sendResult.message_id,
          ma_storage_path:      attachments[0].storage_path,
          ma_file_name:         attachments[0].file_name,
          ma_file_size_bytes:   attachments[0].size_bytes,
          ma_mime_type:         attachments[0].mime_type,
          ma_delivery_method:   "inline",
          ma_virus_scan_status: "pending",
          ma_created_by:        body.on_behalf_of_user_id,
          ma_updated_by:        body.on_behalf_of_user_id,
        })
      }
      return json({ ok: resp.ok, http_status: resp.status, attachment_path: attachmentPath, send_result: sendResult }, 200)
    }

    if (body.action === "reply_sim") {
      if (!body.mailbox || !body.token) return json({ error: "reply_sim requires mailbox, token" }, 400)
      const at = body.mailbox.indexOf("@")
      if (at < 0) return json({ error: "mailbox must be an email address" }, 400)
      const tokenizedTo = `${body.mailbox.slice(0, at)}+${body.token}${body.mailbox.slice(at)}`
      const accessToken = await getAppAccessToken(tenantId, clientId, clientSecret)
      const resp = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(body.mailbox)}/sendMail`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            subject: `Re: ${body.subject || "[LEAP self-test] email pipeline"}`,
            body: { contentType: "HTML", content: body.reply_body || "<p>[LEAP self-test] simulated customer reply</p>" },
            toRecipients: [{ emailAddress: { address: tokenizedTo } }],
          },
          saveToSentItems: false,
        }),
      })
      const errText = resp.status === 202 ? null : await resp.text().catch(() => "")
      return json({ ok: resp.status === 202, http_status: resp.status, sent_to: tokenizedTo, error: errText }, 200)
    }

    if (body.action === "inspect") {
      if (!body.mailbox) return json({ error: "inspect requires mailbox" }, 400)
      const accessToken = await getAppAccessToken(tenantId, clientId, clientSecret)
      const url = `${GRAPH_BASE}/users/${encodeURIComponent(body.mailbox)}/messages` +
        `?$top=10&$orderby=receivedDateTime desc` +
        `&$select=subject,hasAttachments,bodyPreview,from,toRecipients,receivedDateTime`
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "")
        return json({ ok: false, http_status: resp.status, error: errText.slice(0, 800) }, 200)
      }
      const j = await resp.json() as { value: Array<Record<string, unknown>> }
      const needle = (body.subject_contains || "").toLowerCase()
      const rows = (j.value || []).filter(m =>
        !needle || String(m.subject || "").toLowerCase().includes(needle))
      return json({ ok: true, count: rows.length, messages: rows }, 200)
    }

    return json({ error: `Unknown action '${body.action}'` }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

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
  return j.access_token as string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}
