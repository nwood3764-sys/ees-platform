// =============================================================================
// property-owner-research
//
// Finds decision makers (CEO, asset manager, facilities director, ...) for
// property owner groups (accounts) and specific properties. Tiered by cost:
//
//   action: "web_research"   — FREE (no Lusha credits). Claude + web search
//                              investigates the organization: its domain,
//                              website leadership pages, parent companies,
//                              state registries, news. Returns named
//                              decision-maker candidates with source URLs.
//   action: "lusha_search"   — NO CREDITS. Lusha Prospecting contact search:
//                              names + titles + has-email/has-phone flags,
//                              but contact details stay masked.
//   action: "lusha_enrich"   — PAID CREDITS. Reveals email/phone for
//                              explicitly selected candidates only.
//
// Every run writes an owner_research_requests row (ORQ-) and one
// owner_research_candidates row (ORC-) per person found, so research is a
// first-class, auditable LEAP record. Auth mirrors import-prospecting-
// properties: caller JWT -> public.users.id; that user owns every record.
// A fail-closed shared-secret gate (same as admin-test-send-email) lets the
// autonomous self-test harness run on behalf of an explicit app user.
//
// Secrets: LUSHA_API_KEY is read from Deno env if set, else from Supabase
// Vault via the service-role-only get_integration_secret() RPC.
// ANTHROPIC_API_KEY comes from function env (already provisioned for
// ai-assistant).
//
// Request body:
//   { action: "web_research" | "lusha_search",
//     account_id?, property_id?, company_name?, company_domain?,
//     job_titles?: string[] }
//   { action: "lusha_enrich", request_id: uuid, candidate_ids: uuid[] }
//
// web_research runs as a BACKGROUND task (EdgeRuntime.waitUntil) because a
// full AI research pass exceeds the platform's 150s request idle timeout —
// the call returns 202 immediately and the client polls the ORQ row.
//
// Responses: 200 { ok, request, candidates } | 202 { ok, background, request }
//            | 4xx/5xx { ok:false, error }
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const LUSHA_BASE = "https://api.lusha.com"
const ANTHROPIC_MODEL = "claude-opus-4-8"
const MAX_WEB_SEARCHES = 8
const MAX_PAUSE_CONTINUATIONS = 4

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

async function resolveCallerUserId(admin: SupabaseClient, req: Request, body: Record<string, unknown>): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") || ""
  if (authHeader.startsWith("Bearer ")) {
    const jwt = authHeader.slice(7)
    try {
      const parts = jwt.split(".")
      if (parts.length === 3) {
        // The gateway (verify_jwt=true) has already verified the signature;
        // we only need the subject claim here.
        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")))
        const authUserId = payload.sub as string
        if (authUserId) {
          const { data: u } = await admin
            .from("users").select("id").eq("auth_user_id", authUserId).maybeSingle()
          if (u?.id) return u.id
        }
      }
    } catch { /* fall through to the self-test gate */ }
  }
  // Self-test gate (same fail-closed shared secret as admin-test-send-email):
  // lets the autonomous test harness run on behalf of an explicit app user.
  const expectedSecret = Deno.env.get("GRAPH_RENEWAL_CRON_SECRET")
                      || Deno.env.get("GRAPH_WEBHOOK_CLIENT_STATE")
  if (expectedSecret && (req.headers.get("x-pipeline-test-secret") || "") === expectedSecret) {
    const onBehalfOf = body.on_behalf_of_user_id as string | undefined
    if (onBehalfOf) {
      const { data: u } = await admin
        .from("users").select("id").eq("id", onBehalfOf).maybeSingle()
      return u?.id || null
    }
  }
  return null
}

async function getLushaApiKey(admin: SupabaseClient): Promise<string | null> {
  const fromEnv = Deno.env.get("LUSHA_API_KEY")
  if (fromEnv) return fromEnv
  const { data } = await admin.rpc("get_integration_secret", { p_name: "LUSHA_API_KEY" })
  return (data as string | null) || null
}

// ── Target resolution ───────────────────────────────────────────────────────
// Turn an account/property reference into the best-known organization name +
// domain to research. Property → its owning account first, HUD owner org as
// fallback; account → account_name + website domain.

