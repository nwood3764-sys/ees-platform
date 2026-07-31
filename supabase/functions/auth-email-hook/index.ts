// auth-email-hook
//
// Supabase Auth "Send Email Hook" endpoint. When enabled (Auth -> Hooks -> Send
// Email Hook), Supabase stops sending its own auth emails (password reset,
// invite, magic link, signup confirmation, email change, reauthentication) and
// POSTs the payload here instead. This function renders a branded LEAP email and
// sends it through Microsoft Graph from the company no-reply mailbox.
//
// It reuses the SAME app-only (client-credentials) Graph flow as
// send-notification-email -- reading the existing OUTLOOK_CLIENT_ID /
// OUTLOOK_CLIENT_SECRET / OUTLOOK_TENANT_ID secrets -- but is fully
// self-contained so it never touches the outreach / notification pipeline.
//
// Auth: the request is signed with the Standard Webhooks scheme using
// SEND_EMAIL_HOOK_SECRET (shown in the Supabase Auth -> Hooks UI as
// "v1,whsec_..."). verify_jwt is off for this function; the signature IS the auth.
//
// Required secrets:
//   SEND_EMAIL_HOOK_SECRET  the hook signing secret from Supabase (v1,whsec_...)
//   AUTH_EMAIL_SENDER       the Graph mailbox to send from (e.g. noreply@energyefficiencyservices.org)
//   OUTLOOK_CLIENT_ID / OUTLOOK_CLIENT_SECRET / OUTLOOK_TENANT_ID  existing Graph app (app-only Mail.Send)
//   SUPABASE_URL            project API URL (auto-provided) -- used to build the verify link

import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0"

const APP_NAME = "LEAP"
const COMPANY = "Energy Efficiency Services"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, webhook-id, webhook-timestamp, webhook-signature",
}

interface EmailData {
  token: string
  token_hash: string
  redirect_to: string
  email_action_type: string
  site_url: string
  token_hash_new?: string
}
interface HookPayload {
  user: { email: string; new_email?: string }
  email_data: EmailData
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

async function getGraphToken(): Promise<string> {
  const clientId = Deno.env.get("OUTLOOK_CLIENT_ID")
  const clientSecret = Deno.env.get("OUTLOOK_CLIENT_SECRET")
  const tenantId = Deno.env.get("OUTLOOK_TENANT_ID")
  if (!clientId || !clientSecret || !tenantId) {
    throw new Error("Missing OUTLOOK_* Graph credentials")
  }
  const resp = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }),
    },
  )
  const j = await resp.json()
  if (!j.access_token) {
    throw new Error(`Graph token error: ${JSON.stringify(j).slice(0, 300)}`)
  }
  return j.access_token as string
}

// GoTrue verifies the link at the project's /auth/v1/verify endpoint, then
// redirects the user on to redirect_to (their leap.energyefficiencyservices.org
// landing path). email_change uses the new-address token when present.
function verifyUrl(supabaseUrl: string, d: EmailData): string {
  const isChange = d.email_action_type.startsWith("email_change")
  const tokenHash = isChange && d.token_hash_new ? d.token_hash_new : d.token_hash
  const params = new URLSearchParams({
    token: tokenHash,
    type: d.email_action_type,
    redirect_to: d.redirect_to || d.site_url || "",
  })
  return `${supabaseUrl}/auth/v1/verify?${params.toString()}`
}

function content(
  type: string,
  token: string,
): { subject: string; heading: string; body: string } {
  switch (type) {
    case "recovery":
      return {
        subject: `Reset your ${APP_NAME} password`,
        heading: "Reset your password",
        body:
          `We received a request to reset the password for your ${APP_NAME} account. ` +
          `Click the button below to choose a new one. If you didn't request this, you can safely ignore this email.`,
      }
    case "invite":
      return {
        subject: `You've been invited to ${APP_NAME}`,
        heading: `Welcome to ${APP_NAME}`,
        body:
          `You've been invited to ${APP_NAME}, the ${COMPANY} operations platform. ` +
          `Click below to set your password and get started.`,
      }
    case "magiclink":
      return {
        subject: `Your ${APP_NAME} sign-in link`,
        heading: `Sign in to ${APP_NAME}`,
        body:
          `Click the button below to sign in to your ${APP_NAME} account. This link can only be used once.`,
      }
    case "signup":
      return {
        subject: `Confirm your ${APP_NAME} email`,
        heading: "Confirm your email",
        body: `Please confirm your email address to activate your ${APP_NAME} account.`,
      }
    case "email_change":
    case "email_change_current":
    case "email_change_new":
      return {
        subject: `Confirm your new ${APP_NAME} email`,
        heading: "Confirm your email change",
        body: `Please confirm this email address for your ${APP_NAME} account.`,
      }
    case "reauthentication":
      return {
        subject: `Your ${APP_NAME} verification code`,
        heading: "Verification code",
        body:
          `Enter this code to continue: ` +
          `<strong style="font-size:20px;letter-spacing:2px">${token}</strong>`,
      }
    default:
      return {
        subject: `${APP_NAME} account notification`,
        heading: APP_NAME,
        body: `Click below to continue to your ${APP_NAME} account.`,
      }
  }
}

