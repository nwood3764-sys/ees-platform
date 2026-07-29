// =============================================================================
// service-provider-intake — public (anonymous) service-provider signup.
//
// Called by the LEAP public intake form (/provider-signup). Uploads the W-9 to
// the private `service-provider-documents` bucket (service role), then calls the
// transactional RPC create_service_provider_application() which lands the
// submission as an inactive Service Provider account + contact + application +
// ZIP service areas. Returns { ok, application_number }.
//
// verify_jwt default (true): callers present the public anon key, which is a
// valid anon JWT; the function itself does all writes with the service role.
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const MAX_DOC_BYTES = 10 * 1024 * 1024 // 10 MB
const ALLOWED_DOC_MIME = ["application/pdf", "image/jpeg", "image/png", "image/heic"]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}

function sanitizeFileName(name: string, fallback = "file"): string {
  return (name || fallback).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120)
}

// Decode + validate + upload one base64 document to the private bucket.
// Returns document metadata for the RPC, or a Response on error.
async function uploadDoc(
  supabase: ReturnType<typeof createClient>,
  doc: { file_name?: string; mime_type?: string; base64?: string } | undefined,
  kind: string,
): Promise<Record<string, unknown> | null | Response> {
  if (!doc || typeof doc.base64 !== "string" || doc.base64.length === 0) return null
  const mime = String(doc.mime_type || "application/pdf")
  if (!ALLOWED_DOC_MIME.includes(mime)) return json({ ok: false, error: `${kind} must be a PDF or image.` }, 400)
  let bytes: Uint8Array
  try {
    const raw = doc.base64.includes(",") ? doc.base64.split(",")[1] : doc.base64
    const bin = atob(raw)
    bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  } catch { return json({ ok: false, error: `Could not read the ${kind} file.` }, 400) }
  if (bytes.length > MAX_DOC_BYTES) return json({ ok: false, error: `${kind} file is too large (max 10 MB).` }, 400)

  const bucket = "service-provider-documents"
  const safe = sanitizeFileName(String(doc.file_name || kind), kind)
  const path = `applications/${crypto.randomUUID()}/${safe}`
  const up = await supabase.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: false })
  if (up.error) return json({ ok: false, error: `${kind} upload failed: ${up.error.message}` }, 500)
  return { storage_bucket: bucket, storage_path: path, mime_type: mime, file_size_bytes: bytes.length, file_name: safe }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ ok: false, error: "Invalid JSON body" }, 400) }

  // Honeypot — a hidden field bots fill in. Pretend success, create nothing.
  if (typeof body.company_url === "string" && body.company_url.trim() !== "") {
    return json({ ok: true, application_number: null })
  }

  const company = String(body.company_legal_name ?? "").trim()
  const contactEmail = String(body.contact_email ?? "").trim()
  const businessEmail = String(body.business_email ?? "").trim()
  if (!company) return json({ ok: false, error: "Company legal name is required." }, 400)
  if (!contactEmail && !businessEmail) return json({ ok: false, error: "An email address is required." }, 400)

  const supabaseUrl    = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: "Server misconfiguration" }, 500)
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // Optional document uploads (base64) -> private bucket
  const w9res = await uploadDoc(supabase, body.w9 as never, "W-9")
  if (w9res instanceof Response) return w9res
  const w9meta = w9res
  const coires = await uploadDoc(supabase, body.coi as never, "Certificate of insurance")
  if (coires instanceof Response) {
    if (w9meta) await supabase.storage.from("service-provider-documents").remove([String(w9meta.storage_path)]).catch(() => undefined)
    return coires
  }
  const coimeta = coires

  // Assemble the RPC payload from whitelisted fields only.
  const F = (k: string) => (typeof body[k] === "string" ? String(body[k]).trim() : undefined)
  const zipCodes = Array.isArray(body.zip_codes)
    ? (body.zip_codes as unknown[]).map((z) => String(z).trim()).filter(Boolean).slice(0, 2000)
    : []
  const tradeTypes = Array.isArray(body.service_provider_types)
    ? (body.service_provider_types as unknown[]).map((t) => String(t).trim()).filter(Boolean).slice(0, 12)
    : []

  const payload: Record<string, unknown> = {
    source: "Public Intake Site",
    company_legal_name: company,
    dba_name: F("dba_name"),
    service_provider_type: F("service_provider_type"),
    service_provider_types: tradeTypes,
    entity_type: F("entity_type"),
    home_state: F("home_state") || "NC",
    business_phone: F("business_phone"),
    business_email: businessEmail || undefined,
    website: F("website"),
    address_street: F("address_street"),
    address_city: F("address_city"),
    address_state: F("address_state"),
    address_zip: F("address_zip"),
    number_of_employees: F("number_of_employees"),
    contact_first_name: F("contact_first_name"),
    contact_last_name: F("contact_last_name"),
    contact_title: F("contact_title"),
    contact_email: contactEmail || undefined,
    contact_phone: F("contact_phone"),
    license_number: F("license_number"),
    license_type: F("license_type"),
    license_state: F("license_state"),
    license_expiration_date: F("license_expiration_date"),
    gl_carrier: F("gl_carrier"),
    gl_policy_number: F("gl_policy_number"),
    gl_expiration_date: F("gl_expiration_date"),
    wc_carrier: F("wc_carrier"),
    wc_policy_number: F("wc_policy_number"),
    wc_expiration_date: F("wc_expiration_date"),
    notes: F("notes"),
    zip_codes: zipCodes,
    w9: w9meta,
    coi: coimeta,
  }

  const { data, error } = await supabase.rpc("create_service_provider_application", { p_payload: payload })
  if (error) {
    // Clean up orphaned uploads if the cascade failed.
    const orphans = [w9meta, coimeta].filter(Boolean).map((m) => String((m as Record<string, unknown>).storage_path))
    if (orphans.length) await supabase.storage.from("service-provider-documents").remove(orphans).catch(() => undefined)
    return json({ ok: false, error: error.message }, 500)
  }
  return json({ ok: true, application_number: (data as { application_number?: string })?.application_number ?? null })
})
