// =============================================================================
// signing-portal-submit (v3 — EES branding in email templates)
//
// Public (verify_jwt = false). Same token-based auth as signing-portal-load.
// Same flow as v2, plus: rebranded email body footer from "via Anura" to
// "from Energy Efficiency Services" so external recipients see the company
// name they recognize.
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"
import { PDFDocument, PDFFont, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1"

const SIGNATURES_BUCKET = "signatures"
const REFRESH_HORIZON_MS = 5 * 60 * 1000

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface TabSubmission { id: string, value: string }
interface ReqBody {
  env_record_number: string
  signing_token:     string
  consent:           boolean
  tabs:              TabSubmission[]
  decline?:          { reason?: string }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  let body: ReqBody
  try { body = await req.json() as ReqBody }
  catch { return json({ error: "Invalid JSON body" }, 400) }
  if (!body.env_record_number || !body.signing_token)
    return json({ error: "env_record_number and signing_token required" }, 400)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfiguration" }, 500)
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const ip = clientIp(req)
  const ua = req.headers.get("User-Agent") || null

  const { data: recipient } = await supabase
    .from("envelope_recipients")
    .select(`
      id, envelope_id, recipient_order, recipient_name, recipient_email,
      recipient_signed_at, recipient_declined_at, recipient_token_expires_at,
      envelope:envelope_id (
        id, env_record_number, env_unsigned_pdf_path, env_signed_pdf_path,
        env_parent_object, env_parent_record_id, env_owner,
        document_template_id, document_template_snapshot_id, env_name, env_subject,
        env_message,
        status:env_status ( picklist_value )
      )
    `)
    .eq("recipient_signing_token", body.signing_token)
    .maybeSingle()
  if (!recipient) return json({ error: "Token not recognized" }, 404)

  const env = (recipient as any).envelope
  if (!env || env.env_record_number !== body.env_record_number)
    return json({ error: "Token does not match envelope" }, 404)

  if (recipient.recipient_token_expires_at && new Date(recipient.recipient_token_expires_at) < new Date())
    return json({ error: "Signing link has expired" }, 410)

  const envStatus = env.status?.picklist_value
  if (envStatus === "Completed" || envStatus === "Voided" || envStatus === "Declined" || envStatus === "Failed")
    return json({ error: `Envelope is ${envStatus}, no further action allowed` }, 410)

  if (recipient.recipient_signed_at)
    return json({ error: "Already signed" }, 409)
  if (recipient.recipient_declined_at)
    return json({ error: "Already declined" }, 409)

  const { data: othersAhead } = await supabase
    .from("envelope_recipients")
    .select("recipient_order, recipient_signed_at, recipient_name")
    .eq("envelope_id", env.id)
    .lt("recipient_order", recipient.recipient_order)
    .eq("is_deleted", false)
  const blocker = (othersAhead || []).find(o => !o.recipient_signed_at)
  if (blocker)
    return json({ error: `Waiting on ${blocker.recipient_name} (signer ${blocker.recipient_order}) to sign first` }, 409)

  const [
    standardEventRtId,
    statusCompletedId, statusDeclinedId,
    recipStatSignedId, recipStatDeclinedId, recipStatSentId,
    eventConsentId, eventTabFilledId, eventSignedId,
    eventDeclinedId, eventCompletedId, eventAdvancedId,
  ] = await Promise.all([
    picklistId(supabase, "envelope_events",     "record_type",       "Standard"),
    picklistId(supabase, "envelopes",           "env_status",        "Completed"),
    picklistId(supabase, "envelopes",           "env_status",        "Declined"),
    picklistId(supabase, "envelope_recipients", "recipient_status",  "Signed"),
    picklistId(supabase, "envelope_recipients", "recipient_status",  "Declined"),
    picklistId(supabase, "envelope_recipients", "recipient_status",  "Sent"),
    picklistId(supabase, "envelope_events",     "event_type",        "ConsentGranted"),
    picklistId(supabase, "envelope_events",     "event_type",        "TabFilled"),
    picklistId(supabase, "envelope_events",     "event_type",        "Signed"),
    picklistId(supabase, "envelope_events",     "event_type",        "Declined"),
    picklistId(supabase, "envelope_events",     "event_type",        "Completed"),
    picklistId(supabase, "envelope_events",     "event_type",        "AdvancedToNext"),
  ])

  if (body.decline) {
    const reason = body.decline.reason?.slice(0, 2000) || null
    await supabase.from("envelope_recipients").update({
      recipient_status: recipStatDeclinedId,
      recipient_declined_at: new Date().toISOString(),
      recipient_decline_reason: reason,
      recipient_ip_address: ip,
      recipient_user_agent: ua,
    }).eq("id", recipient.id)
    await supabase.from("envelopes").update({
      env_status: statusDeclinedId,
      env_declined_at: new Date().toISOString(),
    }).eq("id", env.id)
    if (eventDeclinedId) {
      await supabase.from("envelope_events").insert({
        event_record_number: "",
        envelope_id: env.id,
        recipient_id: recipient.id,
        event_record_type: standardEventRtId,
        event_type: eventDeclinedId,
        event_metadata: { reason },
        event_ip_address: ip,
        event_user_agent: ua,
      })
    }
    return json({ ok: true, completed: false, advanced: false, declined: true }, 200)
  }

  if (!body.consent) return json({ error: "ESIGN consent required to sign" }, 400)
  if (!Array.isArray(body.tabs)) return json({ error: "tabs[] required" }, 400)

  for (const t of body.tabs) {
    if (!t.id) continue
    await supabase.from("envelope_tabs").update({
      tab_filled_value: t.value || null,
      tab_filled_at:    new Date().toISOString(),
    }).eq("id", t.id).eq("recipient_id", recipient.id)
    if (eventTabFilledId) {
      await supabase.from("envelope_events").insert({
        event_record_number: "",
        envelope_id: env.id,
        recipient_id: recipient.id,
        event_record_type: standardEventRtId,
        event_type: eventTabFilledId,
        event_metadata: { tab_id: t.id, has_value: !!t.value },
        event_ip_address: ip,
        event_user_agent: ua,
      })
    }
  }

  await supabase.from("envelope_recipients").update({
    recipient_consent_at: new Date().toISOString(),
    recipient_ip_address: ip,
    recipient_user_agent: ua,
  }).eq("id", recipient.id)
  if (eventConsentId) {
    await supabase.from("envelope_events").insert({
      event_record_number: "",
      envelope_id: env.id,
      recipient_id: recipient.id,
      event_record_type: standardEventRtId,
      event_type: eventConsentId,
      event_metadata: {},
      event_ip_address: ip,
      event_user_agent: ua,
    })
  }

  await supabase.from("envelope_recipients").update({
    recipient_status: recipStatSignedId,
    recipient_signed_at: new Date().toISOString(),
  }).eq("id", recipient.id)
  if (eventSignedId) {
    await supabase.from("envelope_events").insert({
      event_record_number: "",
      envelope_id: env.id,
      recipient_id: recipient.id,
      event_record_type: standardEventRtId,
      event_type: eventSignedId,
      event_metadata: {},
      event_ip_address: ip,
      event_user_agent: ua,
    })
  }

  const overlayPath = await rebuildOverlayPdf(supabase, env)
  if (overlayPath.error)
    return json({ error: `Overlay build failed: ${overlayPath.error}` }, 500)
  await supabase.from("envelopes").update({
    env_signed_pdf_path: overlayPath.path,
  }).eq("id", env.id)

  const { data: nextRecipient } = await supabase
    .from("envelope_recipients")
    .select("id, recipient_order, recipient_name, recipient_email, recipient_signing_token")
    .eq("envelope_id", env.id)
    .gt("recipient_order", recipient.recipient_order)
    .is("recipient_signed_at", null)
    .is("recipient_declined_at", null)
    .eq("is_deleted", false)
    .order("recipient_order", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (nextRecipient) {
    await supabase.from("envelope_recipients").update({
      recipient_status: recipStatSentId,
      recipient_sent_at: new Date().toISOString(),
    }).eq("id", nextRecipient.id)

    const signingBase =
      req.headers.get("Origin") ||
      (req.headers.get("Referer")?.split("/").slice(0, 3).join("/")) ||
      "https://ees-ops.netlify.app"
    const nextSigningUrl = `${signingBase}/sign/${env.env_record_number}/${nextRecipient.recipient_signing_token}`

    if (eventAdvancedId) {
      await supabase.from("envelope_events").insert({
        event_record_number: "",
        envelope_id: env.id,
        recipient_id: nextRecipient.id,
        event_record_type: standardEventRtId,
        event_type: eventAdvancedId,
        event_metadata: { signing_url: nextSigningUrl },
        event_ip_address: ip,
        event_user_agent: ua,
      })
    }

    let emailSendResult: any = { status: "skipped" }
    if (env.env_owner) {
      try {
        emailSendResult = await sendNextRecipientEmail(supabase, {
          envelopeOwnerUserId: env.env_owner,
          envelopeId:          env.id,
          parentObject:        env.env_parent_object,
          parentRecordId:      env.env_parent_record_id,
          envName:             env.env_name,
          subject:             env.env_subject || `Please sign: ${env.env_name}`,
          customMessage:       env.env_message || null,
          signingUrl:          nextSigningUrl,
          recipientId:         nextRecipient.id,
          recipientName:       nextRecipient.recipient_name,
          recipientEmail:      nextRecipient.recipient_email,
        })
      } catch (e) {
        emailSendResult = { status: "failed", failure_reason: (e as Error).message }
      }
    }

    return json({
      ok: true,
      completed: false,
      advanced: true,
      next_recipient: {
        name: nextRecipient.recipient_name,
        email: nextRecipient.recipient_email,
        signing_url: nextSigningUrl,
      },
      next_email: emailSendResult,
    }, 200)
  }

  const certPath = await generateCertificateOfCompletion(supabase, env, ip)

  await supabase.from("envelopes").update({
    env_status: statusCompletedId,
    env_completed_at: new Date().toISOString(),
    env_certificate_path: certPath || null,
  }).eq("id", env.id)

  const { data: docRow } = await supabase.from("documents").insert({
    document_number: "",
    name: `Signed: ${env.env_name}.pdf`,
    document_type: "Signed Document",
    category: "envelope_signed",
    mime_type: "application/pdf",
    related_object: env.env_parent_object,
    related_id:     env.env_parent_record_id,
    requires_signature: true,
    signed_at: new Date().toISOString(),
    signature_status: "Completed",
    uploaded_by: env.env_owner,
    storage_bucket: SIGNATURES_BUCKET,
    storage_path:   overlayPath.path,
  }).select("id").maybeSingle()
  if (docRow) {
    await supabase.from("envelopes").update({
      env_signed_document_id: docRow.id,
    }).eq("id", env.id)
  }

  if (eventCompletedId) {
    await supabase.from("envelope_events").insert({
      event_record_number: "",
      envelope_id: env.id,
      event_record_type: standardEventRtId,
      event_type: eventCompletedId,
      event_metadata: { signed_document_id: docRow?.id || null, certificate_path: certPath },
      event_ip_address: ip,
      event_user_agent: ua,
    })
  }

  return json({ ok: true, completed: true, advanced: false }, 200)
})

async function sendNextRecipientEmail(
  supabase: SupabaseClient,
  p: {
    envelopeOwnerUserId: string
    envelopeId:     string
    parentObject:   string
    parentRecordId: string
    envName:        string
    subject:        string
    customMessage:  string | null
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

  const bodyHtml = renderEmailHtml({
    recipientName: p.recipientName,
    senderName: senderName || "Energy Efficiency Services",
    templateName: p.envName,
    customMessage: p.customMessage,
    signingUrl: p.signingUrl,
  })
  const bodyText = renderEmailText({
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
    .select("id, email_send_record_number")
    .single()
  if (insErr || !emailRow) return { status: "failed", failure_reason: `email_sends insert failed: ${insErr?.message}` }

  let sendOk = false
  let failureReason: string | null = null
  try {
    const sendResp = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
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

  return {
    status: sendOk ? "sent" : "failed",
    email_send_id: emailRow.id,
    failure_reason: failureReason || undefined,
  }
}

async function refreshAccessToken(
  tenantId: string, clientId: string, clientSecret: string, refreshToken: string,
): Promise<{ access_token: string, refresh_token?: string, expires_in: number }> {
  const resp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "openid profile email offline_access User.Read Mail.Send",
    }).toString(),
  })
  const j = await resp.json()
  if (!resp.ok) throw new Error(j.error_description || j.error || `HTTP ${resp.status}`)
  return j
}

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

async function rebuildOverlayPdf(
  supabase: SupabaseClient,
  env: any,
): Promise<{ path?: string, error?: string }> {
  if (!env.env_unsigned_pdf_path) return { error: "Envelope has no unsigned PDF" }

  const { data: unsignedBlob, error: dlErr } = await supabase
    .storage.from(SIGNATURES_BUCKET).download(env.env_unsigned_pdf_path)
  if (dlErr || !unsignedBlob) return { error: dlErr?.message || "Unsigned PDF download failed" }

  const pdfDoc = await PDFDocument.load(await unsignedBlob.arrayBuffer())
  const pages = pdfDoc.getPages()
  const fontHelv     = await pdfDoc.embedFont(StandardFonts.Helvetica)

  const { data: tabs } = await supabase
    .from("envelope_tabs")
    .select(`
      id, tab_anchor_string, tab_page, tab_x, tab_y, tab_width, tab_height,
      tab_filled_value, tab_filled_at,
      type:tab_type ( picklist_value )
    `)
    .eq("envelope_id", env.id)
    .eq("is_deleted", false)
    .not("tab_filled_value", "is", null)

  for (const t of (tabs || [])) {
    const pageIdx = Math.max(0, Math.min((t.tab_page || 1) - 1, pages.length - 1))
    const page = pages[pageIdx]
    const x = Number(t.tab_x), y = Number(t.tab_y)
    const w = Number(t.tab_width), h = Number(t.tab_height)
    const tabType = (t as any).type?.picklist_value

    if (!t.tab_filled_value) continue

    if (tabType === "signature" || tabType === "initial") {
      const m = String(t.tab_filled_value).match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/)
      if (!m) continue
      const isPng = m[1].toLowerCase() === "png"
      const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0))
      try {
        const img = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes)
        const aspect = img.width / img.height
        let drawW = w, drawH = w / aspect
        if (drawH > h) { drawH = h; drawW = h * aspect }
        page.drawImage(img, {
          x: x + (w - drawW) / 2,
          y: y + (h - drawH) / 2,
          width:  drawW,
          height: drawH,
        })
      } catch { /* skip bad image */ }
    } else if (tabType === "date") {
      page.drawText(formatDate(t.tab_filled_value), {
        x: x + 4, y: y + h * 0.3, size: 11,
        font: fontHelv, color: rgb(0, 0, 0),
      })
    } else {
      page.drawText(String(t.tab_filled_value).slice(0, 200), {
        x: x + 4, y: y + h * 0.3, size: 11,
        font: fontHelv, color: rgb(0, 0, 0),
      })
    }
  }

  const out = await pdfDoc.save()
  const path = `envelopes/${env.id}/signed.pdf`
  const { error: upErr } = await supabase.storage
    .from(SIGNATURES_BUCKET)
    .upload(path, out, { contentType: "application/pdf", upsert: true })
  if (upErr) return { error: upErr.message }
  return { path }
}

