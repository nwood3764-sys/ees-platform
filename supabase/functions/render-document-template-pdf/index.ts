// =============================================================================
// render-document-template-pdf
//
// Produces the merged PDF that recipients sign on. Two input shapes:
//
//   docx mode: download .docx asset → docxtemplater merge → mammoth → HTML
//              → htmlToPdf → PDF + anchor positions
//   html mode: take body_html, do {{token}} substitution, → htmlToPdf
//              → PDF + anchor positions
//
// Always returns the same shape, so send-envelope doesn't care which
// authoring mode the template uses.
//
// Inputs (POST JSON):
//   { document_template_id?, document_template_snapshot_id?,
//     parent_object, parent_record_id, preview? }
//
// Outputs (200 JSON):
//   { pdf_base64, anchors: [{anchor_string, tab_type, ordinal, page,
//     x, y, width, height}, ...], page_count, template_name }
//
// Authentication: caller's JWT (verify_jwt = true). RLS allows
// authenticated read on every table we touch.
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"
import Docxtemplater from "npm:docxtemplater@3.50.0"
import PizZip from "npm:pizzip@3.1.7"
import mammoth from "npm:mammoth@1.8.0"

import { renderHtmlToPdf } from "../_shared/htmlToPdf.ts"
import { buildMergeDict } from "../_shared/merge.ts"

const TEMPLATE_BUCKET = "templates"

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
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  let body: ReqBody
  try { body = await req.json() as ReqBody }
  catch { return json({ error: "Invalid JSON body" }, 400) }

  if (!body.parent_object || !body.parent_record_id)
    return json({ error: "parent_object and parent_record_id required" }, 400)
  if (!body.document_template_id && !body.document_template_snapshot_id)
    return json({ error: "either document_template_id or document_template_snapshot_id required" }, 400)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")
  if (!supabaseUrl || !anonKey)
    return json({ error: "Server misconfiguration" }, 500)

  const authHeader = req.headers.get("Authorization") || ""
  if (!authHeader.startsWith("Bearer "))
    return json({ error: "Missing Bearer token" }, 401)

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  // ── Resolve template ────────────────────────────────────────────────
  let assetPath:    string | null = null
  let bodyHtml:     string | null = null
  let authoringMode:string | null = null
  let templateName = "document"

  if (body.document_template_snapshot_id) {
    const { data, error } = await supabase
      .from("document_template_snapshots")
      .select(`
        dtsn_template_asset_path, dtsn_template_json,
        authoring:dtsn_authoring_mode ( picklist_value )
      `)
      .eq("id", body.document_template_snapshot_id)
      .maybeSingle()
    if (error || !data) return json({ error: "Snapshot not found" }, 404)
    assetPath     = data.dtsn_template_asset_path
    authoringMode = (data as any).authoring?.picklist_value || null
    bodyHtml      = (data as any).dtsn_template_json?.body_html || null
    templateName  = (data as any).dtsn_template_json?.name || templateName
  } else {
    const { data, error } = await supabase
      .from("document_templates")
      .select(`
        name, body_html, dt_template_asset_path,
        authoring:dt_authoring_mode ( picklist_value ),
        status:status ( picklist_value )
      `)
      .eq("id", body.document_template_id!)
      .eq("is_deleted", false)
      .maybeSingle()
    if (error || !data) return json({ error: "Template not found" }, 404)
    const statusValue = (data as any).status?.picklist_value
    if (!body.preview && statusValue !== "Active")
      return json({ error: `Template is ${statusValue}, must be Active (preview:true bypasses)` }, 400)
    assetPath     = data.dt_template_asset_path
    bodyHtml      = data.body_html
    authoringMode = (data as any).authoring?.picklist_value || null
    templateName  = data.name || templateName
  }

  // ── Build the merge dictionary ──────────────────────────────────────
  let dict: Record<string, any>
  try {
    dict = await buildMergeDict(supabase, body.parent_object, body.parent_record_id, templateName)
  } catch (e) {
    return json({ error: (e as Error).message }, 400)
  }

  // ── Produce HTML, dispatching by authoring mode ─────────────────────
  let html: string

  if (authoringMode === "docx") {
    if (!assetPath)
      return json({ error: "Template has no .docx asset uploaded" }, 400)

    const { data: assetBlob, error: assetErr } = await supabase
      .storage.from(TEMPLATE_BUCKET).download(assetPath)
    if (assetErr || !assetBlob)
      return json({ error: `Asset download failed: ${assetErr?.message || "unknown"}` }, 500)

    const assetBytes = await assetBlob.arrayBuffer()

    let mergedBytes: Uint8Array
    try {
      const zip = new PizZip(assetBytes)
      const tpl = new Docxtemplater(zip, {
        delimiters:    { start: "{{", end: "}}" },
        paragraphLoop: true,
        linebreaks:    true,
        nullGetter: (part: any) => `[unknown: {{${part.value}}}]`,
      })
      tpl.render(dict)
      mergedBytes = tpl.getZip().generate({ type: "uint8array" })
    } catch (e) {
      return json({ error: `Docx merge failed: ${(e as Error).message}` }, 500)
    }

    try {
      const result = await mammoth.convertToHtml({ buffer: mergedBytes })
      html = `<body>${result.value || ""}</body>`
    } catch (e) {
      return json({ error: `Docx-to-HTML conversion failed: ${(e as Error).message}` }, 500)
    }
  } else if (authoringMode === "html") {
    if (!bodyHtml)
      return json({ error: "Template has no body_html content" }, 400)
    // Substitute {{a.b.c}} tokens in raw HTML using simple lookup
    html = substituteHtmlTokens(bodyHtml, dict)
  } else {
    return json({ error: `Unknown authoring_mode: ${authoringMode}` }, 400)
  }

  // ── Render HTML to PDF, scanning for anchor strings ─────────────────
  let result
  try {
    result = await renderHtmlToPdf(html)
  } catch (e) {
    return json({ error: `PDF render failed: ${(e as Error).message}` }, 500)
  }

  return json({
    pdf_base64:    btoaBytes(result.pdfBytes),
    anchors:       result.anchors,
    page_count:    result.pageCount,
    template_name: templateName,
  }, 200)
})

// ─── helpers ────────────────────────────────────────────────────────────

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  })
}

function btoaBytes(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let s = ""
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(s)
}

// Substitute {{a.b.c}} tokens in HTML using the merge dict. Anchors
// (\sig1\, etc.) are left untouched — they're scanned by the renderer.
// Unknown tokens render as [unknown: {{path}}] for parity with the docx
// path's nullGetter behavior.
function substituteHtmlTokens(html: string, dict: Record<string, any>): string {
  return html.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_full, path) => {
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
