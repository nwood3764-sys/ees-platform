// =============================================================================
// admin-reset-user-password
//
// Admin-triggered password reset. The caller (must be Admin) supplies a
// public.users.id and a delivery channel; the function gets the user a
// Supabase Auth recovery link. The user opens the link, lands on the
// app with #type=recovery in the URL hash, and the existing AuthGate +
// SetPasswordScreen flow takes over from there.
//
// Delivery channels (v8):
//   'email' (default) — GoTrue sends its standard recovery email, exactly
//                       as before.
//   'sms'             — generateLink({type:'recovery'}) and text the link
//                       to the user's mobile through send-notification-sms
//                       (Twilio). Requires a phone on the public.users row.
//   'link'            — generateLink and return the URL to the admin UI so
//                       they can hand it over on any channel themselves.
//                       (The Users pane's reset modal renders + copies it.)
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
//   { "user_id": "<public.users.id uuid>", "channel": "email" | "sms" | "link" }
//
// Responses:
//   200 { ok: true, email, channel, recovery_url?, sms_sent?, sms_detail?, phone_last4? }
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
  channel?: "email" | "sms" | "link"
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
    // Verify the JWT signature + expiry via GoTrue instead of trusting an
    // unsigned base64 decode of the payload. A blind atob() decode authorizes
    // on an attacker-forgeable `sub`; if verify_jwt were ever disabled for this
    // function that would be instant account takeover (forge an Admin's sub →
    // reset any user's password). getUser rejects any token it can't verify.
    const { data: authData, error: authErr } = await admin.auth.getUser(jwt)
    const authUserId = authData?.user?.id
    if (authErr || !authUserId) return null
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
  const channel = body.channel || "email"
  if (!["email", "sms", "link"].includes(channel)) {
    return json({ ok: false, error: "channel must be 'email', 'sms', or 'link'" }, 400)
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

  // Step 2 — look up the target user's email + phone from public.users.
  // Admin picks by row in the UI, so the user_id is trusted to be a
  // valid public.users.id. We still defensively check.
  const { data: target, error: lookupErr } = await admin
    .from("users")
    .select("id, user_email, user_phone, user_first_name, user_is_deleted")
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
  if (channel === "sms" && !target.user_phone) {
    return json({ ok: false, error: "User has no phone number on file; add one or use the email channel" }, 400)
  }

  // Step 3 — deliver by the requested channel.
  //
  // email: GoTrue sends its own recovery email (resetPasswordForEmail). The
  //   service-role client bypasses the public flow's per-IP rate limit, so
  //   admins can fire several resets without being throttled.
  //
  // sms / link: generateLink({type:'recovery'}) returns the one-time URL
  //   without sending anything; we then text it (sms) or hand it back to the
  //   admin UI (link). NOTE each new recovery link supersedes the previous
  //   one — that's also why 'email' doesn't additionally return a URL: the
  //   emailed link is the only live one.
  if (channel === "email") {
    const { error: resetErr } = await admin.auth.resetPasswordForEmail(
      target.user_email,
      { redirectTo: siteUrl },
    )
    if (resetErr) {
      return json({ ok: false, error: `Reset email send failed: ${resetErr.message}` }, 500)
    }
    return json({ ok: true, email: target.user_email, channel })
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: target.user_email,
    options: { redirectTo: siteUrl },
  })
  const recoveryUrl = linkData?.properties?.action_link
  if (linkErr || !recoveryUrl) {
    return json({ ok: false, error: `Recovery link generation failed: ${linkErr?.message || "no link returned"}` }, 500)
  }

  if (channel === "link") {
    return json({ ok: true, email: target.user_email, channel, recovery_url: recoveryUrl })
  }

  // channel === 'sms'
  const phoneE164 = `+1${target.user_phone}`
  const bodyText =
    `EES LEAP: ${target.user_first_name || "Hi"}, here is your one-time password reset link: ${recoveryUrl} ` +
    `It expires in 1 hour. If you didn't request this, you can ignore this message.`
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/send-notification-sms`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        trigger_event:   "password_reset_link",
        recipient_phone: phoneE164,
        body_text:       bodyText,
      }),
    })
    const payload = await resp.json().catch(() => null)
    if (!resp.ok || payload?.status === "error" || payload?.status === "failed") {
      const detail = payload?.failure_reason || payload?.error || payload?.message || `HTTP ${resp.status}`
      return json({ ok: false, error: `SMS send failed: ${detail}` }, 500)
    }
    return json({
      ok: true,
      email: target.user_email,
      channel,
      sms_sent: true,
      sms_detail: payload?.mode === "mock" ? "mock (Twilio not configured yet)" : "sent",
      phone_last4: target.user_phone.slice(-4),
    })
  } catch (e) {
    return json({ ok: false, error: `SMS dispatch threw: ${(e as Error).message}` }, 500)
  }
})