function renderHtml(
  heading: string,
  body: string,
  link: string,
  showButton: boolean,
): string {
  const button = showButton
    ? `
      <tr><td style="padding:8px 0 24px">
        <a href="${link}" style="display:inline-block;background:#3ecf8e;color:#07111f;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px">Continue</a>
      </td></tr>
      <tr><td style="color:#4a5e7a;font-size:13px;padding-bottom:8px">Or paste this link into your browser:</td></tr>
      <tr><td style="font-size:12px;word-break:break-all"><a href="${link}" style="color:#2aab72">${link}</a></td></tr>`
    : ""
  return `<!doctype html><html><body style="margin:0;background:#f0f3f8;font-family:Inter,Arial,sans-serif">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f3f8;padding:32px 0">
      <tr><td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e4e9f2;border-radius:8px;padding:32px">
          <tr><td style="color:#0d1a2e;font-size:20px;font-weight:700;padding-bottom:16px">${heading}</td></tr>
          <tr><td style="color:#4a5e7a;font-size:14px;line-height:22px;padding-bottom:16px">${body}</td></tr>
          ${button}
          <tr><td style="border-top:1px solid #e4e9f2;color:#8fa0b8;font-size:12px;padding-top:16px">${COMPANY} &middot; ${APP_NAME}</td></tr>
        </table>
      </td></tr>
    </table></body></html>`
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") {
    return json(405, { error: { http_code: 405, message: "Method not allowed" } })
  }

  const hookSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET")
  const sender = Deno.env.get("AUTH_EMAIL_SENDER")
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  if (!hookSecret || !sender || !supabaseUrl) {
    return json(500, {
      error: {
        http_code: 500,
        message:
          "Server misconfiguration: missing SEND_EMAIL_HOOK_SECRET / AUTH_EMAIL_SENDER / SUPABASE_URL",
      },
    })
  }

  const raw = await req.text()

  // Verify the Standard Webhooks signature -- this is how we trust the caller.
  let payload: HookPayload
  try {
    const wh = new Webhook(hookSecret.replace("v1,whsec_", ""))
    payload = wh.verify(raw, {
      "webhook-id": req.headers.get("webhook-id") || "",
      "webhook-timestamp": req.headers.get("webhook-timestamp") || "",
      "webhook-signature": req.headers.get("webhook-signature") || "",
    }) as HookPayload
  } catch (e) {
    return json(401, {
      error: { http_code: 401, message: `Invalid webhook signature: ${(e as Error).message}` },
    })
  }

  const d = payload.email_data
  const isChange = d.email_action_type.startsWith("email_change")
  const to = isChange && payload.user?.new_email ? payload.user.new_email : payload.user?.email
  if (!to) {
    return json(400, { error: { http_code: 400, message: "No recipient email in payload" } })
  }

  const link = verifyUrl(supabaseUrl, d)
  const c = content(d.email_action_type, d.token)
  const html = renderHtml(c.heading, c.body, link, d.email_action_type !== "reauthentication")

  // Send via Microsoft Graph from the company no-reply mailbox.
  try {
    const token = await getGraphToken()
    const graphRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            subject: c.subject,
            body: { contentType: "HTML", content: html },
            toRecipients: [{ emailAddress: { address: to } }],
          },
          saveToSentItems: false,
        }),
      },
    )
    if (graphRes.status !== 202) {
      const errText = await graphRes.text()
      return json(500, {
        error: { http_code: 500, message: `Graph sendMail ${graphRes.status}: ${errText.slice(0, 500)}` },
      })
    }
  } catch (e) {
    return json(500, { error: { http_code: 500, message: `Send failed: ${(e as Error).message}` } })
  }

  // 200 with empty JSON body = success; Supabase treats the email as sent.
  return json(200, {})
})
