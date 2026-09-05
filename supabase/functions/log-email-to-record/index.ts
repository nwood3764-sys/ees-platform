// ─── log-email-to-record ──────────────────────────────────────────────────
// Ingest an EXISTING email (from the LEAP Outlook add-in) and log it onto a
// LEAP record's Conversations timeline — the Salesforce "Log Email to Record"
// capability.
//
// Unlike send-email-v1 (which composes and SENDS a new email from a shared
// program mailbox), this function takes an email that already exists in the
// user's Outlook — read client-side by the add-in via Office.js — and writes
// it into the same conversations/messages/message_attachments model so it
// appears in the target record's Conversations panel exactly like a sent or
// replied email.
//
// It does NOT send anything and does NOT touch Microsoft Graph. It only
// records what already happened.
//
// Auth: caller's JWT is gateway-verified; current_app_user_id is resolved
// from auth.uid for audit columns. Writes use the service role (RLS on
// messages/conversations permits inserts via app_user_can, which the service
// role short-circuits — identical pattern to send-email-v1). A service-role
// caller may pass on_behalf_of_user_id for server-side self-tests.
//
// The target record id always originates from search_records_for_email_log,
// which is SECURITY INVOKER (RLS-scoped) — so the picker only ever surfaces
// records the user can already see.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ATTACHMENT_BUCKET = "communications-attachments"
// Whole-request attachment budget. Office.js hands us base64 content in
// memory; keep the total well under the edge runtime's memory ceiling. Files
// past this are skipped (reported back), never silently dropped.
const ATTACHMENT_TOTAL_BUDGET_BYTES = 20_000_000

// WHICH RECORDS AN EMAIL CAN BE FILED ON is not a list here any more.
//
// Nicholas, 2026-09-03: "It needs to have all the objects. Why would you limit
// it to five?" It was limited because this function carried an anchor map of
// five objects plus a contacts special case, and a second map of soft-delete
// columns, both written when the add-in shipped and never widened. The answer
// is the database's own registry: email_log_target validates the object
// against conversation_anchor_columns() — the objects a thread can be anchored
// to, derived from the conversations table's foreign keys — checks the row
// exists and is not deleted, and hands back its name. An object that gains a
// Communications card is fileable the same day, with no change here.

interface Recipient { name?: string; email: string }

interface ReqBody {
  target_object:    string
  target_record_id: string
  email: {
    subject?:             string
    from:                 Recipient
    to?:                  Recipient[]
    cc?:                  Recipient[]
    date?:                string      // ISO — when the email was sent/received
    body_html?:           string
    body_text?:           string
    direction?:           "inbound" | "outbound"
    internet_message_id?: string
  }
  contact_id?: string
  attachments?: Array<{
    file_name:      string
    mime_type?:     string
    size_bytes?:    number
    content_base64: string
  }>
  on_behalf_of_user_id?: string
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  let body: ReqBody
  try { body = await req.json() as ReqBody }
  catch { return json({ error: "Invalid JSON body" }, 400) }

  const vErr = validateRequest(body)
  if (vErr) return json({ error: vErr }, 400)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfiguration: Supabase keys missing" }, 500)

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const authHeader = req.headers.get("Authorization") || ""
  const callerUserId = await resolveCallerUserId(admin, serviceKey, authHeader, body.on_behalf_of_user_id)
  if (!callerUserId) return json({ error: "Caller is not a registered LEAP user" }, 401)

  // ── 1. Verify the target record exists and isn't soft-deleted ────────────
  // The registry decides both whether this object can hold a thread at all and
  // which column says the row is deleted, so an unfileable object is refused
  // by name rather than by a missing map entry.
  const { data: targetRows, error: targetErr } = await admin.rpc("email_log_target", {
    p_object: body.target_object,
    p_id:     body.target_record_id,
  })
  if (targetErr) return json({ error: `Target lookup failed: ${targetErr.message}` }, 400)
  const target = Array.isArray(targetRows) && targetRows.length > 0 ? targetRows[0] : null
  if (!target) {
    return json({ error: `Target ${body.target_object} ${body.target_record_id} not found` }, 404)
  }

  // ── 2. Resolve direction + addresses ─────────────────────────────────────
  const direction = body.email.direction === "outbound" ? "outbound" : "inbound"
  const fromEmail  = body.email.from.email.trim()
  const firstTo    = (body.email.to || []).find(r => r?.email && EMAIL_RE.test(r.email))?.email?.trim() || null

  // For an inbound email the customer is the sender; for an outbound one the
  // customer is the recipient. our_address is the LEAP-side address on the
  // thread. Both conversations columns are NOT NULL, so fall back to the
  // sender address when a counterpart is missing.
  const customerAddress = direction === "outbound" ? (firstTo || fromEmail) : fromEmail
  const ourAddress      = direction === "outbound" ? fromEmail : (firstTo || fromEmail)
  const msgFrom = fromEmail
  const msgTo   = direction === "outbound" ? (firstTo || customerAddress) : (firstTo || ourAddress)

