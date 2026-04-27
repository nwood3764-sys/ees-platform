// =============================================================================
// docusign-send-envelope
//
// Creates a DocuSign envelope for a document_template against a parent
// record, sends it for signature, and writes the bookkeeping rows in
// `envelopes` + `envelope_recipients`.
//
// Request body:
//   {
//     document_template_id: uuid,
//     parent_object:        text,                       // e.g. "projects"
//     parent_record_id:     uuid,
//     recipients: [
//       { name: text, email: text, role?: text,
//         order: int, contact_id?: uuid }, ...
//     ],
//     subject?:    text,
//     message?:    text,
//     env_name?:   text   // defaults to "<template name> — <parent record>"
//   }
//
// Response (200): { envelope_id, env_record_number, provider_envelope_id }
// Response (4xx/5xx): { error }
//
// Flow:
//   1. Validate caller (JWT) and request shape.
//   2. Resolve the template — must be Active AND
//      dt_signature_provider = 'docusign'.
//   3. Find the latest published snapshot for this template — that's the
//      version we lock to for this envelope.
//   4. Insert envelopes row (status=Draft) + envelope_recipients rows.
//   5. Call render-document-template via internal fetch to get the merged
//      .docx binary.
//   6. JWT-grant authenticate to DocuSign, fetch /oauth/userinfo for the
//      account base_uri.
//   7. POST the envelope (status=sent) with the docx + signers + tabs.
//   8. On success: update envelopes row (status=Sent, provider ids).
//      On failure: update envelopes row (status=Failed, env_failure_reason).
//
// Anchor convention: the .docx template is expected to contain anchor
// strings like "\sig1\", "\sig2\", ... at the locations where each signer
// (in `recipients[].order` order) should sign. We attach a SignHere tab
// using anchorString = "\\sig{order}\\".
//
// Required Supabase secrets (set via supabase secrets set ...):
//   DOCUSIGN_INTEGRATION_KEY      — the GUID of the eIK
//   DOCUSIGN_USER_GUID            — the impersonated user's GUID
//   DOCUSIGN_ACCOUNT_GUID         — the API account GUID (NOT the friendly id)
//   DOCUSIGN_PRIVATE_KEY          — the RSA private key (PEM, full text incl.
//                                    BEGIN/END lines and embedded newlines)
//   DOCUSIGN_OAUTH_BASE_URL       — "account-d.docusign.com" for sandbox
//                                    "account.docusign.com" for production
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"
import { create as djwtCreate } from "https://deno.land/x/djwt@v3.0.2/mod.ts"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface Recipient {
  name:        string
  email:       string
  role?:       string
  order:       number
  contact_id?: string | null
}

interface ReqBody {
  document_template_id: string
  parent_object:        string
  parent_record_id:     string
  recipients:           Recipient[]
  subject?:             string
  message?:             string
  env_name?:            string
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  // ── Parse + validate ────────────────────────────────────────────────────
  let body: ReqBody
  try { body = await req.json() as ReqBody }
  catch { return json({ error: "Invalid JSON body" }, 400) }

  const validationError = validateBody(body)
  if (validationError) return json({ error: validationError }, 400)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")
  if (!supabaseUrl || !anonKey) {
    return json({ error: "Server misconfiguration: SUPABASE_URL or SUPABASE_ANON_KEY missing" }, 500)
  }

