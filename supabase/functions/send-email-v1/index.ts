// ─── send-email-v1 ────────────────────────────────────────────────────────
// Communications Module v1 canonical outbound email path.
//
// Differences from send-notification-email v2:
//   - Record-anchored: every send is anchored to a parent record (anchor_object
//     + anchor_record_id) and dual-writes to messages + conversations, surfacing
//     on the record's Conversations related list. send-notification-email writes
//     only notification_logs.
//   - Mailbox routing: queries outbound_mailboxes (program × state lookup with
//     state-only fallback) instead of the hardcoded DEFAULT_SENDER_BY_STATE.
//   - Template-driven compose: accepts email_template_id + editable_regions and
//     server-side assembles the final body from the template's locked + editable
//     region structure. Free-form compose (raw body_html, no template) also
//     supported.
//   - Locked-region enforcement: validates that every locked region's resolved
//     content appears verbatim in the final body. Tampered sends are refused
//     (the spec's data-layer enforcement requirement).
//   - Plus-addressed conversation token: From becomes assessments+c_<8>@ees-X.org
//     for inbound threading. Constructed in mock mode too so the persisted row
//     reflects what real mode would send.
//   - Message-ID: generated locally as msg_external_message_id for audit. Graph
//     owns the actual outgoing Message-ID header in real mode; reconciliation
//     against Graph's value is deferred to the real-mode slice (a custom
//     X-LEAP-Conversation-Token header will carry the token as a belt-and-
//     suspenders fallback for clients that strip the plus address).
//
// Mock mode (no OUTLOOK_CLIENT_ID / SECRET / TENANT_ID): all writes happen,
// Graph call is skipped, msg_provider_message_id = mock-<uuid>. Same shape
// as send-notification-sms v2 — flip to real mode by setting the three env
// vars and granting Mail.Send.Shared on the Azure AD app.
//
// Auth: caller's JWT verified, but the function uses SUPABASE_SERVICE_ROLE_KEY
// for writes (RLS on messages/conversations restricts SELECT but inserts are
// permitted via app_user_can which the service role short-circuits).
// current_app_user_id is resolved from the caller's auth.uid for audit cols.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Recipient { name?: string; email: string }

interface LockedRegion {
  region_id:        string
  region_type:      "locked" | "editable"
  region_content?:  string  // locked regions carry content; editable carry placeholder
  region_placeholder?: string
  region_order:     number
}

interface ReqBody {
  // Anchor — every send is record-anchored
  anchor_object:    string
  anchor_record_id: string

  // Recipient(s)
  to:   Recipient
  cc?:  Recipient[]
  bcc?: Recipient[]

  // Compose mode A — template-driven
  email_template_id?: string
  editable_regions?:  Record<string, string>  // keyed by region_id

  // Compose mode B — free-form (must include both subject and body_html)
  subject?:   string
  body_html?: string

  // Mailbox selection (in priority order)
  outbound_mailbox_id?: string  // explicit
  // (then template_default_outbound_mailbox_id from template if available)
  state?: string                // state-only fallback if no other match
  program_id?: string           // program × state lookup

  // Optional contact for thread resolution (preferred over email-only matching)
  contact_id?: string
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  let body: ReqBody
  try { body = await req.json() as ReqBody }
  catch { return json({ error: "Invalid JSON body" }, 400) }

  const vErr = validateRequest(body)
  if (vErr) return json({ error: vErr }, 400)

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const clientId     = Deno.env.get("OUTLOOK_CLIENT_ID")
  const clientSecret = Deno.env.get("OUTLOOK_CLIENT_SECRET")
  const tenantId     = Deno.env.get("OUTLOOK_TENANT_ID")
  if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfiguration: Supabase keys missing" }, 500)

  // Service-role client for writes (bypasses RLS write checks)
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Resolve caller's public.users.id for audit columns
  const authHeader = req.headers.get("Authorization") || ""
  const callerUserId = await resolveCallerUserId(admin, authHeader)
  if (!callerUserId) return json({ error: "Caller is not a registered LEAP user" }, 401)