  const subject = (body.email.subject || "").trim() || "(no subject)"

  // Body: prefer the HTML Outlook gave us; otherwise wrap plain text. Never
  // null (msg_body is NOT NULL).
  let bodyHtml = (body.email.body_html || "").trim()
  if (!bodyHtml) {
    const text = (body.email.body_text || "").trim()
    bodyHtml = text ? `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(text)}</pre>` : "<p>(no message body)</p>"
  }

  const sentAtIso = isValidIso(body.email.date) ? new Date(body.email.date!).toISOString() : new Date().toISOString()

  // ── 3. Find or create the conversation (always a new thread per logged email) ──
  const convParams: Record<string, unknown> = {
    p_channel:          "email",
    p_our_address:      ourAddress,
    p_customer_address: customerAddress,
    p_contact_id:       body.contact_id || null,
    p_subject:          subject,
    p_force_new:        true,
  }
  // One generic anchor: find_or_create_conversation resolves the column from
  // the same registry, and RAISES for an object that has none rather than
  // filing the thread nowhere.
  convParams.p_anchor_object = body.target_object
  convParams.p_anchor_id     = body.target_record_id
  if (body.target_object === "contacts" && !body.contact_id) {
    convParams.p_contact_id = body.target_record_id
  }

  const { data: convResult, error: convErr } = await admin.rpc("find_or_create_conversation", convParams)
  if (convErr || !convResult) {
    console.error("log-email-to-record: find_or_create_conversation failed", convErr)
    return json({ error: `Conversation resolution failed: ${convErr?.message || "no id returned"}` }, 500)
  }
  const conversationId = convResult as string

  // ── 4. Insert the message row ────────────────────────────────────────────
  const nowIso = new Date().toISOString()
  const { data: msgRow, error: msgErr } = await admin
    .from("messages")
    .insert({
      msg_record_number:       "",                         // trg_msg_record_number fills this
      conversation_id:         conversationId,
      msg_direction:           direction,
      msg_channel:             "email",
      msg_from_address:        msgFrom,
      msg_to_address:          msgTo,
      msg_subject:             subject,
      msg_body:                bodyHtml,
      msg_provider:            "microsoft_graph",
      msg_provider_message_id: body.email.internet_message_id || `outlook-log-${crypto.randomUUID()}`,
      msg_status:              direction === "outbound" ? "sent" : "received",
      msg_status_updated_at:   nowIso,
      msg_sent_at:             sentAtIso,
      msg_external_message_id: body.email.internet_message_id || null,
      contact_id:              body.contact_id || (body.target_object === "contacts" ? body.target_record_id : null),
      msg_created_by:          callerUserId,
      msg_updated_by:          callerUserId,
      msg_ai_assisted:         false,
      msg_ai_iterations:       0,
    })
    .select("id, msg_record_number")
    .single()
  if (msgErr || !msgRow) {
    console.error("log-email-to-record: messages insert failed", msgErr)
    return json({ error: `Message insert failed: ${msgErr?.message || "no id returned"}` }, 500)
  }

  // ── 5. Store attachments (scanned async by scan-message-attachments cron) ──
  const attachmentsLogged: Array<{ file_name: string; storage_path: string }> = []
  const attachmentsSkipped: Array<{ file_name: string; reason: string }> = []
  if (Array.isArray(body.attachments) && body.attachments.length > 0) {
    let budget = ATTACHMENT_TOTAL_BUDGET_BYTES
    let idx = 0
    for (const att of body.attachments) {
      idx++
      let bytes: Uint8Array
      try {
        bytes = base64ToBytes(att.content_base64)
      } catch {
        attachmentsSkipped.push({ file_name: att.file_name, reason: "invalid base64 content" })
        continue
      }
      if (bytes.byteLength > budget) {
        attachmentsSkipped.push({ file_name: att.file_name, reason: "attachment budget exceeded for this request" })
        continue
      }
      const safeName = sanitizeFileName(att.file_name) || `attachment-${idx}`
      const storagePath = `email-log/${conversationId}/${msgRow.id}/${idx}-${safeName}`
      const { error: upErr } = await admin.storage
        .from(ATTACHMENT_BUCKET)
        .upload(storagePath, bytes, {
          contentType: att.mime_type || "application/octet-stream",
          upsert: true,
        })
      if (upErr) {
        attachmentsSkipped.push({ file_name: att.file_name, reason: `upload failed: ${upErr.message}` })
        continue
      }
      const { error: maErr } = await admin.from("message_attachments").insert({
        ma_message_id:        msgRow.id,
        ma_storage_path:      storagePath,
        ma_file_name:         att.file_name,
        ma_file_size_bytes:   bytes.byteLength,
        ma_mime_type:         att.mime_type || null,
        ma_delivery_method:   "inline",
        ma_virus_scan_status: "pending",
        ma_created_by:        callerUserId,
        ma_updated_by:        callerUserId,
      })
      if (maErr) {
        attachmentsSkipped.push({ file_name: att.file_name, reason: `attachment row insert failed: ${maErr.message}` })
        continue
      }
      budget -= bytes.byteLength
      attachmentsLogged.push({ file_name: att.file_name, storage_path: storagePath })
    }
  }

