// =============================================================================
// signing-portal-load
//
// Public endpoint (verify_jwt = false). Recipients are not Anura users, so
// the request can't carry a Supabase JWT. The signing token in the URL IS
// the auth: a 32-byte random value tied to one envelope_recipients row.
//
// Inputs (POST JSON):
//   { env_record_number, signing_token }
//
// Outputs (200 JSON, success):
//   {
//     envelope: { id, name, subject, message, status, sent_at },
//     recipient: { id, name, email, role, order, consent_at },
//     tabs: [{ id, type, page, x, y, width, height, filled_value, filled_at }, ...],
//     pdf_signed_url: "https://...",
//     can_sign: true,
//     turn_after: null   // or { name, email, order } if it's not their turn yet
//   }
//
// Outputs (4xx, denial):
//   { error: "...", code: "expired" | "not_found" | "completed" | "wrong_turn" | "invalid" }
//
// On every successful load the function fires a Viewed event, capturing
// the requester's IP (from CF-Connecting-IP / X-Forwarded-For) and user
// agent. These join the envelope's audit trail and feed the Certificate
// of Completion.
//
// Uses the service-role key because RLS on envelopes/recipients/tabs/
// events grants `authenticated` only — public callers are anon. We
// restrict what we read (only the row matching the validated token),
// then write only to envelope_events.
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const SIGNATURES_BUCKET = "signatures"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface ReqBody {
  env_record_number: string
  signing_token:     string
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

  // ── Validate the token ──────────────────────────────────────────────
  const { data: recipient, error: recipErr } = await supabase
    .from("envelope_recipients")
    .select(`
      id, envelope_id, recipient_order, recipient_name, recipient_email,
      recipient_role, recipient_status, recipient_signed_at, recipient_declined_at,
      recipient_consent_at, recipient_token_expires_at,
      envelope:envelope_id (
        id, env_record_number, env_name, env_subject, env_message, env_unsigned_pdf_path,
        env_signed_pdf_path, status:env_status ( picklist_value )
      )
    `)
    .eq("recipient_signing_token", body.signing_token)
    .maybeSingle()
  if (recipErr) return json({ error: "Lookup failed", code: "invalid" }, 500)
  if (!recipient) return json({ error: "Token not recognized", code: "not_found" }, 404)

  const env = (recipient as any).envelope
  if (!env || env.env_record_number !== body.env_record_number)
    return json({ error: "Token does not match envelope", code: "invalid" }, 404)

  // Token expiry
  if (recipient.recipient_token_expires_at && new Date(recipient.recipient_token_expires_at) < new Date())
    return json({ error: "Signing link has expired", code: "expired" }, 410)

  // Envelope state
  const envStatus = env.status?.picklist_value
  if (envStatus === "Voided") return json({ error: "Envelope was voided", code: "completed" }, 410)
  if (envStatus === "Declined") return json({ error: "Envelope was declined by another recipient", code: "completed" }, 410)
  if (envStatus === "Failed") return json({ error: "Envelope failed to send", code: "completed" }, 410)

  // Already signed? Allow them to view, but no further action.
  const alreadySigned = !!recipient.recipient_signed_at

  // ── Determine if it's this recipient's turn ─────────────────────────
  const { data: othersAhead } = await supabase
    .from("envelope_recipients")
    .select("recipient_order, recipient_signed_at, recipient_name, recipient_email")
    .eq("envelope_id", env.id)
    .lt("recipient_order", recipient.recipient_order)
    .eq("is_deleted", false)
    .order("recipient_order", { ascending: true })

  const blocker = (othersAhead || []).find(o => !o.recipient_signed_at)
  const canSign = !alreadySigned && !blocker && envStatus !== "Completed"

  // ── Pull tabs assigned to this recipient ────────────────────────────
  const { data: tabs } = await supabase
    .from("envelope_tabs")
    .select("id, tab_type, tab_page, tab_x, tab_y, tab_width, tab_height, tab_filled_value, tab_filled_at, tab_anchor_string")
    .eq("recipient_id", recipient.id)
    .eq("is_deleted", false)
    .order("tab_page")
    .order("tab_y", { ascending: false })   // top-down on each page

  // Resolve the tab_type uuids → string values for FE consumption
  const typeIds = Array.from(new Set((tabs || []).map(t => t.tab_type).filter(Boolean)))
  const { data: typeRows } = typeIds.length
    ? await supabase.from("picklist_values").select("id, picklist_value").in("id", typeIds)
    : { data: [] as any[] }
  const typeMap = new Map<string, string>()
  for (const r of (typeRows || [])) typeMap.set(r.id, r.picklist_value)

  const tabsForFE = (tabs || []).map(t => ({
    id: t.id,
    type: typeMap.get(t.tab_type) || "text",
    page: t.tab_page,
    x: Number(t.tab_x),
    y: Number(t.tab_y),
    width: Number(t.tab_width),
    height: Number(t.tab_height),
    filled_value: t.tab_filled_value,
    filled_at: t.tab_filled_at,
    anchor_string: t.tab_anchor_string,
  }))

  // ── Choose which PDF to display ─────────────────────────────────────
  // While signing is in progress, env_signed_pdf_path holds the rolling
  // overlay. Recipient 1 sees env_unsigned_pdf_path; recipient N sees
  // env_signed_pdf_path (which has all prior recipients' overlays).
  const pdfPath = env.env_signed_pdf_path || env.env_unsigned_pdf_path
  if (!pdfPath) return json({ error: "Envelope has no rendered PDF", code: "invalid" }, 500)

  const { data: signedUrlData } = await supabase.storage
    .from(SIGNATURES_BUCKET)
    .createSignedUrl(pdfPath, 3600)

  // ── Audit: Viewed (every load fires) + Opened (first load only) ─────
  const ip = clientIp(req)
  const ua = req.headers.get("User-Agent") || null
  const standardEventRtId = await picklistId(supabase, "envelope_events", "record_type", "Standard")
  const viewedId          = await picklistId(supabase, "envelope_events", "event_type",  "Viewed")
  const openedId          = await picklistId(supabase, "envelope_events", "event_type",  "Opened")

  // Opened only on the very first load (no prior Opened event for this recipient)
  const { count: priorOpens } = await supabase
    .from("envelope_events")
    .select("id", { count: "exact", head: true })
    .eq("envelope_id", env.id)
    .eq("recipient_id", recipient.id)
    .eq("event_type", openedId)
  if ((priorOpens || 0) === 0 && openedId) {
    await supabase.from("envelope_events").insert({
      event_record_number: "",
      envelope_id: env.id,
      recipient_id: recipient.id,
      event_record_type: standardEventRtId,
      event_type: openedId,
      event_metadata: {},
      event_ip_address: ip,
      event_user_agent: ua,
    })
  }
  if (viewedId) {
    await supabase.from("envelope_events").insert({
      event_record_number: "",
      envelope_id: env.id,
      recipient_id: recipient.id,
      event_record_type: standardEventRtId,
      event_type: viewedId,
      event_metadata: {},
      event_ip_address: ip,
      event_user_agent: ua,
    })
  }

  return json({
    envelope: {
      id: env.id,
      env_record_number: env.env_record_number,
      name: env.env_name,
      subject: env.env_subject,
      message: env.env_message,
      status: envStatus,
    },
    recipient: {
      id: recipient.id,
      name: recipient.recipient_name,
      email: recipient.recipient_email,
      role: recipient.recipient_role,
      order: recipient.recipient_order,
      consent_at: recipient.recipient_consent_at,
      already_signed: alreadySigned,
      already_declined: !!recipient.recipient_declined_at,
    },
    tabs: tabsForFE,
    pdf_signed_url: signedUrlData?.signedUrl || null,
    can_sign: canSign,
    turn_after: blocker ? { name: blocker.recipient_name, order: blocker.recipient_order } : null,
  }, 200)
})

// ─── helpers ────────────────────────────────────────────────────────────

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
