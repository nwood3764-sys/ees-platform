// =============================================================================
// render-document-template
//
// Merges a document_templates .docx asset with data from a parent record
// (project, property, opportunity, etc.) and returns the resulting docx
// binary. Powers two flows:
//
//   1. Preview — author iterating on a docx template wants to see what it
//      looks like with real data filled in. POST { document_template_id,
//      parent_object, parent_record_id, preview: true } and a docx blob
//      comes back for download.
//   2. Send-for-signature — the send-envelope function calls us internally
//      to get the merged docx, which it then converts to PDF (via mammoth
//      → pdf-lib) and stores as the envelope's unsigned PDF. In this mode
//      we resolve the template via document_template_snapshot_id (the
//      snapshot pinned at envelope send time) so the merged content
//      reflects exactly what was Active when the envelope was created.
//
// Template resolution order:
//   1. document_template_snapshot_id → load from document_template_snapshots
//      (frozen JSON; bypasses Active-only gate since the snapshot WAS
//      Active when published; uses dtsn_template_asset_path)
//   2. document_template_id → live row, must be Active (or preview=true
//      bypasses the gate)
//
// Authoring-mode requirement: only docx-mode templates render here. HTML-
// mode templates render via the body_html → pdf-lib path inside the
// send-envelope function — they don't go through docxtemplater because
// the body is already in HTML, ready for the PDF pipeline.
//
// All authentication piggybacks on the caller's JWT (verify_jwt = true).
// RLS already grants `authenticated` SELECT on every table we read here.
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"
import Docxtemplater from "npm:docxtemplater@3.50.0"
import PizZip from "npm:pizzip@3.1.7"

const TEMPLATE_BUCKET = "templates"
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

// CORS
const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface ReqBody {
  document_template_id?:          string
  document_template_snapshot_id?: string
  parent_object:                  string
  parent_record_id:               string
  preview?:                       boolean
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") {
    return json({ error: "POST required" }, 405)
  }

  let body: ReqBody
  try {
    body = await req.json() as ReqBody
  } catch {
    return json({ error: "Invalid JSON body" }, 400)
  }

  if (!body.parent_object || !body.parent_record_id) {
    return json({ error: "parent_object and parent_record_id are required" }, 400)
  }
  if (!body.document_template_id && !body.document_template_snapshot_id) {
    return json({ error: "either document_template_id or document_template_snapshot_id is required" }, 400)
  }

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

  // ── Resolve the template (snapshot first, else live row) ─────────────────
  let assetPath:    string | null = null
  let templateName: string        = "document"
  let authoringMode:string | null = null

  if (body.document_template_snapshot_id) {
    const { data, error } = await supabase
      .from("document_template_snapshots")
      .select(`
        dtsn_template_asset_path,
        dtsn_template_json,
        authoring:dtsn_authoring_mode ( picklist_value )
      `)
      .eq("id", body.document_template_snapshot_id)
      .maybeSingle()
    if (error)         return json({ error: `Snapshot lookup failed: ${error.message}` }, 500)
    if (!data)         return json({ error: "Snapshot not found" }, 404)
    assetPath     = data.dtsn_template_asset_path
    authoringMode = (data as any).authoring?.picklist_value || null
    templateName  = (data as any).dtsn_template_json?.name || templateName
  } else {
    const { data, error } = await supabase
      .from("document_templates")
      .select(`
        name, dt_template_asset_path,
        authoring:dt_authoring_mode ( picklist_value ),
        status:status ( picklist_value )
      `)
      .eq("id", body.document_template_id!)
      .eq("is_deleted", false)
      .maybeSingle()
    if (error)  return json({ error: `Template lookup failed: ${error.message}` }, 500)
    if (!data)  return json({ error: "Template not found" }, 404)
    const statusValue = (data as any).status?.picklist_value
    if (!body.preview && statusValue !== "Active") {
      return json({ error: `Template is ${statusValue}, must be Active to render (preview: true bypasses)` }, 400)
    }
    assetPath     = data.dt_template_asset_path
    authoringMode = (data as any).authoring?.picklist_value || null
    templateName  = data.name || templateName
  }

  if (authoringMode !== "docx") {
    return json({ error: `Template authoring_mode is '${authoringMode}', must be 'docx'` }, 400)
  }
  if (!assetPath) {
    return json({ error: "Template has no .docx asset uploaded" }, 400)
  }

  // ── Download the asset ───────────────────────────────────────────────────
  const { data: assetBlob, error: assetErr } = await supabase
    .storage.from(TEMPLATE_BUCKET).download(assetPath)
  if (assetErr || !assetBlob) {
    return json({ error: `Asset download failed: ${assetErr?.message || "unknown"}` }, 500)
  }
  const assetBytes = await assetBlob.arrayBuffer()

  // ── Load the parent record + build a merge dictionary ────────────────────
  // V1: only the parent row's own columns. The merge dictionary is keyed by
  // {parent_object_singular}.{column} so the existing FE merge picker
  // syntax ({{property.name}}, {{project.project_name}}, etc.) resolves.
  // Future extensions will walk FK relationships one hop, then deeper.
  const dict: Record<string, any> = {}
  try {
    const { data: parentRow, error: parentErr } = await supabase
      .from(body.parent_object)
      .select("*")
      .eq("id", body.parent_record_id)
      .maybeSingle()
    if (parentErr) {
      return json({ error: `Parent record lookup failed: ${parentErr.message}` }, 500)
    }
    if (!parentRow) {
      return json({ error: "Parent record not found" }, 404)
    }
    const root = singularize(body.parent_object)
    dict[root] = await resolveRowForMerge(supabase, parentRow)
  } catch (e) {
    return json({ error: `Merge data assembly failed: ${(e as Error).message}` }, 500)
  }

  // System merge fields — always present
  const now = new Date()
  dict.today = {
    iso:   now.toISOString().slice(0, 10),
    short: now.toLocaleDateString("en-US"),
    long:  now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  }
  dict.template = { name: templateName }

  // ── Render with docxtemplater ────────────────────────────────────────────
  let renderedBuffer: Uint8Array
  try {
    const zip = new PizZip(assetBytes)
    const doc = new Docxtemplater(zip, {
      delimiters:    { start: "{{", end: "}}" },
      paragraphLoop: true,
      linebreaks:    true,
      // Unknown placeholders render as the original token so authors can
      // see what was missed instead of getting a silent blank.
      nullGetter: (part: any) => `[unknown: {{${part.value}}}]`,
    })
    doc.render(dict)
    renderedBuffer = doc.getZip().generate({ type: "uint8array" })
  } catch (e) {
    return json({ error: `Docx render failed: ${(e as Error).message}` }, 500)
  }

  return new Response(renderedBuffer, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type":        DOCX_MIME,
      "Content-Disposition": `attachment; filename="${safeFilename(templateName)}.docx"`,
    },
  })
})

