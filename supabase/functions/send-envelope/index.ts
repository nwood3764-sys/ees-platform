// =============================================================================
// send-envelope
//
// Native (in-Anura) e-signature: creates an envelope, renders the merged
// PDF, scans for anchor strings, generates per-recipient signing tokens,
// stores everything, and returns the magic-link signing URLs to the FE.
//
// No external e-signature provider involved. The signing portal lives at
// /sign/{env_record_number}/{token} inside the same Vite app that serves
// the Anura UI. Recipients are NOT Anura users; the token is the auth.
//
// Email delivery is intentionally out of scope for this function — we
// fire `Sent` and return the signing URLs. The caller (Send-for-Signature
// modal) displays the URLs so an internal user can copy/paste into their
// own email until SMTP/SendGrid integration lands. Each token is
// recorded in envelope_events.event_metadata so the magic links can also
// be retrieved from the audit log later.
//
// Inputs (POST JSON):
//   {
//     document_template_id: uuid,
//     parent_object: text,
//     parent_record_id: uuid,
//     recipients: [{ name, email, role?, order, contact_id? }, ...],
//     subject?, message?, env_name?
//   }
//
// Outputs (200 JSON):
//   {
//     envelope_id, env_record_number,
//     signing_urls: [{ recipient_id, name, email, order, signing_url }, ...],
//     unsigned_pdf_signed_url   // hour-long signed URL for previewing
//   }
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const SIGNATURES_BUCKET = "signatures"
const TOKEN_EXPIRY_DAYS = 30

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface Recipient {
  name: string
  email: string
  role?: string
  order: number
  contact_id?: string | null
}

interface ReqBody {
  document_template_id: string
  parent_object: string
  parent_record_id: string
  recipients: Recipient[]
  subject?: string
  message?: string
  env_name?: string
  signing_base_url?: string  // optional; defaults to the request's Origin
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  let body: ReqBody
  try { body = await req.json() as ReqBody }
  catch { return json({ error: "Invalid JSON body" }, 400) }

  const validationError = validate(body)
  if (validationError) return json({ error: validationError }, 400)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")
  if (!supabaseUrl || !anonKey) return json({ error: "Server misconfiguration" }, 500)

  const authHeader = req.headers.get("Authorization") || ""
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing Bearer token" }, 401)
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const callerUserId = await resolveCallerUserId(supabase)
  if (!callerUserId) return json({ error: "Could not resolve caller's user id" }, 401)

  // ── Validate template ───────────────────────────────────────────────
  const { data: dt, error: dtErr } = await supabase
    .from("document_templates")
    .select(`
      id, name, dt_record_number,
      authoring:dt_authoring_mode ( picklist_value ),
      status:status ( picklist_value )
    `)
    .eq("id", body.document_template_id)
    .eq("is_deleted", false)
    .maybeSingle()
  if (dtErr || !dt) return json({ error: `Template not found: ${dtErr?.message || ""}` }, 404)
  if ((dt as any).status?.picklist_value !== "Active")
    return json({ error: `Template must be Active (currently ${(dt as any).status?.picklist_value || "Draft"})` }, 400)

