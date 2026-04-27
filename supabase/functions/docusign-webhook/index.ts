// =============================================================================
// docusign-webhook
//
// Receives DocuSign Connect callbacks for envelope status changes. Updates
// the envelopes + envelope_recipients rows, and on envelope-completed
// downloads the combined signed PDF and writes it to the documents table.
//
// IMPORTANT: this function MUST be deployed with verify_jwt = false because
// DocuSign does not send a Supabase JWT. Set this in supabase/config.toml:
//
//   [functions.docusign-webhook]
//   verify_jwt = false
//
// We instead verify the HMAC signature on the request body to prove that
// the call genuinely came from DocuSign Connect (configured per-account
// in DocuSign admin: Settings → Integrations → Connect → HMAC).
//
// Connect payload (JSON mode): a top-level `data` object containing
// envelopeSummary with envelopeId, status, and a recipients structure.
// We only handle the JSON Connect payloads (the modern shape) — XML
// Connect is legacy.
//
// Required Supabase secrets:
//   DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_GUID, DOCUSIGN_ACCOUNT_GUID,
//   DOCUSIGN_PRIVATE_KEY, DOCUSIGN_OAUTH_BASE_URL — needed to call back
//     to DocuSign on envelope-completed to download the combined PDF.
//   DOCUSIGN_CONNECT_HMAC_KEY — 32-byte HMAC secret configured in
//     DocuSign Connect → HMAC. Stored as base64.
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"
import { create as djwtCreate } from "https://deno.land/x/djwt@v3.0.2/mod.ts"

const SIGNED_BUCKET = "signatures"

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("POST required", { status: 405 })
  }

  // Read raw body once — needed for HMAC verification AND parsing
  const rawBody = await req.text()

  // ── HMAC verification ───────────────────────────────────────────────────
  const hmacSecretB64 = Deno.env.get("DOCUSIGN_CONNECT_HMAC_KEY")
  if (!hmacSecretB64) {
    console.error("DOCUSIGN_CONNECT_HMAC_KEY not configured — refusing webhook")
    return new Response("Webhook HMAC not configured", { status: 500 })
  }
  const hmacOk = await verifyDocusignHmac(req.headers, rawBody, hmacSecretB64)
  if (!hmacOk) {
    console.error("DocuSign HMAC verification failed")
    return new Response("Invalid HMAC signature", { status: 401 })
  }

  // ── Parse Connect payload ───────────────────────────────────────────────
  let payload: any
  try { payload = JSON.parse(rawBody) }
  catch (e) {
    console.error("Webhook payload not valid JSON:", e)
    return new Response("Invalid JSON", { status: 400 })
  }

  const summary = payload?.data?.envelopeSummary
  const envelopeId = payload?.data?.envelopeId || summary?.envelopeId
  const envelopeStatus = (summary?.status || payload?.event || "").toLowerCase()

  if (!envelopeId) {
    console.error("Webhook payload missing envelopeId:", JSON.stringify(payload).slice(0, 500))
    return new Response("Missing envelopeId", { status: 400 })
  }

  // ── Service-role client for webhook DB writes ───────────────────────────
  // Webhook isn't auth'd as a user, so we use the service role key. RLS
  // applies to authenticated/anon roles only — service role bypasses it.
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) {
    console.error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing")
    return new Response("Server misconfiguration", { status: 500 })
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // ── Find the envelope row by provider_envelope_id ───────────────────────
  const { data: envRow, error: envLookupErr } = await supabase
    .from("envelopes")
    .select("id, env_provider_account_id, document_template_id, env_parent_object, env_parent_record_id, env_owner")
    .eq("env_provider_envelope_id", envelopeId)
    .maybeSingle()
  if (envLookupErr) {
    console.error("Envelope lookup failed:", envLookupErr.message)
    return new Response("DB error", { status: 500 })
  }
  if (!envRow) {
    // Connect can fire before our send-envelope's DB update lands. Log
    // and 200 so DocuSign doesn't retry indefinitely. The next status
    // change will land normally once the row exists.
    console.warn(`Webhook for unknown envelope ${envelopeId} — ignoring`)
    return new Response("ok", { status: 200 })
  }

  // ── Resolve picklist ids for status updates ─────────────────────────────
  const newEnvStatusId = await picklistId(supabase, "envelopes", "env_status", mapEnvStatus(envelopeStatus))

  // Lifecycle timestamp column for this status, if any
  const tsColumn = envStatusToColumn(envelopeStatus)
  const envUpdate: Record<string, any> = {
    env_status: newEnvStatusId,
    updated_at: new Date().toISOString(),
  }
  if (tsColumn) envUpdate[tsColumn] = new Date().toISOString()

  // ── Update per-recipient statuses ───────────────────────────────────────
  const recipientsBlock =
    summary?.recipients?.signers ||
    summary?.recipients?.recipients ||
    payload?.data?.recipients?.signers ||
    []
  for (const r of recipientsBlock) {
    const rEmail = (r.email || "").toLowerCase()
    if (!rEmail) continue
    const newRecipientStatusId = await picklistId(
      supabase, "envelope_recipients", "recipient_status",
      mapRecipientStatus(String(r.status || "").toLowerCase()),
    )
    const recipUpdate: Record<string, any> = {
      recipient_status:  newRecipientStatusId,
      provider_recipient_id: r.recipientId || null,
      updated_at:        new Date().toISOString(),
    }
    const recTs = recipientStatusToColumn(String(r.status || "").toLowerCase())
    if (recTs) recipUpdate[recTs] = new Date().toISOString()
    if (r.declinedReason) recipUpdate.recipient_decline_reason = r.declinedReason

    await supabase
      .from("envelope_recipients")
      .update(recipUpdate)
      .eq("envelope_id", envRow.id)
      .ilike("recipient_email", rEmail)
  }

  // ── On Completed: download combined PDF and write a documents row ───────
  if (envelopeStatus === "completed") {
    try {
      const docId = await downloadAndStoreCombinedPdf(supabase, envRow, envelopeId)
      envUpdate.env_signed_document_id = docId
    } catch (e) {
      console.error("Combined PDF download failed:", e)
      // Don't fail the webhook — the status update still goes through.
      // Operator can re-trigger PDF fetch manually from the envelope row.
    }
  }

  const { error: envUpdateErr } = await supabase
    .from("envelopes")
    .update(envUpdate)
    .eq("id", envRow.id)
  if (envUpdateErr) {
    console.error("Envelope update failed:", envUpdateErr.message)
    return new Response("DB error", { status: 500 })
  }

  return new Response("ok", { status: 200 })
})