  const authHeader = req.headers.get("Authorization") || ""
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Missing Bearer token" }, 401)
  }
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  // Resolve caller -> public.users.id for owner / created_by
  const callerUserId = await resolveCallerUserId(supabase)
  if (!callerUserId) return json({ error: "Could not resolve caller's public.users id" }, 401)

  // ── Load template + validate state ──────────────────────────────────────
  const { data: dt, error: dtErr } = await supabase
    .from("document_templates")
    .select(`
      id, name, dt_record_number, dt_template_asset_path,
      authoring:dt_authoring_mode ( picklist_value ),
      provider:dt_signature_provider ( picklist_value ),
      status:status ( picklist_value )
    `)
    .eq("id", body.document_template_id)
    .eq("is_deleted", false)
    .maybeSingle()
  if (dtErr || !dt) return json({ error: `Template lookup failed: ${dtErr?.message || "not found"}` }, 404)

  const dtAny = dt as any
  if (dtAny.status?.picklist_value !== "Active") {
    return json({ error: `Template must be Active (currently ${dtAny.status?.picklist_value || "Draft"})` }, 400)
  }
  if (dtAny.authoring?.picklist_value !== "docx") {
    return json({ error: "Template authoring_mode must be 'docx' to send via DocuSign" }, 400)
  }
  if (dtAny.provider?.picklist_value !== "docusign") {
    return json({ error: `Template signature provider must be 'docusign' (currently ${dtAny.provider?.picklist_value || "none"})` }, 400)
  }
  if (!dt.dt_template_asset_path) {
    return json({ error: "Template has no .docx asset uploaded" }, 400)
  }

  // ── Find the latest snapshot for this dt ────────────────────────────────
  const { data: snapshot, error: snapErr } = await supabase
    .from("document_template_snapshots")
    .select("id, dtsn_version, dtsn_record_number")
    .eq("document_template_id", body.document_template_id)
    .order("dtsn_version", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (snapErr || !snapshot) {
    return json({ error: `No published snapshot found for this template — re-publish first` }, 400)
  }

  // ── Insert envelopes row in Draft ───────────────────────────────────────
  const draftStatusId    = await picklistId(supabase, "envelopes", "env_status",  "Draft")
  const docusignProvId   = await picklistId(supabase, "envelopes", "env_provider","docusign")
  const standardEnvRtId  = await picklistId(supabase, "envelopes", "record_type", "Standard")
  const standardRecRtId  = await picklistId(supabase, "envelope_recipients", "record_type",     "Standard")
  const createdRecStatId = await picklistId(supabase, "envelope_recipients", "recipient_status","Created")
  const sentStatusId     = await picklistId(supabase, "envelopes", "env_status", "Sent")
  const failedStatusId   = await picklistId(supabase, "envelopes", "env_status", "Failed")

  if (!draftStatusId || !docusignProvId || !standardEnvRtId || !standardRecRtId || !createdRecStatId || !sentStatusId || !failedStatusId) {
    return json({ error: "Picklist seed missing — envelope status/provider/record_type seed not found" }, 500)
  }

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
      env_provider: docusignProvId,
      env_owner: callerUserId,
      created_by: callerUserId,
      updated_by: callerUserId,
    })
    .select("id, env_record_number")
    .single()
  if (envInsertErr || !envelopeRow) {
    return json({ error: `Envelope insert failed: ${envInsertErr?.message}` }, 500)
  }

  // Insert recipient rows
  const recipientRows = body.recipients.map(r => ({
    recipient_record_number: "",
    envelope_id: envelopeRow.id,
    recipient_record_type: standardRecRtId,
    recipient_order: r.order,
    recipient_role: r.role || null,
    recipient_contact_id: r.contact_id || null,
    recipient_name: r.name,
    recipient_email: r.email,
    recipient_status: createdRecStatId,
    created_by: callerUserId,
    updated_by: callerUserId,
  }))
  const { error: recipErr } = await supabase.from("envelope_recipients").insert(recipientRows)
  if (recipErr) {
    return json({ error: `Recipient insert failed: ${recipErr.message}` }, 500)
  }

  // ── Render the merged docx ──────────────────────────────────────────────
  let mergedDocxB64: string
  try {
    const rendered = await fetch(`${supabaseUrl}/functions/v1/render-document-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": authHeader },
      body: JSON.stringify({
        document_template_snapshot_id: snapshot.id,
        parent_object:                 body.parent_object,
        parent_record_id:              body.parent_record_id,
      }),
    })
    if (!rendered.ok) {
      const errText = await rendered.text()
      throw new Error(`render-document-template returned ${rendered.status}: ${errText}`)
    }
    const buf = new Uint8Array(await rendered.arrayBuffer())
    mergedDocxB64 = btoaBytes(buf)
  } catch (e) {
    await markEnvelopeFailed(supabase, envelopeRow.id, failedStatusId, callerUserId, `Render failed: ${(e as Error).message}`)
    return json({ error: `Render failed: ${(e as Error).message}`, envelope_id: envelopeRow.id }, 500)
  }

  // ── DocuSign auth + envelope create ─────────────────────────────────────
  const docusignSecrets = readDocusignSecrets()
  if ("error" in docusignSecrets) {
    await markEnvelopeFailed(supabase, envelopeRow.id, failedStatusId, callerUserId, docusignSecrets.error)
    return json({ error: docusignSecrets.error, envelope_id: envelopeRow.id }, 500)
  }

  let docusignResp: { envelopeId: string, status: string, uri: string }
  try {
    const accessToken = await getDocuSignAccessToken(docusignSecrets)
    const accountInfo = await getDocuSignAccountInfo(accessToken, docusignSecrets)

    const envelopePayload = {
      emailSubject: subject,
      emailBlurb:   body.message || "",
      status:       "sent",
      documents: [{
        documentBase64: mergedDocxB64,
        name:           `${dt.name}.docx`,
        fileExtension:  "docx",
        documentId:     "1",
      }],
      recipients: {
        signers: body.recipients.map((r, idx) => ({
          email:        r.email,
          name:         r.name,
          recipientId:  String(idx + 1),
          routingOrder: String(r.order),
          roleName:     r.role || "Signer",
          tabs: {
            signHereTabs: [{
              anchorString:  `\\sig${r.order}\\`,
              anchorXOffset: "0",
              anchorYOffset: "0",
              anchorUnits:   "pixels",
              anchorIgnoreIfNotPresent: "true",
            }],
          },
        })),
      },
    }

    const resp = await fetch(
      `${accountInfo.baseUri}/restapi/v2.1/accounts/${docusignSecrets.accountGuid}/envelopes`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify(envelopePayload),
      },
    )
    const respBody = await resp.text()
    if (!resp.ok) {
      throw new Error(`DocuSign envelope create returned ${resp.status}: ${respBody}`)
    }
    docusignResp = JSON.parse(respBody)
  } catch (e) {
    await markEnvelopeFailed(supabase, envelopeRow.id, failedStatusId, callerUserId, `DocuSign send failed: ${(e as Error).message}`)
    return json({ error: `DocuSign send failed: ${(e as Error).message}`, envelope_id: envelopeRow.id }, 500)
  }

  // ── Update envelopes row to Sent ────────────────────────────────────────
  const { error: updateErr } = await supabase
    .from("envelopes")
    .update({
      env_status:                sentStatusId,
      env_sent_at:               new Date().toISOString(),
      env_provider_envelope_id:  docusignResp.envelopeId,
      env_provider_envelope_uri: docusignResp.uri,
      env_provider_account_id:   docusignSecrets.accountGuid,
      updated_by:                callerUserId,
    })
    .eq("id", envelopeRow.id)
  if (updateErr) {
    // Envelope was sent successfully but we couldn't write back the
    // bookkeeping. Surface but don't roll back DocuSign.
    return json({
      error: `Envelope sent but DB update failed: ${updateErr.message}`,
      envelope_id: envelopeRow.id,
      provider_envelope_id: docusignResp.envelopeId,
    }, 500)
  }

  return json({
    envelope_id:           envelopeRow.id,
    env_record_number:     envelopeRow.env_record_number,
    provider_envelope_id:  docusignResp.envelopeId,
    provider_envelope_uri: docusignResp.uri,
    status:                "Sent",
  }, 200)
})

// ─── Validation ─────────────────────────────────────────────────────────

function validateBody(b: ReqBody): string | null {
  if (!b.document_template_id) return "document_template_id required"
  if (!b.parent_object)        return "parent_object required"
  if (!b.parent_record_id)     return "parent_record_id required"
  if (!Array.isArray(b.recipients) || b.recipients.length === 0) return "recipients[] required"
  for (const r of b.recipients) {
    if (!r.name || !r.email)     return "each recipient needs name + email"
    if (!Number.isInteger(r.order) || r.order < 1) return "each recipient needs an integer order >= 1"
  }
  // Orders must be unique
  const orders = new Set(b.recipients.map(r => r.order))
  if (orders.size !== b.recipients.length) return "recipient.order values must be unique"
  return null
}

// ─── Caller resolution ──────────────────────────────────────────────────

async function resolveCallerUserId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.rpc("current_app_user_id")
  if (error || !data) return null
  return data as string
}

// ─── Picklist helpers ───────────────────────────────────────────────────

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

// ─── Envelope failure helper ────────────────────────────────────────────

async function markEnvelopeFailed(
  supabase: SupabaseClient,
  envelopeId: string,
  failedStatusId: string,
  callerUserId: string,
  reason: string,
): Promise<void> {
  await supabase
    .from("envelopes")
    .update({
      env_status:         failedStatusId,
      env_failed_at:      new Date().toISOString(),
      env_failure_reason: reason.slice(0, 2000),
      updated_by:         callerUserId,
    })
    .eq("id", envelopeId)
}

// ─── DocuSign auth ──────────────────────────────────────────────────────

interface DocuSignSecrets {
  integrationKey: string
  userGuid:       string
  accountGuid:    string
  privateKeyPem:  string
  oauthHost:      string  // "account-d.docusign.com" or "account.docusign.com"
}

function readDocusignSecrets(): DocuSignSecrets | { error: string } {
  const integrationKey = Deno.env.get("DOCUSIGN_INTEGRATION_KEY")
  const userGuid       = Deno.env.get("DOCUSIGN_USER_GUID")
  const accountGuid    = Deno.env.get("DOCUSIGN_ACCOUNT_GUID")
  const privateKeyPem  = Deno.env.get("DOCUSIGN_PRIVATE_KEY")
  const oauthHost      = Deno.env.get("DOCUSIGN_OAUTH_BASE_URL")

  const missing: string[] = []
  if (!integrationKey) missing.push("DOCUSIGN_INTEGRATION_KEY")
  if (!userGuid)       missing.push("DOCUSIGN_USER_GUID")
  if (!accountGuid)    missing.push("DOCUSIGN_ACCOUNT_GUID")
  if (!privateKeyPem)  missing.push("DOCUSIGN_PRIVATE_KEY")
  if (!oauthHost)      missing.push("DOCUSIGN_OAUTH_BASE_URL")
  if (missing.length) return { error: `Missing DocuSign secrets: ${missing.join(", ")}` }

  return {
    integrationKey: integrationKey!,
    userGuid:       userGuid!,
    accountGuid:    accountGuid!,
    privateKeyPem:  privateKeyPem!,
    oauthHost:      oauthHost!,
  }
}

// JWT-grant flow: build a JWT signed with our RSA private key, exchange
// at /oauth/token for an access_token. The access_token is good for ~1
// hour but we only need it for the lifetime of this request.
async function getDocuSignAccessToken(s: DocuSignSecrets): Promise<string> {
  const key = await importRsaPrivateKey(s.privateKeyPem)
  const now = Math.floor(Date.now() / 1000)
  const jwt = await djwtCreate(
    { alg: "RS256", typ: "JWT" },
    {
      iss:   s.integrationKey,
      sub:   s.userGuid,
      aud:   s.oauthHost,
      iat:   now,
      exp:   now + 3600,
      scope: "signature impersonation",
    },
    key,
  )

  const resp = await fetch(`https://${s.oauthHost}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:  jwt,
    }),
  })
  const respText = await resp.text()
  if (!resp.ok) {
    // 'consent_required' means the user hasn't granted impersonation
    // consent yet — ship the consent URL in the error so the operator
    // can fix it without digging through DocuSign docs.
    if (respText.includes("consent_required")) {
      throw new Error(
        `DocuSign consent required. Visit https://${s.oauthHost}/oauth/auth?` +
        `response_type=code&scope=signature+impersonation&` +
        `client_id=${s.integrationKey}&redirect_uri=https://www.docusign.com` +
        ` and grant consent for the impersonated user.`
      )
    }
    throw new Error(`DocuSign /oauth/token returned ${resp.status}: ${respText}`)
  }
  const parsed = JSON.parse(respText)
  return parsed.access_token as string
}

async function getDocuSignAccountInfo(
  accessToken: string,
  s: DocuSignSecrets,
): Promise<{ baseUri: string }> {
  const resp = await fetch(`https://${s.oauthHost}/oauth/userinfo`, {
    headers: { "Authorization": `Bearer ${accessToken}` },
  })
  if (!resp.ok) throw new Error(`DocuSign /oauth/userinfo returned ${resp.status}: ${await resp.text()}`)
  const data = await resp.json()
  const account = (data.accounts || []).find((a: any) => a.account_id === s.accountGuid)
  if (!account) throw new Error(`DocuSign account ${s.accountGuid} not in /oauth/userinfo response`)
  return { baseUri: account.base_uri as string }
}

async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
  // Strip PEM armor + whitespace, base64-decode, then importKey as PKCS8
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

// ─── Misc helpers ───────────────────────────────────────────────────────

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

// Base64-encode a Uint8Array. btoa() takes a binary string, so we chunk
// the bytes through String.fromCharCode to avoid a giant single-call
// stack frame for large docs.
function btoaBytes(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let s = ""
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(s)
}
