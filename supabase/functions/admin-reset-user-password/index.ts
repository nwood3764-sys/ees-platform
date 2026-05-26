// =============================================================================
// admin-reset-user-password
//
// Admin-triggered password reset. The caller (must be Admin) supplies a
// public.users.id; the function sends a Supabase Auth recovery email to
// that user's email address. The user clicks the link, lands on the
// app with #type=recovery in the URL hash, and the existing AuthGate +
// SetPasswordScreen flow takes over from there.
//
// Same mechanism as the public "Forgot password?" button on the login
// screen — just triggered server-side by an authenticated admin so a
// user who has lost access (or never finished the original invite)
// gets a fresh link sent without needing to type their own email
// into the login form.
//
// Why server-side and not just calling supabase.auth.resetPasswordForEmail
// from the admin browser:
//   - That call is rate-limited per IP. An admin firing several resets
//     in quick succession would hit the cap.
//   - The browser call doesn't require the caller to be authenticated
//     at all, let alone Admin — putting it server-side lets us enforce
//     "only admins can reset other users' passwords".
//   - The browser call also requires the user's email to be passed in,
//     creating a small risk of typos sending the link to the wrong
//     person. Server-side we look the email up from public.users.id,
//     so the admin picks the user by row, never types the email.
//
// Request body:
//   { "user_id": "<public.users.id uuid>" }
//
// Responses:
//   200 { ok: true,  email: "<the email we sent to>" }
//   400 { ok: false, error: "<validation message>" }
//   401 { ok: false, error: "Caller is not a registered LEAP user" }
//   403 { ok: false, error: "Caller is not an Admin" }
//   404 { ok: false, error: "User not found" }
//   500 { ok: false, error: "<server error>" }
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface ReqBody {
  user_id: string
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

// Resolve the caller's public.users row from the JWT in the Authorization
// header. Returns { id, role_name } or null. Mirrors the pattern used in
// import-prospecting-properties so the codebase has one auth shape.
async function resolveCaller(admin: SupabaseClient, authHeader: string):
  Promise<{ id: string, roleName: string | null } | null> {
  if (!authHeader.startsWith("Bearer ")) return null
  const jwt = authHeader.slice(7)
  try {
    const parts = jwt.split(".")
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")))
    const authUserId = payload.sub as string
    if (!authUserId) return null
    const { data: u } = await admin
      .from("users")
      .select("id, role:role_id ( role_name )")
      .eq("auth_user_id", authUserId)
      .maybeSingle()
    if (!u?.id) return null
    // The Supabase JS client returns the joined record either as an
    // object or an array depending on the relationship; both shapes
    // need handling.
    const roleField = (u as any).role
    const roleName  = Array.isArray(roleField)
      ? (roleField[0]?.role_name ?? null)
      : (roleField?.role_name    ?? null)
    return { id: u.id, roleName }
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors })
  if (req.method !== "POST")    return json({ ok: false, error: "Method not allowed" }, 405)

  let body: ReqBody
  try { body = await req.json() as ReqBody }
  catch { return json({ ok: false, error: "Invalid JSON body" }, 400) }

  if (!body?.user_id || typeof body.user_id !== "string") {
    return json({ ok: false, error: "user_id is required" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  // Site URL the user should land on after clicking the recovery link.
  // Falls back to a sensible default if the secret isn't set.
  const siteUrl     = Deno.env.get("LEAP_SITE_URL") || "https://ees-ops.netlify.app"

  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Server misconfiguration: Supabase keys missing" }, 500)
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Step 1 — verify the caller is Admin.
  const authHeader = req.headers.get("Authorization") || ""
  const caller = await resolveCaller(admin, authHeader)
  if (!caller) {
    return json({ ok: false, error: "Caller is not a registered LEAP user" }, 401)
  }
  if (caller.roleName !== "Admin") {
    return json({ ok: false, error: "Caller is not an Admin" }, 403)
  }

  // Step 2 — look up the target user's email from public.users.
  // Admin picks by row in the UI, so the user_id is trusted to be a
  // valid public.users.id. We still defensively check.
  const { data: target, error: lookupErr } = await admin
    .from("users")
    .select("id, user_email, user_is_deleted")
    .eq("id", body.user_id)
    .maybeSingle()

  if (lookupErr) {
    return json({ ok: false, error: `User lookup failed: ${lookupErr.message}` }, 500)
  }
  if (!target) {
    return json({ ok: false, error: "User not found" }, 404)
  }
  if (target.user_is_deleted) {
    return json({ ok: false, error: "User is deleted; restore the account before resetting" }, 400)
  }
  if (!target.user_email) {
    return json({ ok: false, error: "User has no email on file; add one before resetting" }, 400)
  }

  // Step 3 — send the recovery email via Supabase Auth Admin API.
  // `generateLink({ type: 'recovery' })` would return us a one-time URL
  // we could surface in-app, but the explicit ask is to send an email,
  // so we use `resetPasswordForEmail` (sends the email) rather than
  // generateLink (returns the URL). Both produce equivalent links;
  // the difference is who delivers them.
  //
  // The standard supabase.auth.resetPasswordForEmail is exposed on the
  // admin client too; using the service-role key bypasses the per-IP
  // rate limit that the public flow hits, so admins can fire several
  // resets without being throttled.
  const { error: resetErr } = await admin.auth.resetPasswordForEmail(
    target.user_email,
    { redirectTo: siteUrl },
  )

  if (resetErr) {
    return json({ ok: false, error: `Reset email send failed: ${resetErr.message}` }, 500)
  }

  return json({ ok: true, email: target.user_email })
})
