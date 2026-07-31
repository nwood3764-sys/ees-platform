// =============================================================================
// send-envelope (v4 — pre-generated source-document signing route)
//
// v3 + an ADDITIVE second entry path: an envelope can now be sent from a
// pre-generated PDF (a `documents` row) with explicit tab positions, instead
// of from a document_template + snapshot that gets rendered here. This is what
// lets the Final Project Payment Request invoice — produced in-app by
// paperworkModel, which has no document_template — be sent for a property
// owner's signature.
//
// The template path is UNCHANGED. Mode is chosen by the request body:
//   - document_template_id present → existing path (validate template, find
//     snapshot, render via render-document-template-pdf, discover anchors).
//   - source_document_id present   → read the PDF bytes from that documents
//     row's storage location and use the caller-supplied `tabs` (a generated
//     PDF has no discoverable text anchors). Exactly one of the two is required.
//
// Everything after the PDF bytes + tab list are in hand is shared and
// unchanged: unsigned.pdf upload, recipients, tokens, tab rows, events, and the
// recipient-#1 email (which still only fires when Outlook is connected —
// otherwise the response carries copy-paste signing URLs, the safe test mode).
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

interface TabInput {
  recipient_order: number
  tab_type: string          // 'sig' | 'signature' | 'date' | 'text' | 'initial'
  page: number
  x: number
  y: number
  width: number
  height: number
}

interface ReqBody {
  document_template_id?: string   // template path (existing)
  source_document_id?: string     // source-document path (new); exactly one of the two
  tabs?: TabInput[]               // required with source_document_id — a generated PDF has no anchors
  parent_object: string
  parent_record_id: string
  recipients: Recipient[]
  subject?: string
  message?: string
  env_name?: string
  signing_base_url?: string
  attach_unsigned_pdf?: boolean
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

  // Mode: template (existing) vs. pre-generated source document (new).
  const useSourceDoc = !!body.source_document_id
  let docName = "Document"                 // env_name / subject / email default
  let snapshot: { id: string, dtsn_version?: number } | null = null
  let sourceDoc: { id: string, name: string, storage_bucket: string, storage_path: string } | null = null

