// approve-service-provider — Supabase Edge Function
//
// One-click approval of a Service Provider application. Runs the approval RPC
// AS THE CALLER (so app_user_can gating + reviewer stamping use the staff
// user's identity), which activates the account and provisions the provider's
// portal_users login, then AUTO-SENDS the auth invite email (redirect to
// /provider-portal) using the service-role key.
//
// Mirrors invite-portal-user: caller client (re-verifies permission) + admin
// client (holds the service-role key server-side).

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SUPABASE_ANON_KEY         = Deno.env.get("SUPABASE_ANON_KEY")!

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}

// The provider portal is mounted at /provider-portal on the same app.
function getProviderRedirectUrl(req: Request): string {
  const origin = req.headers.get("origin")
  const base =
    origin && /^https?:\/\/(localhost(:\d+)?|.+\.netlify\.app|app\.ees-wi\.org)$/.test(origin)
      ? origin
      : "https://ees-ops.netlify.app"
  return `${base}/provider-portal`
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return jsonResponse({ error: "Method not allowed" }, 405)

  const authHeader = req.headers.get("Authorization") || ""
  if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "Missing Authorization header" }, 401)

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const adminClient  = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: callerData, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerData?.user) return jsonResponse({ error: "Invalid or expired session" }, 401)

  const { data: canManage, error: permErr } = await callerClient.rpc("app_user_can", {
    p_object: "service_provider_applications", p_action: "update",
  })
  if (permErr) return jsonResponse({ error: "Failed to verify permission", detail: permErr.message }, 500)
  if (canManage !== true) return jsonResponse({ error: "You do not have permission to approve applications" }, 403)

  let payload: any
  try { payload = await req.json() } catch { return jsonResponse({ error: "Invalid JSON body" }, 400) }
  const applicationId: string | undefined = payload.application_id?.trim?.() || undefined
  if (!applicationId || !/^[0-9a-f-]{36}$/i.test(applicationId)) {
    return jsonResponse({ error: "application_id must be a UUID" }, 400)
  }
  const portalRole: string = typeof payload.portal_role === "string" && payload.portal_role ? payload.portal_role : "service_provider_admin"

  // 1. Approve (as the caller): activate account + provision the portal login.
  const { data: appr, error: apprErr } = await callerClient.rpc("approve_service_provider_application", {
    p_application_id: applicationId, p_portal_role: portalRole,
  })
  if (apprErr) return jsonResponse({ error: "Approval failed", detail: apprErr.message }, 500)
  if (appr?.error) return jsonResponse({ error: appr.error }, 400)

  const portalUserId: string | undefined = appr?.portal_user_id
  const email: string | undefined = appr?.email?.trim?.().toLowerCase()
  const fullName: string = appr?.full_name || email || "Service Provider"

  // 2. If there's no email or the provider already has access, we're done.
  if (!portalUserId) return jsonResponse({ ok: true, approved: true, invited: false, note: "Account activated; no portal user provisioned." })
  if (!email) return jsonResponse({ ok: true, approved: true, invited: false, portal_user_id: portalUserId, note: "Approved; no email on file to send an invite." })

  const { data: pu } = await adminClient.from("portal_users").select("auth_user_id").eq("id", portalUserId).maybeSingle()
  if (pu?.auth_user_id) return jsonResponse({ ok: true, approved: true, invited: false, portal_user_id: portalUserId, note: "Approved; provider already has portal access." })

  // 3. Auto-send the invite.
  const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: getProviderRedirectUrl(req),
    data: { full_name: fullName, portal_user: true, provider_user: true },
  })
  if (inviteErr || !invited?.user) {
    const msg = inviteErr?.message || "Invite failed"
    const already = /registered|already/i.test(msg)
    return jsonResponse({
      ok: !already ? false : true, approved: true, invited: false, portal_user_id: portalUserId,
      error: already ? undefined : "Invite failed",
      note: already ? `An auth account already exists for ${email}. Link or reset it manually.` : undefined,
      detail: msg,
    }, already ? 200 : 400)
  }

  // 4. Link auth user + mark Invited; roll back the auth identity on failure.
  const { error: linkErr } = await adminClient.from("portal_users").update({
    auth_user_id: invited.user.id, status: "Portal User Invited", updated_at: new Date().toISOString(),
  }).eq("id", portalUserId)
  if (linkErr) {
    await adminClient.auth.admin.deleteUser(invited.user.id).catch(() => undefined)
    return jsonResponse({ error: "Failed to link invited user", detail: linkErr.message }, 500)
  }

  return jsonResponse({ ok: true, approved: true, invited: true, portal_user_id: portalUserId, email, account_id: appr?.account_id })
})
