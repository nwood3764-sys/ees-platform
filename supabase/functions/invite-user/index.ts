// invite-user — Supabase Edge Function
//
// Called from the browser by an authenticated admin to invite a new user (or
// re-invite an orphan public.users row that has no auth link yet).
//
// Why an Edge Function rather than a client-side call:
//   `auth.admin.inviteUserByEmail` requires the service-role key. That key
//   must NEVER ride in the browser bundle. This function holds it as a
//   server-side secret and does the privileged work on the caller's behalf
//   after verifying the caller is an Admin.
//
// v7 additions:
//   • Delivery channels. `send_email` (default true) keeps the standard
//     Supabase Auth invite email. `send_sms: true` additionally (or instead)
//     texts a one-time sign-in link to the user's mobile via the
//     send-notification-sms function (Twilio). Email-off + SMS-on uses
//     `generateLink({type:'invite'})` so no email is ever dispatched.
//   • Internal-secret path. Alongside the Admin-JWT path, a fail-closed
//     shared secret (internal_cron_auth row 'user_provisioning', sent as
//     x-internal-auth-secret) plus an explicit on_behalf_of_user_id that
//     must resolve to an active Admin lets server-side automation provision
//     users — same pattern dispatch-scheduled-reports uses for its cron gate.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SUPABASE_ANON_KEY         = Deno.env.get("SUPABASE_ANON_KEY")!

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-auth-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

function getInviteRedirectUrl(req: Request): string {
  const origin = req.headers.get("origin")
  if (origin && /^https?:\/\/(localhost(:\d+)?|.+\.netlify\.app)$/.test(origin)) {
    return origin
  }
  return "https://ees-ops.netlify.app"
}

// Normalize a free-form phone entry to the storage format the DB enforces:
// exactly 10 digits, no formatting (users_user_phone_check = ^\d{10}$).
// The UI accepts human-friendly input (dashes, parens, spaces, optional US
// country code); we strip it here so "515-808-0381" is stored as "5158080381".
// Returns { ok: true, value: string | null } on success (null = no phone),
// or { ok: false, error: string } when the input can't be a 10-digit US number.
function normalizePhone(raw: string | undefined): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  let digits = String(raw).replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1)
  if (digits.length === 0) return { ok: true, value: null }
  if (digits.length === 10) return { ok: true, value: digits }
  return {
    ok: false,
    error: `Phone number must be a 10-digit US number. After removing formatting, "${raw}" has ${digits.length} digit(s).`,
  }
}

// Stored phones are bare 10-digit US numbers; Twilio wants E.164.
function toE164(tenDigits: string): string {
  return `+1${tenDigits}`
}