  // ── 1. Resolve outbound mailbox ──────────────────────────────────────────
  let mailbox: any | null = null
  let mailboxResolutionTrace = ""
  try {
    const r = await resolveOutboundMailbox(admin, body)
    mailbox = r.mailbox
    mailboxResolutionTrace = r.trace
  } catch (e) {
    return json({ error: `Mailbox resolution failed: ${(e as Error).message}` }, 400)
  }
  if (!mailbox) return json({ error: `No active outbound mailbox matched the request (${mailboxResolutionTrace}). Ensure outbound_mailboxes is seeded for this program × state, or pass outbound_mailbox_id explicitly.` }, 400)

  // ── 2. Resolve email_template (if template-driven) ───────────────────────
  let template: any | null = null
  if (body.email_template_id) {
    const { data: tpl, error: tplErr } = await admin
      .from("email_templates")
      .select("id, name, subject, body_html, status, is_deleted, related_object, template_locked_regions, template_ai_assist_allowed, template_default_outbound_mailbox_id")
      .eq("id", body.email_template_id)
      .maybeSingle()
    if (tplErr)        return json({ error: `Template lookup failed: ${tplErr.message}` }, 500)
    if (!tpl)          return json({ error: "Template not found" }, 404)
    if (tpl.is_deleted) return json({ error: "Template is deleted" }, 400)
    if (tpl.related_object && tpl.related_object !== body.anchor_object) {
      return json({ error: `Template's related_object (${tpl.related_object}) doesn't match anchor_object (${body.anchor_object}); merge dict won't have the right keys.` }, 400)
    }
    template = tpl
  }

  // ── 3. Build merge dict from anchor record ───────────────────────────────
  let mergeDict: Record<string, any>
  try {
    mergeDict = await buildMergeDict(admin, body.anchor_object, body.anchor_record_id, template?.name || "")
  } catch (e) {
    return json({ error: `Merge dict build failed: ${(e as Error).message}` }, 400)
  }

  // ── 4. Compose subject + body ────────────────────────────────────────────
  let subject:  string
  let bodyHtml: string
  if (template) {
    subject = substituteTokens(template.subject || "", mergeDict)
    // Assemble body from locked-regions structure if present; otherwise fall
    // back to substituting tokens against the template's body_html with the
    // caller's editable_regions stitched in as named replacements.
    const lockedRegions: LockedRegion[] = Array.isArray(template.template_locked_regions)
      ? template.template_locked_regions
      : []
    if (lockedRegions.length > 0) {
      bodyHtml = assembleFromLockedRegions(lockedRegions, body.editable_regions || {}, mergeDict)
    } else {
      // Template has no locked-region structure yet — pure substitution
      bodyHtml = substituteTokens(template.body_html || "", mergeDict)
    }
  } else {
    // Free-form compose — caller supplied subject + body
    subject  = body.subject!
    bodyHtml = body.body_html!
  }

  // ── 5. Validate locked regions appear verbatim in final body ─────────────
  if (template && Array.isArray(template.template_locked_regions) && template.template_locked_regions.length > 0) {
    const lockedRegions = template.template_locked_regions as LockedRegion[]
    for (const r of lockedRegions) {
      if (r.region_type !== "locked") continue
      const resolved = substituteTokens(r.region_content || "", mergeDict)
      if (resolved && !bodyHtml.includes(resolved)) {
        return json({
          error: "Locked region validation failed",
          detail: `Locked region '${r.region_id}' (order ${r.region_order}) is missing or modified in the composed body. Locked regions cannot be edited.`,
          region_id: r.region_id,
        }, 422)
      }
    }
  }

