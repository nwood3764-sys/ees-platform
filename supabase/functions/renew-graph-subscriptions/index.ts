// ─── renew-graph-subscriptions ───────────────────────────────────────────
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
//   - Mock mode (any of OUTLOOK_CLIENT_ID / _SECRET / _TENANT_ID is unset):
//     enumerates nothing, returns {mode:'mock', would_renew:0}. Lets the
//     cron schedule land cleanly before Azure AD is configured.
//   - Real mode: calls Graph as described below.
//
// Real-mode flow:
//   1. Acquire app access token via client_credentials against the
//      common token endpoint (mirrors send-email-v1.getAppAccessToken).
//   2. GET https://graph.microsoft.com/v1.0/subscriptions — returns every
//      subscription the app owns across all resources (inbox messages,
//      calendar events, etc.).
//   3. For each subscription whose expirationDateTime falls inside the
//      renewal window (default: next 24 hours), PATCH the subscription
//      with a new expirationDateTime set to the per-resource maximum
//      (Graph caps mail subscriptions at 4230 minutes ≈ 70 hours; we
//      request 4200 minutes = 70h to stay just under).
//   4. Returns a summary {mode, total_subscriptions, renewal_window_h,
//      attempted, succeeded, failed[]} for observability via cron logs.
//
// Public per-call response is JSON. Pre-shared-key auth via the
// GRAPH_RENEWAL_CRON_SECRET env var lets the pg_cron job authenticate
// without the Supabase JWT (cron's net.http_post doesn't carry user
// context). Mismatch → 401. Missing in mock mode → still accepted, so
// developers can hit the endpoint without configuring the secret.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-graph-renewal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const GRAPH_BASE = "https://graph.microsoft.com/v1.0"

// Per-resource max lifetime in minutes. Graph documents these as hard caps
// per https://learn.microsoft.com/en-us/graph/api/resources/subscription
// We request a value just under the cap to avoid clock-skew rejections.
// Mail (messages on a mailbox) — 4230 min; we request 4200 (70h).
// Calendar events — 4230 min; same treatment.
// We don't differentiate at present — 4200 is safe for both.
const RENEWAL_TARGET_MINUTES = 4200

// Renewal window. We renew anything expiring inside this window so a
// missed cron run doesn't drop the subscription.
const DEFAULT_RENEWAL_WINDOW_HOURS = 24

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })
  if (req.method !== "POST")    return json({ error: "POST only" }, 405)

  // Pre-shared-key auth so the pg_cron net.http_post call can reach us
  // without needing a user JWT. In mock mode we skip the check so the
  // function is safe to call manually before secrets are configured.
  const expectedSecret = Deno.env.get("GRAPH_RENEWAL_CRON_SECRET")
  const presentedSecret = req.headers.get("x-graph-renewal-secret") || ""
  if (expectedSecret && presentedSecret !== expectedSecret) {
    return json({ error: "Forbidden: missing or wrong x-graph-renewal-secret" }, 401)
  }

  const clientId     = Deno.env.get("OUTLOOK_CLIENT_ID")
  const clientSecret = Deno.env.get("OUTLOOK_CLIENT_SECRET")
  const tenantId     = Deno.env.get("OUTLOOK_TENANT_ID")
  const supabaseUrl  = Deno.env.get("SUPABASE_URL")!
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

  // Optional body to override the renewal window for one-off catch-up
  // runs ({"renewal_window_hours": 72}).
  let renewalWindowH = DEFAULT_RENEWAL_WINDOW_HOURS
  try {
    const body = await req.json().catch(() => ({})) as { renewal_window_hours?: number }
    if (typeof body.renewal_window_hours === "number" && body.renewal_window_hours > 0) {
      renewalWindowH = Math.min(body.renewal_window_hours, 72)
    }
  } catch { /* empty body is fine */ }

  // Mock mode — no Azure AD app yet, nothing to renew. Return success
  // so the cron job logs aren't full of failures before configuration.
  const mockMode = !clientId || !clientSecret || !tenantId
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

  // Real-mode work
  let accessToken: string
  try {
    accessToken = await getAppAccessToken(tenantId!, clientId!, clientSecret!)
  } catch (e) {
    await logRun(admin, { mode: "real", phase: "token", error: (e as Error).message })
    return json({ mode: "real", error: `Token acquisition failed: ${(e as Error).message}` }, 502)
  }

  // List every subscription the app owns. Graph paginates with @odata.nextLink;
  // for our scale we expect single-digit subscriptions (one per inbound mailbox)
  // and a single page. Walk the link just in case.
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

// ─── helpers ─────────────────────────────────────────────────────────────

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

// Lightweight observability — writes one row per cron run into a new
// table if it exists; silently skips if the table isn't present. The
// table is optional so this function can be deployed before any
// schema work lands. See migration 20260520120000.
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
