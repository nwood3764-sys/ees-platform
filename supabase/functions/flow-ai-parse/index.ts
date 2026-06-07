// ─── flow-ai-parse ────────────────────────────────────────────────────────
// Parses a contact image (email signature screenshot, business card photo)
// into structured contact fields using the Anthropic vision API. Powers the
// contact-intake guided flow's first step.
//
// Flow:
//   1. Verify caller is a registered LEAP user (audit + cost attribution).
//   2. Call Anthropic messages API (claude vision) with the image + a strict
//      JSON-only extraction prompt.
//   3. Parse the returned JSON, log token usage + estimated cost to
//      flow_ai_usage, return the parsed fields to the client.
//
// Mock mode (no ANTHROPIC_API_KEY set): returns an empty field set with a
// note, logs a zero-cost usage row marked 'mock'. Lets the guided flow work
// (manual entry) before the key is provisioned; the parse step lights up the
// moment the secret exists.
//
// Auth: caller JWT decoded for auth.uid → public.users.id. Writes use the
// service role. The key is read at runtime from the edge secret; it is never
// returned to the client.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Model + pricing. Pricing in USD per million tokens; update if Anthropic
// pricing changes. Used only for the cost-visibility report, not billing.
const MODEL = "claude-sonnet-4-20250514"
const PRICE_INPUT_PER_MTOK  = 3.00
const PRICE_OUTPUT_PER_MTOK = 15.00

interface ReqBody {
  image_base64?: string   // raw base64 (no data: prefix)
  image_mime?:   string   // image/png | image/jpeg | image/webp
  raw_text?:     string   // alternative: paste of an email signature etc.
  flow_id?:      string
  run_id?:       string
}

// The contact shape we ask the model to extract. Kept deliberately flat and
// mapped to contacts columns client-side in the guided flow.
const EXTRACTION_PROMPT = `You extract contact details from an image or text of a business card or email signature.
Return ONLY a JSON object, no prose, no markdown fences. Use this exact shape, using null for anything not present:
{
  "first_name": null,
  "last_name": null,
  "title": null,
  "company": null,
  "email": null,
  "phone": null,
  "mobile": null,
  "website": null,
  "street": null,
  "city": null,
  "state": null,
  "postal_code": null,
  "notes": null
}
Rules: Do not invent values. If a field is not clearly present, use null. For phone vs mobile, put a number labeled cell/mobile in "mobile" and a main/office number in "phone". State should be the 2-letter US code if determinable. Put anything useful that doesn't fit a field into "notes".`

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json({ error: "POST only" }, 405)

  let body: ReqBody
  try { body = await req.json() } catch { return json({ error: "Invalid JSON body" }, 400) }

  if (!body.image_base64 && !body.raw_text) {
    return json({ error: "Provide image_base64 (with image_mime) or raw_text" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const apiKey      = Deno.env.get("ANTHROPIC_API_KEY")
  if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfiguration: Supabase keys missing" }, 500)

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const authHeader = req.headers.get("Authorization") || ""
  const callerUserId = await resolveCallerUserId(admin, authHeader)
  if (!callerUserId) return json({ error: "Caller is not a registered LEAP user" }, 401)

  // ── Mock mode: no key yet ────────────────────────────────────────────────
  if (!apiKey) {
    await logUsage(admin, {
      userId: callerUserId, flowId: body.flow_id, runId: body.run_id,
      model: "mock", inTok: 0, outTok: 0, cost: 0,
      outcome: "ok", message: "mock mode — ANTHROPIC_API_KEY not set",
    })
    return json({
      mock: true,
      note: "AI parsing is not active yet (API key not configured). Enter the contact details manually.",
      fields: emptyFields(),
    })
  }

  // ── Build Anthropic request content ──────────────────────────────────────
  const content: unknown[] = []
  if (body.image_base64) {
    const mime = body.image_mime || "image/png"
    content.push({
      type: "image",
      source: { type: "base64", media_type: mime, data: body.image_base64 },
    })
  }
  content.push({
    type: "text",
    text: body.raw_text
      ? `${EXTRACTION_PROMPT}\n\nText to extract from:\n${body.raw_text}`
      : EXTRACTION_PROMPT,
  })

  let parsed: Record<string, unknown> | null = null
  let inTok = 0, outTok = 0

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content }],
      }),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      await logUsage(admin, {
        userId: callerUserId, flowId: body.flow_id, runId: body.run_id,
        model: MODEL, inTok: 0, outTok: 0, cost: 0,
        outcome: "error", message: `Anthropic API ${resp.status}: ${errText.slice(0, 300)}`,
      })
      return json({ error: `AI parse failed (${resp.status}). Enter details manually.`, detail: errText.slice(0, 300) }, 502)
    }

    const data = await resp.json()
    inTok  = data?.usage?.input_tokens  ?? 0
    outTok = data?.usage?.output_tokens ?? 0

    // Concatenate text blocks, strip any stray fences, parse JSON.
    const text = (data?.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim()
    try { parsed = JSON.parse(text) } catch { parsed = null }
  } catch (e) {
    await logUsage(admin, {
      userId: callerUserId, flowId: body.flow_id, runId: body.run_id,
      model: MODEL, inTok: 0, outTok: 0, cost: 0,
      outcome: "error", message: `Request error: ${(e as Error).message}`,
    })
    return json({ error: "AI parse request failed. Enter details manually." }, 502)
  }

  const cost = (inTok / 1_000_000) * PRICE_INPUT_PER_MTOK
             + (outTok / 1_000_000) * PRICE_OUTPUT_PER_MTOK

  await logUsage(admin, {
    userId: callerUserId, flowId: body.flow_id, runId: body.run_id,
    model: MODEL, inTok, outTok, cost,
    outcome: parsed ? "ok" : "error",
    message: parsed ? null : "Model returned unparseable output",
  })

  if (!parsed) {
    return json({ error: "AI returned an unreadable result. Enter details manually.", fields: emptyFields() }, 200)
  }

  // Merge onto the canonical empty shape so missing keys are always present.
  const fields = { ...emptyFields(), ...parsed }
  return json({ mock: false, fields, usage: { input_tokens: inTok, output_tokens: outTok, estimated_cost_usd: cost } })
})

function emptyFields() {
  return {
    first_name: null, last_name: null, title: null, company: null,
    email: null, phone: null, mobile: null, website: null,
    street: null, city: null, state: null, postal_code: null, notes: null,
  }
}

interface UsageLog {
  userId: string; flowId?: string; runId?: string
  model: string; inTok: number; outTok: number; cost: number
  outcome: string; message: string | null
}

async function logUsage(admin: SupabaseClient, u: UsageLog) {
  try {
    await admin.from("flow_ai_usage").insert({
      fau_record_number: "",
      fau_user_id: u.userId,
      fau_flow_id: u.flowId || null,
      fau_run_id: u.runId || null,
      fau_purpose: "contact_parse",
      fau_model: u.model,
      fau_input_tokens: u.inTok,
      fau_output_tokens: u.outTok,
      fau_estimated_cost_usd: u.cost,
      fau_outcome: u.outcome,
      fau_outcome_message: u.message,
    })
  } catch {
    // Usage logging must never break the parse response.
  }
}

async function resolveCallerUserId(admin: SupabaseClient, authHeader: string): Promise<string | null> {
  if (!authHeader.startsWith("Bearer ")) return null
  const jwt = authHeader.slice(7)
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
