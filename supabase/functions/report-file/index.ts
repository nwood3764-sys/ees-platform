// report-file — serves ONE file behind a short, revocable link.
//
// A generated report is read by people outside EES. Its photo links used to be
// raw Supabase signed URLs: ~500 characters of JWT on a hostname that reads as
// random letters. Gmail prints that whole string on its redirect interstitial
// and Acrobat names the host in a security prompt, so a program reviewer is
// asked to trust something indistinguishable from phishing.
//
// A link is now leap.energyefficiencyservices.org/f/<22 chars>, which Netlify
// proxies to this function.
//
// ── The security posture, deliberately narrow ──────────────────────────────
//
// The capability being handed out is not new: a signed URL was already an
// unauthenticated, year-long, UNREVOKABLE right to fetch one file. This keeps
// that model and tightens every part of it.
//
//   * The token is looked up. It is never interpreted, never concatenated into
//     a path, and never trusted as anything but an opaque key. The path served
//     comes from the DATABASE ROW, never from the request — so there is no
//     traversal, no substitution, no enumeration.
//   * GET (and HEAD/OPTIONS) only. Every other method is refused before any
//     lookup happens. The function accepts no body and reads no query
//     parameters, so there is no input to inject through.
//   * It touches exactly one table, and only report_file_links. It performs no
//     joins, runs no caller-supplied SQL, and cannot reach photos, documents,
//     work orders or anything else.
//   * It never writes anything a caller controls. The single UPDATE it makes
//     stamps access time and a counter on the row it just read.
//   * The service-role key stays inside this worker. It is never returned,
//     never echoed into an error, and no response reveals whether a token was
//     wrong, expired or revoked — every failure is the same flat 404.
//   * Expired or revoked links stop working immediately, which a signed URL
//     can never do.
//
// Worst case if a link leaks: the holder can read that one photo until the row
// expires or somebody revokes it. That is strictly less than the status quo.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

// A token is 22 url-safe base64 characters from 16 random bytes. Anything that
// does not look like one is rejected before a query is issued, so malformed
// input never reaches the database.
const TOKEN_PATTERN = /^[A-Za-z0-9]{16,64}$/

// Content types we are willing to label. Anything else is served as a
// download with a generic type rather than something a browser might execute.
const INLINE_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", heic: "image/heic", heif: "image/heif", pdf: "application/pdf",
}

function notFound(): Response {
  // Deliberately identical for a bad token, an expired one and a revoked one.
  // Distinguishing them would let someone probe which tokens exist.
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  })
}

function extensionOf(path: string): string {
  const base = path.split("/").pop() || ""
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ""
}

// Strip anything that could break out of the Content-Disposition header.
function safeFilename(name: string | null, fallback: string): string {
  const cleaned = String(name || "").replace(/[\r\n"\\]/g, "").trim()
  return cleaned || fallback
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "range",
      },
    })
  }
  // Read-only by construction: nothing else is even considered.
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 })
  }

  // The token is the LAST path segment and nothing else is read from the URL.
  const segments = new URL(req.url).pathname.split("/").filter(Boolean)
  const token = segments[segments.length - 1] || ""
  if (!TOKEN_PATTERN.test(token)) return notFound()

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: link, error } = await admin
    .from("report_file_links")
    .select("id, rfl_storage_bucket, rfl_storage_path, rfl_display_name, rfl_expires_at, rfl_access_count")
    .eq("rfl_token", token)
    .eq("is_deleted", false)
    .maybeSingle()

  if (error || !link) return notFound()
  if (new Date(link.rfl_expires_at as string).getTime() <= Date.now()) return notFound()

  // The path comes from the row. Nothing the caller sent contributes to it.
  const { data: blob, error: dlErr } = await admin.storage
    .from(link.rfl_storage_bucket as string)
    .download(link.rfl_storage_path as string)
  if (dlErr || !blob) return notFound()

  const ext = extensionOf(link.rfl_storage_path as string)
  const contentType = INLINE_TYPES[ext] || "application/octet-stream"
  const filename = safeFilename(link.rfl_display_name as string | null, `evidence.${ext || "bin"}`)

  // Images and PDFs open in the tab rather than downloading. That is the whole
  // point for a reviewer: clicking a photo should SHOW the photo, not drop a
  // file in Downloads and leave a blank tab behind (Nicholas, 2026-08-27).
  // Anything we do not recognise is forced to download instead of being
  // rendered, so an unexpected file type is never handed to the browser to
  // interpret.
  const disposition = INLINE_TYPES[ext] ? "inline" : "attachment"

  // Fire-and-forget: usage is worth recording but must never delay or fail the
  // response the reader is waiting on.
  admin.from("report_file_links").update({
    rfl_last_accessed_at: new Date().toISOString(),
    rfl_access_count: ((link.rfl_access_count as number) || 0) + 1,
  }).eq("id", link.id as string).then(() => {}, () => {})

  const bytes = await blob.arrayBuffer()
  return new Response(req.method === "HEAD" ? null : bytes, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(bytes.byteLength),
      "content-disposition": `${disposition}; filename="${filename}"`,
      // Private: a shared cache must not hold evidence for the next requester.
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": "*",
    },
  })
})