  // ── 6. Find or create conversation thread ────────────────────────────────
  const { data: convResult, error: convErr } = await admin.rpc("find_or_create_conversation", {
    p_channel:                "email",
    p_our_address:            mailbox.obm_address,
    p_customer_address:       body.to.email,
    p_contact_id:             body.contact_id || null,
    p_account_id:             null,  // TODO: derive from anchor walk
    p_project_id:             body.anchor_object === "projects" ? body.anchor_record_id : null,
    p_service_appointment_id: body.anchor_object === "service_appointments" ? body.anchor_record_id : null,
    p_subject:                subject,
  })
  if (convErr || !convResult) {
    console.error("send-email-v1: find_or_create_conversation failed", convErr)
    return json({ error: `Conversation resolution failed: ${convErr?.message || "no id returned"}` }, 500)
  }
  const conversationId = convResult as string

  // ── 7. Compose plus-addressed From + generate Message-ID ─────────────────
  const convShortToken = `c_${conversationId.replace(/-/g, "").slice(0, 8)}`
  const fromAddressWithToken = plusAddress(mailbox.obm_address, convShortToken)
  const externalMessageId = `<leap-${conversationId.replace(/-/g, "").slice(0, 16)}-${crypto.randomUUID()}@${mailbox.obm_address.split("@")[1]}>`

  // ── 8. Insert messages row in queued state ───────────────────────────────
  const { data: msgRow, error: msgErr } = await admin
    .from("messages")
    .insert({
      msg_record_number:        "",
      conversation_id:          conversationId,
      msg_direction:            "outbound",
      msg_channel:              "email",
      msg_from_address:         fromAddressWithToken,
      msg_to_address:           body.to.email,
      msg_subject:              subject,
      msg_body:                 bodyHtml,
      msg_provider:             "microsoft_graph",
      msg_status:               "queued",
      msg_status_updated_at:    new Date().toISOString(),
      msg_external_message_id:  externalMessageId,
      contact_id:               body.contact_id || null,
      msg_created_by:           callerUserId,
      msg_updated_by:           callerUserId,
      // AI metadata defaults — populated by future AI-assist composer
      msg_ai_assisted:          false,
      msg_ai_iterations:        0,
    })
    .select("id, msg_record_number")
    .single()
  if (msgErr || !msgRow) {
    console.error("send-email-v1: messages insert failed", msgErr)
    return json({ error: `Message insert failed: ${msgErr?.message || "no id returned"}` }, 500)
  }

  // ── 9. Mock mode — skip Graph call, mark sent ────────────────────────────
  const mockMode = !clientId || !clientSecret || !tenantId
  if (mockMode) {
    const mockProviderId = `mock-${crypto.randomUUID()}`
    const nowIso = new Date().toISOString()
    await admin.from("messages").update({
      msg_status:              "sent",
      msg_provider_message_id: mockProviderId,
      msg_sent_at:             nowIso,
      msg_status_updated_at:   nowIso,
      msg_updated_at:          nowIso,
      msg_updated_by:          callerUserId,
    }).eq("id", msgRow.id)
    return json({
      status: "ok",
      mode: "mock",
      message_id:               msgRow.id,
      msg_record_number:        msgRow.msg_record_number,
      conversation_id:          conversationId,
      conversation_short_token: convShortToken,
      from_address:             fromAddressWithToken,
      external_message_id:      externalMessageId,
      provider_message_id:      mockProviderId,
      outbound_mailbox: {
        id: mailbox.id,
        address: mailbox.obm_address,
        state: mailbox.obm_state,
        record_number: mailbox.obm_record_number,
      },
      mailbox_resolution: mailboxResolutionTrace,
    }, 200)
  }

