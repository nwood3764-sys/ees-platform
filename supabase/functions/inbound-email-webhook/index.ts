// ─── inbound-email-webhook ───────────────────────────────────────────────
// Microsoft Graph change-notification receiver for inbound email. Mirrors
// the twilio-inbound pattern: validates the request, idempotently inserts
// the inbound message into the `messages` table, and threads it onto the
// correct conversation via a fallback chain.
//
// Subscribe Graph notifications via Microsoft Graph REST:
//   POST https://graph.microsoft.com/v1.0/subscriptions
//   {
//     "changeType":         "created",
//     "notificationUrl":    "https://flyjigrijjjtcsvpgzvk.supabase.co/functions/v1/inbound-email-webhook",
//     "resource":           "users/assessments@ees-wi.org/mailFolders('Inbox')/messages",
//     "expirationDateTime": "<ISO-8601 ~3 days from now>",
//     "clientState":        "<env GRAPH_WEBHOOK_CLIENT_STATE>"
//   }
//
// Graph expires subscriptions every ~3 days; renewal cron is its own function
// (renew-graph-subscriptions, deferred).
//
// Handshake — when a subscription is created Graph sends GET with
//   ?validationToken=<token>
// We must respond 200 with the token as plain text body, within 10 seconds.
// We support this on POST too (Graph documentation differs between versions).
//
// Notification format (Graph POSTs JSON):
//   {
//     "value": [
//       {
//         "subscriptionId":   "...",
//         "changeType":       "created",
//         "resource":         "users/{mailbox}/messages/{id}",
//         "resourceData":     { "id": "{message-id}", "@odata.type": "#Microsoft.Graph.Message" },
//         "clientState":      "<our token>"
//       }
//     ]
//   }
//
// On receipt the function:
//   1. Validates clientState against GRAPH_WEBHOOK_CLIENT_STATE.
//   2. For each notification entry: fetches the full message from Graph
//      (real mode) OR uses inline `_mock_message` payload (mock mode).
//   3. Resolves the thread via a three-step fallback:
//        a. Plus-addressed conversation token in toRecipients
//           (assessments+c_8f3a2b1d@ees-wi.org → conversations.id LIKE '8f3a2b1d%')
//        b. In-Reply-To / References header → messages.msg_external_message_id
//        c. Sender email → contacts.contact_email → most recent open thread
//   4. If matched: insert messages row in 'received', rollup trigger
//      updates conv_last_message_at / _direction / _preview / _inbound_unread.
//   5. If unmatched: write to unmatched_inbox for triage.
//
// Mock-mode testing — POST with `_mock_message` payload bypasses the Graph
// fetch:
//   {
//     "value":[{ "subscriptionId":"…", "changeType":"created", "resource":"users/…/messages/…",
//                "resourceData":{"id":"mock-1"}, "clientState":"…",
//                "_mock_message": {
//                  "id":"mock-1",
//                  "internetMessageId":"<some@id>",
//                  "subject":"Re: …",
//                  "bodyPreview":"…",
//                  "body":{"contentType":"html","content":"<p>…</p>"},
//                  "from":{"emailAddress":{"address":"customer@example.com","name":"Customer"}},
//                  "toRecipients":[{"emailAddress":{"address":"assessments+c_8f3a2b1d@ees-wi.org"}}],
//                  "internetMessageHeaders":[
//                    {"name":"In-Reply-To","value":"<leap-…@ees-wi.org>"}
//                  ]
//                }
//              }]
//   }
//
// Auth: public webhook. verify_jwt=false because Microsoft Graph won't
// present a JWT. clientState (HMAC-like shared secret) is the security
// boundary.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// ── Types ───────────────────────────────────────────────────────────────

interface GraphRecipient {
  emailAddress: { address: string; name?: string }
}

interface GraphMessage {
  id?: string
  internetMessageId?: string
  subject?: string
  bodyPreview?: string
  body?: { contentType?: string; content?: string }
  from?: GraphRecipient
  toRecipients?: GraphRecipient[]
  ccRecipients?: GraphRecipient[]
  internetMessageHeaders?: { name: string; value: string }[]
  receivedDateTime?: string
}

