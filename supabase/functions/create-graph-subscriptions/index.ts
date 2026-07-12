// ─── create-graph-subscriptions ────────────────────────────────────────────
// Creates Microsoft Graph change-notification subscriptions on shared mailbox
// inboxes so inbound customer replies are pushed to inbound-email-webhook and
// auto-logged. The renewer (renew-graph-subscriptions) only extends existing
// subscriptions — this is the missing step that creates them in the first place.
//
// Auth: app-only (client credentials) to Graph, same creds as send-email-v1.
// Trigger auth: header `x-graph-subscription-secret` must equal
// GRAPH_WEBHOOK_CLIENT_STATE (the same shared secret the webhook validates), so
// this can be invoked safely from pg_net / cron without a user JWT.
//
// Body (optional): { "mailboxes": ["ncira@ees-nc.org", ...] }
// If omitted, subscribes every non-deleted outbound_mailboxes address.
//
// Results are recorded in public.graph_subscriptions and also returned.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-graph-subscription-secret",
}

// Graph caps /messages subscriptions at ~4230 minutes; stay just under.
const EXPIRATION_MINUTES = 4200

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  const clientState = Deno.env.get("GRAPH_WEBHOOK_CLIENT_STATE")
  const provided = req.headers.get("x-graph-subscription-secret") || ""
  if (!clientState) return json({ error: "GRAPH_WEBHOOK_CLIENT_STATE not configured" }, 500)
  if (provided !== clientState) return json({ error: "unauthorized" }, 401)

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const clientId     = Deno.env.get("OUTLOOK_CLIENT_ID")
  const clientSecret = Deno.env.get("OUTLOOK_CLIENT_SECRET")
  const tenantId     = Deno.env.get("OUTLOOK_TENANT_ID")
  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase keys missing" }, 500)
  if (!clientId || !clientSecret || !tenantId) return json({ error: "Graph app credentials missing (OUTLOOK_CLIENT_ID/SECRET/TENANT_ID)" }, 500)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  let reqBody: any = {}
  try { reqBody = await req.json() } catch { /* body optional */ }

  let mailboxes: string[] = Array.isArray(reqBody?.mailboxes) ? reqBody.mailboxes.filter(Boolean) : []
  if (mailboxes.length === 0) {
    const { data } = await admin
      .from("outbound_mailboxes")
      .select("obm_address")
      .eq("obm_is_deleted", false)
    mailboxes = (data || []).map((r: any) => r.obm_address).filter(Boolean)
  }
  if (mailboxes.length === 0) return json({ error: "No mailboxes to subscribe" }, 400)

  const notificationUrl = `${supabaseUrl}/functions/v1/inbound-email-webhook`
  const expiration = new Date(Date.now() + EXPIRATION_MINUTES * 60 * 1000).toISOString()

  let token: string
  try {
    token = await getAppAccessToken(tenantId, clientId, clientSecret)
  } catch (e) {
    return json({ error: `Graph token failed: ${(e as Error).message}` }, 502)
  }

  const results: any[] = []
  for (const mb of mailboxes) {
    const resource = `/users/${mb}/mailFolders('inbox')/messages`
    try {
      const res = await fetch("https://graph.microsoft.com/v1.0/subscriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          changeType: "created",
          notificationUrl,
          resource,
          expirationDateTime: expiration,
          clientState,
        }),
      })
      const jr = await res.json().catch(() => ({}))
      if (res.ok) {
        await admin.from("graph_subscriptions").insert({
          gs_mailbox: mb,
          gs_subscription_id: jr.id,
          gs_resource: jr.resource || resource,
          gs_expiration: jr.expirationDateTime || expiration,
          gs_status: "active",
        })
        results.push({ mailbox: mb, ok: true, subscription_id: jr.id, expiration: jr.expirationDateTime })
      } else {
        const errText = JSON.stringify(jr).slice(0, 1500)
        await admin.from("graph_subscriptions").insert({
          gs_mailbox: mb, gs_status: "error", gs_error: `${res.status}: ${errText}`,
        })
        results.push({ mailbox: mb, ok: false, status: res.status, error: jr })
      }
    } catch (e) {
      const reason = (e as Error).message
      await admin.from("graph_subscriptions").insert({ gs_mailbox: mb, gs_status: "error", gs_error: reason })
      results.push({ mailbox: mb, ok: false, error: reason })
    }
  }

  return json({ notificationUrl, expiration, results }, 200)
})

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