  // ── 10. Real Graph send ──────────────────────────────────────────────────
  try {
    const accessToken = await getAppAccessToken(tenantId!, clientId!, clientSecret!)
    const graphRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox.obm_address)}/sendMail`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            subject,
            body: { contentType: "HTML", content: bodyHtml },
            toRecipients:  [toGraphRecipient(body.to)],
            ccRecipients:  (body.cc  || []).map(toGraphRecipient),
            bccRecipients: (body.bcc || []).map(toGraphRecipient),
            // Custom header carries the conversation token as a fallback for
            // clients that strip the plus address. Graph rejects setting
            // Message-ID directly, so we use an X- header here.
            internetMessageHeaders: [
              { name: "X-LEAP-Conversation-Token", value: convShortToken },
              { name: "X-LEAP-External-Message-ID", value: externalMessageId },
            ],
          },
          saveToSentItems: true,
        }),
      },
    )

    const nowIso = new Date().toISOString()
    if (graphRes.status === 202) {
      const syntheticId = `graph-${msgRow.id}`
      await admin.from("messages").update({
        msg_status:              "sent",
        msg_provider_message_id: syntheticId,
        msg_sent_at:             nowIso,
        msg_status_updated_at:   nowIso,
        msg_updated_at:          nowIso,
        msg_updated_by:          callerUserId,
      }).eq("id", msgRow.id)
      return json({
        status: "ok",
        mode: "real",
        message_id:               msgRow.id,
        msg_record_number:        msgRow.msg_record_number,
        conversation_id:          conversationId,
        conversation_short_token: convShortToken,
        from_address:             fromAddressWithToken,
        external_message_id:      externalMessageId,
        provider_message_id:      syntheticId,
        outbound_mailbox: {
          id: mailbox.id,
          address: mailbox.obm_address,
          state: mailbox.obm_state,
          record_number: mailbox.obm_record_number,
        },
      }, 200)
    }
    const errText = await graphRes.text().catch(() => "")
    const reason = `Graph sendMail returned ${graphRes.status}: ${errText.slice(0, 1500)}`
    await markMessageFailed(admin, msgRow.id, reason, graphRes.status.toString(), callerUserId)
    return json({
      status: "failed",
      mode: "real",
      message_id:        msgRow.id,
      msg_record_number: msgRow.msg_record_number,
      conversation_id:   conversationId,
      failure_reason:    reason,
    }, 200)
  } catch (e) {
    const reason = `Send threw: ${(e as Error).message}`.slice(0, 1500)
    await markMessageFailed(admin, msgRow.id, reason, null, callerUserId)
    return json({
      status: "failed",
      mode: "real",
      message_id:        msgRow.id,
      msg_record_number: msgRow.msg_record_number,
      conversation_id:   conversationId,
      failure_reason:    reason,
    }, 200)
  }
})

// ─── helpers ──────────────────────────────────────────────────────────────

function validateRequest(b: ReqBody): string | null {
  if (!b || typeof b !== "object") return "Body must be a JSON object"
  if (!b.anchor_object || typeof b.anchor_object !== "string") return "anchor_object required"
  if (!b.anchor_record_id || typeof b.anchor_record_id !== "string") return "anchor_record_id required"
  if (!UUID_RE.test(b.anchor_record_id)) return "anchor_record_id must be a UUID"
  if (!b.to || typeof b.to !== "object" || !b.to.email) return "to.email required"
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.to.email)) return "to.email must be a valid email address"

  // Template OR free-form — exactly one mode must be satisfiable
  const hasTemplate = !!b.email_template_id
  const hasFreeForm = !!b.subject && !!b.body_html
  if (!hasTemplate && !hasFreeForm) {
    return "Must provide either email_template_id (template-driven) or both subject and body_html (free-form)"
  }
  if (hasTemplate && !UUID_RE.test(b.email_template_id!)) return "email_template_id must be a UUID"
  if (b.outbound_mailbox_id && !UUID_RE.test(b.outbound_mailbox_id)) return "outbound_mailbox_id must be a UUID"
  if (b.contact_id && !UUID_RE.test(b.contact_id)) return "contact_id must be a UUID"

  if (b.cc && !Array.isArray(b.cc))   return "cc must be an array"
  if (b.bcc && !Array.isArray(b.bcc)) return "bcc must be an array"
  return null
}

async function resolveCallerUserId(admin: SupabaseClient, authHeader: string): Promise<string | null> {
  if (!authHeader.startsWith("Bearer ")) return null
  const jwt = authHeader.slice(7)
  // Decode the JWT to extract auth.uid (sub claim) without verifying — the
  // gateway already verified the JWT before invoking this function.
  try {
    const parts = jwt.split(".")
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")))
    const authUserId = payload.sub as string
    if (!authUserId) return null
    const { data: u } = await admin
      .from("users")
      .select("id")
      .eq("auth_user_id", authUserId)
      .maybeSingle()
    return u?.id || null
  } catch {
    return null
  }
}

async function resolveOutboundMailbox(
  admin: SupabaseClient,
  body: ReqBody,
): Promise<{ mailbox: any | null; trace: string }> {
  // Mailbox selection is PROGRAMMATIC and NOT overridable. The single
  // source of truth is the resolve_outbound_mailbox_for_anchor SQL
  // function, which walks the anchor record's parent chain to a state
  // and then to the active outbound_mailbox for that state.
  //
  // Any outbound_mailbox_id passed in the request body is verified
  // against the resolver. If they disagree, the request is rejected.
  // This blocks any client (browser, API caller, future automation)
  // from sending from a mailbox other than the one the resolver picks.

  const { data: rows, error } = await admin.rpc(
    "resolve_outbound_mailbox_for_anchor",
    {
      p_anchor_object:    body.anchor_object,
      p_anchor_record_id: body.anchor_record_id,
    },
  )
  if (error) {
    return { mailbox: null, trace: `resolver RPC failed: ${error.message}` }
  }
  const resolved = Array.isArray(rows) && rows.length > 0 ? rows[0] : null
  if (!resolved) {
    return {
      mailbox: null,
      trace: `no mailbox could be resolved for anchor (${body.anchor_object} ${body.anchor_record_id}) — ` +
             `the record's state may be missing, or no active outbound_mailbox is configured for that state`,
    }
  }

  // Hydrate the full mailbox row so downstream sender code has all columns
  const { data: full, error: fullErr } = await admin
    .from("outbound_mailboxes")
    .select("*")
    .eq("id", resolved.outbound_mailbox_id)
    .eq("obm_is_active", true)
    .eq("obm_is_deleted", false)
    .maybeSingle()
  if (fullErr || !full) {
    return { mailbox: null, trace: `resolved mailbox ${resolved.outbound_mailbox_id} could not be hydrated (inactive or deleted)` }
  }

  // Defense in depth: if caller supplied outbound_mailbox_id and it
  // disagrees with the resolver, reject. Caller can omit the field;
  // if they pass it, it must match.
  if (body.outbound_mailbox_id && body.outbound_mailbox_id !== resolved.outbound_mailbox_id) {
    return {
      mailbox: null,
      trace: `client supplied outbound_mailbox_id=${body.outbound_mailbox_id} but resolver picked ${resolved.outbound_mailbox_id}; ` +
             `mailbox is programmatic and not overridable`,
    }
  }

  return { mailbox: full, trace: `resolver: ${resolved.resolution_path}` }
}