  if (useSourceDoc) {
    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .select("id, name, storage_bucket, storage_path, is_deleted")
      .eq("id", body.source_document_id)
      .maybeSingle()
    if (docErr || !doc) return json({ error: `Source document not found: ${docErr?.message || ""}` }, 404)
    if ((doc as any).is_deleted) return json({ error: "Source document is deleted" }, 400)
    if (!(doc as any).storage_bucket || !(doc as any).storage_path)
      return json({ error: "Source document has no stored file" }, 400)
    sourceDoc = doc as any
    docName = body.env_name || (doc as any).name || "Document"
  } else {
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

    const { data: snap, error: snapErr } = await supabase
      .from("document_template_snapshots")
      .select("id, dtsn_version")
      .eq("document_template_id", body.document_template_id)
      .order("dtsn_version", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (snapErr || !snap) return json({ error: "No published snapshot — re-publish the template first" }, 400)
    snapshot = snap
    docName = (dt as any).name
  }

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

  const envName = body.env_name || `${docName} — ${body.parent_record_id.slice(0, 8)}`
  const subject = body.subject || `Please sign: ${docName}`

  const { data: envelopeRow, error: envInsertErr } = await supabase
    .from("envelopes")
    .insert({
      env_record_number: "",
      env_name: envName,
      env_record_type: standardEnvRtId,
      document_template_id: useSourceDoc ? null : body.document_template_id,
      document_template_snapshot_id: useSourceDoc ? null : snapshot!.id,
      env_source_document_id: useSourceDoc ? sourceDoc!.id : null,
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

  // Acquire the unsigned PDF bytes and the tab source (anchors for the template
  // path; caller-supplied tabs for the source-document path).
  let pdfBytes: Uint8Array
  let anchorList: any[]
  let pageCount = 0
  if (useSourceDoc) {
    try {
      const { data: blob, error: dlErr } = await supabase.storage
        .from(sourceDoc!.storage_bucket)
        .download(sourceDoc!.storage_path)
      if (dlErr || !blob) throw new Error(dlErr?.message || "download returned no data")
      pdfBytes = new Uint8Array(await blob.arrayBuffer())
    } catch (e) {
      await markEnvelopeFailed(supabase, envelopeId, failedStatusId!, callerUserId, `Source document read failed: ${(e as Error).message}`)
      return json({ error: `Source document read failed: ${(e as Error).message}`, envelope_id: envelopeId }, 500)
    }
    // Normalize caller tabs into the same shape the anchor loop consumes.
    anchorList = body.tabs!.map((t, i) => ({
      anchor_string: `generated:${t.tab_type}:${t.recipient_order}:${i}`,
      tab_type: t.tab_type,
      ordinal:  t.recipient_order,
      page:     t.page,
      x:        t.x,
      y:        t.y,
      width:    t.width,
      height:   t.height,
    }))
  } else {
    let renderResult: { pdf_base64: string, anchors: any[], page_count: number, template_name: string }
    try {
      const renderResp = await fetch(`${supabaseUrl}/functions/v1/render-document-template-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": authHeader },
        body: JSON.stringify({
          document_template_snapshot_id: snapshot!.id,
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
    pdfBytes = atobBytes(renderResult.pdf_base64)
    anchorList = renderResult.anchors
    pageCount = renderResult.page_count
  }
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

  const tabRows = []
  const droppedAnchors: string[] = []
  for (const a of anchorList) {
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

  const signingBase = body.signing_base_url
    || req.headers.get("Origin")
    || req.headers.get("Referer")?.split("/").slice(0, 3).join("/")
    || "https://leap.energyefficiencyservices.org"
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

  const firstRecip = insertedRecips.find(r => r.recipient_order === 1)
  if (firstRecip && sentRecStatId) {
    await supabase.from("envelope_recipients").update({
      recipient_status: sentRecStatId,
      recipient_sent_at: new Date().toISOString(),
      updated_by: callerUserId,
    }).eq("id", firstRecip.id)
  }

  if (eventCreatedId) {
    await supabase.from("envelope_events").insert({
      event_record_number: "",
      envelope_id: envelopeId,
      event_record_type: standardEventRtId,
      event_type: eventCreatedId,
      event_metadata: {
        source:           useSourceDoc ? "source_document" : "template",
        page_count:       pageCount,
        anchor_count:     anchorList.length,
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

  await supabase.from("envelopes").update({
    env_status: sentStatusId,
    env_sent_at: new Date().toISOString(),
    updated_by: callerUserId,
  }).eq("id", envelopeId)

  // ── Send email to recipient #1 via Outlook ────────────────────
  const emailSendResults: any[] = []
  if (firstRecip) {
    const senderName = await getCallerDisplayName(supabase) || "Energy Efficiency Services"
    const firstRecipUrl = signingUrls.find(u => u.order === 1)!.signing_url
    const emailHtml = renderEmailHtml({
      recipientName: firstRecip.recipient_name,
      senderName,
      templateName:  docName,
      customMessage: body.message || null,
      signingUrl:    firstRecipUrl,
    })
    const emailText = renderEmailText({
      recipientName: firstRecip.recipient_name,
      senderName,
      templateName:  docName,
      customMessage: body.message || null,
      signingUrl:    firstRecipUrl,
    })

    try {
      const sendResp = await fetch(`${supabaseUrl}/functions/v1/send-email-via-graph`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": authHeader },
        body: JSON.stringify({
          parent_object:    body.parent_object,
          parent_record_id: body.parent_record_id,
          recipients_to:    [{ name: firstRecip.recipient_name, email: firstRecip.recipient_email }],
          subject,
          body_html: emailHtml,
          body_text: emailText,
          attachment_paths: body.attach_unsigned_pdf
            ? [{ storage_bucket: SIGNATURES_BUCKET, storage_path: unsignedPath, name: `${docName}.pdf`, content_type: "application/pdf" }]
            : [],
          related_envelope_id:  envelopeId,
          related_recipient_id: firstRecip.id,
        }),
      })
      const j = await sendResp.json()
      emailSendResults.push({
        recipient_id: firstRecip.id,
        order: 1,
        status: j.ok ? "sent" : (j.code === "not_connected" ? "not_connected" : "failed"),
        email_send_id: j.email_send_id || null,
        failure_reason: j.failure_reason || j.error || null,
      })
    } catch (e) {
      emailSendResults.push({
        recipient_id: firstRecip.id, order: 1,
        status: "failed",
        failure_reason: (e as Error).message,
      })
    }
  }

  const { data: signedUrlData } = await supabase.storage
    .from(SIGNATURES_BUCKET)
    .createSignedUrl(unsignedPath, 3600)

  return json({
    envelope_id: envelopeId,
    env_record_number: envelopeRow.env_record_number,
    signing_urls: signingUrls,
    unsigned_pdf_signed_url: signedUrlData?.signedUrl || null,
    dropped_anchors: droppedAnchors,
    email_send_results: emailSendResults,
  }, 200)
})

// ─── helpers ───────────────────────────────────────────────────────────────

function validate(b: ReqBody): string | null {
  const hasTpl = !!b.document_template_id, hasDoc = !!b.source_document_id
  if (hasTpl === hasDoc) return "exactly one of document_template_id or source_document_id required"
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
  if (hasDoc) {
    if (!Array.isArray(b.tabs) || b.tabs.length === 0)
      return "tabs[] required and non-empty when sending a source document"
    for (const t of b.tabs) {
      if (!Number.isInteger(t.recipient_order) || t.recipient_order < 1)
        return "tab.recipient_order must be positive integer"
      if (!t.tab_type) return "tab.tab_type required"
      for (const k of ["page", "x", "y", "width", "height"] as const)
        if (typeof t[k] !== "number" || !Number.isFinite(t[k])) return `tab.${k} must be a finite number`
    }
    if (!orders.has(1)) return "a recipient with order 1 is required"
  }
  return null
}

async function resolveCallerUserId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.rpc("current_app_user_id")
  if (error || !data) return null
  return data as string
}

async function getCallerDisplayName(supabase: SupabaseClient): Promise<string | null> {
  const { data: idRow } = await supabase.rpc("current_app_user_id")
  if (!idRow) return null
  const { data } = await supabase.from("users")
    .select("user_first_name, user_last_name, user_name")
    .eq("id", idRow as string)
    .maybeSingle()
  if (!data) return null
  const full = [(data as any).user_first_name, (data as any).user_last_name].filter(Boolean).join(" ").trim()
  return full || (data as any).user_name || null
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

// HTML/text email templates — single source of truth so send-envelope and
// signing-portal-submit produce identical-looking emails (the AdvancedToNext
// path duplicates these inline).
function renderEmailHtml(p: {
  recipientName: string, senderName: string, templateName: string,
  customMessage: string | null, signingUrl: string,
}): string {
  const safe = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const customBlock = p.customMessage
    ? `<p style="white-space:pre-wrap;">${safe(p.customMessage)}</p>`
    : `<p>You have a document waiting for your signature: <strong>${safe(p.templateName)}</strong>.</p>`
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.55;color:#1a202c;max-width:600px;margin:0 auto;padding:24px;background:#fff;">
<p style="font-size:15px;">Hi ${safe(p.recipientName.split(" ")[0] || p.recipientName)},</p>
<div style="font-size:14px;">${customBlock}</div>
<div style="margin:28px 0;">
  <a href="${p.signingUrl}" style="background:#1f7ae0;color:#fff;padding:13px 28px;text-decoration:none;border-radius:6px;font-weight:600;display:inline-block;font-size:14px;">Review and Sign</a>
</div>
<p style="font-size:12px;color:#666;">If the button doesn't work, paste this URL into your browser:<br><a href="${p.signingUrl}" style="color:#1f7ae0;word-break:break-all;">${p.signingUrl}</a></p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
<p style="font-size:11px;color:#888;">Sent on behalf of ${safe(p.senderName)} from Energy Efficiency Services. This signing link is unique to you and will expire in 30 days.</p>
</body></html>`
}

function renderEmailText(p: {
  recipientName: string, senderName: string, templateName: string,
  customMessage: string | null, signingUrl: string,
}): string {
  const greeting = `Hi ${p.recipientName.split(" ")[0] || p.recipientName},`
  const intro = p.customMessage || `You have a document waiting for your signature: ${p.templateName}.`
  return `${greeting}\n\n${intro}\n\nReview and sign:\n${p.signingUrl}\n\n—\nSent on behalf of ${p.senderName} from Energy Efficiency Services. This signing link is unique to you and will expire in 30 days.`
}
