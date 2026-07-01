// invite-portal-user — Supabase Edge Function
//
// The SEND step of the "Add to Portal" flow. The pending portal user + property
// grants are created first by the SECURITY DEFINER RPC portal_invite_create
// (account-scoped, permission-gated, no email). This function is called only
// when an internal user explicitly chooses to send the invitation: it creates
// the auth identity, emails the set-password / accept link, and links the auth
// user back to the portal_users row.
//
// Why an Edge Function: auth.admin.inviteUserByEmail needs the service-role key,
// which must never ride in the browser bundle. This holds it server-side and
// acts on the caller's behalf after re-verifying the caller may manage portal
// users (app_user_can), so a non-privileged session cannot email invitations.

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
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

// The portal is a standalone surface mounted at /project-portal on the same
// app. Land the invited user there after they set a password.
function getPortalRedirectUrl(req: Request): string {
  const origin = req.headers.get("origin")
  const base =
    origin && /^https?:\/\/(localhost(:\d+)?|.+\.netlify\.app)$/.test(origin)
      ? origin
      : "https://ees-ops.netlify.app"
  return `${base}/project-portal`
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return jsonResponse({ error: "Method not allowed" }, 405)

  const authHeader = req.headers.get("Authorization") || ""
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "Missing Authorization header" }, 401)
  }

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // 1. Verify the caller's session.
  const { data: callerData, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerData?.user) {
    return jsonResponse({ error: "Invalid or expired session" }, 401)
  }

  // 2. Re-verify the caller may manage portal users. app_user_can runs as the
  //    caller (reads auth.uid()), so this is the same gate the RPC enforces.
  const { data: canManage, error: permErr } = await callerClient.rpc("app_user_can", {
    p_object: "portal_users",
    p_action: "update",
  })
  if (permErr) {
    return jsonResponse({ error: "Failed to verify permission", detail: permErr.message }, 500)
  }
  if (canManage !== true) {
    return jsonResponse({ error: "You do not have permission to send portal invitations" }, 403)
  }

  // 3. Parse body.
  let payload: any
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }
  const portalUserId: string | undefined = payload.portal_user_id?.trim?.() || undefined
  if (!portalUserId || !/^[0-9a-f-]{36}$/i.test(portalUserId)) {
    return jsonResponse({ error: "portal_user_id must be a UUID" }, 400)
  }

  // 4. Load the pending portal user.
  const { data: pu, error: puErr } = await adminClient
    .from("portal_users")
    .select("id, email, full_name, auth_user_id, is_deleted, status")
    .eq("id", portalUserId)
    .maybeSingle()

  if (puErr)          return jsonResponse({ error: "Failed to load portal user", detail: puErr.message }, 500)
  if (!pu)            return jsonResponse({ error: "Portal user not found" }, 404)
  if (pu.is_deleted)  return jsonResponse({ error: "Portal user has been removed" }, 400)
  if (pu.auth_user_id) return jsonResponse({ error: "This portal user has already been invited" }, 409)
  const email = pu.email?.trim?.().toLowerCase()
  if (!email)         return jsonResponse({ error: "Portal user has no email address on file" }, 400)

  // 5. Create the auth identity + send the invitation email.
  const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
    email,
    {
      redirectTo: getPortalRedirectUrl(req),
      data: { full_name: pu.full_name || email, portal_user: true },
    },
  )
  if (inviteErr || !invited?.user) {
    const msg = inviteErr?.message || "Invite failed"
    const already = /registered|already/i.test(msg)
    return jsonResponse({
      error: already
        ? `An auth account already exists for ${email}. Link or reset it manually before inviting.`
        : "Invite failed",
      detail: msg,
    }, already ? 409 : 400)
  }

  // 6. Link the auth user and move the portal user to Invited. If this write
  //    fails, roll back the auth identity so we don't orphan it.
  const { error: linkErr } = await adminClient
    .from("portal_users")
    .update({
      auth_user_id: invited.user.id,
      status: "Portal User Invited",
      updated_at: new Date().toISOString(),
    })
    .eq("id", portalUserId)

  if (linkErr) {
    await adminClient.auth.admin.deleteUser(invited.user.id).catch(() => undefined)
    return jsonResponse({ error: "Failed to link invited user", detail: linkErr.message }, 500)
  }

  return jsonResponse({
    ok: true,
    portal_user_id: portalUserId,
    auth_user_id: invited.user.id,
    email,
    status: "Portal User Invited",
  })
})