function singularize(plural: string): string {
  const map: Record<string, string> = {
    properties: "property", opportunities: "opportunity", accounts: "account",
    contacts: "contact", projects: "project", work_orders: "work_order",
    work_steps: "work_step", buildings: "building", units: "unit",
    incentive_applications: "incentive_application",
    payment_receipts: "payment_receipt",
    project_payment_requests: "project_payment_request",
    assessments: "assessment", programs: "program", work_types: "work_type",
    service_appointments: "service_appointment",
  }
  if (plural in map) return map[plural]
  if (plural.endsWith("ies")) return plural.slice(0, -3) + "y"
  if (plural.endsWith("s"))   return plural.slice(0, -1)
  return plural
}

async function resolveRowForMerge(admin: SupabaseClient, row: Record<string, any>): Promise<Record<string, any>> {
  const out: Record<string, any> = { ...row }
  const uuidValues = new Set<string>()
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "string" && UUID_RE.test(v) && k !== "id") uuidValues.add(v)
  }
  if (uuidValues.size === 0) return out
  const ids = Array.from(uuidValues)
  const [picklistRes, usersRes] = await Promise.all([
    admin.from("picklist_values").select("id, picklist_label, picklist_value").in("id", ids),
    admin.from("users").select("id, first_name, last_name").in("id", ids),
  ])
  const picklistMap = new Map<string, string>()
  for (const p of (picklistRes.data || [])) picklistMap.set(p.id, p.picklist_label || p.picklist_value || "")
  const userMap = new Map<string, string>()
  for (const u of (usersRes.data || [])) {
    const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim()
    if (full) userMap.set(u.id, full)
  }
  for (const [k, v] of Object.entries(row)) {
    if (typeof v !== "string" || !UUID_RE.test(v) || k === "id") continue
    if (picklistMap.has(v)) out[k] = picklistMap.get(v)
    else if (userMap.has(v)) out[k] = userMap.get(v)
  }
  return out
}