// Text a one-time sign-in link through the platform's Twilio sender.
// Returns the sender's status ('ok' | 'failed' | 'mock' | error text) so the
// caller can surface delivery state without failing the whole invite —
// the user record and auth account are already committed by the time we text.
async function sendAuthLinkSms(phoneE164: string, bodyText: string): Promise<{ sent: boolean; detail: string }> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-notification-sms`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        trigger_event:   "user_invite_link",
        recipient_phone: phoneE164,
        body_text:       bodyText,
      }),
    })
    const payload = await resp.json().catch(() => null)
    if (!resp.ok || payload?.status === "error") {
      return { sent: false, detail: payload?.error || payload?.message || `HTTP ${resp.status}` }
    }
    if (payload?.status === "failed") {
      return { sent: false, detail: payload?.failure_reason || "Twilio send failed" }
    }
    // payload.mode is 'real' or 'mock' (mock = Twilio credentials not yet configured)
    return { sent: true, detail: payload?.mode === "mock" ? "mock (Twilio not configured yet)" : "sent" }
  } catch (e) {
    return { sent: false, detail: `SMS dispatch threw: ${(e as Error).message}` }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return jsonResponse({ error: "Method not allowed" }, 405)

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let payload: any
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  // ── Caller resolution ─────────────────────────────────────────────────────
  // Path 1 (normal): browser session JWT belonging to an active Admin.
  // Path 2 (automation): x-internal-auth-secret matching the fail-closed
  //   internal_cron_auth 'user_provisioning' row + on_behalf_of_user_id that
  //   resolves to an active Admin. The acting user is stamped on audit fields
  //   either way, so provenance is identical in both paths.
  let callerProfile: { id: string } | null = null

  const authHeader = req.headers.get("Authorization") || ""
  if (authHeader.startsWith("Bearer ")) {
    const { data: callerData } = await createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    }).auth.getUser()
    if (callerData?.user) {
      const { data: profile, error: profileErr } = await adminClient
        .from("users")
        .select("id, role_id, user_is_active, user_is_deleted, roles:role_id ( role_name, role_is_active )")
        .eq("auth_user_id", callerData.user.id)
        .maybeSingle()
      if (profileErr) {
        return jsonResponse({ error: "Failed to verify caller", detail: profileErr.message }, 500)
      }
      if (profile && !profile.user_is_deleted && profile.user_is_active
          && (profile.roles as any)?.role_name === "Admin") {
        callerProfile = { id: profile.id }
      } else if (profile) {
        return jsonResponse({ error: "Only Admin users can invite new users" }, 403)
      }
    }
  }

  if (!callerProfile) {
    const suppliedSecret = req.headers.get("x-internal-auth-secret") || ""
    const onBehalfOf: string | undefined = payload.on_behalf_of_user_id?.trim?.() || undefined
    if (suppliedSecret && onBehalfOf) {
      const { data: secretRow } = await adminClient
        .from("internal_cron_auth")
        .select("secret")
        .eq("name", "user_provisioning")
        .maybeSingle()
      if (secretRow?.secret && secretRow.secret === suppliedSecret) {
        const { data: actor } = await adminClient
          .from("users")
          .select("id, user_is_active, user_is_deleted, roles:role_id ( role_name )")
          .eq("id", onBehalfOf)
          .maybeSingle()
        if (actor && !actor.user_is_deleted && actor.user_is_active
            && (actor.roles as any)?.role_name === "Admin") {
          callerProfile = { id: actor.id }
        }
      }
    }
  }

  if (!callerProfile) {
    return jsonResponse({ error: "Caller has no active LEAP profile or is not an Admin" }, 403)
  }

  const existingUserId: string | undefined = payload.existing_user_id?.trim?.() || undefined
  const email: string  | undefined         = payload.email?.trim?.().toLowerCase() || undefined
  const firstName: string | undefined      = payload.first_name?.trim?.() || undefined
  const lastName: string  | undefined      = payload.last_name?.trim?.()  || undefined
  const roleId: string    | undefined      = payload.role_id?.trim?.()    || undefined
  const title: string     | undefined      = payload.title?.trim?.()      || undefined
  const phone: string     | undefined      = payload.phone?.trim?.()      || undefined
  const sendEmail: boolean                 = payload.send_email !== false // default true
  const sendSms: boolean                   = payload.send_sms === true    // default false

  if (existingUserId) {
    if (!/^[0-9a-f-]{36}$/i.test(existingUserId)) {
      return jsonResponse({ error: "existing_user_id must be a UUID" }, 400)
    }
  } else {
    if (!email)     return jsonResponse({ error: "email is required" }, 400)
    if (!firstName) return jsonResponse({ error: "first_name is required" }, 400)
    if (!lastName)  return jsonResponse({ error: "last_name is required" }, 400)
    if (!roleId)    return jsonResponse({ error: "role_id is required" }, 400)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "email is not a valid email address" }, 400)
    }
  }
  if (!sendEmail && !sendSms) {
    return jsonResponse({ error: "At least one delivery channel (send_email or send_sms) is required" }, 400)
  }

  // Normalize + validate phone BEFORE any auth-user creation, so an invalid
  // phone returns a clean 400 instead of orphaning an auth identity.
  const phoneResult = normalizePhone(phone)
  if (!phoneResult.ok) {
    return jsonResponse({ error: phoneResult.error }, 400)
  }
  const normalizedPhone = phoneResult.value

  if (roleId) {
    const { data: roleRow, error: roleErr } = await adminClient
      .from("roles")
      .select("id, role_name, role_is_active")
      .eq("id", roleId)
      .maybeSingle()
    if (roleErr) return jsonResponse({ error: "Failed to validate role", detail: roleErr.message }, 500)
    if (!roleRow) return jsonResponse({ error: "role_id not found" }, 400)
    if (!roleRow.role_is_active) return jsonResponse({ error: "Role is inactive" }, 400)
  }

  const redirectTo = getInviteRedirectUrl(req)

  // Create the auth identity + get everything needed for delivery.
  //   sendEmail=true  → inviteUserByEmail (GoTrue creates the user AND sends
  //                     its standard invite email).
  //   sendEmail=false → generateLink({type:'invite'}) (creates the user,
  //                     returns the one-time link, sends nothing).
  // The SMS link is generated separately below once the user exists.
  async function createAuthUser(inviteEmail: string, fullName?: string):
    Promise<{ ok: true; authUserId: string; inviteLink: string | null } | { ok: false; error: string }> {
    if (sendEmail) {
      const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
        inviteEmail,
        fullName ? { redirectTo, data: { full_name: fullName } } : { redirectTo },
      )
      if (inviteErr || !invited?.user) return { ok: false, error: inviteErr?.message || "Invite failed" }
      return { ok: true, authUserId: invited.user.id, inviteLink: null }
    }
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: "invite",
      email: inviteEmail,
      options: fullName ? { redirectTo, data: { full_name: fullName } } : { redirectTo },
    })
    if (linkErr || !linkData?.user) return { ok: false, error: linkErr?.message || "Invite link generation failed" }
    return { ok: true, authUserId: linkData.user.id, inviteLink: linkData.properties?.action_link || null }
  }

  // Text the sign-in link. When the invite email already went out (its link
  // uses the confirmation token), the SMS gets a recovery link — a separate
  // token slot, so both links stay valid. When no email was sent, the SMS
  // carries the invite link itself.
  async function deliverSms(inviteEmail: string, targetPhone: string, existingInviteLink: string | null):
    Promise<{ sent: boolean; detail: string }> {
    let link = existingInviteLink
    if (!link) {
      const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email: inviteEmail,
        options: { redirectTo },
      })
      if (linkErr || !linkData?.properties?.action_link) {
        return { sent: false, detail: linkErr?.message || "Could not generate sign-in link for SMS" }
      }
      link = linkData.properties.action_link
    }
    const bodyText =
      `EES LEAP: You've been invited to LEAP. Tap this one-time link to set your password and sign in: ${link} ` +
      `The link expires in 1 hour. If it expires, use "Forgot password?" on the sign-in page.`
    return await sendAuthLinkSms(toE164(targetPhone), bodyText)
  }

  if (existingUserId) {
    const { data: existing, error: existingErr } = await adminClient
      .from("users")
      .select("id, user_email, user_phone, auth_user_id, user_is_deleted")
      .eq("id", existingUserId)
      .maybeSingle()
    if (existingErr) return jsonResponse({ error: "Failed to load user", detail: existingErr.message }, 500)
    if (!existing)   return jsonResponse({ error: "User not found" }, 404)
    if (existing.user_is_deleted) return jsonResponse({ error: "User is deleted" }, 400)
    if (existing.auth_user_id)    return jsonResponse({ error: "User already has an auth account" }, 409)
    if (!existing.user_email)     return jsonResponse({ error: "User has no email address on file" }, 400)

    const inviteEmail = existing.user_email.toLowerCase()
    const smsPhone = normalizedPhone || existing.user_phone
    if (sendSms && !smsPhone) {
      return jsonResponse({ error: "SMS delivery requested but the user has no phone number" }, 400)
    }

    const created = await createAuthUser(inviteEmail)
    if (!created.ok) return jsonResponse({ error: "Invite failed", detail: created.error }, 400)

    const updates: Record<string, unknown> = {
      auth_user_id: created.authUserId,
      user_updated_by: callerProfile.id,
      user_updated_at: new Date().toISOString(),
    }
    if (roleId) updates.role_id = roleId
    if (title !== undefined) updates.user_title = title
    if (phone !== undefined) updates.user_phone = normalizedPhone

    const { error: updateErr } = await adminClient
      .from("users")
      .update(updates)
      .eq("id", existingUserId)

    if (updateErr) {
      await adminClient.auth.admin.deleteUser(created.authUserId).catch(() => undefined)
      return jsonResponse({ error: "Failed to link user", detail: updateErr.message }, 500)
    }

    let sms: { sent: boolean; detail: string } | null = null
    if (sendSms && smsPhone) {
      sms = await deliverSms(inviteEmail, smsPhone, created.inviteLink)
    }

    return jsonResponse({
      ok: true,
      flow: "relink",
      user_id: existingUserId,
      auth_user_id: created.authUserId,
      email: inviteEmail,
      email_sent: sendEmail,
      sms_sent: sms?.sent ?? false,
      sms_detail: sms?.detail ?? null,
    })
  }

  const { data: dup, error: dupErr } = await adminClient
    .from("users")
    .select("id, user_record_number")
    .eq("user_is_deleted", false)
    .ilike("user_email", email!)
    .maybeSingle()
  if (dupErr)  return jsonResponse({ error: "Failed to check for duplicates", detail: dupErr.message }, 500)
  if (dup)     return jsonResponse({ error: `An active user with email ${email} already exists (${dup.user_record_number})` }, 409)

  if (sendSms && !normalizedPhone) {
    return jsonResponse({ error: "SMS delivery requested but no phone number was provided" }, 400)
  }

  const fullName = `${firstName} ${lastName}`.trim()
  const created = await createAuthUser(email!, fullName)
  if (!created.ok) return jsonResponse({ error: "Invite failed", detail: created.error }, 400)

  const { data: newUser, error: insertErr } = await adminClient
    .from("users")
    .insert({
      user_record_number: "",
      auth_user_id:       created.authUserId,
      user_first_name:    firstName,
      user_last_name:     lastName,
      user_name:          fullName,
      user_email:         email,
      user_title:         title || null,
      user_phone:         normalizedPhone,
      role_id:            roleId,
      user_is_active:     true,
      user_is_deleted:    false,
      user_created_by:    callerProfile.id,
      user_created_at:    new Date().toISOString(),
    })
    .select("id, user_record_number")
    .single()

  if (insertErr || !newUser) {
    await adminClient.auth.admin.deleteUser(created.authUserId).catch(() => undefined)
    return jsonResponse({ error: "Failed to create user record", detail: insertErr?.message }, 500)
  }

  let sms: { sent: boolean; detail: string } | null = null
  if (sendSms && normalizedPhone) {
    sms = await deliverSms(email!, normalizedPhone, created.inviteLink)
  }

  return jsonResponse({
    ok: true,
    flow: "invite",
    user_id: newUser.id,
    user_record_number: newUser.user_record_number,
    auth_user_id: created.authUserId,
    email,
    email_sent: sendEmail,
    sms_sent: sms?.sent ?? false,
    sms_detail: sms?.detail ?? null,
  })
})
