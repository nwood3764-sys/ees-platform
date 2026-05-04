// =============================================================================
// render-email-template
//
// Merges an email_templates row's subject + body_html with data from a parent
// record (project, property, opportunity, etc.) and returns the resolved
// strings. The front-end shows them in a Preview modal so authors can verify
// merge fields resolve correctly before sending the template.
//
// No PDF, no anchors, no envelope creation — pure substitution. Same merge
// dictionary shape as render-document-template-pdf (HTML mode), so authors
// who've learned the {{root.field}} syntax in document templates use the
// exact same tokens here.
//
// Inputs (POST JSON):
//   { email_template_id, parent_object, parent_record_id, preview? }
//
// Outputs (200 JSON):
//   { template_name, subject, body_html }
//
// Authentication: caller's JWT (verify_jwt = true). RLS gates apply normally —
// the author needs read access to the parent record to preview it.
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

// Merge helpers — duplicated inline because the MCP deploy tool doesn't
// bundle the supabase/functions/_shared sibling directory the way the
// Supabase CLI does. Keep these in sync with _shared/merge.ts (renderer
// edge functions are the canonical source).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function singularize(plural: string): string {
  const map: Record<string, string> = {
    properties: "property", opportunities: "opportunity", accounts: "account",
    contacts: "contact", projects: "project", work_orders: "work_order",
    work_steps: "work_step", buildings: "building", units: "unit",
    incentive_applications: "incentive_application",
    payment_receipts: "payment_receipt",
    project_payment_requests: "project_payment_request",
    assessments: "assessment", programs: "program", work_types: "work_type",
  }
  if (plural in map) return map[plural]
  if (plural.endsWith("ies")) return plural.slice(0, -3) + "y"
  if (plural.endsWith("s"))   return plural.slice(0, -1)
  return plural
}

async function resolveRowForMerge(
  supabase: SupabaseClient,
  row: Record<string, any>,
): Promise<Record<string, any>> {
  const out: Record<string, any> = { ...row }
  const uuidValues = new Set<string>()
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "string" && UUID_RE.test(v) && k !== "id") uuidValues.add(v)
  }
  if (uuidValues.size === 0) return out
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
    if (typeof v !== "string" || !UUID_RE.test(v) || k === "id") continue
    if (picklistMap.has(v))      out[k] = picklistMap.get(v)
    else if (userMap.has(v))     out[k] = userMap.get(v)
  }
  return out
}

async function buildMergeDict(
  supabase: SupabaseClient,
  parentObject: string,
  parentRecordId: string,
  templateName: string,
): Promise<Record<string, any>> {
  const dict: Record<string, any> = {}
  const { data: parentRow, error } = await supabase
    .from(parentObject).select("*").eq("id", parentRecordId).maybeSingle()
  if (error)      throw new Error(`Parent lookup failed: ${error.message}`)
  if (!parentRow) throw new Error("Parent record not found")
  const root = singularize(parentObject)
  dict[root] = await resolveRowForMerge(supabase, parentRow)
  const now = new Date()
  dict.today = {
    iso:   now.toISOString().slice(0, 10),
    short: now.toLocaleDateString("en-US"),
    long:  now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  }
  dict.template = { name: templateName }
  return dict
}

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface ReqBody {
  email_template_id: string
  parent_object:     string
  parent_record_id:  string
  preview?:          boolean
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  let body: ReqBody
  try { body = await req.json() as ReqBody }
  catch { return json({ error: "Invalid JSON body" }, 400) }

  if (!body.email_template_id) return json({ error: "email_template_id is required" }, 400)
  if (!body.parent_object || !body.parent_record_id) {
    return json({ error: "parent_object and parent_record_id are required" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")
  if (!supabaseUrl || !anonKey) {
    return json({ error: "Server misconfiguration: SUPABASE_URL or SUPABASE_ANON_KEY missing" }, 500)
  }
  const authHeader = req.headers.get("Authorization") || ""
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing Bearer token" }, 401)
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  // Load template — RLS handles read auth. We deliberately don't enforce
  // an Active-only gate when preview:true so authors can iterate on
  // Drafts and Archived templates the same way they preview document
  // templates today.
  const { data: tpl, error: tplErr } = await supabase
    .from("email_templates")
    .select("id, name, subject, body_html, related_object, status, is_deleted")
    .eq("id", body.email_template_id)
    .maybeSingle()
  if (tplErr) return json({ error: `template lookup failed: ${tplErr.message}` }, 500)
  if (!tpl)   return json({ error: "template not found" }, 404)
  if (tpl.is_deleted) return json({ error: "template is deleted" }, 400)

  // Light parity check — same behavior as render-document-template-pdf.
  // The error is just a hint; the merge will probably succeed anyway,
  // but related_object alignment is required for envelope flows so it's
  // worth surfacing now rather than at send time.
  if (tpl.related_object && tpl.related_object !== body.parent_object) {
    return json({
      error: `Template's related_object (${tpl.related_object}) doesn't match parent_object (${body.parent_object}). The merge dict won't have the right keys for this template's tokens.`
    }, 400)
  }

  // Build merge dict + substitute
  let dict: Record<string, any>
  try {
    dict = await buildMergeDict(supabase, body.parent_object, body.parent_record_id, tpl.name || "")
  } catch (err) {
    return json({ error: `merge dict build failed: ${(err as Error).message}` }, 400)
  }

  const subject  = substituteTokens(tpl.subject || "", dict)
  const bodyHtml = substituteTokens(tpl.body_html || "", dict)

  return json({
    template_name: tpl.name,
    subject,
    body_html: bodyHtml,
  })
})

// Same {{a.b.c}} substitution used by render-document-template-pdf.
// Unknown paths render as '[unknown: {{path}}]'; null/undefined leaves
// render as '—' for visual parity with the docx path's nullGetter.
function substituteTokens(input: string, dict: Record<string, any>): string {
  return input.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_full, path) => {
    const segs = path.split(".")
    let cur: any = dict
    for (const s of segs) {
      if (cur == null || typeof cur !== "object") return `[unknown: {{${path}}}]`
      cur = cur[s]
    }
    if (cur === null || cur === undefined) return "—"
    return String(cur)
  })
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", ...cors },
  })
}
