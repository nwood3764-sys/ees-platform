// =============================================================================
// import-prospecting-properties
//
// Bulk-import endpoint for the Prospecting module. Wraps the
// import_property_batch(text, jsonb, uuid) RPC with auth + JSON
// validation. The RPC does all the heavy lifting in a single
// transaction:
//
//   - Accounts: match-or-create by account_hud_participant_number
//   - Properties: match-or-create by property_hud_property_id or
//     property_lihtc_project_id; UPDATE overlays non-null incoming
//     fields only
//   - property_source_data: UPSERT keyed by psd_property_id
//   - property_disaster_exposure: UPSERT when fema_* keys present
//   - property_import_batches: one row per call, status flipped
//     to completed / completed_with_errors at the end
//
// Authenticated users only (verify_jwt=true). Caller's auth.uid is
// translated to public.users.id and used as the owner for every
// created record.
//
// Request body:
//   {
//     "source_dataset": "HUD_ACTIVE_PORTFOLIO" | "HUD_LIHTC" |
//                       "HUD_MULTIFAMILY_CONTRACTS" | "DOE_LEAD" |
//                       <other>,
//     "records": [ { ... }, ... ]   // see import_property_batch RPC
//                                    // for the per-record shape
//   }
//
// Responses:
//   200 { ok: true,  summary: <RPC result jsonb> }
//   400 { ok: false, error: "<validation message>" }
//   401 { ok: false, error: "Caller is not a registered LEAP user" }
//   500 { ok: false, error: "<server error>" }
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const KNOWN_DATASETS = new Set([
  "HUD_ACTIVE_PORTFOLIO",
  "HUD_LIHTC",
  "HUD_MULTIFAMILY_CONTRACTS",
  "DOE_LEAD",
  "MANUAL",
])

const MAX_RECORDS_PER_CALL = 5000

interface ReqBody {
  source_dataset: string
  records: Array<Record<string, unknown>>
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

function validateRequest(body: any): string | null {
  if (!body || typeof body !== "object") return "Body must be a JSON object"
  if (typeof body.source_dataset !== "string" || body.source_dataset.length === 0) {
    return "source_dataset is required"
  }
  if (!KNOWN_DATASETS.has(body.source_dataset)) {
    return `Unknown source_dataset: ${body.source_dataset}. Known: ${[...KNOWN_DATASETS].join(", ")}`
  }
  if (!Array.isArray(body.records)) {
    return "records must be an array"
  }
  if (body.records.length === 0) {
    return "records must contain at least one row"
  }
  if (body.records.length > MAX_RECORDS_PER_CALL) {
    return `records exceeds the per-call cap of ${MAX_RECORDS_PER_CALL}; split into multiple batches`
  }
  return null
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors })
  if (req.method !== "POST")    return json({ ok: false, error: "Method not allowed" }, 405)

  let body: ReqBody
  try { body = await req.json() as ReqBody }
  catch { return json({ ok: false, error: "Invalid JSON body" }, 400) }

  const vErr = validateRequest(body)
  if (vErr) return json({ ok: false, error: vErr }, 400)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Server misconfiguration: Supabase keys missing" }, 500)
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const authHeader   = req.headers.get("Authorization") || ""
  const callerUserId = await resolveCallerUserId(admin, authHeader)
  if (!callerUserId) {
    return json({ ok: false, error: "Caller is not a registered LEAP user" }, 401)
  }

  try {
    const { data, error } = await admin.rpc("import_property_batch", {
      p_source_dataset: body.source_dataset,
      p_records:        body.records,
      p_owner_user_id:  callerUserId,
    })
    if (error) {
      return json({ ok: false, error: `Import RPC failed: ${error.message}` }, 500)
    }
    return json({ ok: true, summary: data })
  } catch (e) {
    return json({ ok: false, error: `Import RPC threw: ${(e as Error).message}` }, 500)
  }
})