// ─── HMAC verification ──────────────────────────────────────────────────
// DocuSign Connect signs the raw request body with HMAC-SHA256 using the
// shared secret. Up to 5 keys can be active for rotation; we check headers
// X-DocuSign-Signature-1 through -5 against our configured secret.
async function verifyDocusignHmac(
  headers: Headers,
  rawBody: string,
  secretB64: string,
): Promise<boolean> {
  const secretBytes = Uint8Array.from(atob(secretB64), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    "raw", secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"],
  )
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody))
  const expected = btoaBytes(new Uint8Array(sigBytes))

  for (let i = 1; i <= 5; i++) {
    const provided = headers.get(`X-DocuSign-Signature-${i}`)
    if (provided && timingSafeEq(provided, expected)) return true
  }
  return false
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ─── Status mapping ─────────────────────────────────────────────────────

// DocuSign envelope status values: created, sent, delivered, signed,
// completed, declined, voided. Map to our envelopes.env_status picklist.
function mapEnvStatus(s: string): string {
  switch (s.toLowerCase()) {
    case "sent":      return "Sent"
    case "delivered": return "Delivered"
    case "completed": return "Completed"
    case "declined":  return "Declined"
    case "voided":    return "Voided"
    default:          return "Sent"  // unknown — stay in Sent rather than mis-classifying
  }
}

function envStatusToColumn(s: string): string | null {
  switch (s.toLowerCase()) {
    case "sent":      return "env_sent_at"
    case "delivered": return "env_delivered_at"
    case "completed": return "env_completed_at"
    case "declined":  return "env_declined_at"
    case "voided":    return "env_voided_at"
    default:          return null
  }
}

function mapRecipientStatus(s: string): string {
  switch (s.toLowerCase()) {
    case "created":       return "Created"
    case "sent":          return "Sent"
    case "delivered":     return "Delivered"
    case "signed":        return "Signed"
    case "completed":     return "Completed"
    case "declined":      return "Declined"
    case "autoresponded": return "AutoResponded"
    default:              return "Sent"
  }
}

function recipientStatusToColumn(s: string): string | null {
  switch (s.toLowerCase()) {
    case "sent":      return "recipient_sent_at"
    case "delivered": return "recipient_delivered_at"
    case "signed":    return "recipient_signed_at"
    case "completed": return "recipient_signed_at"  // map completed → signed_at for non-signing roles
    case "declined":  return "recipient_declined_at"
    default:          return null
  }
}