function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`
    const host = new URL(withProto).hostname.replace(/^www\./i, "")
    return host || null
  } catch {
    return null
  }
}

interface Target {
  companyName: string | null
  companyDomain: string | null
  accountId: string | null
  propertyId: string | null
  contextLines: string[]
}

async function resolveTarget(admin: SupabaseClient, body: Record<string, unknown>): Promise<Target | string> {
  const target: Target = {
    companyName: (body.company_name as string) || null,
    companyDomain: (body.company_domain as string) || null,
    accountId: (body.account_id as string) || null,
    propertyId: (body.property_id as string) || null,
    contextLines: [],
  }

  if (target.propertyId) {
    const { data: prop, error } = await admin
      .from("properties")
      .select("id, property_name, property_city, property_state, property_website, property_account_id, property_hud_owner_org, property_hud_management_org")
      .eq("id", target.propertyId).maybeSingle()
    if (error || !prop) return "Property not found"
    target.contextLines.push(`Property: ${prop.property_name} (${prop.property_city || "?"}, ${prop.property_state || "?"})`)
    if (!target.accountId) target.accountId = prop.property_account_id
    if (!target.companyDomain) target.companyDomain = domainFromUrl(prop.property_website)
    if (prop.property_hud_owner_org) target.contextLines.push(`HUD-listed owner organization: ${prop.property_hud_owner_org}`)
    if (prop.property_hud_management_org) target.contextLines.push(`HUD-listed management organization: ${prop.property_hud_management_org}`)
    if (!target.companyName && prop.property_hud_owner_org) target.companyName = prop.property_hud_owner_org
  }

  if (target.accountId) {
    const { data: acct, error } = await admin
      .from("accounts")
      .select("id, account_name, account_website, account_organization_name, parent_account_id")
      .eq("id", target.accountId).maybeSingle()
    if (error || !acct) return "Account not found"
    target.companyName = acct.account_name || acct.account_organization_name || target.companyName
    if (!target.companyDomain) target.companyDomain = domainFromUrl(acct.account_website)
    target.contextLines.push(`Owner group (account): ${acct.account_name}`)
    if (acct.parent_account_id) {
      const { data: parent } = await admin
        .from("accounts").select("account_name").eq("id", acct.parent_account_id).maybeSingle()
      if (parent?.account_name) target.contextLines.push(`Parent account in CRM: ${parent.account_name}`)
    }
  }

  if (!target.companyName) return "Could not resolve an organization name to research — provide company_name"
  return target
}

async function defaultJobTitles(admin: SupabaseClient): Promise<string[]> {
  const { data } = await admin
    .from("picklist_values")
    .select("picklist_value, picklist_sort_order")
    .eq("picklist_object", "owner_research_requests")
    .eq("picklist_field", "orq_target_job_title")
    .eq("picklist_is_active", true)
    .order("picklist_sort_order")
  return (data || []).map((r: { picklist_value: string }) => r.picklist_value)
}

// ── Candidate persistence ───────────────────────────────────────────────────

interface CandidateDraft {
  source: string
  provider_contact_id?: string | null
  full_name: string
  first_name?: string | null
  last_name?: string | null
  job_title?: string | null
  seniority?: string | null
  department?: string | null
  company_name?: string | null
  company_domain?: string | null
  location?: string | null
  linkedin_url?: string | null
  has_emails?: boolean | null
  has_phones?: boolean | null
  emails?: unknown
  phones?: unknown
  source_urls?: unknown
  notes?: string | null
  raw?: unknown
}

async function insertCandidates(
  admin: SupabaseClient, requestId: string, target: Target, ownerId: string, drafts: CandidateDraft[],
) {
  if (drafts.length === 0) return []
  const rows = drafts.map((d) => ({
    orc_request_id: requestId,
    orc_account_id: target.accountId,
    orc_property_id: target.propertyId,
    orc_source: d.source,
    orc_provider_contact_id: d.provider_contact_id || null,
    orc_full_name: d.full_name,
    orc_first_name: d.first_name || null,
    orc_last_name: d.last_name || null,
    orc_job_title: d.job_title || null,
    orc_seniority: d.seniority || null,
    orc_department: d.department || null,
    orc_company_name: d.company_name || target.companyName,
    orc_company_domain: d.company_domain || target.companyDomain,
    orc_location: d.location || null,
    orc_linkedin_url: d.linkedin_url || null,
    orc_has_emails: d.has_emails ?? null,
    orc_has_phones: d.has_phones ?? null,
    orc_emails: d.emails ?? null,
    orc_phones: d.phones ?? null,
    orc_source_urls: d.source_urls ?? null,
    orc_notes: d.notes || null,
    orc_raw_payload: d.raw ?? null,
    orc_owner: ownerId,
    orc_created_by: ownerId,
  }))
  const { data, error } = await admin.from("owner_research_candidates").insert(rows).select()
  if (error) throw new Error(`Failed to save candidates: ${error.message}`)
  return data || []
}

async function finishRequest(
  admin: SupabaseClient, requestId: string, ownerId: string,
  patch: Record<string, unknown>,
) {
  await admin.from("owner_research_requests")
    .update({ ...patch, orq_updated_by: ownerId, orq_updated_at: new Date().toISOString(), orq_completed_at: new Date().toISOString() })
    .eq("id", requestId)
}

// ── Tier 1: free AI web research ────────────────────────────────────────────

function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf("[")
  if (start === -1) return null
  for (let end = text.length; end > start; end--) {
    if (text[end - 1] !== "]") continue
    try {
      const parsed = JSON.parse(text.slice(start, end))
      if (Array.isArray(parsed)) return parsed
    } catch { /* keep shrinking */ }
  }
  return null
}

async function runWebResearch(
  anthropicKey: string, target: Target, jobTitles: string[],
): Promise<{ candidates: CandidateDraft[]; summary: string; raw: unknown }> {
  const prompt = [
    `Research the real-estate organization below and identify its DECISION MAKERS — the people who can approve building-level energy efficiency / HVAC retrofit projects. Prioritize titles like: ${jobTitles.join(", ")}. Property-management site staff (property managers, leasing agents, maintenance techs) are NOT decision makers — exclude them unless nothing better exists.`,
    ``,
    `Organization: ${target.companyName}`,
    target.companyDomain ? `Known website domain: ${target.companyDomain}` : `Website domain: unknown — find it.`,
    ...target.contextLines.map((l) => `Context: ${l}`),
    ``,
    `Be creative and thorough with FREE public sources:`,
    `- The organization's own website (leadership/about/team pages).`,
    `- Whether it is a subsidiary — find the PARENT COMPANY and its executives if the parent makes capital decisions.`,
    `- State corporate registries (registered agents, officers), HUD/PHA listings, nonprofit filings (IRS 990 officers), LinkedIn company pages, press releases, industry news.`,
    ``,
    `Then reply with ONLY a JSON array (no prose before or after). Each element:`,
    `{"full_name": string, "job_title": string, "company_name": string, "company_domain": string|null, "location": string|null, "linkedin_url": string|null, "emails": string[]|null, "phones": string[]|null, "source_urls": string[], "notes": string}`,
    `Rules: only include people you found real evidence for (source_urls required, no guesses). Include publicly listed emails/phones only. "notes" = one sentence on why this person is the decision maker. If you find nothing, reply with [].`,
  ].join("\n")

  const messages: unknown[] = [{ role: "user", content: prompt }]
  let lastResponse: Record<string, unknown> | null = null

  for (let i = 0; i <= MAX_PAUSE_CONTINUATIONS; i++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 8000,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: MAX_WEB_SEARCHES }],
        messages,
      }),
    })
    if (!resp.ok) {
      const errBody = await resp.text()
      throw new Error(`Anthropic API error ${resp.status}: ${errBody.slice(0, 400)}`)
    }
    lastResponse = await resp.json()
    if (lastResponse?.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: lastResponse.content })
      continue
    }
    break
  }

  if (!lastResponse) throw new Error("Web research produced no response")
  if (lastResponse.stop_reason === "refusal") {
    throw new Error("Web research was declined by the model's safety system — try Lusha search instead")
  }

  const blocks = (lastResponse.content as Array<{ type: string; text?: string }>) || []
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("\n")
  const parsed = extractJsonArray(text) || []

  const candidates: CandidateDraft[] = []
  for (const p of parsed as Array<Record<string, unknown>>) {
    const fullName = typeof p.full_name === "string" ? p.full_name.trim() : ""
    if (!fullName) continue
    const emails = Array.isArray(p.emails) ? p.emails.filter((e) => typeof e === "string") : null
    const phones = Array.isArray(p.phones) ? p.phones.filter((e) => typeof e === "string") : null
    candidates.push({
      source: "Web Research",
      full_name: fullName,
      job_title: typeof p.job_title === "string" ? p.job_title : null,
      company_name: typeof p.company_name === "string" ? p.company_name : null,
      company_domain: typeof p.company_domain === "string" ? p.company_domain : null,
      location: typeof p.location === "string" ? p.location : null,
      linkedin_url: typeof p.linkedin_url === "string" ? p.linkedin_url : null,
      emails: emails && emails.length ? emails : null,
      phones: phones && phones.length ? phones : null,
      has_emails: emails && emails.length ? true : null,
      has_phones: phones && phones.length ? true : null,
      source_urls: Array.isArray(p.source_urls) ? p.source_urls : null,
      notes: typeof p.notes === "string" ? p.notes : null,
      raw: p,
    })
  }

  return { candidates, summary: text.slice(0, 4000), raw: { stop_reason: lastResponse.stop_reason, usage: lastResponse.usage } }
}

