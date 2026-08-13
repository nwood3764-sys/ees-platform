// ─── create-homes-intake ────────────────────────────────────────────────
// Staff HOMES intake. Given pasted inquiry info for a pre-qualified NC
// single-family homeowner, this:
//   1. Creates the CRM chain via the create_homes_intake RPC (Account/Contact/
//      Property[single-family]/Building[single-family]/Opportunity[NC SF HOMES
//      audit]/Project[single-family energy assessment]).
//   2. Builds a personalized, prefilled "Schedule Now" link to the public NC
//      booking page.
//   3. Emails the homeowner a welcome + that link through send-email-v1 —
//      anchored to the opportunity so it sends from the NC state mailbox, logs
//      to the contact's Communications, and threads replies.
//
// Auth: verify_jwt=true. Staff-only; the caller's JWT identifies the LEAP user
// who owns the created records and whose name signs the welcome email.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://ees-ops.netlify.app"
const BOOKING_SLUG = "nc-energy-savers-site-visit"

// NC program identity for the welcome email body. The sending mailbox's
// signature (resolved by send-email-v1) carries the full program footer.
const NC_COMPANY = "Energy Efficiency Services of North Carolina"
const NC_PHONE   = "(704) 990-5614"

interface ReqBody {
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  street?: string
  city?: string
  state?: string
  zip?: string
  ami_tier?: string
  notes?: string
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ error: "Server misconfiguration: Supabase keys missing" }, 500)
  }

  const authHeader = req.headers.get("Authorization") || ""
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "Missing bearer token" }, 401)
  }

  let body: ReqBody
  try { body = await req.json() as ReqBody }
  catch { return json({ error: "Invalid JSON body" }, 400) }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Resolve caller → app user (for record ownership + email signature).
  const { data: authData } = await admin.auth.getUser(authHeader.replace(/^[Bb]earer\s+/, ""))
  const authUser = authData?.user
  if (!authUser) return json({ error: "Invalid or expired session" }, 401)

  const { data: appUser } = await admin
    .from("users")
    .select("id")
    .eq("auth_user_id", authUser.id)
    .maybeSingle()
  if (!appUser) return json({ error: "Caller is not a registered LEAP user" }, 401)

  // 1. Create the CRM chain as the caller (owner = staff member).
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: rpcData, error: rpcErr } = await userClient.rpc("create_homes_intake", { payload: body })
  if (rpcErr)  return json({ error: `Intake failed: ${rpcErr.message}` }, 400)
  if (!rpcData || rpcData.status !== "ok") {
    return json({ error: rpcData?.message || "Intake failed", intake: rpcData }, 400)
  }

  const p = rpcData.prefill || {}
  const scheduleUrl = buildScheduleUrl(p)

  // 2. Send the welcome email through send-email-v1 (anchored to the opportunity).
  const emailResult = await sendWelcomeEmail(supabaseUrl, serviceKey, {
    opportunity_id: rpcData.opportunity_id,
    recipient_email: p.email,
    recipient_name: `${p.first} ${p.last}`.trim(),
    first_name: p.first,
    contact_id: rpcData.contact_id,
    schedule_url: scheduleUrl,
    on_behalf_of_user_id: appUser.id,
  })

  return json({
    status: "ok",
    ...rpcData,
    schedule_url: scheduleUrl,
    email: emailResult,
  }, 200)
})

function buildScheduleUrl(p: Record<string, string>): string {
  const q = new URLSearchParams()
  if (p.first)  q.set("first",  p.first)
  if (p.last)   q.set("last",   p.last)
  if (p.email)  q.set("email",  p.email)
  if (p.phone)  q.set("phone",  p.phone)
  if (p.street) q.set("street", p.street)
  if (p.city)   q.set("city",   p.city)
  if (p.state)  q.set("state",  p.state)
  if (p.zip)    q.set("zip",    p.zip)
  return `${APP_BASE_URL}/sa/${BOOKING_SLUG}?${q.toString()}`
}

async function sendWelcomeEmail(
  supabaseUrl: string, serviceKey: string,
  args: {
    opportunity_id: string
    recipient_email: string
    recipient_name: string
    first_name: string
    contact_id: string | null
    schedule_url: string
    on_behalf_of_user_id: string
  },
): Promise<Record<string, unknown>> {
  if (!args.recipient_email) return { status: "skipped_no_email" }

  const subject = "Let's schedule your free home energy assessment"
  const bodyHtml = welcomeHtml(args.first_name, args.schedule_url)

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email-v1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
      body: JSON.stringify({
        anchor_object:    "opportunities",
        anchor_record_id: args.opportunity_id,
        to:               { email: args.recipient_email, name: args.recipient_name || args.recipient_email },
        subject,
        body_html:        bodyHtml,
        contact_id:       args.contact_id || undefined,
        state:            "NC",
        on_behalf_of_user_id: args.on_behalf_of_user_id,
      }),
    })
    const data = await res.json().catch(() => null)
    return { http_status: res.status, ...(data || {}) }
  } catch (e) {
    return { status: "dispatch_error", message: (e as Error).message }
  }
}

function welcomeHtml(firstName: string, scheduleUrl: string): string {
  const hi = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,"
  return `<div style="margin:0;padding:0;background:#f0f3f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f3f8;padding:24px 0;font-family:Inter,Arial,Helvetica,sans-serif;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e4e9f2;border-radius:8px;overflow:hidden;">
<tr><td style="background:#07111f;padding:20px 32px;"><span style="color:#ffffff;font-size:16px;font-weight:600;letter-spacing:.01em;">${NC_COMPANY}</span></td></tr>
<tr><td style="padding:32px 32px 8px;">
<h1 style="margin:0 0 8px;color:#0d1a2e;font-size:22px;font-weight:700;line-height:28px;">You're pre-qualified, ${escapeHtml(firstName || "")}!</h1>
<p style="margin:0 0 16px;color:#4a5e7a;font-size:15px;line-height:22px;">${hi} good news &mdash; your home qualifies for a <strong>free home energy assessment</strong> through the North Carolina Energy Savers program. The next step is to pick a time that works for you.</p>
<p style="margin:0 0 8px;color:#0d1a2e;font-size:15px;font-weight:600;">What to expect</p>
<ul style="margin:0 0 24px;padding-left:20px;color:#4a5e7a;font-size:14px;line-height:22px;">
<li>A friendly visit from our North Carolina Energy Auditor, about 30&ndash;45 minutes.</li>
<li>We'll look at insulation, HVAC, and other areas that affect your energy use.</li>
<li>There's no cost and no obligation.</li>
</ul>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#3ecf8e;"><a href="${scheduleUrl}" style="display:inline-block;padding:14px 32px;color:#07111f;font-size:16px;font-weight:600;text-decoration:none;border-radius:8px;">Schedule your assessment</a></td></tr></table>
<p style="margin:24px 0 0;color:#8fa0b8;font-size:13px;line-height:20px;">Prefer to talk to someone? Call us at ${NC_PHONE} or just reply to this email.</p>
</td></tr>
<tr><td style="background:#f7f9fc;border-top:1px solid #e4e9f2;padding:20px 32px;"><p style="margin:0;color:#8fa0b8;font-size:12px;line-height:18px;">${NC_COMPANY}</p></td></tr>
</table></td></tr></table></div>`
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }
  return (s || "").replace(/[&<>"']/g, (c) => map[c])
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
