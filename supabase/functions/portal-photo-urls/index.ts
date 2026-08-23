// ─── portal-photo-urls ──────────────────────────────────────────────────────
// Mints short-lived signed URLs for the work-evidence photos a PORTAL USER is
// allowed to see, so the Property Owner Portal can render them.
//
// Why this exists: photos.file_url holds a STORAGE PATH, not a URL, and the
// work-evidence bucket is private. The portal rendered <img src={path}>, which
// the browser resolved against the site root and 404'd — every photo in the
// portal was a broken image. Portal users also (correctly) have no direct
// access to storage at all, so they cannot sign these URLs themselves.
//
// Security: the caller is resolved from their JWT to a portal_users row, and
// every requested photo is re-resolved server-side through
// work_step -> work_order -> property/building and filtered to the caller's
// own grants in portal_user_property_grants, with the same account guard the
// portal's two read RPCs apply. A photo id outside the caller's grants is
// simply absent from the response. The service role key never leaves here.
//
// Returns the watermarked variant when process-photo has produced one (that is
// the copy stamped with the work step name), falling back to the original.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Long enough to browse a unit's photos and open the lightbox, short enough
// that a leaked URL is worthless quickly. The client re-requests as needed.
const SIGNED_URL_TTL_SECONDS = 900

// A portal page renders at most a few dozen photos; the cap is an abuse guard.
const MAX_PHOTO_IDS = 250

const ACTIVE_PORTAL_STATUSES = ["Portal User Active", "Portal User Invited"]

interface ReqBody {
  photo_ids: string[]
  // Internal-admin View As, mirroring get_portal_project_tracker's parameters.
  // Exactly one may be set, and only an Admin may set either — verified here
  // against public.users/roles, never trusted from the request.
  view_as_portal_user_id?: string | null
  preview_account_id?: string | null
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  let body: ReqBody
  try { body = await req.json() as ReqBody } catch { return json({ error: "Invalid JSON body" }, 400) }
  const ids = Array.isArray(body?.photo_ids) ? body.photo_ids.filter(Boolean).slice(0, MAX_PHOTO_IDS) : []
  if (!ids.length) return json({ urls: {} }, 200)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfiguration" }, 500)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // ── Caller -> portal user ──
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")
  if (!jwt) return json({ error: "Not authenticated" }, 401)
  const { data: userData } = await admin.auth.getUser(jwt)
  const authUid = userData?.user?.id
  if (!authUid) return json({ error: "Not authenticated" }, 401)

  const viewAsPortalUserId = body?.view_as_portal_user_id || null
  const previewAccountId   = body?.preview_account_id || null
  const wantsViewAs = !!(viewAsPortalUserId || previewAccountId)

  let portalUserId: string | null = null
  let accountId: string | null = null
  let previewWholeAccount = false

  if (wantsViewAs) {
    if (viewAsPortalUserId && previewAccountId) {
      return json({ error: "Supply exactly one view-as target" }, 400)
    }
    // Admin check, against the caller's internal identity.
    const { data: staff } = await admin
      .from("users")
      .select("id, user_is_active, roles ( role_name )")
      .eq("auth_user_id", authUid).maybeSingle()
    const roleName = (staff as any)?.roles?.role_name
    if (!staff || staff.user_is_active !== true || roleName !== "Admin") {
      return json({ error: "Viewing a portal as someone else is limited to system administrators" }, 403)
    }
    if (viewAsPortalUserId) {
      const { data: target } = await admin
        .from("portal_users")
        .select("id, portal_user_account_id")
        .eq("id", viewAsPortalUserId).eq("is_deleted", false).maybeSingle()
      if (!target) return json({ error: "Portal user not found" }, 404)
      portalUserId = target.id
      accountId    = target.portal_user_account_id
    } else {
      previewWholeAccount = true
      accountId = previewAccountId
    }
  } else {
    const { data: pu } = await admin
      .from("portal_users")
      .select("id, status, portal_user_account_id")
      .eq("auth_user_id", authUid).eq("is_deleted", false).maybeSingle()
    if (!pu || !ACTIVE_PORTAL_STATUSES.includes(pu.status)) {
      return json({ error: "Not an active portal user" }, 403)
    }
    portalUserId = pu.id
    accountId    = pu.portal_user_account_id
  }

  // ── Grants (skipped entirely when previewing a whole account) ──
  const propIds = new Set<string>()
  const bldgIds = new Set<string>()
  if (!previewWholeAccount) {
    const { data: grants } = await admin
      .from("portal_user_property_grants")
      .select("pug_property_id, pug_building_id")
      .eq("pug_portal_user_id", portalUserId).eq("pug_is_deleted", false)
    for (const g of (grants || []) as any[]) {
      if (g.pug_property_id) propIds.add(g.pug_property_id)
      if (g.pug_building_id) bldgIds.add(g.pug_building_id)
    }
    if (!propIds.size && !bldgIds.size) return json({ urls: {} }, 200)
  }

  // ── Re-resolve the requested photos through their work order ──
  const { data: rows, error: qErr } = await admin
    .from("photos")
    .select(`id, storage_bucket, storage_path_original, storage_path_watermarked,
             work_steps!inner ( work_orders!inner ( property_id, building_id,
               properties ( property_account_id ) ) )`)
    .in("id", ids)
    .eq("is_deleted", false)
  if (qErr) return json({ error: qErr.message }, 500)

  const allowed = (rows || []).filter((r: any) => {
    const wo = r.work_steps?.work_orders
    if (!wo) return false
    const acct = wo.properties?.property_account_id
    if (previewWholeAccount) {
      // Account preview: everything on that account, matching the tracker.
      return !!acct && acct === accountId
    }
    if (!(propIds.has(wo.property_id) || bldgIds.has(wo.building_id))) return false
    // Same account guard the portal's read RPCs apply: a grant to a property
    // that belongs to another account resolves to nothing.
    return !accountId || !acct || acct === accountId
  })
  if (!allowed.length) return json({ urls: {} }, 200)

  // ── Sign, one call per bucket ──
  const byBucket = new Map<string, Set<string>>()
  for (const r of allowed as any[]) {
    if (!r.storage_bucket) continue
    const paths = byBucket.get(r.storage_bucket) || new Set<string>()
    if (r.storage_path_watermarked) paths.add(r.storage_path_watermarked)
    if (r.storage_path_original)    paths.add(r.storage_path_original)
    byBucket.set(r.storage_bucket, paths)
  }

  const urlMap = new Map<string, string>()   // `${bucket}::${path}` -> signed url
  await Promise.all(Array.from(byBucket.entries()).map(async ([bucket, set]) => {
    const paths = Array.from(set)
    const { data } = await admin.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
    ;(data || []).forEach((d: any, i: number) => {
      if (d?.signedUrl) urlMap.set(`${bucket}::${paths[i]}`, d.signedUrl)
    })
  }))

  const urls: Record<string, { thumb: string | null; full: string | null }> = {}
  for (const r of allowed as any[]) {
    const b = r.storage_bucket
    const stamped  = r.storage_path_watermarked ? urlMap.get(`${b}::${r.storage_path_watermarked}`) || null : null
    const original = r.storage_path_original    ? urlMap.get(`${b}::${r.storage_path_original}`)    || null : null
    urls[r.id] = { thumb: stamped || original, full: stamped || original }
  }

  return json({ urls, expires_in: SIGNED_URL_TTL_SECONDS }, 200)
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