// ─── Picklist + caller helpers ──────────────────────────────────────────

async function picklistId(
  supabase: SupabaseClient, obj: string, field: string, value: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("picklist_values")
    .select("id")
    .eq("picklist_object", obj)
    .eq("picklist_field", field)
    .eq("picklist_value", value)
    .eq("picklist_is_active", true)
    .maybeSingle()
  return data?.id || null
}

// ─── Combined PDF download ──────────────────────────────────────────────

async function downloadAndStoreCombinedPdf(
  supabase: SupabaseClient,
  envRow: any,
  envelopeId: string,
): Promise<string> {
  // Re-do JWT grant flow inside the webhook — webhooks are stateless and
  // the access token isn't worth caching across invocations.
  const integrationKey = Deno.env.get("DOCUSIGN_INTEGRATION_KEY")!
  const userGuid       = Deno.env.get("DOCUSIGN_USER_GUID")!
  const accountGuid    = Deno.env.get("DOCUSIGN_ACCOUNT_GUID")!
  const privateKeyPem  = Deno.env.get("DOCUSIGN_PRIVATE_KEY")!
  const oauthHost      = Deno.env.get("DOCUSIGN_OAUTH_BASE_URL")!

  const key = await importRsaPrivateKey(privateKeyPem)
  const now = Math.floor(Date.now() / 1000)
  const jwt = await djwtCreate(
    { alg: "RS256", typ: "JWT" },
    {
      iss: integrationKey, sub: userGuid, aud: oauthHost,
      iat: now, exp: now + 3600, scope: "signature impersonation",
    },
    key,
  )
  const tokenResp = await fetch(`https://${oauthHost}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:  jwt,
    }),
  })
  if (!tokenResp.ok) throw new Error(`DocuSign token: ${tokenResp.status} ${await tokenResp.text()}`)
  const accessToken = (await tokenResp.json()).access_token

  // Find base_uri
  const userInfoResp = await fetch(`https://${oauthHost}/oauth/userinfo`, {
    headers: { "Authorization": `Bearer ${accessToken}` },
  })
  if (!userInfoResp.ok) throw new Error(`DocuSign userinfo: ${userInfoResp.status}`)
  const userInfo = await userInfoResp.json()
  const account = (userInfo.accounts || []).find((a: any) => a.account_id === accountGuid)
  if (!account) throw new Error(`DocuSign account ${accountGuid} not found in userinfo`)
  const baseUri = account.base_uri

  // GET /envelopes/{envelopeId}/documents/combined → PDF binary
  const pdfResp = await fetch(
    `${baseUri}/restapi/v2.1/accounts/${accountGuid}/envelopes/${envelopeId}/documents/combined`,
    {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept":        "application/pdf",
      },
    },
  )
  if (!pdfResp.ok) throw new Error(`Combined PDF fetch returned ${pdfResp.status}`)
  const pdfBytes = new Uint8Array(await pdfResp.arrayBuffer())

  // Upload to signatures bucket
  const storagePath = `envelopes/${envRow.id}/signed-${Date.now()}.pdf`
  const { error: uploadErr } = await supabase
    .storage.from(SIGNED_BUCKET)
    .upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: false,
    })
  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`)

  // Insert documents row pointing to the signed PDF
  const { data: docRow, error: docInsertErr } = await supabase
    .from("documents")
    .insert({
      document_number:    "",
      name:               `Signed Envelope ${envelopeId.slice(0, 8)}.pdf`,
      document_type:      "Signed Envelope",
      category:           "envelope_signed",
      file_size_bytes:    pdfBytes.byteLength,
      mime_type:          "application/pdf",
      related_object:     envRow.env_parent_object,
      related_id:         envRow.env_parent_record_id,
      requires_signature: true,
      signed_at:          new Date().toISOString(),
      signature_status:   "Completed",
      uploaded_by:        envRow.env_owner,
      storage_bucket:     SIGNED_BUCKET,
      storage_path:       storagePath,
    })
    .select("id")
    .single()
  if (docInsertErr || !docRow) throw new Error(`Documents insert failed: ${docInsertErr?.message}`)

  return docRow.id
}

async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
  const cleaned = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "")
  const der = Uint8Array.from(atob(cleaned), c => c.charCodeAt(0))
  return await crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  )
}

function btoaBytes(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let s = ""
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(s)
}