interface NotificationEntry {
  subscriptionId?: string
  changeType?: string
  resource?: string
  resourceData?: { id?: string; "@odata.type"?: string }
  clientState?: string
  _mock_message?: GraphMessage  // mock-mode bypass
}

interface NotificationBody {
  value?: NotificationEntry[]
}

// ── Server ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  // Subscription validation handshake — Graph sends ?validationToken=<token>
  // (sometimes as GET, sometimes as POST with empty body). Echo the token
  // back as plain text within 10 seconds to prove URL ownership.
  const url = new URL(req.url)
  const validationToken = url.searchParams.get("validationToken")
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { ...cors, "Content-Type": "text/plain" },
    })
  }

  if (req.method !== "POST") {
    // Any other method gets a 200 — Graph treats non-2xx as failure and retries
    return new Response("OK", { status: 200, headers: cors })
  }

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const clientState  = Deno.env.get("GRAPH_WEBHOOK_CLIENT_STATE")
  if (!supabaseUrl || !serviceKey) {
    console.error("inbound-email-webhook: Supabase service-role key missing — cannot persist")
    return ok()
  }

  // Parse body
  let body: NotificationBody
  try { body = await req.json() as NotificationBody }
  catch (e) {
    console.error("inbound-email-webhook: invalid JSON body", e)
    return ok()
  }

  if (!body?.value || !Array.isArray(body.value) || body.value.length === 0) {
    console.warn("inbound-email-webhook: empty value array — nothing to do")
    return ok()
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const results: any[] = []
  for (const entry of body.value) {
    // clientState validation — every notification carries the shared secret
    // we registered in the subscription. Reject mismatches silently (Graph
    // doesn't retry on validation, but we don't want a thrash loop either).
    if (clientState) {
      if (entry.clientState !== clientState) {
        console.error("inbound-email-webhook: clientState mismatch — dropping notification", {
          subscriptionId: entry.subscriptionId,
        })
        results.push({ status: "rejected", reason: "clientState mismatch" })
        continue
      }
    } else {
      console.warn("inbound-email-webhook: GRAPH_WEBHOOK_CLIENT_STATE not set — validation SKIPPED")
    }

    try {
      const result = await processNotification(admin, entry)
      results.push(result)
    } catch (e) {
      console.error("inbound-email-webhook: unhandled exception processing entry", e)
      results.push({ status: "error", error: (e as Error).message })
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  })
})

// ── Per-notification pipeline ───────────────────────────────────────────

