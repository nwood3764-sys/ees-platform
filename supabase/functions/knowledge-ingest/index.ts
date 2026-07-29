// ─── knowledge-ingest ───────────────────────────────────────────────────────
// Builds the searchable index for one knowledge_documents row: resolves the
// text (server-side PDF extraction when needed), splits it into chunks, embeds
// each chunk with Supabase's in-house gte-small model (no external API/key), and
// writes knowledge_chunks. Re-index safe: it clears the doc's old chunks first.
//
// All DB writes go through the caller's JWT, so RLS applies — only an Admin can
// ingest (knowledge_chunks INSERT is Admin-only). Read stays internal-only.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const BUCKET = "knowledge-base"
const CHUNK_TARGET = 1000   // ~chars per chunk (gte-small ≈ 512 tokens)
const CHUNK_OVERLAP = 150

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}

// Split text into overlapping chunks on paragraph/sentence boundaries.
function chunkText(text: string): string[] {
  const clean = (text || "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim()
  if (!clean) return []
  const paras = clean.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let cur = ""
  const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = "" }
  for (const para of paras) {
    if (para.length > CHUNK_TARGET) {
      push()
      // hard-split an oversized paragraph by sentences, then by length
      const sentences = para.match(/[^.!?\n]+[.!?]?/g) || [para]
      let seg = ""
      for (const s of sentences) {
        if ((seg + s).length > CHUNK_TARGET && seg) { chunks.push(seg.trim()); seg = seg.slice(-CHUNK_OVERLAP) }
        seg += s
        while (seg.length > CHUNK_TARGET * 1.5) { chunks.push(seg.slice(0, CHUNK_TARGET).trim()); seg = seg.slice(CHUNK_TARGET - CHUNK_OVERLAP) }
      }
      if (seg.trim()) cur = seg.trim()
      continue
    }
    if ((cur + "\n\n" + para).length > CHUNK_TARGET && cur) push()
    cur = cur ? cur + "\n\n" + para : para
  }
  push()
  return chunks.slice(0, 400) // safety cap per document
}

async function resolveCaller(admin: SupabaseClient, authHeader: string): Promise<string | null> {
  if (!authHeader.startsWith("Bearer ")) return null
  try {
    const payload = JSON.parse(atob(authHeader.slice(7).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))
    if (!payload.sub) return null
    const { data } = await admin.from("users").select("id").eq("auth_user_id", payload.sub).maybeSingle()
    return data?.id || null
  } catch { return null }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json({ error: "POST only" }, 405)

  let body: { document_id?: string }
  try { body = await req.json() } catch { return json({ error: "Invalid JSON body" }, 400) }
  const documentId = body.document_id
  if (!documentId) return json({ error: "document_id required" }, 400)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const authHeader = req.headers.get("Authorization") || ""
  const callerId = await resolveCaller(admin, authHeader)
  if (!callerId) return json({ error: "Caller is not a registered LEAP user" }, 401)

  const jwt = authHeader.slice(7)
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Load the document (RLS: internal read).
  const { data: doc, error: docErr } = await userClient
    .from("knowledge_documents")
    .select("id, kd_source_type, kd_content_text, kd_file_path, kd_file_name, kd_mime_type")
    .eq("id", documentId).maybeSingle()
  if (docErr) return json({ error: docErr.message }, 400)
  if (!doc) return json({ error: "Document not found or not visible" }, 404)

  try {
    // Resolve the text. Client pre-extracts Word/Excel/CSV/text; PDFs come here
    // as a stored file we extract now.
    let text: string = doc.kd_content_text || ""
    const looksPdf = (doc.kd_mime_type || "").includes("pdf") || (doc.kd_file_name || "").toLowerCase().endsWith(".pdf")
    if (!text.trim() && doc.kd_source_type === "file" && doc.kd_file_path && looksPdf) {
      const { data: blob, error: dlErr } = await userClient.storage.from(BUCKET).download(doc.kd_file_path)
      if (dlErr) throw new Error(`Download failed: ${dlErr.message}`)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const pdf = await getDocumentProxy(bytes)
      const { text: pdfText } = await extractText(pdf, { mergePages: true })
      text = (Array.isArray(pdfText) ? pdfText.join("\n\n") : pdfText) || ""
      await userClient.from("knowledge_documents").update({ kd_content_text: text, kd_updated_at: new Date().toISOString() }).eq("id", documentId)
    }

    if (!text.trim()) {
      await userClient.from("knowledge_documents").update({
        kd_is_indexed: false, kd_chunk_count: 0,
        kd_index_error: "No extractable text found (a scanned/image PDF needs OCR).",
        kd_updated_at: new Date().toISOString(),
      }).eq("id", documentId)
      return json({ ok: true, indexed: false, chunk_count: 0, note: "No extractable text found." })
    }

    const chunks = chunkText(text)

    // Embed each chunk with the in-house model.
    const session = new (globalThis as any).Supabase.ai.Session("gte-small")
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await session.run(chunks[i], { mean_pool: true, normalize: true }) as number[]
      rows.push({ kc_document_id: documentId, kc_chunk_index: i, kc_chunk_text: chunks[i], kc_embedding: JSON.stringify(embedding) })
    }

    // Replace old chunks, insert new (batched).
    const { error: delErr } = await userClient.from("knowledge_chunks").delete().eq("kc_document_id", documentId)
    if (delErr) throw new Error(`Clear old chunks: ${delErr.message}`)
    for (let i = 0; i < rows.length; i += 50) {
      const { error: insErr } = await userClient.from("knowledge_chunks").insert(rows.slice(i, i + 50))
      if (insErr) throw new Error(`Insert chunks: ${insErr.message}`)
    }

    await userClient.from("knowledge_documents").update({
      kd_is_indexed: true, kd_indexed_at: new Date().toISOString(),
      kd_chunk_count: rows.length, kd_index_error: null,
      kd_updated_at: new Date().toISOString(),
    }).eq("id", documentId)

    return json({ ok: true, indexed: true, chunk_count: rows.length })
  } catch (e) {
    const msg = (e as Error).message || String(e)
    try {
      await userClient.from("knowledge_documents").update({
        kd_is_indexed: false, kd_index_error: msg.slice(0, 500), kd_updated_at: new Date().toISOString(),
      }).eq("id", documentId)
    } catch { /* noop */ }
    return json({ error: `Ingest failed: ${msg}` }, 500)
  }
})