async function generateCertificateOfCompletion(
  supabase: SupabaseClient,
  env: any,
  _ip: string | null,
): Promise<string | null> {
  try {
    const { data: recipients } = await supabase
      .from("envelope_recipients")
      .select(`
        recipient_order, recipient_name, recipient_email, recipient_role,
        recipient_consent_at, recipient_signed_at, recipient_declined_at,
        recipient_ip_address, recipient_user_agent
      `)
      .eq("envelope_id", env.id)
      .eq("is_deleted", false)
      .order("recipient_order")

    const { data: events } = await supabase
      .from("envelope_events")
      .select(`
        event_record_number, created_at, event_ip_address, event_user_agent,
        event_type:event_type ( picklist_label, picklist_value ),
        recipient:recipient_id ( recipient_name )
      `)
      .eq("envelope_id", env.id)
      .order("created_at", { ascending: true })

    const doc = await PDFDocument.create()
    const fontReg  = await doc.embedFont(StandardFonts.Helvetica)
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)

    const PAGE_W = 612, PAGE_H = 792, MX = 54
    let page = doc.addPage([PAGE_W, PAGE_H])
    let y = PAGE_H - 60

    const writeLine = (text: string, opts: { font?: PDFFont, size?: number, color?: any } = {}) => {
      const size = opts.size ?? 10
      if (y < 60) { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - 60 }
      page.drawText(text.slice(0, 110), {
        x: MX, y, size,
        font: opts.font || fontReg,
        color: opts.color || rgb(0.05, 0.10, 0.18),
      })
      y -= size * 1.45
    }

    writeLine("Certificate of Completion", { font: fontBold, size: 18 })
    y -= 6
    writeLine(`Envelope: ${env.env_name}`, { size: 11 })
    writeLine(`Record #: ${env.env_record_number}`, { size: 11 })
    writeLine(`Generated: ${new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}`, { size: 11 })
    y -= 8

    writeLine("Signers", { font: fontBold, size: 13 })
    y -= 2
    for (const r of (recipients || [])) {
      writeLine(`${r.recipient_order}. ${r.recipient_name} <${r.recipient_email}>`, { font: fontBold, size: 11 })
      if (r.recipient_role) writeLine(`   Role: ${r.recipient_role}`)
      writeLine(`   Status: ${r.recipient_signed_at ? "Signed" : r.recipient_declined_at ? "Declined" : "Pending"}`)
      if (r.recipient_consent_at)
        writeLine(`   ESIGN Consent: ${new Date(r.recipient_consent_at).toLocaleString()}`)
      if (r.recipient_signed_at)
        writeLine(`   Signed At: ${new Date(r.recipient_signed_at).toLocaleString()}`)
      if (r.recipient_ip_address) writeLine(`   IP: ${r.recipient_ip_address}`)
      if (r.recipient_user_agent) writeLine(`   User Agent: ${r.recipient_user_agent}`)
      y -= 4
    }

    y -= 6
    writeLine("Audit Trail", { font: fontBold, size: 13 })
    y -= 2
    for (const e of (events || [])) {
      const when = new Date(e.created_at).toLocaleString()
      const evt  = (e as any).event_type?.picklist_label || (e as any).event_type?.picklist_value || "Event"
      const who  = (e as any).recipient?.recipient_name || "—"
      writeLine(`${when}  ${evt}  (${who})  ${e.event_ip_address || ""}`)
    }

    const bytes = await doc.save()
    const path = `envelopes/${env.id}/certificate.pdf`
    const { error: upErr } = await supabase.storage
      .from(SIGNATURES_BUCKET)
      .upload(path, bytes, { contentType: "application/pdf", upsert: true })
    if (upErr) return null
    return path
  } catch {
    return null
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  })
}

function clientIp(req: Request): string | null {
  return (
    req.headers.get("CF-Connecting-IP") ||
    (req.headers.get("X-Forwarded-For") || "").split(",")[0].trim() ||
    null
  )
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

function formatDate(v: string): string {
  try {
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return v
    return d.toLocaleDateString("en-US")
  } catch { return v }
}
