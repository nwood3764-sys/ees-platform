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

  const { data: callerData, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerData?.user) {
    return jsonResponse({ error: "Invalid or expired session" }, 401)
  }
  const callerAuthUserId = callerData.user.id

  const { data: callerProfile, error: callerProfileErr } = await adminClient
    .from("users")
    .select("id, role_id, user_is_active, user_is_deleted, roles:role_id ( role_name, role_is_active )")
    .eq("auth_user_id", callerAuthUserId)
    .maybeSingle()

  if (callerProfileErr) {
    return jsonResponse({ error: "Failed to verify caller", detail: callerProfileErr.message }, 500)
  }
  if (!callerProfile || callerProfile.user_is_deleted || !callerProfile.user_is_active) {
    return jsonResponse({ error: "Caller has no active Anura profile" }, 403)
  }
  const callerRoleName = (callerProfile.roles as any)?.role_name
  if (callerRoleName !== "Admin") {
    return jsonResponse({ error: "Only Admin users can invite new users" }, 403)
  }

  let payload: any
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  const existingUserId: string | undefined = payload.existing_user_id?.trim?.() || undefined
  const email: string  | undefined         = payload.email?.trim?.().toLowerCase() || undefined
  const firstName: string | undefined      = payload.first_name?.trim?.() || undefined
  const lastName: string  | undefined      = payload.last_name?.trim?.()  || undefined
  const roleId: string    | undefined      = payload.role_id?.trim?.()    || undefined
  const title: string     | undefined      = payload.title?.trim?.()      || undefined
  const phone: string     | undefined      = payload.phone?.trim?.()      || undefined

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

  if (existingUserId) {
    const { data: existing, error: existingErr } = await adminClient
      .from("users")
      .select("id, user_email, auth_user_id, user_is_deleted")
      .eq("id", existingUserId)
      .maybeSingle()
    if (existingErr) return jsonResponse({ error: "Failed to load user", detail: existingErr.message }, 500)
    if (!existing)   return jsonResponse({ error: "User not found" }, 404)
    if (existing.user_is_deleted) return jsonResponse({ error: "User is deleted" }, 400)
    if (existing.auth_user_id)    return jsonResponse({ error: "User already has an auth account" }, 409)
    if (!existing.user_email)     return jsonResponse({ error: "User has no email address on file" }, 400)

    const inviteEmail = existing.user_email.toLowerCase()

    const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
      inviteEmail,
      { redirectTo: getInviteRedirectUrl(req) },
    )
    if (inviteErr || !invited?.user) {
      return jsonResponse({ error: "Invite failed", detail: inviteErr?.message }, 400)
    }

    const updates: Record<string, unknown> = {
      auth_user_id: invited.user.id,
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
      await adminClient.auth.admin.deleteUser(invited.user.id).catch(() => undefined)
      return jsonResponse({ error: "Failed to link user", detail: updateErr.message }, 500)
    }

    return jsonResponse({
      ok: true,
      flow: "relink",
      user_id: existingUserId,
      auth_user_id: invited.user.id,
      email: inviteEmail,
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

  const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
    email!,
    {
      redirectTo: getInviteRedirectUrl(req),
      data: { full_name: `${firstName} ${lastName}`.trim() },
    },
  )
  if (inviteErr || !invited?.user) {
    return jsonResponse({ error: "Invite failed", detail: inviteErr?.message }, 400)
  }

  const { data: newUser, error: insertErr } = await adminClient
    .from("users")
    .insert({
      user_record_number: "",
      auth_user_id:       invited.user.id,
      user_first_name:    firstName,
      user_last_name:     lastName,
      user_name:          `${firstName} ${lastName}`.trim(),
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
    await adminClient.auth.admin.deleteUser(invited.user.id).catch(() => undefined)
    return jsonResponse({ error: "Failed to create user record", detail: insertErr?.message }, 500)
  }

  return jsonResponse({
    ok: true,
    flow: "invite",
    user_id: newUser.id,
    user_record_number: newUser.user_record_number,
    auth_user_id: invited.user.id,
    email,
  })
})
