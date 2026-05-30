// ─── inbound-email-webhook v3 ────────────────────────────────────────────
// v3 changes vs v2:
//   1. clientState env var (GRAPH_WEBHOOK_CLIENT_STATE) is now REQUIRED.
//      v2 fell open if unset (logged a warning, processed anyway). Any
//      anonymous caller could POST a fake Graph notification body and
//      inject messages/unmatched_inbox rows. v3 returns 500 if env var
//      is unset and 401 per-entry if presented value doesn't match.
//   2. _mock_message backdoor is now gated by INBOUND_EMAIL_ALLOW_MOCK
//      env var (must be "true"). v2 always honored _mock_message which
//      let any caller skip the Graph fetch and inject attacker-controlled
//      from/subject/body straight into the messages table.
//
// Auth model unchanged otherwise: verify_jwt=false because Microsoft
// Graph won't present a JWT. clientState shared secret is THE security
// boundary.
//
// Plus-address resolution still uses the generated conv_short_token
// column (substring(id::text, 1, 8)) for exact match — same as v2.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface GraphRecipient { emailAddress: { address: string; name?: string } }

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
  _mock_message?: GraphMessage
}

interface NotificationBody { value?: NotificationEntry[] }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  // Graph subscription validation handshake — always allowed without auth.
  // Graph POSTs ?validationToken=... when creating/renewing a subscription;
  // we have to echo it back as plaintext within 10 seconds.
  const url = new URL(req.url)
  const validationToken = url.searchParams.get("validationToken")
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { ...cors, "Content-Type": "text/plain" },
    })
  }

  if (req.method !== "POST") return new Response("OK", { status: 200, headers: cors })

  const supabaseUrl         = Deno.env.get("SUPABASE_URL")
  const serviceKey          = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const expectedClientState = Deno.env.get("GRAPH_WEBHOOK_CLIENT_STATE")
  const allowMock           = Deno.env.get("INBOUND_EMAIL_ALLOW_MOCK") === "true"

  if (!supabaseUrl || !serviceKey) {
    console.error("inbound-email-webhook: SUPABASE_URL or SERVICE_ROLE_KEY missing")
    return json({ error: "server misconfigured: Supabase service key missing" }, 500)
  }

  // Fail-closed on missing clientState env var. v2 logged a warning and
  // processed anyway — fail-open. Now: refuse to process if not configured.
  if (!expectedClientState) {
    console.error("inbound-email-webhook: GRAPH_WEBHOOK_CLIENT_STATE env var not set")
    return json({
      error: "Server misconfigured: GRAPH_WEBHOOK_CLIENT_STATE env var missing. Set it to the same value used when creating the Graph subscription.",
    }, 500)
  }

  let body: NotificationBody
  try { body = await req.json() as NotificationBody }
  catch (e) { console.error("inbound-email-webhook: invalid JSON body", e); return json({ error: "invalid JSON" }, 400) }

  if (!body?.value || !Array.isArray(body.value) || body.value.length === 0) {
    console.warn("inbound-email-webhook: empty value array")
    return json({ processed: 0, results: [] }, 200)
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const results: unknown[] = []
  for (const entry of body.value) {
    if (entry.clientState !== expectedClientState) {
      console.error("inbound-email-webhook: clientState mismatch", { subscriptionId: entry.subscriptionId })
      results.push({ status: "rejected", reason: "clientState mismatch" })
      continue
    }
    if (entry._mock_message && !allowMock) {
      console.error("inbound-email-webhook: _mock_message provided but INBOUND_EMAIL_ALLOW_MOCK != 'true'")
      results.push({ status: "rejected", reason: "_mock_message not allowed in this environment" })
      continue
    }
    try { results.push(await processNotification(admin, entry, allowMock)) }
    catch (e) {
      console.error("inbound-email-webhook: unhandled exception", e)
      results.push({ status: "error", error: (e as Error).message })
    }
  }

  return json({ processed: results.length, results }, 200)
})

