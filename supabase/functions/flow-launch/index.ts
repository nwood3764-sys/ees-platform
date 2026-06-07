// ─── flow-launch ──────────────────────────────────────────────────────────
// External entry point for launching a guided flow from outside the LEAP SPA —
// specifically the Outlook add-in for the contact-intake flow. The add-in
// POSTs the selected message's sender block (or an attached business card
// image) here; this function verifies the caller, creates a pending flow_run,
// optionally pre-parses the payload via flow-ai-parse, and returns a launch
// token + deep link the user opens in LEAP to finish the guided interview.
//
// The add-in itself (manifest + taskpane) is deployed to the M365 tenant
// separately. This endpoint is the contract it targets.
//
// Auth: same JWT → public.users.id resolution as the rest of the platform.
// The add-in obtains a LEAP session token via the standard auth flow before
// calling this.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface ReqBody {
  flow_key?:     string   // logical key of the flow to launch; defaults to contact-intake
  image_base64?: string
  image_mime?:   string
  raw_text?:     string   // e.g. the pasted sender signature block
  source?:       string   // 'outlook' | 'web' | etc. (audit only)
}

const DEFAULT_FLOW_NAME = "Contact Intake"

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfiguration" }, 500)

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const authHeader = req.headers.get("Authorization") || ""
  const callerUserId = await resolveCallerUserId(admin, authHeader)
  if (!callerUserId) return json({ error: "Caller is not a registered LEAP user" }, 401)

  // Resolve the target flow (active screen flow by name).
  const { data: flow, error: flowErr } = await admin
    .from("flows")
    .select("id, flow_name, flow_type, flow_status, flow_active_version_id")
    .eq("flow_name", DEFAULT_FLOW_NAME)
    .eq("flow_type", "screen")
    .eq("is_deleted", false)
    .maybeSingle()
  if (flowErr) return json({ error: `Flow lookup failed: ${flowErr.message}` }, 500)
  if (!flow)   return json({ error: `Flow "${DEFAULT_FLOW_NAME}" not found or not published` }, 404)

  // Create a pending run the SPA will hydrate when the user opens the link.
  const { data: run, error: runErr } = await admin
    .from("flow_runs")
    .insert({
      fr_record_number: "",
      fr_flow_id: flow.id,
      fr_flow_version_id: flow.flow_active_version_id,
      fr_flow_type: "screen",
      fr_status: "in_progress",
      fr_trigger_event: "launch",
      fr_context: { source: body.source || "outlook", launched_at: new Date().toISOString() },
      owner_id: callerUserId,
      created_by: callerUserId,
    })
    .select("id, fr_record_number")
    .maybeSingle()
  if (runErr) return json({ error: `Could not create flow run: ${runErr.message}` }, 500)

  // Optionally pre-parse the payload now so the SPA opens with fields filled.
  let parsed: unknown = null
  if (body.image_base64 || body.raw_text) {
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/flow-ai-parse`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          image_base64: body.image_base64,
          image_mime: body.image_mime,
          raw_text: body.raw_text,
          flow_id: flow.id,
          run_id: run?.id,
        }),
      })
      if (resp.ok) parsed = await resp.json()
    } catch {
      // Non-fatal: SPA can re-parse or accept manual entry.
    }
  }

  return json({
    ok: true,
    flow_id: flow.id,
    run_id: run?.id,
    run_number: run?.fr_record_number,
    // Deep link the add-in opens; the SPA route hydrates the pending run.
    launch_url: `/flow/run/${flow.id}?run=${run?.id}`,
    prefill: parsed,
  })
})

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
      .from("users").select("id").eq("auth_user_id", authUserId).maybeSingle()
    return u?.id || null
  } catch {
    return null
  }
}