  return json({
    status:             "ok",
    conversation_id:    conversationId,
    message_id:         msgRow.id,
    msg_record_number:  msgRow.msg_record_number,
    direction,
    target_object:      body.target_object,
    target_record_id:   body.target_record_id,
    target_label:       target.rec_label,
    attachments_logged: attachmentsLogged,
    attachments_skipped: attachmentsSkipped,
  }, 200)
})

// ─── helpers ──────────────────────────────────────────────────────────────

function validateRequest(b: ReqBody): string | null {
  if (!b || typeof b !== "object") return "Body must be a JSON object"
  // Which objects are allowed is the database's answer, not a copy of it kept
  // here: email_log_target names the allowed set in its own error.
  if (!b.target_object || typeof b.target_object !== "string" || !/^[a-z][a-z0-9_]*$/.test(b.target_object)) {
    return "target_object must be an object name"
  }
  if (!b.target_record_id || !UUID_RE.test(b.target_record_id)) return "target_record_id must be a UUID"
  if (!b.email || typeof b.email !== "object") return "email object required"
  if (!b.email.from || !b.email.from.email || !EMAIL_RE.test(b.email.from.email)) return "email.from.email must be a valid email address"
  if (b.email.to && !Array.isArray(b.email.to)) return "email.to must be an array"
  if (b.email.direction && b.email.direction !== "inbound" && b.email.direction !== "outbound") return "email.direction must be 'inbound' or 'outbound'"
  if (b.contact_id && !UUID_RE.test(b.contact_id)) return "contact_id must be a UUID"
  if (b.on_behalf_of_user_id && !UUID_RE.test(b.on_behalf_of_user_id)) return "on_behalf_of_user_id must be a UUID"
  if (b.attachments) {
    if (!Array.isArray(b.attachments)) return "attachments must be an array"
    for (const a of b.attachments) {
      if (!a || typeof a.file_name !== "string" || !a.file_name) return "attachments[].file_name required"
      if (typeof a.content_base64 !== "string" || !a.content_base64) return "attachments[].content_base64 required"
    }
  }
  return null
}

async function resolveCallerUserId(admin: SupabaseClient, serviceKey: string, authHeader: string, onBehalfOfUserId?: string): Promise<string | null> {
  if (!authHeader.startsWith("Bearer ")) return null
  const jwt = authHeader.slice(7)

  // Service-role caller (server-side self-test) acts on behalf of an explicit
  // existing app user. Full-trust key, so this grants no extra privilege.
  if (jwt === serviceKey) {
    if (!onBehalfOfUserId || !UUID_RE.test(onBehalfOfUserId)) return null
    const { data: obo } = await admin.from("users").select("id").eq("id", onBehalfOfUserId).maybeSingle()
    return obo?.id || null
  }

  try {
    const parts = jwt.split(".")
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")))
    if (payload.role === "service_role") {
      if (!onBehalfOfUserId || !UUID_RE.test(onBehalfOfUserId)) return null
      const { data: obo } = await admin.from("users").select("id").eq("id", onBehalfOfUserId).maybeSingle()
      return obo?.id || null
    }
    const authUserId = payload.sub as string
    if (!authUserId) return null
    const { data: u } = await admin.from("users").select("id").eq("auth_user_id", authUserId).maybeSingle()
    return u?.id || null
  } catch {
    return null
  }
}

function isValidIso(s?: string): boolean {
  if (!s || typeof s !== "string") return false
  const t = Date.parse(s)
  return !Number.isNaN(t)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function sanitizeFileName(name: string): string {
  return String(name || "").replace(/[^\w.\-]+/g, "_").replace(/_{2,}/g, "_").replace(/^[._]+/, "").slice(0, 120)
}

function base64ToBytes(b64: string): Uint8Array {
  // Accept data: URIs and bare base64; strip whitespace Office may include.
  const cleaned = b64.includes(",") && b64.slice(0, 64).includes("base64")
    ? b64.slice(b64.indexOf(",") + 1)
    : b64
  const bin = atob(cleaned.replace(/\s+/g, ""))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