async function processNotification(admin: SupabaseClient, entry: NotificationEntry, allowMock: boolean): Promise<unknown> {
  const ourMailbox = extractMailboxFromResource(entry.resource || "")
  if (!ourMailbox) {
    console.error("inbound-email-webhook: could not parse mailbox from resource", entry.resource)
    return { status: "error", error: "unparseable resource" }
  }

  let message: GraphMessage | null = null
  let mode: "mock" | "real" = "mock"
  if (entry._mock_message && allowMock) {
    message = entry._mock_message
    mode = "mock"
  } else {
    const tenantId     = Deno.env.get("OUTLOOK_TENANT_ID")
    const clientId     = Deno.env.get("OUTLOOK_CLIENT_ID")
    const clientSecret = Deno.env.get("OUTLOOK_CLIENT_SECRET")
    if (!tenantId || !clientId || !clientSecret) {
      console.warn("inbound-email-webhook: Graph creds missing", { resource: entry.resource })
      return { status: "skipped", reason: "no graph creds and no mock payload allowed" }
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

  const internetMessageId = message.internetMessageId || ""
  const fromAddress       = message.from?.emailAddress?.address || ""
  const subject           = message.subject || ""
  const bodyContent       = message.body?.content || message.bodyPreview || ""
  const toRecipients      = message.toRecipients || []
  const headersByName     = headerMap(message.internetMessageHeaders || [])

  if (!fromAddress) {
    console.error("inbound-email-webhook: missing From address")
    return { status: "error", error: "missing From" }
  }

  const idempotencyKey = internetMessageId || message.id || ""
  if (idempotencyKey) {
    const { data: existing } = await admin
      .from("messages")
      .select("id")
      .eq("msg_provider_message_id", idempotencyKey)
      .eq("msg_is_deleted", false)
      .maybeSingle()
    if (existing) return { status: "duplicate", message_id: existing.id }
  }

  let conversationId: string | null = null
  let resolutionTrace = ""

  // (1) Plus-addressed conversation token — exact match on the indexed
  // generated column conv_short_token (= substring(id::text, 1, 8)).
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
      resolutionTrace = `plus-address token ${tokenFromTo} -> ${convByToken.conv_record_number}`
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
        resolutionTrace = `Message-ID match -> ${msgByMsgId.msg_record_number}`
      }
    }
  }

  // (3) Sender email -> contact -> most-recent open thread on that mailbox
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
        resolutionTrace = `sender->contact->thread match -> ${openThread.conv_record_number}`
      }
    }
  }

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

  // Unmatched -> triage inbox. ON CONFLICT not used because unique constraint
  // gives us idempotency for free: duplicate UI inserts return PGRST/23505
  // which the caller can treat as a duplicate.
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
    ui_raw_payload:          message as unknown,
    ui_status:               "awaiting_triage",
  }).select("id, ui_record_number").single()
  if (uiErr) {
    if (uiErr.code === "23505") return { status: "duplicate", reason: "already in unmatched_inbox" }
    console.error("inbound-email-webhook: unmatched_inbox insert failed", uiErr)
    return { status: "error", error: uiErr.message }
  }
  return {
    status:             "unmatched",
    mode,
    unmatched_inbox_id: uiRow.id,
    record_number:      uiRow.ui_record_number,
    resolution_trace:   "no rule matched -- sent to triage",
  }
}

function extractMailboxFromResource(resource: string): string | null {
  if (!resource) return null
  const m = resource.match(/users\/([^/]+)/i)
  if (!m) return null
  return decodeURIComponent(m[1])
}

function findConversationTokenInRecipients(recipients: GraphRecipient[]): string | null {
  for (const r of recipients) {
    const addr = r.emailAddress?.address || ""
    const m = addr.match(/\+c_([0-9a-f]{8})@/i)
    if (m) return m[1].toLowerCase()
  }
  return null
}

function extractMessageIds(s: string): string[] {
  if (!s) return []
  const matches = s.match(/<[^<>]+>/g)
  return matches ? matches : []
}

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
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!resp.ok) {
    const text = await resp.text().catch(() => "")
    throw new Error(`Graph HTTP ${resp.status}: ${text.slice(0, 500)}`)
  }
  return await resp.json() as GraphMessage
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