// ─── helpers ────────────────────────────────────────────────────────────

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

function safeFilename(name: string): string {
  return (name || "document")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 100)
}

// Pluralize-aware singular conversion. Anura table names follow Salesforce
// pluralization (properties → property, opportunities → opportunity,
// projects → project). For irregular plurals we fall back to stripping a
// trailing 's'. The keys here cover everything currently exposed via the
// merge field picker.
function singularize(plural: string): string {
  const map: Record<string, string> = {
    properties: "property",
    opportunities: "opportunity",
    accounts: "account",
    contacts: "contact",
    projects: "project",
    work_orders: "work_order",
    work_steps: "work_step",
    buildings: "building",
    units: "unit",
    incentive_applications: "incentive_application",
    payment_receipts: "payment_receipt",
    project_payment_requests: "project_payment_request",
    assessments: "assessment",
    programs: "program",
    work_types: "work_type",
  }
  if (plural in map) return map[plural]
  if (plural.endsWith("ies")) return plural.slice(0, -3) + "y"
  if (plural.endsWith("s"))   return plural.slice(0, -1)
  return plural
}

// Resolve a row's uuid columns to readable values: picklist uuids → labels,
// user uuids → "First Last", contact uuids → contact name. Other columns
// pass through unchanged. Result is a flat object suitable for docxtemplater.
async function resolveRowForMerge(supabase: any, row: Record<string, any>): Promise<Record<string, any>> {
  const out: Record<string, any> = { ...row }

  // Find uuid-shaped string values
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const uuidValues = new Set<string>()
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "string" && uuidRe.test(v) && k !== "id") uuidValues.add(v)
  }

  if (uuidValues.size === 0) return out

  // Bulk lookup picklist labels and user names
  const ids = Array.from(uuidValues)
  const [picklistRes, usersRes] = await Promise.all([
    supabase.from("picklist_values").select("id, picklist_label, picklist_value").in("id", ids),
    supabase.from("users").select("id, first_name, last_name").in("id", ids),
  ])
  const picklistMap = new Map<string, string>()
  for (const p of (picklistRes.data || [])) {
    picklistMap.set(p.id, p.picklist_label || p.picklist_value || "")
  }
  const userMap = new Map<string, string>()
  for (const u of (usersRes.data || [])) {
    const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim()
    if (full) userMap.set(u.id, full)
  }

  for (const [k, v] of Object.entries(row)) {
    if (typeof v !== "string" || !uuidRe.test(v) || k === "id") continue
    if (picklistMap.has(v))   out[k] = picklistMap.get(v)
    else if (userMap.has(v))  out[k] = userMap.get(v)
    // Otherwise leave the uuid as-is (could be a lookup to another business
    // table we haven't resolved yet — extension territory)
  }
  return out
}