// ── Tier 2: Lusha prospecting search (no credits) ───────────────────────────

async function runLushaSearch(
  lushaKey: string, target: Target, jobTitles: string[],
): Promise<{ candidates: CandidateDraft[]; providerRequestId: string | null; raw: unknown }> {
  const companies: Record<string, unknown> = {}
  if (target.companyDomain) companies.domains = [target.companyDomain]
  else if (target.companyName) companies.names = [target.companyName]

  const body = {
    pages: { page: 0, size: 40 },
    filters: {
      companies: { include: companies },
      contacts: { include: { jobTitles: jobTitles } },
    },
  }

  const resp = await fetch(`${LUSHA_BASE}/prospecting/contact/search`, {
    method: "POST",
    headers: { api_key: lushaKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const payload = await resp.json().catch(() => null)
  if (resp.status === 404) {
    // Lusha returns 404 when no contacts match the filters
    return { candidates: [], providerRequestId: null, raw: payload }
  }
  if (!resp.ok) {
    const msg = payload?.message || payload?.error || JSON.stringify(payload)?.slice(0, 300)
    throw new Error(`Lusha search error ${resp.status}: ${msg}`)
  }

  const providerRequestId = payload?.requestId || null
  const rows: Array<Record<string, unknown>> = Array.isArray(payload?.data) ? payload.data
    : Array.isArray(payload?.contacts) ? payload.contacts : []

  const candidates: CandidateDraft[] = rows.map((c) => {
    const name = (c.name as string) ||
      [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown"
    return {
      source: "Lusha",
      provider_contact_id: c.contactId != null ? String(c.contactId) : (c.id != null ? String(c.id) : null),
      full_name: name,
      first_name: (c.firstName as string) || null,
      last_name: (c.lastName as string) || null,
      job_title: (c.jobTitle as string) || (c.title as string) || null,
      seniority: c.seniority != null ? String(c.seniority) : null,
      department: (c.department as string) || null,
      company_name: (c.companyName as string) || null,
      company_domain: (c.fqdn as string) || (c.companyDomain as string) || null,
      location: (c.location as string) || [c.city, c.state, c.country].filter(Boolean).join(", ") || null,
      has_emails: (c.hasEmails as boolean) ?? (c.hasWorkEmail as boolean) ?? null,
      has_phones: (c.hasPhones as boolean) ?? (c.hasDirectPhone as boolean) ?? (c.hasMobilePhone as boolean) ?? null,
      raw: c,
    }
  })

  return { candidates, providerRequestId, raw: { requestId: providerRequestId, total: payload?.totalResults ?? rows.length } }
}

// ── Tier 3: Lusha enrich (paid credits, explicit selection only) ────────────

async function runLushaEnrich(
  admin: SupabaseClient, lushaKey: string, requestId: string, candidateIds: string[], callerUserId: string,
) {
  const { data: reqRow, error: reqErr } = await admin
    .from("owner_research_requests")
    .select("id, orq_provider_request_id")
    .eq("id", requestId).maybeSingle()
  if (reqErr || !reqRow) throw new Error("Research request not found")
  if (!reqRow.orq_provider_request_id) {
    throw new Error("This request has no Lusha search attached — run a Lusha search first, then enrich its candidates")
  }

  const { data: cands, error: candErr } = await admin
    .from("owner_research_candidates")
    .select("id, orc_provider_contact_id")
    .in("id", candidateIds)
    .eq("orc_request_id", requestId)
    .eq("orc_is_deleted", false)
  if (candErr) throw new Error(`Failed to load candidates: ${candErr.message}`)
  const providerIds = (cands || []).map((c) => c.orc_provider_contact_id).filter(Boolean) as string[]
  if (providerIds.length === 0) throw new Error("No selected candidates carry a Lusha contact id")

  const resp = await fetch(`${LUSHA_BASE}/prospecting/contact/enrich`, {
    method: "POST",
    headers: { api_key: lushaKey, "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: reqRow.orq_provider_request_id, contactIds: providerIds }),
  })
  const payload = await resp.json().catch(() => null)
  if (!resp.ok) {
    const msg = payload?.message || payload?.error || JSON.stringify(payload)?.slice(0, 300)
    throw new Error(`Lusha enrich error ${resp.status}: ${msg}`)
  }

  const enriched: Array<Record<string, unknown>> = Array.isArray(payload?.contacts) ? payload.contacts
    : Array.isArray(payload?.data) ? payload.data : []

  const updated: unknown[] = []
  for (const e of enriched) {
    const pid = e.contactId != null ? String(e.contactId) : (e.id != null ? String(e.id) : null)
    if (!pid) continue
    const cand = (cands || []).find((c) => c.orc_provider_contact_id === pid)
    if (!cand) continue
    const emails = Array.isArray(e.emailAddresses) ? e.emailAddresses
      : Array.isArray(e.emails) ? e.emails : null
    const phones = Array.isArray(e.phoneNumbers) ? e.phoneNumbers
      : Array.isArray(e.phones) ? e.phones : null
    const { data: row } = await admin
      .from("owner_research_candidates")
      .update({
        orc_emails: emails,
        orc_phones: phones,
        orc_status: "Research Candidate Enriched",
        orc_enriched_at: new Date().toISOString(),
        orc_raw_payload: e,
        orc_updated_by: callerUserId,
        orc_updated_at: new Date().toISOString(),
      })
      .eq("id", cand.id)
      .select().maybeSingle()
    if (row) updated.push(row)
  }
  return { updated, rawCount: enriched.length }
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors })
  if (req.method !== "POST")    return json({ ok: false, error: "Method not allowed" }, 405)

  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> }
  catch { return json({ ok: false, error: "Invalid JSON body" }, 400) }

  const action = body.action as string
  if (!["web_research", "lusha_search", "lusha_enrich"].includes(action)) {
    return json({ ok: false, error: "action must be web_research | lusha_search | lusha_enrich" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Server misconfiguration: Supabase keys missing" }, 500)
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const callerUserId = await resolveCallerUserId(admin, req, body)
  if (!callerUserId) return json({ ok: false, error: "Caller is not a registered LEAP user" }, 401)

  try {
    // ---- Enrich: operates on an existing request, no new ORQ row ----------
    if (action === "lusha_enrich") {
      const requestId = body.request_id as string
      const candidateIds = body.candidate_ids as string[]
      if (!requestId || !Array.isArray(candidateIds) || candidateIds.length === 0) {
        return json({ ok: false, error: "request_id and candidate_ids are required" }, 400)
      }
      const lushaKey = await getLushaApiKey(admin)
      if (!lushaKey) return json({ ok: false, error: "LUSHA_API_KEY is not configured" }, 500)
      const result = await runLushaEnrich(admin, lushaKey, requestId, candidateIds, callerUserId)
      return json({ ok: true, candidates: result.updated })
    }

    // ---- Search actions: create an ORQ row, run, save ORC rows ------------
    const target = await resolveTarget(admin, body)
    if (typeof target === "string") return json({ ok: false, error: target }, 400)

    let jobTitles = Array.isArray(body.job_titles)
      ? (body.job_titles as string[]).filter((t) => typeof t === "string" && t.trim())
      : []
    if (jobTitles.length === 0) jobTitles = await defaultJobTitles(admin)
    if (jobTitles.length === 0) {
      return json({ ok: false, error: "No target job titles configured (picklist orq_target_job_title is empty)" }, 500)
    }

    const method = action === "web_research" ? "Web Research" : "Lusha Prospecting Search"
    const { data: reqRow, error: reqErr } = await admin
      .from("owner_research_requests")
      .insert({
        orq_account_id: target.accountId,
        orq_property_id: target.propertyId,
        orq_company_name: target.companyName,
        orq_company_domain: target.companyDomain,
        orq_target_job_titles: jobTitles,
        orq_research_method: method,
        orq_status: "Research Request Submitted",
        orq_owner: callerUserId,
        orq_created_by: callerUserId,
      })
      .select().single()
    if (reqErr || !reqRow) {
      return json({ ok: false, error: `Failed to create research request: ${reqErr?.message}` }, 500)
    }

    // Web research exceeds the request idle timeout — run it as a background
    // task and return immediately; the client polls the ORQ row.
    if (action === "web_research") {
      const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")
      if (!anthropicKey) {
        await finishRequest(admin, reqRow.id, callerUserId, {
          orq_status: "Research Request Failed",
          orq_error_message: "ANTHROPIC_API_KEY is not configured",
        })
        return json({ ok: false, error: "ANTHROPIC_API_KEY is not configured", request_id: reqRow.id }, 500)
      }
      const work = (async () => {
        try {
          const r = await runWebResearch(anthropicKey, target, jobTitles)
          const saved = await insertCandidates(admin, reqRow.id, target, callerUserId, r.candidates)
          await finishRequest(admin, reqRow.id, callerUserId, {
            orq_status: saved.length > 0 ? "Research Request Completed" : "Research Request No Results",
            orq_total_results: saved.length,
            orq_raw_response: r.raw,
          })
        } catch (inner) {
          await finishRequest(admin, reqRow.id, callerUserId, {
            orq_status: "Research Request Failed",
            orq_error_message: (inner as Error).message,
          })
        }
      })()
      // deno-lint-ignore no-explicit-any
      ;(globalThis as any).EdgeRuntime?.waitUntil?.(work)
      return json({ ok: true, background: true, request: reqRow }, 202)
    }

    try {
      const lushaKey = await getLushaApiKey(admin)
      if (!lushaKey) throw new Error("LUSHA_API_KEY is not configured")
      const r = await runLushaSearch(lushaKey, target, jobTitles)
      const saved = await insertCandidates(admin, reqRow.id, target, callerUserId, r.candidates)
      await finishRequest(admin, reqRow.id, callerUserId, {
        orq_status: saved.length > 0 ? "Research Request Completed" : "Research Request No Results",
        orq_total_results: saved.length,
        orq_provider_request_id: r.providerRequestId,
        orq_raw_response: r.raw,
      })
      return json({
        ok: true,
        request: { ...reqRow, orq_status: saved.length > 0 ? "Research Request Completed" : "Research Request No Results", orq_total_results: saved.length, orq_provider_request_id: r.providerRequestId },
        candidates: saved,
      })
    } catch (inner) {
      await finishRequest(admin, reqRow.id, callerUserId, {
        orq_status: "Research Request Failed",
        orq_error_message: (inner as Error).message,
      })
      return json({ ok: false, error: (inner as Error).message, request_id: reqRow.id }, 500)
    }
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500)
  }
})
