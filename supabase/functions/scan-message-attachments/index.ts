// ─── scan-message-attachments ──────────────────────────────────────────────
// LEAP-side attachment scan layer. Microsoft Exchange Online Protection has
// already run real anti-malware on every message that transits a shared
// mailbox (inbound AND outbound), so anything that reached storage passed
// Microsoft's AV. This function adds LEAP's own verdict on the STORED copy —
// the one staff download from the conversation panel — with deterministic
// checks that run reliably in an edge function:
//
//   1. EICAR test signature (industry-standard AV self-test string)
//   2. Executable magic bytes (PE "MZ", ELF, Mach-O) regardless of file name
//   3. Dangerous file extensions (.exe, .js, .vbs, .ps1, … incl. the
//      double-extension trick "invoice.pdf.exe" — the FINAL extension rules)
//   4. Content-type spoofing: declared image/* or application/pdf whose
//      magic bytes are not that type
//
// Verdicts land on message_attachments:
//   clean        — all checks passed
//   blocked      — a check tripped (ma_virus_scan_detail says which)
//   scan_failed  — storage download failed; picked up again on runs where
//                  the row hasn't been touched for an hour (slow retry)
// ma_virus_scan_engine records the engine + the Microsoft transit layer.
//
// Invocation: pg_cron every 5 minutes (scan-message-attachments-every-5min)
// with the shared pipeline secret; also callable ad-hoc the same way.
// Auth: fail-closed shared secret (x-graph-renewal-secret), same gate as
// renew-graph-subscriptions / admin-test-send-email.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const ATTACHMENT_BUCKET = "communications-attachments"
const BATCH_SIZE = 25
const SCAN_ENGINE = "leap-policy-scan-v1 (+ microsoft-eop transit)"
// Files larger than this are judged on extension/name only — downloading
// hundreds of MB per cron tick would starve the function. EOP already
// scanned the content in transit.
const MAX_CONTENT_SCAN_BYTES = 25 * 1024 * 1024

// EICAR test string, assembled at runtime so this source file itself never
// contains the contiguous signature (which trips desktop AV on checkout).
const EICAR_SIGNATURE = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join("")

// Final-extension blocklist — executable / script / installer formats that
// have no business riding email through LEAP. Lowercase, no dots.
const BLOCKED_EXTENSIONS = new Set([
  "exe", "scr", "bat", "cmd", "com", "pif", "msi", "msp", "mst",
  "js", "jse", "vbs", "vbe", "wsf", "wsh", "ps1", "psm1", "psd1",
  "jar", "hta", "cpl", "dll", "reg", "lnk", "iso", "img", "vhd", "vhdx",
])

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405)

  const expectedSecret = Deno.env.get("GRAPH_RENEWAL_CRON_SECRET")
                      || Deno.env.get("GRAPH_WEBHOOK_CLIENT_STATE")
  if (!expectedSecret) return json({ error: "Server misconfigured: no shared secret set" }, 500)
  if ((req.headers.get("x-graph-renewal-secret") || "") !== expectedSecret) {
    return json({ error: "Forbidden" }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: rows, error: listErr } = await admin
    .from("message_attachments")
    .select("id, ma_storage_path, ma_file_name, ma_file_size_bytes, ma_mime_type, ma_virus_scan_detail")
    .or(`ma_virus_scan_status.eq.pending,and(ma_virus_scan_status.eq.scan_failed,ma_updated_at.lt.${new Date(Date.now() - 3600_000).toISOString()})`)
    .eq("ma_is_deleted", false)
    .order("ma_created_at", { ascending: true })
    .limit(BATCH_SIZE)
  if (listErr) return json({ error: `pending lookup failed: ${listErr.message}` }, 500)

  const results: Array<Record<string, unknown>> = []
  for (const row of rows || []) {
    let status = "clean"
    let detail: string | null = null

    // ── Name-based checks (no download needed) ─────────────────────────────
    const ext = (row.ma_file_name.split(".").pop() || "").toLowerCase()
    if (BLOCKED_EXTENSIONS.has(ext)) {
      status = "blocked"
      detail = `Blocked file extension .${ext}`
    }

    // ── Content checks ──────────────────────────────────────────────────────
    if (status === "clean" && (row.ma_file_size_bytes ?? 0) <= MAX_CONTENT_SCAN_BYTES) {
      const { data: blob, error: dlErr } = await admin.storage
        .from(ATTACHMENT_BUCKET)
        .download(row.ma_storage_path)
      if (dlErr || !blob) {
        status = "scan_failed"
        detail = `Storage download failed: ${dlErr?.message || "no data"}`
      } else {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const verdict = scanBytes(bytes, row.ma_mime_type)
        if (verdict) { status = "blocked"; detail = verdict }
      }
    } else if (status === "clean") {
      detail = "Content not re-scanned (over size cap); extension checks passed; scanned by Microsoft EOP in transit"
    }

    const { error: upErr } = await admin
      .from("message_attachments")
      .update({
        ma_virus_scan_status:       status,
        ma_virus_scan_completed_at: status === "scan_failed" ? null : new Date().toISOString(),
        ma_virus_scan_engine:       SCAN_ENGINE,
        ma_virus_scan_detail:       detail,
        ma_updated_at:              new Date().toISOString(),
      })
      .eq("id", row.id)
    results.push({ id: row.id, file: row.ma_file_name, status, detail, update_error: upErr?.message || null })
  }

  return json({
    ok: true,
    scanned: results.length,
    blocked: results.filter(r => r.status === "blocked").length,
    failed:  results.filter(r => r.status === "scan_failed").length,
    results,
  }, 200)
})

// Returns a block reason, or null when the content passes.
function scanBytes(bytes: Uint8Array, declaredMime: string | null): string | null {
  // EICAR — spec says the signature appears within the first 128 bytes.
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 256))
  if (head.includes(EICAR_SIGNATURE)) return "EICAR test signature detected"

  // Executable magic bytes, whatever the file claims to be.
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return "Windows executable (PE/MZ) content"
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return "ELF executable content"
  if (bytes.length >= 4) {
    // 0xcafebabe (fat Mach-O) is skipped — it collides with Java class files,
    // and .jar/.class ride the extension blocklist instead.
    const m = (bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3]) >>> 0
    if (m === 0xfeedface || m === 0xfeedfacf) return "Mach-O executable content"
  }

  // Content-type spoofing for the types staff trust on sight.
  const mime = (declaredMime || "").toLowerCase()
  if (mime === "application/pdf" && !startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    return "Declared PDF but content is not a PDF"
  }
  if (mime === "image/png" && !startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) {
    return "Declared PNG but content is not a PNG"
  }
  if (mime === "image/jpeg" && !startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "Declared JPEG but content is not a JPEG"
  }
  if (mime === "image/gif" && !startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return "Declared GIF but content is not a GIF"
  }

  return null
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false
  for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic[i]) return false
  return true
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}
