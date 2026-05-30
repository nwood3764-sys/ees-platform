// ─── renew-graph-subscriptions v2 ────────────────────────────────────────
// Microsoft Graph subscriptions expire every ~3 days. Without renewal the
// inbound-email-webhook stops receiving notifications and inbound email
// silently goes dark. This function enumerates every Graph subscription
// owned by the Azure AD app and extends the expirationDateTime on any
// that fall inside the renewal window.
//
// Scheduled via pg_cron (every 6 hours — plenty of headroom against the
// 3-day expiry). Re-runnable safely; idempotent within one window.
//
// Operating modes:
//   - Mock mode (any of OUTLOOK_CLIENT_ID / _SECRET / _TENANT_ID unset):
//     enumerates nothing, returns {mode:'mock'}. Secret is OPTIONAL here
//     so developers can hit the endpoint without configuring env vars —
//     no real Graph access happens so there's nothing to protect.
//   - Real mode: secret is REQUIRED (fail-closed). Missing env var
//     returns 500 and logs to graph_subscription_renewal_runs so the
//     misconfig surfaces in the audit table. Wrong secret returns 401.
//
// v2 change vs v1: previously the secret check short-circuited if env
// var was unset (fail-open). With Graph creds configured but secret
// env var unset, any anonymous caller could enumerate our subscriptions
// via /functions/v1/renew-graph-subscriptions. v2 splits the auth gate
// by mode so real-mode is fail-closed.
//
// Real-mode flow (once auth passes):
//   1. Acquire app access token via client_credentials against the
//      common token endpoint (mirrors send-email-v1.getAppAccessToken).
//   2. GET /v1.0/subscriptions — returns every subscription the app owns
//      across all resources (inbox messages, calendar events, etc.).
//   3. For each subscription whose expirationDateTime falls inside the
//      renewal window (default: next 24 hours), PATCH with new
//      expirationDateTime set to RENEWAL_TARGET_MINUTES from now.
//      (Graph caps mail subscriptions at 4230 minutes ≈ 70 hours;
//      we request 4200 minutes to stay just under.)
//   4. Returns a summary {mode, total_subscriptions, renewal_window_h,
//      attempted, succeeded, failed[]} for observability via cron logs.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-graph-renewal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const GRAPH_BASE = "https://graph.microsoft.com/v1.0"
const RENEWAL_TARGET_MINUTES = 4200
const DEFAULT_RENEWAL_WINDOW_HOURS = 24

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })
  if (req.method !== "POST")    return json({ error: "POST only" }, 405)

  const expectedSecret  = Deno.env.get("GRAPH_RENEWAL_CRON_SECRET")
  const presentedSecret = req.headers.get("x-graph-renewal-secret") || ""

  const clientId     = Deno.env.get("OUTLOOK_CLIENT_ID")
  const clientSecret = Deno.env.get("OUTLOOK_CLIENT_SECRET")
  const tenantId     = Deno.env.get("OUTLOOK_TENANT_ID")
  const supabaseUrl  = Deno.env.get("SUPABASE_URL")!
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

  let renewalWindowH = DEFAULT_RENEWAL_WINDOW_HOURS
  try {
    const body = await req.json().catch(() => ({})) as { renewal_window_hours?: number }
    if (typeof body.renewal_window_hours === "number" && body.renewal_window_hours > 0) {
      renewalWindowH = Math.min(body.renewal_window_hours, 72)
    }
  } catch { /* empty body is fine */ }

  const mockMode = !clientId || !clientSecret || !tenantId

  // Auth gate. Real mode = fail-closed (production safety). Mock mode =
  // fail-open (developer-friendly; function does no real work anyway).
  if (!mockMode) {
    if (!expectedSecret) {
      const admin = createClient(supabaseUrl, serviceKey)
      await logRun(admin, {
        mode: "real", phase: "auth",
        error: "GRAPH_RENEWAL_CRON_SECRET env var not configured; refusing to serve in real mode",
      })
      return json({
        error: "Server misconfigured: GRAPH_RENEWAL_CRON_SECRET env var missing. Set it in Supabase project env vars to match the cron job's x-graph-renewal-secret header.",
      }, 500)
    }
    if (presentedSecret !== expectedSecret) {
      return json({ error: "Forbidden: missing or wrong x-graph-renewal-secret" }, 401)
    }
  }

  if (mockMode) {
    return json({
      mode: "mock",
      reason: "OUTLOOK_CLIENT_ID / _SECRET / _TENANT_ID not configured; subscription renewal skipped",
      renewal_window_h: renewalWindowH,
      total_subscriptions: 0,
      attempted: 0,
      succeeded: 0,
      failed: [],
    }, 200)
  }

  const admin: SupabaseClient = createClient(supabaseUrl, serviceKey)

  let accessToken: string
  try {
    accessToken = await getAppAccessToken(tenantId!, clientId!, clientSecret!)
  } catch (e) {
    await logRun(admin, { mode: "real", phase: "token", error: (e as Error).message })
    return json({ mode: "real", error: `Token acquisition failed: ${(e as Error).message}` }, 502)
  }

  const subscriptions: GraphSubscription[] = []
  let nextUrl: string | null = `${GRAPH_BASE}/subscriptions`
  while (nextUrl) {
    const resp = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "")
      await logRun(admin, { mode: "real", phase: "list", error: `Graph ${resp.status}: ${errText.slice(0, 500)}` })
      return json({ mode: "real", error: `List subscriptions failed: HTTP ${resp.status}` }, 502)
    }
    const j = await resp.json() as { value: GraphSubscription[], "@odata.nextLink"?: string }
    subscriptions.push(...(j.value || []))
    nextUrl = j["@odata.nextLink"] || null
  }

  const now = Date.now()
  const windowMs = renewalWindowH * 60 * 60 * 1000
  const dueForRenewal = subscriptions.filter(s => {
    const exp = Date.parse(s.expirationDateTime)
    return Number.isFinite(exp) && (exp - now) <= windowMs
  })

  const newExpiration = new Date(now + RENEWAL_TARGET_MINUTES * 60 * 1000).toISOString()
  const failed: Array<{ id: string, resource: string, error: string }> = []
  let succeeded = 0

  for (const sub of dueForRenewal) {
    try {
      const resp = await fetch(`${GRAPH_BASE}/subscriptions/${sub.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expirationDateTime: newExpiration }),
      })
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "")
        failed.push({ id: sub.id, resource: sub.resource, error: `HTTP ${resp.status}: ${errText.slice(0, 400)}` })
        continue
      }
      succeeded++
    } catch (e) {
      failed.push({ id: sub.id, resource: sub.resource, error: (e as Error).message })
    }
  }

  const summary = {
    mode: "real" as const,
    renewal_window_h: renewalWindowH,
    new_expiration_iso: newExpiration,
    total_subscriptions: subscriptions.length,
    attempted: dueForRenewal.length,
    succeeded,
    failed,
  }
  await logRun(admin, summary)
  return json(summary, 200)
})

interface GraphSubscription {
  id: string
  resource: string
  expirationDateTime: string
  changeType: string
  clientState?: string
  notificationUrl?: string
}

async function getAppAccessToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const resp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }).toString(),
  })
  const j = await resp.json()
  if (!resp.ok) throw new Error(j.error_description || j.error || `Token endpoint HTTP ${resp.status}`)
  if (!j.access_token) throw new Error("Token response missing access_token")
  return j.access_token as string
}

async function logRun(admin: SupabaseClient, summary: Record<string, unknown>): Promise<void> {
  try {
    await admin.from("graph_subscription_renewal_runs").insert({
      gsrr_ran_at:  new Date().toISOString(),
      gsrr_summary: summary,
    })
  } catch { /* table may not exist yet; that's fine */ }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
