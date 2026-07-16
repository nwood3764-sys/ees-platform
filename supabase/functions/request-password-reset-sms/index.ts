// =============================================================================
// request-password-reset-sms
//
// Public (verify_jwt = false) counterpart to the login screen's email-based
// "Forgot password?" flow: the user types the mobile number on their LEAP
// profile, and if it matches exactly one active user we text that user a
// one-time Supabase Auth recovery link via send-notification-sms (Twilio).
//
// Security model — this endpoint is reachable without any session, so it is
// built to leak nothing and to be useless for abuse:
//
//   • No enumeration: the response is always { ok: true } with identical
//     wording whether or not the phone matched a user. Delivery state is
//     never revealed to the requester — only the phone's owner learns
//     anything (by receiving, or not receiving, a text).
//   • The link only ever goes TO the phone number on file. An attacker who
//     submits someone else's number can only cause the real owner to get a
//     reset text they didn't ask for — the message says to ignore it.
//   • Rate limited per phone (3 per 15 minutes) and per client IP
//     (10 per hour) via the password_reset_sms_requests table. Every
//     attempt is logged there — including throttled ones — so abuse is
//     auditable. Throttled requests still return { ok: true }.
//   • Ambiguous matches (the same phone on multiple active users) send
//     nothing: we can't know which account the requester means, and texting
//     several accounts' reset links to one phone would be worse.
//
// Request body:  { "phone": "<free-form US phone>" }
// Response:      200 { ok: true }  — always, except malformed input (400)
//                                    and server misconfiguration (500).
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const PER_PHONE_LIMIT   = 3   // requests per phone per window
const PER_PHONE_WINDOW  = 15  // minutes
const PER_IP_LIMIT      = 10  // requests per client IP per window
const PER_IP_WINDOW     = 60  // minutes

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

// Same normalization contract as invite-user: bare 10 US digits.
function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  let digits = raw.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1)
  return digits.length === 10 ? digits : null
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors })
  if (req.method !== "POST")    return json({ ok: false, error: "Method not allowed" }, 405)

  let body: { phone?: string }
  try { body = await req.json() }
  catch { return json({ ok: false, error: "Invalid JSON body" }, 400) }

  const phone = normalizePhone(body?.phone)
  if (!phone) {
    // Malformed input is the one case we answer honestly — it can't leak
    // account existence because no lookup has happened yet.
    return json({ ok: false, error: "Enter a 10-digit US mobile number." }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const siteUrl     = Deno.env.get("LEAP_SITE_URL") || "https://ees-ops.netlify.app"
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Server misconfiguration" }, 500)
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Client IP for rate limiting. x-forwarded-for is set by the edge gateway;
  // fall back to a constant so a missing header still buckets (conservatively)
  // rather than bypassing the IP limit.
  const clientIp = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim()

  // ── Rate limiting (fail closed: a counting error throttles) ───────────────
  const phoneWindowStart = new Date(Date.now() - PER_PHONE_WINDOW * 60_000).toISOString()
  const ipWindowStart    = new Date(Date.now() - PER_IP_WINDOW    * 60_000).toISOString()

  const [{ count: phoneCount, error: phoneCountErr }, { count: ipCount, error: ipCountErr }] = await Promise.all([
    admin.from("password_reset_sms_requests")
      .select("id", { count: "exact", head: true })
      .eq("prsr_phone", phone)
      .gte("prsr_created_at", phoneWindowStart),
    admin.from("password_reset_sms_requests")
      .select("id", { count: "exact", head: true })
      .eq("prsr_client_ip", clientIp)
      .gte("prsr_created_at", ipWindowStart),
  ])

  const throttled =
    !!phoneCountErr || !!ipCountErr ||
    (phoneCount ?? 0) >= PER_PHONE_LIMIT ||
    (ipCount ?? 0)    >= PER_IP_LIMIT

  // Log every attempt (throttled or not) for auditability. Failure to log is
  // not fatal to the user flow but is worth a server-side error line.
  let userFound = false
  let smsDispatched = false

  if (!throttled) {
    // Match exactly one active, sign-in-capable user by phone.
    const { data: matches } = await admin
      .from("users")
      .select("id, user_email, user_first_name, auth_user_id")
      .eq("user_phone", phone)
      .eq("user_is_active", true)
      .eq("user_is_deleted", false)
      .not("user_email", "is", null)
      .limit(2)

    if (matches && matches.length === 1) {
      userFound = true
      const target = matches[0]
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: target.user_email as string,
        options: { redirectTo: siteUrl },
      })
      const recoveryUrl = linkData?.properties?.action_link
      if (!linkErr && recoveryUrl) {
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
              recipient_phone: `+1${phone}`,
              body_text:       bodyText,
            }),
          })
          const payload = await resp.json().catch(() => null)
          smsDispatched = resp.ok && payload?.status === "ok"
        } catch (e) {
          console.error("request-password-reset-sms: SMS dispatch threw", e)
        }
      } else {
        console.error("request-password-reset-sms: generateLink failed", linkErr?.message)
      }
    }
  }

  const { error: logErr } = await admin.from("password_reset_sms_requests").insert({
    prsr_phone:          phone,
    prsr_client_ip:      clientIp,
    prsr_was_throttled:  throttled,
    prsr_user_found:     userFound,
    prsr_sms_dispatched: smsDispatched,
  })
  if (logErr) console.error("request-password-reset-sms: attempt log insert failed", logErr.message)

  // Identical response in every non-error case — matched, unmatched,
  // ambiguous, throttled — so nothing about account existence leaks.
  return json({ ok: true })
})