  // ── Find latest snapshot ────────────────────────────────────────────
  const { data: snapshot, error: snapErr } = await supabase
    .from("document_template_snapshots")
    .select("id, dtsn_version")
    .eq("document_template_id", body.document_template_id)
    .order("dtsn_version", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (snapErr || !snapshot) return json({ error: "No published snapshot — re-publish the template first" }, 400)

  // ── Resolve picklist ids we'll need ─────────────────────────────────
  const [
    standardEnvRtId, standardRecRtId, standardTabRtId, standardEventRtId,
    draftStatusId, sentStatusId, failedStatusId,
    createdRecStatId, sentRecStatId,
    eventCreatedId, eventSentId,
  ] = await Promise.all([
    picklistId(supabase, "envelopes",            "record_type",      "Standard"),
    picklistId(supabase, "envelope_recipients",  "record_type",      "Standard"),
    picklistId(supabase, "envelope_tabs",        "record_type",      "Standard"),
    picklistId(supabase, "envelope_events",      "record_type",      "Standard"),
    picklistId(supabase, "envelopes",            "env_status",       "Draft"),
    picklistId(supabase, "envelopes",            "env_status",       "Sent"),
    picklistId(supabase, "envelopes",            "env_status",       "Failed"),
    picklistId(supabase, "envelope_recipients",  "recipient_status", "Created"),
    picklistId(supabase, "envelope_recipients",  "recipient_status", "Sent"),
    picklistId(supabase, "envelope_events",      "event_type",       "Created"),
    picklistId(supabase, "envelope_events",      "event_type",       "Sent"),
  ])
  if (!draftStatusId || !sentStatusId || !standardEnvRtId)
    return json({ error: "Required picklist seeds missing — contact admin" }, 500)

  // ── Insert envelopes row in Draft ───────────────────────────────────
  const envName = body.env_name || `${dt.name} — ${body.parent_record_id.slice(0, 8)}`
  const subject = body.subject || `Please sign: ${dt.name}`

  const { data: envelopeRow, error: envInsertErr } = await supabase
    .from("envelopes")
    .insert({
      env_record_number: "",
      env_name: envName,
      env_record_type: standardEnvRtId,
      document_template_id: body.document_template_id,
      document_template_snapshot_id: snapshot.id,
      env_parent_object: body.parent_object,
      env_parent_record_id: body.parent_record_id,
      env_subject: subject,
      env_message: body.message || null,
      env_status: draftStatusId,
      env_owner: callerUserId,
      created_by: callerUserId,
      updated_by: callerUserId,
    })
    .select("id, env_record_number")
    .single()
  if (envInsertErr || !envelopeRow)
    return json({ error: `Envelope insert failed: ${envInsertErr?.message}` }, 500)

  const envelopeId = envelopeRow.id

  // ── Insert recipients with signing tokens ───────────────────────────
  const tokenExpiresAt = new Date()
  tokenExpiresAt.setDate(tokenExpiresAt.getDate() + TOKEN_EXPIRY_DAYS)

  const recipientRows = body.recipients.map(r => ({
    recipient_record_number: "",
    envelope_id: envelopeId,
    recipient_record_type: standardRecRtId,
    recipient_order: r.order,
    recipient_role: r.role || null,
    recipient_contact_id: r.contact_id || null,
    recipient_name: r.name,
    recipient_email: r.email,
    recipient_status: createdRecStatId,
    recipient_signing_token: generateToken(),
    recipient_token_expires_at: tokenExpiresAt.toISOString(),
    created_by: callerUserId,
    updated_by: callerUserId,
  }))
  const { data: insertedRecips, error: recipErr } = await supabase
    .from("envelope_recipients")
    .insert(recipientRows)
    .select("id, recipient_order, recipient_signing_token, recipient_name, recipient_email")
  if (recipErr || !insertedRecips) {
    await markEnvelopeFailed(supabase, envelopeId, failedStatusId!, callerUserId, `Recipient insert failed: ${recipErr?.message}`)
    return json({ error: `Recipient insert failed: ${recipErr?.message}` }, 500)
  }

  const recipientByOrder = new Map<number, typeof insertedRecips[number]>()
  for (const r of insertedRecips) recipientByOrder.set(r.recipient_order, r)

  // ── Render the merged PDF + anchors ─────────────────────────────────
  let renderResult: { pdf_base64: string, anchors: any[], page_count: number, template_name: string }
  try {
    const renderResp = await fetch(`${supabaseUrl}/functions/v1/render-document-template-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": authHeader },
      body: JSON.stringify({
        document_template_snapshot_id: snapshot.id,
        parent_object:                 body.parent_object,
        parent_record_id:              body.parent_record_id,
      }),
    })
    if (!renderResp.ok) throw new Error(`render-document-template-pdf returned ${renderResp.status}: ${await renderResp.text()}`)
    renderResult = await renderResp.json()
  } catch (e) {
    await markEnvelopeFailed(supabase, envelopeId, failedStatusId!, callerUserId, `Render failed: ${(e as Error).message}`)
    return json({ error: `Render failed: ${(e as Error).message}`, envelope_id: envelopeId }, 500)
  }

  // ── Upload unsigned PDF ─────────────────────────────────────────────
  const pdfBytes = atobBytes(renderResult.pdf_base64)
  const unsignedPath = `envelopes/${envelopeId}/unsigned.pdf`
  const { error: uploadErr } = await supabase.storage
    .from(SIGNATURES_BUCKET)
    .upload(unsignedPath, pdfBytes, { contentType: "application/pdf", upsert: true })
  if (uploadErr) {
    await markEnvelopeFailed(supabase, envelopeId, failedStatusId!, callerUserId, `Storage upload failed: ${uploadErr.message}`)
    return json({ error: `Storage upload failed: ${uploadErr.message}`, envelope_id: envelopeId }, 500)
  }

  await supabase.from("envelopes").update({
    env_unsigned_pdf_path: unsignedPath,
    updated_by: callerUserId,
  }).eq("id", envelopeId)

  // ── Insert envelope_tabs from anchor scan ───────────────────────────
  // Each anchor's `ordinal` (the digit after "sig"/"initial"/"date"/"text")
  // identifies which recipient owns the tab. If a template uses \sig5\
  // but no recipient has order=5, the tab is dropped with a warning event.
  const tabRows = []
  const droppedAnchors: string[] = []
  for (const a of renderResult.anchors) {
    const recip = recipientByOrder.get(a.ordinal)
    if (!recip) {
      droppedAnchors.push(a.anchor_string)
      continue
    }
    const tabType = a.tab_type === "sig" ? "signature" : a.tab_type
    const tabTypeId = await picklistId(supabase, "envelope_tabs", "tab_type", tabType)
    if (!tabTypeId) {
      droppedAnchors.push(a.anchor_string)
      continue
    }
    tabRows.push({
      tab_record_number: "",
      envelope_id: envelopeId,
      recipient_id: recip.id,
      tab_record_type: standardTabRtId,
      tab_type: tabTypeId,
      tab_anchor_string: a.anchor_string,
      tab_page: a.page,
      tab_x: a.x,
      tab_y: a.y,
      tab_width: a.width,
      tab_height: a.height,
      created_by: callerUserId,
      updated_by: callerUserId,
    })
  }
  if (tabRows.length > 0) {
    const { error: tabErr } = await supabase.from("envelope_tabs").insert(tabRows)
    if (tabErr) {
      await markEnvelopeFailed(supabase, envelopeId, failedStatusId!, callerUserId, `Tab insert failed: ${tabErr.message}`)
      return json({ error: `Tab insert failed: ${tabErr.message}`, envelope_id: envelopeId }, 500)
    }
  }

  // ── Build signing URLs ──────────────────────────────────────────────
  const signingBase = body.signing_base_url
    || req.headers.get("Origin")
    || req.headers.get("Referer")?.split("/").slice(0, 3).join("/")
    || "https://anura-ops.netlify.app"
  const signingUrls = insertedRecips
    .slice()
    .sort((a, b) => a.recipient_order - b.recipient_order)
    .map(r => ({
      recipient_id: r.id,
      name:         r.recipient_name,
      email:        r.recipient_email,
      order:        r.recipient_order,
      signing_url:  `${signingBase}/sign/${envelopeRow.env_record_number}/${r.recipient_signing_token}`,
    }))

  // ── Mark recipient #1 as Sent (others stay Created until advanced) ──
  const firstRecip = insertedRecips.find(r => r.recipient_order === 1)
  if (firstRecip && sentRecStatId) {
    await supabase.from("envelope_recipients").update({
      recipient_status: sentRecStatId,
      recipient_sent_at: new Date().toISOString(),
      updated_by: callerUserId,
    }).eq("id", firstRecip.id)
  }

  // ── Audit events: Created + Sent ────────────────────────────────────
  if (eventCreatedId) {
    await supabase.from("envelope_events").insert({
      event_record_number: "",
      envelope_id: envelopeId,
      event_record_type: standardEventRtId,
      event_type: eventCreatedId,
      event_metadata: {
        page_count:       renderResult.page_count,
        anchor_count:     renderResult.anchors.length,
        tab_count:        tabRows.length,
        dropped_anchors:  droppedAnchors,
        recipient_count:  insertedRecips.length,
      },
      created_by: callerUserId,
    })
  }
  if (eventSentId) {
    await supabase.from("envelope_events").insert({
      event_record_number: "",
      envelope_id: envelopeId,
      event_record_type: standardEventRtId,
      event_type: eventSentId,
      event_metadata: {
        signing_urls: signingUrls.map(u => ({ recipient_id: u.recipient_id, signing_url: u.signing_url })),
      },
      created_by: callerUserId,
    })
  }

  // ── Mark envelope Sent ──────────────────────────────────────────────
  await supabase.from("envelopes").update({
    env_status: sentStatusId,
    env_sent_at: new Date().toISOString(),
    updated_by: callerUserId,
  }).eq("id", envelopeId)

  // ── Build a signed URL so the FE can preview the unsigned PDF ───────
  const { data: signedUrlData } = await supabase.storage
    .from(SIGNATURES_BUCKET)
    .createSignedUrl(unsignedPath, 3600)

  return json({
    envelope_id: envelopeId,
    env_record_number: envelopeRow.env_record_number,
    signing_urls: signingUrls,
    unsigned_pdf_signed_url: signedUrlData?.signedUrl || null,
    dropped_anchors: droppedAnchors,
  }, 200)
})

// ─── helpers ────────────────────────────────────────────────────────────

function validate(b: ReqBody): string | null {
  if (!b.document_template_id) return "document_template_id required"
  if (!b.parent_object)        return "parent_object required"
  if (!b.parent_record_id)     return "parent_record_id required"
  if (!Array.isArray(b.recipients) || b.recipients.length === 0)
    return "recipients[] required and non-empty"
  for (const r of b.recipients) {
    if (!r.name || !r.email)   return "each recipient needs name and email"
    if (!Number.isInteger(r.order) || r.order < 1) return "recipient.order must be positive integer"
  }
  const orders = new Set(b.recipients.map(r => r.order))
  if (orders.size !== b.recipients.length) return "recipient.order values must be unique"
  return null
}

async function resolveCallerUserId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.rpc("current_app_user_id")
  if (error || !data) return null
  return data as string
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

async function markEnvelopeFailed(
  supabase: SupabaseClient,
  envelopeId: string,
  failedStatusId: string,
  callerUserId: string,
  reason: string,
) {
  await supabase.from("envelopes").update({
    env_status: failedStatusId,
    env_failed_at: new Date().toISOString(),
    env_failure_reason: reason.slice(0, 2000),
    updated_by: callerUserId,
  }).eq("id", envelopeId)
}

// 32-byte cryptographically random token, base64url-encoded for URL safety
function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let s = ""
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function atobBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  })
}
