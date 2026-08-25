// ─── program-portal-file ────────────────────────────────────────────────────
// The only route from a Program Manager Portal user to an actual file.
//
// Two actions, deliberately different:
//
//   view      — a short-lived signed URL for inline display. Photos are served
//               watermarked (the copy stamped with the work step name) when
//               process-photo has produced one. Not logged: one assessment page
//               renders dozens of thumbnails and a row per thumbnail would bury
//               the thing the log exists to show.
//   download  — the original file, as an attachment. Requires BOTH the
//               organisation (accounts.account_allow_portal_download) and the
//               individual (portal_users.portal_user_allow_download) to be
//               permitted, and writes portal_download_log BEFORE signing.
//
// That last point is why file serving cannot be done client-side: a URL the
// browser signs for itself cannot be logged. Storage stays locked to internal
// staff (2026-08-18) — portal users have no direct storage access at all.
//
// Reachability is re-derived server-side on every call, never trusted from the
// request: file -> work step -> work order -> project, and that project must be
// reachable from a live row in portal_record_grants for THIS portal user. The
// work order must also be an assessment record type: an assessment's project
// can carry install work orders, and those were not shared.
//
// Admins may pass view_as_portal_user_id to preview, mirroring the portal's
// read RPC. Admin status is verified here against public.users/roles.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const VIEW_TTL_SECONDS     = 900     // long enough to browse a page of photos
const DOWNLOAD_TTL_SECONDS = 120     // handed straight to the browser

const ACTIVE_PORTAL_STATUSES = ["Portal User Active", "Portal User Invited"]
const ASSESSMENT_WO_TYPES = [
  "MULTIFAMILY-ENERGY-ASSESSMENT",
  "SINGLE-FAMILY-ENERGY-ASSESSMENT",
  "HES-ASSESSMENT",
]
const REPORT_DOCUMENT_TYPE = "energy_assessment_report"

interface ReqBody {
  file_object: "photos" | "documents"
  file_id: string
  action?: "view" | "download"
  view_as_portal_user_id?: string | null
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  let body: ReqBody
  try { body = await req.json() as ReqBody } catch { return json({ error: "Invalid JSON body" }, 400) }

  const fileObject = body?.file_object
  const fileId     = body?.file_id
  const action     = body?.action === "download" ? "download" : "view"
  if (fileObject !== "photos" && fileObject !== "documents") {
    return json({ error: "file_object must be photos or documents" }, 400)
  }
  if (!fileId) return json({ error: "file_id required" }, 400)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfiguration" }, 500)
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // ── Caller ──
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")
  if (!jwt) return json({ error: "Not authenticated" }, 401)
  const { data: userData } = await admin.auth.getUser(jwt)
  const authUid = userData?.user?.id
  if (!authUid) return json({ error: "Not authenticated" }, 401)

  const viewAsId = body?.view_as_portal_user_id || null
  let pu: any = null

  if (viewAsId) {
    const { data: staff } = await admin
      .from("users").select("id, user_is_active, roles ( role_name )")
      .eq("auth_user_id", authUid).maybeSingle()
    if (!staff || staff.user_is_active !== true || (staff as any)?.roles?.role_name !== "Admin") {
      return json({ error: "Previewing a portal as someone else is limited to system administrators" }, 403)
    }
    const { data } = await admin
      .from("portal_users")
      .select("id, record_type, status, portal_user_account_id, portal_user_allow_download")
      .eq("id", viewAsId).eq("is_deleted", false).maybeSingle()
    pu = data
  } else {
    const { data } = await admin
      .from("portal_users")
      .select("id, record_type, status, portal_user_account_id, portal_user_allow_download")
      .eq("auth_user_id", authUid).eq("is_deleted", false).maybeSingle()
    pu = data
    if (pu && !ACTIVE_PORTAL_STATUSES.includes(pu.status)) pu = null
  }

  if (!pu || pu.record_type !== "Program Manager User") {
    return json({ error: "Not a program manager portal user" }, 403)
  }

  // ── What this user has been granted, resolved to a set of project ids ──
  const { data: grants } = await admin
    .from("portal_record_grants")
    .select("prg_object, prg_record_id")
    .eq("prg_portal_user_id", pu.id).eq("prg_is_deleted", false)

  const grantedAssessmentIds = (grants || []).filter((g: any) => g.prg_object === "assessments").map((g: any) => g.prg_record_id)
  const grantedProjectIds    = new Set((grants || []).filter((g: any) => g.prg_object === "projects").map((g: any) => g.prg_record_id))