async function buildMergeDict(admin: SupabaseClient, anchorObject: string, anchorRecordId: string, templateName: string): Promise<Record<string, any>> {
  const dict: Record<string, any> = {}
  const { data: parentRow, error } = await admin.from(anchorObject).select("*").eq("id", anchorRecordId).maybeSingle()
  if (error)      throw new Error(`Anchor record lookup failed: ${error.message}`)
  if (!parentRow) throw new Error("Anchor record not found")
  const root = singularize(anchorObject)
  dict[root] = await resolveRowForMerge(admin, parentRow)
  const now = new Date()
  dict.today = {
    iso:   now.toISOString().slice(0, 10),
    short: now.toLocaleDateString("en-US"),
    long:  now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  }
  dict.template = { name: templateName }
  return dict
}

function substituteTokens(input: string, dict: Record<string, any>): string {
  return input.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_full, path) => {
    const segs = String(path).split(".")
    let cur: any = dict
    for (const s of segs) {
      if (cur == null || typeof cur !== "object") return `[unknown: {{${path}}}]`
      cur = cur[s]
    }
    if (cur === null || cur === undefined) return "—"
    return String(cur)
  })
}

function assembleFromLockedRegions(
  regions: LockedRegion[],
  editableContent: Record<string, string>,
  mergeDict: Record<string, any>,
): string {
  // Sort by region_order; concat with paragraph spacing for HTML output.
  const ordered = [...regions].sort((a, b) => (a.region_order || 0) - (b.region_order || 0))
  const parts: string[] = []
  for (const r of ordered) {
    if (r.region_type === "locked") {
      parts.push(substituteTokens(r.region_content || "", mergeDict))
    } else {
      // editable — use caller-supplied content if present, otherwise empty
      const supplied = editableContent[r.region_id]
      if (supplied) parts.push(supplied)
    }
  }
  return parts.join("\n\n")
}

function plusAddress(address: string, token: string): string {
  // Inject +token before @ — e.g. assessments@EES-WI.org becomes
  // assessments+c_8f3a2b1d@EES-WI.org. The plus-address subaddressing convention
  // is preserved by Microsoft 365 routing, so inbound to the plus-addressed
  // alias still lands in the base mailbox.
  const at = address.indexOf("@")
  if (at < 0) return address
  return `${address.slice(0, at)}+${token}${address.slice(at)}`
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

async function markMessageFailed(
  admin: SupabaseClient,
  msgId: string,
  reason: string,
  errorCode: string | null,
  callerUserId: string,
): Promise<void> {
  const nowIso = new Date().toISOString()
  await admin.from("messages").update({
    msg_status:                 "failed",
    msg_provider_error_message: reason,
    msg_provider_error_code:    errorCode,
    msg_status_updated_at:      nowIso,
    msg_updated_at:             nowIso,
    msg_updated_by:             callerUserId,
  }).eq("id", msgId)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