async function processNotification(admin: SupabaseClient, entry: NotificationEntry): Promise<any> {
  // Identify the mailbox the notification belongs to (our_address for thread
  // lookups). Resource shape: users/{mailbox}/messages/{id} or
  // users/{mailbox}/mailFolders('Inbox')/messages/{id}.
  const ourMailbox = extractMailboxFromResource(entry.resource || "")
  if (!ourMailbox) {
    console.error("inbound-email-webhook: could not parse mailbox from resource", entry.resource)
    return { status: "error", error: "unparseable resource" }
  }

  // Fetch the message — mock-mode uses inline _mock_message; real-mode hits
  // Graph with app-only access token.
  let message: GraphMessage | null = null
  let mode: "mock" | "real" = "mock"
  if (entry._mock_message) {
    message = entry._mock_message
    mode = "mock"
  } else {
    const tenantId     = Deno.env.get("OUTLOOK_TENANT_ID")
    const clientId     = Deno.env.get("OUTLOOK_CLIENT_ID")
    const clientSecret = Deno.env.get("OUTLOOK_CLIENT_SECRET")
    if (!tenantId || !clientId || !clientSecret) {
      console.warn("inbound-email-webhook: Graph creds missing and no _mock_message — cannot fetch", {
        resource: entry.resource,
      })
      return { status: "skipped", reason: "no graph creds and no mock payload" }
    }
    try {
      const accessToken = await getAppAccessToken(tenantId, clientId, clientSecret)
      message = await fetchMessageFromGraph(accessToken, ourMailbox, entry.resourceData?.id || "")
      mode = "real"
    } catch (e) {
      console.error("inbound-email-webhook: Graph fetch failed", e)
      return { status: "error", error: `graph fetch: ${(e as Error).message}` }
    }
  }
  if (!message) return { status: "error", error: "no message body" }

  // Extract canonical fields we'll need throughout
  const internetMessageId = message.internetMessageId || ""
  const fromAddress       = message.from?.emailAddress?.address || ""
  const subject           = message.subject || ""
  const bodyContent       = message.body?.content || message.bodyPreview || ""
  const toRecipients      = message.toRecipients || []
  const headersByName     = headerMap(message.internetMessageHeaders || [])

  if (!fromAddress) {
    console.error("inbound-email-webhook: missing From address — cannot route")
    return { status: "error", error: "missing From" }
  }

  // Idempotency — Graph can fire duplicate notifications. Match on
  // internetMessageId (most reliable) and fall back to the Graph message id.
  const idempotencyKey = internetMessageId || message.id || ""
  if (idempotencyKey) {
    const { data: existing } = await admin
      .from("messages")
      .select("id")
      .eq("msg_provider_message_id", idempotencyKey)
      .eq("msg_is_deleted", false)
      .maybeSingle()
    if (existing) {
      return { status: "duplicate", message_id: existing.id }
    }
  }

  // ── Thread-resolution fallback chain ───────────────────────────────
  let conversationId: string | null = null
  let resolutionTrace = ""

  // (1) Plus-addressed conversation token
  const tokenFromTo = findConversationTokenInRecipients(toRecipients)
  if (tokenFromTo) {
    const { data: convByToken } = await admin
      .from("conversations")
      .select("id, conv_record_number")
      .eq("conv_short_token", tokenFromTo)
      .eq("conv_is_deleted", false)
      .limit(1)
      .maybeSingle()
    if (convByToken) {
      conversationId = convByToken.id
      resolutionTrace = `plus-address token ${tokenFromTo} → ${convByToken.conv_record_number}`
    }
  }

  // (2) In-Reply-To / References header
  if (!conversationId) {
    const inReplyTo = headersByName.get("in-reply-to") || ""
    const references = headersByName.get("references") || ""
    const candidateIds = extractMessageIds(`${inReplyTo} ${references}`)
    if (candidateIds.length > 0) {
      const { data: msgByMsgId } = await admin
        .from("messages")
        .select("conversation_id, msg_record_number")
        .in("msg_external_message_id", candidateIds)
        .eq("msg_is_deleted", false)
        .order("msg_created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (msgByMsgId?.conversation_id) {
        conversationId = msgByMsgId.conversation_id
        resolutionTrace = `Message-ID match → ${msgByMsgId.msg_record_number}`
      }
    }
  }

  // (3) Sender email → contact → most-recent open thread on that mailbox
  if (!conversationId) {
    const { data: contact } = await admin
      .from("contacts")
      .select("id")
      .eq("contact_email", fromAddress.toLowerCase())
      .eq("contact_is_deleted", false)
      .limit(1)
      .maybeSingle()
    if (contact?.id) {
      const { data: openThread } = await admin
        .from("conversations")
        .select("id, conv_record_number")
        .eq("contact_id", contact.id)
        .eq("conv_channel", "email")
        .eq("conv_our_address", ourMailbox)
        .eq("conv_is_deleted", false)
        .order("conv_last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (openThread) {
        conversationId = openThread.id
        resolutionTrace = `sender→contact→thread match → ${openThread.conv_record_number}`
      }
    }
  }

  // ── Route the message ─────────────────────────────────────────────
  if (conversationId) {
    const { data: msgRow, error: insErr } = await admin.from("messages").insert({
      msg_record_number:        "",
      conversation_id:          conversationId,
      msg_direction:            "inbound",
      msg_channel:              "email",
      msg_from_address:         fromAddress,
      msg_to_address:           toRecipients.map(r => r.emailAddress?.address).filter(Boolean).join(", "),
      msg_subject:              subject || null,
      msg_body:                 bodyContent || "(empty message)",
      msg_provider:             "microsoft_graph",
      msg_provider_message_id:  idempotencyKey,
      msg_status:               "received",
      msg_status_updated_at:    new Date().toISOString(),
      msg_external_message_id:  internetMessageId || null,
    }).select("id, msg_record_number").single()
    if (insErr) {
      console.error("inbound-email-webhook: messages insert failed", insErr)
      return { status: "error", error: insErr.message }
    }
    return {
      status:           "threaded",
      mode,
      message_id:       msgRow.id,
      record_number:    msgRow.msg_record_number,
      conversation_id:  conversationId,
      resolution_trace: resolutionTrace,
    }
  }

  // ── Unmatched → triage inbox ───────────────────────────────────────
  const { data: uiRow, error: uiErr } = await admin.from("unmatched_inbox").insert({
    ui_record_number:        "",
    ui_channel:              "email",
    ui_received_at:          message.receivedDateTime || new Date().toISOString(),
    ui_from_address:         fromAddress,
    ui_to_address:           toRecipients.map(r => r.emailAddress?.address).filter(Boolean).join(", ") || null,
    ui_subject:              subject || null,
    ui_body_preview:         bodyContent.slice(0, 500) || null,
    ui_provider:             "microsoft_graph",
    ui_provider_message_id:  idempotencyKey || message.id || "unknown",
    ui_in_reply_to_header:   headersByName.get("in-reply-to") || null,
    ui_references_header:    headersByName.get("references") || null,
    ui_raw_payload:          message as any,
    ui_status:               "awaiting_triage",
  }).select("id, ui_record_number").single()
  if (uiErr) {
    if (uiErr.code === "23505") return { status: "duplicate", reason: "already in unmatched_inbox" }
    console.error("inbound-email-webhook: unmatched_inbox insert failed", uiErr)
    return { status: "error", error: uiErr.message }
  }
  return {
    status:           "unmatched",
    mode,
    unmatched_inbox_id: uiRow.id,
    record_number:    uiRow.ui_record_number,
    resolution_trace: "no rule matched — sent to triage",
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

// Parse 'users/<mailbox>/messages/<id>' or
// 'users/<mailbox>/mailFolders(\'Inbox\')/messages/<id>'.
function extractMailboxFromResource(resource: string): string | null {
  if (!resource) return null
  const m = resource.match(/users\/([^/]+)/i)
  if (!m) return null
  return decodeURIComponent(m[1])
}

// Pull the conversation token from any toRecipient that's plus-addressed:
//   assessments+c_8f3a2b1d@ees-wi.org → '8f3a2b1d'  (8-hex token after 'c_')
function findConversationTokenInRecipients(recipients: GraphRecipient[]): string | null {
  for (const r of recipients) {
    const addr = r.emailAddress?.address || ""
    const m = addr.match(/\+c_([0-9a-f]{8})@/i)
    if (m) return m[1].toLowerCase()
  }
  return null
}

// Extract every <id@host> token from a header value (or concatenation of
// In-Reply-To and References).
function extractMessageIds(s: string): string[] {
  if (!s) return []
  const matches = s.match(/<[^<>]+>/g)
  return matches ? matches : []
}

// Lowercase-keyed map of internetMessageHeaders for case-insensitive lookup.
function headerMap(headers: { name: string; value: string }[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const h of headers || []) {
    if (h?.name) m.set(h.name.toLowerCase(), h.value || "")
  }
  return m
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
  return j.access_token as string
}

async function fetchMessageFromGraph(accessToken: string, mailbox: string, messageId: string): Promise<GraphMessage> {
  if (!messageId) throw new Error("messageId required")
  const resp = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}` +
      `?$select=id,internetMessageId,subject,bodyPreview,body,from,toRecipients,ccRecipients,internetMessageHeaders,receivedDateTime`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  )
  if (!resp.ok) {
    const text = await resp.text().catch(() => "")
    throw new Error(`Graph HTTP ${resp.status}: ${text.slice(0, 500)}`)
  }
  return await resp.json() as GraphMessage
}

function ok(): Response {
  return new Response("OK", { status: 200, headers: cors })
}