  if (grantedAssessmentIds.length) {
    const { data: assessments } = await admin
      .from("assessments").select("project_id")
      .in("id", grantedAssessmentIds).eq("assessment_is_deleted", false)
    for (const a of (assessments || []) as any[]) if (a.project_id) grantedProjectIds.add(a.project_id)
  }
  if (!grantedProjectIds.size) return json({ error: "Not found" }, 404)

  // ── Resolve the file, and re-derive its work order ──
  let workOrderId: string | null = null
  let bucket: string | null = null
  let viewPath: string | null = null
  let originalPath: string | null = null
  let fileName = "file"

  if (fileObject === "photos") {
    const { data: photo } = await admin
      .from("photos")
      .select("id, storage_bucket, storage_path_original, storage_path_watermarked, caption, work_step_id, work_steps ( work_order_id )")
      .eq("id", fileId).eq("is_deleted", false).maybeSingle()
    if (!photo || !(photo as any).work_steps?.work_order_id) return json({ error: "Not found" }, 404)
    workOrderId  = (photo as any).work_steps.work_order_id
    bucket       = photo.storage_bucket
    viewPath     = photo.storage_path_watermarked || photo.storage_path_original
    originalPath = photo.storage_path_original || photo.storage_path_watermarked
    fileName     = (photo.caption ? `${photo.caption}` : `photo-${photo.id}`).replace(/[^\w.\- ]+/g, "") + ".jpg"
  } else {
    const { data: doc } = await admin
      .from("documents")
      .select("id, name, document_type, related_object, related_id, storage_bucket, storage_path")
      .eq("id", fileId).eq("is_deleted", false).maybeSingle()
    // Only the generated Energy Assessment Report is shared in v1, and only
    // where it hangs off a work order.
    if (!doc || doc.related_object !== "work_orders" || doc.document_type !== REPORT_DOCUMENT_TYPE) {
      return json({ error: "Not found" }, 404)
    }
    workOrderId  = doc.related_id
    bucket       = doc.storage_bucket
    viewPath     = doc.storage_path
    originalPath = doc.storage_path
    fileName     = doc.name || "energy-assessment-report.pdf"
  }

  const { data: wo } = await admin
    .from("work_orders")
    .select("id, project_id, work_order_record_type")
    .eq("id", workOrderId).eq("work_order_is_deleted", false).maybeSingle()
  if (!wo || !wo.project_id || !grantedProjectIds.has(wo.project_id)) return json({ error: "Not found" }, 404)

  const { data: rt } = await admin
    .from("picklist_values").select("picklist_value").eq("id", wo.work_order_record_type).maybeSingle()
  if (!rt || !ASSESSMENT_WO_TYPES.includes(rt.picklist_value)) return json({ error: "Not found" }, 404)

  if (!bucket || !viewPath) return json({ error: "File is not available" }, 404)

  // ── Download needs both permissions, and is recorded ──
  if (action === "download") {
    const { data: acct } = await admin
      .from("accounts").select("account_allow_portal_download")
      .eq("id", pu.portal_user_account_id).maybeSingle()
    const orgAllows  = acct?.account_allow_portal_download === true
    const userAllows = pu.portal_user_allow_download === true
    if (!orgAllows || !userAllows) {
      return json({
        error: "Downloading is not enabled for this account or user",
        organization_allows: orgAllows,
        user_allows: userAllows,
      }, 403)
    }

    // Logged BEFORE the URL exists, so a signed URL is never handed out
    // without a record of it.
    const { error: logErr } = await admin.from("portal_download_log").insert({
      pdl_record_number: "",
      pdl_portal_user_id: pu.id,
      pdl_account_id: pu.portal_user_account_id,
      pdl_file_object: fileObject,
      pdl_file_id: fileId,
      pdl_file_name: fileName,
      pdl_storage_bucket: bucket,
      pdl_storage_path: originalPath,
      pdl_context_object: "work_orders",
      pdl_context_id: workOrderId,
    })
    if (logErr) return json({ error: "Could not record the download" }, 500)

    const { data: signed, error: sErr } = await admin.storage
      .from(bucket).createSignedUrl(originalPath as string, DOWNLOAD_TTL_SECONDS, { download: fileName })
    if (sErr || !signed?.signedUrl) return json({ error: "Could not prepare the file" }, 500)
    return json({ url: signed.signedUrl, action: "download", file_name: fileName, expires_in: DOWNLOAD_TTL_SECONDS }, 200)
  }

  const { data: signed, error: sErr } = await admin.storage
    .from(bucket).createSignedUrl(viewPath, VIEW_TTL_SECONDS)
  if (sErr || !signed?.signedUrl) return json({ error: "Could not prepare the file" }, 500)
  return json({ url: signed.signedUrl, action: "view", expires_in: VIEW_TTL_SECONDS }, 200)
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
