// =============================================================================
// property-owner-research
//
// Finds decision makers (CEO, asset manager, facilities director, ...) for
// property owner groups (accounts) and specific properties. Actions:
//
//   action: "deep_research"   — the staged research pipeline (the default the
//                               UI runs). A request walks a state machine:
//                               Owner Identification → Organization Research →
//                               Decision Maker Discovery → Contact Info
//                               Gathering. Each stage is its OWN invocation
//                               with a fresh time budget, chained via
//                               self-invocation, and every stage's output is
//                               persisted as a stored fact in
//                               orq_stage_results. Ends at
//                               "Research Request Ready for Review".
//   action: "run_stage"       — internal: executes one stage of an existing
//                               request. Called by the stage chain (shared
//                               pipeline secret) or to retry a failed stage.
//   action: "web_research"    — legacy single-pass AI research (kept for
//                               compatibility; deep_research supersedes it).
//   action: "lusha_search"    — NO CREDITS. Lusha Prospecting contact search:
//                               names + titles + has-email/has-phone flags,
//                               but contact details stay masked.
//   action: "lusha_enrich"    — PAID CREDITS. Reveals email/phone for
//                               explicitly selected candidates only.
//
// Every run writes an owner_research_requests row (ORQ-) and one
// owner_research_candidates row (ORC-) per person found, so research is a
// first-class, auditable LEAP record. Auth mirrors import-prospecting-
// properties: caller JWT -> public.users.id; that user owns every record.
// A fail-closed shared-secret gate (same as admin-test-send-email) lets the
// autonomous self-test harness AND the stage chain run on behalf of an
// explicit app user.
//
// Secrets: LUSHA_API_KEY is read from Deno env if set, else from Supabase
// Vault via the service-role-only get_integration_secret() RPC.
// ANTHROPIC_API_KEY comes from function env (already provisioned for
// ai-assistant).
//
// Request body:
//   { action: "deep_research" | "web_research" | "lusha_search",
//     account_id?, property_id?, company_name?, company_domain?,
//     job_titles?: string[] }
//   { action: "run_stage", request_id: uuid, stage: string }
//   { action: "lusha_enrich", request_id: uuid, candidate_ids: uuid[] }
//
// deep_research / run_stage / web_research all run as BACKGROUND tasks
// (EdgeRuntime.waitUntil) because a research pass exceeds the platform's
// 150s request idle timeout — the call returns 202 immediately and the
// client polls the ORQ row.
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
// The whole background task must finish inside the edge worker's 400s wall
// clock, so the legacy single-pass research is deliberately time-boxed: few
// searches, low effort (fast; plenty for name/title extraction), and an
// explicit speed instruction in the prompt.
const MAX_WEB_SEARCHES = 6
const MAX_WEB_SEARCHES_OWNER_UNKNOWN = 6
// Search snippets alone rarely name a property's owner — the researcher must
// be able to OPEN the listing pages it finds (LIHTC databases, waitlist
// pages, assessor records), like a human clicking a result. Fetched pages
// are capped hard: uncapped fetches blew the 400s worker wall clock.
const MAX_WEB_FETCHES = 4
const MAX_FETCH_CONTENT_TOKENS = 8000
const MAX_PAUSE_CONTINUATIONS = 3
const STALE_RUN_MINUTES = 8

// Staged deep research: each stage gets a fresh 400s wall clock, so the
// per-stage tool budget stays small while effort goes UP to medium (better
// reasoning about which sources to trust — affordable once stages are small).
const STAGE_MAX_SEARCHES = 4
const STAGE_MAX_FETCHES = 3
const STAGE_FETCH_CONTENT_TOKENS = 6000
const STAGE_EFFORT = "medium"
// How many candidates the Contact Info Gathering stage researches per run.
const STAGE_CONTACT_INFO_MAX_PEOPLE = 5

// Stage names match the admin-managed picklist (owner_research_requests /
// orq_stage) seeded in the workflow v2 migration.
const STAGES = [
  "Owner Identification",
  "Organization Research",
  "Decision Maker Discovery",
  "Contact Info Gathering",
] as const
type Stage = typeof STAGES[number]

function nextStageAfter(stage: Stage): Stage | null {
  const i = STAGES.indexOf(stage)
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null
}

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
  // Shared-secret gate (same fail-closed secret as admin-test-send-email):
  // lets the autonomous test harness and the stage chain run on behalf of an
  // explicit app user.
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

// Placeholder org names ("Unknown Owner", "N/A", ...) must never be treated
// as a researchable organization — searching them returns honest nothing.
function isPlaceholderOrgName(name: string | null | undefined): boolean {
  if (!name || !name.trim()) return true
  return /^(unknown|unnamed|n\/?a\b|none\b|tbd\b|placeholder|no owner|not available)/i.test(name.trim())
}

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
  propertyLabel: string | null   // "Name (City, ST)" — the research subject when the owner is unknown
  ownerUnknown: boolean
}

async function resolveTarget(admin: SupabaseClient, body: Record<string, unknown>): Promise<Target | string> {
  const target: Target = {
    companyName: (body.company_name as string) || null,
    companyDomain: (body.company_domain as string) || null,
    accountId: (body.account_id as string) || null,
    propertyId: (body.property_id as string) || null,
    contextLines: [],
    propertyLabel: null,
    ownerUnknown: false,
  }

  if (target.propertyId) {
    const { data: prop, error } = await admin
      .from("properties")
      .select("id, property_name, property_street, property_city, property_state, property_zip, property_parcel_number, property_hud_property_id, property_lihtc_project_id, property_lihtc_hud_id, property_website, property_account_id, property_hud_owner_org, property_hud_management_org")
      .eq("id", target.propertyId).maybeSingle()
    if (error || !prop) return "Property not found"
    target.propertyLabel = `${prop.property_name} (${prop.property_city || "?"}, ${prop.property_state || "?"})`
    target.contextLines.push(`Property: ${target.propertyLabel}`)
    if (prop.property_street) {
      target.contextLines.push(`Street address: ${prop.property_street}, ${prop.property_city || ""}, ${prop.property_state || ""} ${prop.property_zip || ""}`.trim())
    }
    // Database identifiers are the strongest search keys — an ID lookup
    // usually lands directly on the project's listing page naming the owner.
    const lihtcId = prop.property_lihtc_project_id || prop.property_lihtc_hud_id
    if (lihtcId) {
      target.contextLines.push(`LIHTC project ID: ${lihtcId} — SEARCH THIS ID DIRECTLY (e.g. "${lihtcId}" and "${lihtcId} LIHTC"); the HUD LIHTC database entry for it gives the project's real name and its owner/contact.`)
    }
    if (prop.property_hud_property_id) target.contextLines.push(`HUD property ID: ${prop.property_hud_property_id} — also a direct search key.`)
    if (prop.property_parcel_number) target.contextLines.push(`County parcel number: ${prop.property_parcel_number} — search it against the county assessor/GIS.`)
    if (!target.accountId) target.accountId = prop.property_account_id
    if (!target.companyDomain) target.companyDomain = domainFromUrl(prop.property_website)
    if (prop.property_hud_owner_org) target.contextLines.push(`HUD-listed owner organization: ${prop.property_hud_owner_org}`)
    if (prop.property_hud_management_org) target.contextLines.push(`HUD-listed management organization: ${prop.property_hud_management_org}`)
    if (!target.companyName && prop.property_hud_owner_org && !isPlaceholderOrgName(prop.property_hud_owner_org)) {
      target.companyName = prop.property_hud_owner_org
    }
  }

  if (target.accountId) {
    const { data: acct, error } = await admin
      .from("accounts")
      .select("id, account_name, account_website, account_organization_name, parent_account_id")
      .eq("id", target.accountId).maybeSingle()
    if (error || !acct) return "Account not found"
    const acctName = acct.account_name || acct.account_organization_name
    if (acctName && !isPlaceholderOrgName(acctName)) {
      target.companyName = acctName
      target.contextLines.push(`Owner group (account): ${acctName}`)
    }
    if (!target.companyDomain) target.companyDomain = domainFromUrl(acct.account_website)
    if (acct.parent_account_id) {
      const { data: parent } = await admin
        .from("accounts").select("account_name").eq("id", acct.parent_account_id).maybeSingle()
      if (parent?.account_name && !isPlaceholderOrgName(parent.account_name)) {
        target.contextLines.push(`Parent account in CRM: ${parent.account_name}`)
      }
    }
  }

  // A placeholder ("Unknown Owner") is not a researchable organization.
  if (isPlaceholderOrgName(target.companyName)) {
    target.companyName = null
    target.ownerUnknown = true
  }
  if (!target.companyName && !target.propertyLabel) {
    return "No owner organization on file to research — open a specific property (web research can identify its owner) or set the account's real organization name"
  }
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

// "Jane P. Henderson" / "jane henderson" → "janephenderson" — for merging the
// same person found by web research and Lusha into one candidate row.
function normalizeName(name: string | null | undefined): string {
  return (name || "").toLowerCase().replace(/[^a-z]/g, "")
}

// ── Anthropic research core ─────────────────────────────────────────────────

async function callAnthropicResearch(
  anthropicKey: string, prompt: string,
  opts: { maxSearches: number; maxFetches: number; maxFetchTokens: number; effort: string },
): Promise<{ text: string; stopReason: string | null; usage: unknown }> {
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
        output_config: { effort: opts.effort },
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: opts.maxSearches },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: opts.maxFetches, max_content_tokens: opts.maxFetchTokens },
        ],
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

  if (!lastResponse) throw new Error("Research produced no response")
  if (lastResponse.stop_reason === "refusal") {
    throw new Error("Research was declined by the model's safety system")
  }
  const blocks = (lastResponse.content as Array<{ type: string; text?: string }>) || []
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("\n")
  return { text, stopReason: (lastResponse.stop_reason as string) || null, usage: lastResponse.usage }
}

// Tolerant JSON extraction: find the first { or [ and parse the longest
// valid JSON value starting there (models occasionally wrap JSON in prose).
function extractFirstJson(text: string): unknown | null {
  const tryParse = (open: string, close: string): unknown | null => {
    const start = text.indexOf(open)
    if (start === -1) return null
    for (let end = text.length; end > start; end--) {
      if (text[end - 1] !== close) continue
      try { return JSON.parse(text.slice(start, end)) } catch { /* keep shrinking */ }
    }
    return null
  }
  return tryParse("{", "}") ?? tryParse("[", "]")
}

const speedRules = (searches: number, fetches: number) =>
  `You are on a strict time budget: start searching immediately, run at most ${searches} searches and ${fetches} page fetches, and then answer with what you have. When a search result looks like it has the answer, FETCH that page rather than running another search. Do not deliberate between tool calls.`

// Parse a people[] array (shared by single-pass research, Decision Maker
// Discovery, and Contact Info Gathering).
function parsePeople(people: unknown[]): CandidateDraft[] {
  const candidates: CandidateDraft[] = []
  for (const p of people as Array<Record<string, unknown>>) {
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
  return candidates
}

const PEOPLE_JSON_SHAPE = `[{"full_name": string, "job_title": string, "company_name": string, "company_domain": string|null, "location": string|null, "linkedin_url": string|null, "emails": string[]|null, "phones": string[]|null, "source_urls": [{"url": string, "title": string}], "notes": string}]`
// Every evidence link carries a short human-readable page title so reviewers
// can see where a claim came from without clicking ("HUD LIHTC Database —
// Hanover Gardens"). The UI accepts both this shape and legacy bare strings.
const EVIDENCE_RULES = `Each source_urls/evidence_urls entry must be {"url", "title"} where title is a short human-readable description of the page (e.g. "Crunchbase — Leah Lyerly profile"). Extract, don't just cite: when a page you visited shows or links to a person's LinkedIn profile, contact info, or official name, capture the VALUE into the output fields — a link left on the cited page is a finding missed.`

// ── Legacy tier 1: single-pass free AI web research ─────────────────────────

// Tolerant extraction: preferred shape is an object with a `people` array,
// but accept a bare array (older prompt shape / model drift) too.
function extractResearchJson(text: string): { people: unknown[]; identifiedOrg: string | null; orgDomain: string | null; identificationNotes: string | null } {
  const empty = { people: [] as unknown[], identifiedOrg: null as string | null, orgDomain: null as string | null, identificationNotes: null as string | null }
  const parsed = extractFirstJson(text)
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>
    return {
      people: Array.isArray(o.people) ? o.people : [],
      identifiedOrg: typeof o.identified_owner_organization === "string" && o.identified_owner_organization.trim() ? o.identified_owner_organization.trim() : null,
      orgDomain: typeof o.organization_domain === "string" && o.organization_domain.trim() ? o.organization_domain.trim() : null,
      identificationNotes: typeof o.identification_notes === "string" ? o.identification_notes : null,
    }
  }
  if (Array.isArray(parsed)) return { ...empty, people: parsed }
  return empty
}

async function runWebResearch(
  anthropicKey: string, target: Target, jobTitles: string[],
): Promise<{ candidates: CandidateDraft[]; identifiedOrg: string | null; identifiedOrgDomain: string | null; identificationNotes: string | null; summary: string; raw: unknown }> {
  const maxSearches = target.companyName ? MAX_WEB_SEARCHES : MAX_WEB_SEARCHES_OWNER_UNKNOWN
  const mission = target.companyName
    ? [
        `Research the real-estate organization below and identify its DECISION MAKERS — the people who can approve building-level energy efficiency / HVAC retrofit projects. Prioritize titles like: ${jobTitles.join(", ")}. Property-management site staff (property managers, leasing agents, maintenance techs) are NOT decision makers — exclude them unless nothing better exists.`,
        ``,
        `Organization: ${target.companyName}`,
        target.companyDomain ? `Known website domain: ${target.companyDomain}` : `Website domain: unknown — find it.`,
      ]
    : [
        `The OWNER of the property below is not known. Your mission has two steps:`,
        `1. IDENTIFY who owns and controls the property. Start with the database identifiers in the Context lines below (LIHTC project ID, HUD property ID, parcel number) — searching an ID directly usually finds the project's listing page naming the real project name and owner. Then try the street address + ZIP, affordable-housing listings (LIHTC/HUD databases, waitlist pages that name the managing housing authority or owner), county assessor/parcel records, apartment listings, and news. Note: the property "name" in our system may just be a street address — the project's real marketed name is often different.`,
        `2. Then identify that owner organization's DECISION MAKERS — the people who can approve building-level energy efficiency / HVAC retrofit projects. Prioritize titles like: ${jobTitles.join(", ")}. Property-management site staff are NOT decision makers — but the OWNER organization itself (including a housing authority and its executive director) absolutely counts.`,
        ``,
        `Property to investigate: ${target.propertyLabel}`,
      ]
  const prompt = [
    ...mission,
    ...target.contextLines.map((l) => `Context: ${l}`),
    ``,
    `Be creative with FREE public sources:`,
    `- The organization's own website (leadership/about/team pages).`,
    `- Whether it is a subsidiary — find the PARENT COMPANY and its executives if the parent makes capital decisions.`,
    `- State corporate registries (registered agents, officers), HUD/PHA listings, nonprofit filings (IRS 990 officers), LinkedIn company pages, press releases, industry news.`,
    ``,
    speedRules(maxSearches, MAX_WEB_FETCHES),
    ``,
    `Then reply with ONLY a JSON object (no prose before or after) shaped exactly like this:`,
    `{"identified_owner_organization": string|null, "organization_domain": string|null, "identification_notes": string, "people": ${PEOPLE_JSON_SHAPE}}`,
    `Rules: even if you cannot confirm ANY individual, ALWAYS fill identified_owner_organization with the organization you determined owns/controls the property (or its marketed development name and managing organization) — that finding alone is valuable; cite the evidence URL in identification_notes. Only include people you found real evidence for (source_urls required, no guesses). Include publicly listed emails/phones only. Each person's "notes" = one sentence on why they are the decision maker. If you truly learned nothing, use null and an empty people array.`,
  ].join("\n")

  const r = await callAnthropicResearch(anthropicKey, prompt, {
    maxSearches, maxFetches: MAX_WEB_FETCHES, maxFetchTokens: MAX_FETCH_CONTENT_TOKENS, effort: "low",
  })
  const extracted = extractResearchJson(r.text)

  return {
    candidates: parsePeople(extracted.people),
    identifiedOrg: extracted.identifiedOrg,
    identifiedOrgDomain: extracted.orgDomain,
    identificationNotes: extracted.identificationNotes,
    summary: r.text.slice(0, 4000),
    // Persist the response text too — when parsing yields nothing, the text is
    // the only way to tell "genuinely found nobody" from a formatting problem.
    raw: { stop_reason: r.stopReason, usage: r.usage, text: r.text.slice(0, 6000) },
  }
}

// ── Tier 2: Lusha prospecting search (no credits) ───────────────────────────

async function runLushaSearch(
  lushaKey: string, target: Target, jobTitles: string[],
): Promise<{ candidates: CandidateDraft[]; providerRequestId: string | null; raw: unknown }> {
  const companies: Record<string, unknown> = {}
  if (target.companyDomain) companies.domains = [target.companyDomain]
  else if (target.companyName) companies.names = [target.companyName]
  if (!companies.domains && !companies.names) {
    throw new Error("No known owner organization to search in Lusha — run Web Research first to identify the owner, or set the owner account's real organization name")
  }

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
    // Enrich responses nest the contact under `data`:
    // { id, isSuccess, data: { emailAddresses:[{email,...}], phoneNumbers:[{number,...}],
    //   socialLinks:{linkedin}, firstName, lastName, seniority:[{value}], departments:[...] } }
    const d = (e.data && typeof e.data === "object" ? e.data : e) as Record<string, unknown>
    const emails = Array.isArray(d.emailAddresses) ? d.emailAddresses
      : Array.isArray(d.emails) ? d.emails : null
    const phones = Array.isArray(d.phoneNumbers) ? d.phoneNumbers
      : Array.isArray(d.phones) ? d.phones : null
    const social = (d.socialLinks && typeof d.socialLinks === "object" ? d.socialLinks : {}) as Record<string, unknown>
    const seniorityArr = Array.isArray(d.seniority) ? d.seniority as Array<Record<string, unknown>> : []
    const departmentsArr = Array.isArray(d.departments) ? d.departments.filter((x) => typeof x === "string") : []
    const { data: row } = await admin
      .from("owner_research_candidates")
      .update({
        orc_emails: emails,
        orc_phones: phones,
        orc_first_name: (d.firstName as string) || undefined,
        orc_last_name: (d.lastName as string) || undefined,
        orc_linkedin_url: (social.linkedin as string) || undefined,
        orc_seniority: seniorityArr.length ? String(seniorityArr[0].value ?? seniorityArr[0]) : undefined,
        orc_department: departmentsArr.length ? departmentsArr.join(", ") : undefined,
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

// ── Staged deep research ────────────────────────────────────────────────────
// Each stage runs in its own invocation (fresh 400s wall clock) and persists
// its output as a stored fact in orq_stage_results before chaining to the
// next stage via self-invocation through the shared-secret gate.

interface StageOutcome {
  results: Record<string, unknown>          // stored under orq_stage_results[stage]
  requestPatch?: Record<string, unknown>    // extra columns to set on the ORQ row
  halt?: string | null                      // terminal status short-name ("No Results") to stop the chain
}

async function selfInvokeStage(requestId: string, stage: Stage, onBehalfOfUserId: string): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
  const secret = Deno.env.get("GRAPH_RENEWAL_CRON_SECRET") || Deno.env.get("GRAPH_WEBHOOK_CLIENT_STATE")
  if (!supabaseUrl || !anonKey || !secret) {
    throw new Error("Stage chaining is not configured (anon key or shared pipeline secret missing)")
  }
  const resp = await fetch(`${supabaseUrl}/functions/v1/property-owner-research`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${anonKey}`,
      "apikey": anonKey,
      "x-pipeline-test-secret": secret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "run_stage", request_id: requestId, stage, on_behalf_of_user_id: onBehalfOfUserId }),
  })
  if (resp.status >= 300) {
    const t = await resp.text().catch(() => "")
    throw new Error(`Failed to chain to stage "${stage}" (${resp.status}): ${t.slice(0, 200)}`)
  }
  // Drain the (small) 202 body so the connection can close cleanly.
  await resp.text().catch(() => "")
}

// Stage 1 — Owner Identification: property identifiers → who owns/controls it.
async function stageOwnerIdentification(
  anthropicKey: string, target: Target,
): Promise<StageOutcome> {
  if (target.companyName) {
    return { results: { skipped: true, reason: "Owner organization already known", organization: target.companyName } }
  }
  const prompt = [
    `IDENTIFY who owns and controls the property below. Start with the database identifiers in the Context lines (LIHTC project ID, HUD property ID, parcel number) — searching an ID directly usually finds the project's listing page naming the real project name and owner. Then try the street address + ZIP, affordable-housing listings (LIHTC/HUD databases, waitlist pages that name the managing housing authority or owner), county assessor/parcel records, apartment listings, and news. Note: the property "name" in our system may just be a street address — the project's real marketed name is often different.`,
    ``,
    `Property to investigate: ${target.propertyLabel}`,
    ...target.contextLines.map((l) => `Context: ${l}`),
    ``,
    speedRules(STAGE_MAX_SEARCHES, STAGE_MAX_FETCHES),
    ``,
    `Then reply with ONLY a JSON object (no prose before or after) shaped exactly like this:`,
    `{"identified_owner_organization": string|null, "organization_domain": string|null, "marketed_property_name": string|null, "management_organization": string|null, "identification_notes": string, "evidence_urls": [{"url": string, "title": string}]}`,
    `Rules: identified_owner_organization must be ONLY the organization's clean legal name exactly as registered (e.g. "JES Holdings, LLC") — NO parentheticals, qualifiers, or explanations inside the name; ALL context (corporate relationships, how you determined it, caveats) belongs in identification_notes. It is the entity that OWNS/controls the property (developer, housing authority, ownership LLC's parent) — not the on-site manager (put that clean name in management_organization). Cite every claim's URL in evidence_urls. ${EVIDENCE_RULES} If you truly cannot determine the owner, use null and explain what you found and where the trail ended in identification_notes.`,
  ].join("\n")

  const r = await callAnthropicResearch(anthropicKey, prompt, {
    maxSearches: STAGE_MAX_SEARCHES, maxFetches: STAGE_MAX_FETCHES, maxFetchTokens: STAGE_FETCH_CONTENT_TOKENS, effort: STAGE_EFFORT,
  })
  const o = (extractFirstJson(r.text) || {}) as Record<string, unknown>
  const org = typeof o.identified_owner_organization === "string" && o.identified_owner_organization.trim()
    && !isPlaceholderOrgName(o.identified_owner_organization) ? o.identified_owner_organization.trim() : null
  const domain = typeof o.organization_domain === "string" && o.organization_domain.trim() ? o.organization_domain.trim() : null
  const results: Record<string, unknown> = {
    identified_owner_organization: org,
    organization_domain: domain,
    marketed_property_name: typeof o.marketed_property_name === "string" ? o.marketed_property_name : null,
    management_organization: typeof o.management_organization === "string" ? o.management_organization : null,
    identification_notes: typeof o.identification_notes === "string" ? o.identification_notes : null,
    evidence_urls: Array.isArray(o.evidence_urls) ? o.evidence_urls : [],
    usage: r.usage,
    text: r.text.slice(0, 4000),
  }
  if (!org) return { results, halt: "No Results" }
  return {
    results,
    // The identified org is staging data until a reviewer approves it — the
    // approval queue turns it into a real Account / property repoint.
    requestPatch: {
      orq_company_name: org,
      orq_company_domain: domain,
      orq_org_approval_status: "Organization Approval Pending",
    },
  }
}

// Stage 2 — Organization Research: verify the org (domain, parent, type).
async function stageOrganizationResearch(
  anthropicKey: string, target: Target, priorResults: Record<string, unknown>,
): Promise<StageOutcome> {
  if (!target.companyName) throw new Error("No owner organization to research (Owner Identification found none)")
  const identification = (priorResults["Owner Identification"] || {}) as Record<string, unknown>
  const prompt = [
    `Research the real-estate organization below and VERIFY its identity and structure. We already believe it owns/controls: ${target.propertyLabel || "properties in our portfolio"}.`,
    ``,
    `Organization: ${target.companyName}`,
    target.companyDomain ? `Known website domain: ${target.companyDomain}` : `Website domain: unknown — find the official website.`,
    ...(typeof identification.identification_notes === "string" && identification.identification_notes
      ? [`Prior finding: ${identification.identification_notes}`] : []),
    ...target.contextLines.map((l) => `Context: ${l}`),
    ``,
    `Determine: the official/legal organization name, its website domain, whether it is a subsidiary (find the PARENT COMPANY that makes capital decisions), what kind of organization it is (housing authority, nonprofit, private developer, REIT, property manager...), where it is headquartered, and anything from state corporate registries or IRS 990 filings that names its officers.`,
    ``,
    speedRules(STAGE_MAX_SEARCHES, STAGE_MAX_FETCHES),
    ``,
    `Then reply with ONLY a JSON object (no prose before or after) shaped exactly like this:`,
    `{"official_name": string|null, "organization_domain": string|null, "parent_company": string|null, "subsidiaries": string[], "organization_type": string|null, "headquarters": string|null, "key_facts": string[], "evidence_urls": [{"url": string, "title": string}], "notes": string}`,
    `Rules: official_name, parent_company, and every subsidiaries entry must be clean legal entity names exactly as registered (e.g. "Fairway Management, Inc.") — no parentheticals or explanations inside names; context goes in notes/key_facts. subsidiaries = companies this organization owns or controls (management arms, development affiliates, property LLCs). key_facts = short facts useful for finding this organization's decision makers next (officer names from registries/990s go here). Cite evidence_urls for every claim. ${EVIDENCE_RULES}`,
  ].join("\n")

  const r = await callAnthropicResearch(anthropicKey, prompt, {
    maxSearches: STAGE_MAX_SEARCHES, maxFetches: STAGE_MAX_FETCHES, maxFetchTokens: STAGE_FETCH_CONTENT_TOKENS, effort: STAGE_EFFORT,
  })
  const o = (extractFirstJson(r.text) || {}) as Record<string, unknown>
  const domain = typeof o.organization_domain === "string" && o.organization_domain.trim() ? o.organization_domain.trim() : null
  const results: Record<string, unknown> = {
    official_name: typeof o.official_name === "string" ? o.official_name : null,
    organization_domain: domain,
    parent_company: typeof o.parent_company === "string" ? o.parent_company : null,
    subsidiaries: Array.isArray(o.subsidiaries) ? o.subsidiaries.filter((s) => typeof s === "string") : [],
    organization_type: typeof o.organization_type === "string" ? o.organization_type : null,
    headquarters: typeof o.headquarters === "string" ? o.headquarters : null,
    key_facts: Array.isArray(o.key_facts) ? o.key_facts : [],
    evidence_urls: Array.isArray(o.evidence_urls) ? o.evidence_urls : [],
    notes: typeof o.notes === "string" ? o.notes : null,
    usage: r.usage,
    text: r.text.slice(0, 4000),
  }
  const patch: Record<string, unknown> = {}
  if (domain && !target.companyDomain) patch.orq_company_domain = domain
  // The verified official name is the cleanest version of the org name we
  // will ever have — it becomes the request's working name (and therefore
  // the default account name at approval).
  const officialName = typeof o.official_name === "string" ? o.official_name.trim() : ""
  if (officialName && !isPlaceholderOrgName(officialName)) {
    patch.orq_company_name = officialName
  }
  return { results, requestPatch: Object.keys(patch).length ? patch : undefined }
}

// Stage 3 — Decision Maker Discovery: web people pass + credit-free Lusha
// search, merged into one candidate list (same person → one ORC row).
async function stageDecisionMakerDiscovery(
  admin: SupabaseClient, anthropicKey: string, requestId: string, target: Target,
  jobTitles: string[], priorResults: Record<string, unknown>, callerUserId: string,
): Promise<StageOutcome> {
  if (!target.companyName) throw new Error("No owner organization to research (Owner Identification found none)")
  const orgResearch = (priorResults["Organization Research"] || {}) as Record<string, unknown>
  const factLines: string[] = []
  if (typeof orgResearch.parent_company === "string" && orgResearch.parent_company) factLines.push(`Parent company: ${orgResearch.parent_company}`)
  if (typeof orgResearch.organization_type === "string" && orgResearch.organization_type) factLines.push(`Organization type: ${orgResearch.organization_type}`)
  if (typeof orgResearch.headquarters === "string" && orgResearch.headquarters) factLines.push(`Headquarters: ${orgResearch.headquarters}`)
  for (const f of (Array.isArray(orgResearch.key_facts) ? orgResearch.key_facts : []).slice(0, 8)) {
    if (typeof f === "string") factLines.push(f)
  }

  const prompt = [
    `Identify the DECISION MAKERS at the real-estate organization below — the people who can approve building-level energy efficiency / HVAC retrofit projects. Prioritize titles like: ${jobTitles.join(", ")}. Property-management site staff (property managers, leasing agents, maintenance techs) are NOT decision makers — but the owner organization itself (including a housing authority and its executive director) absolutely counts. If a parent company makes capital decisions, its executives count too.`,
    ``,
    `Organization: ${target.companyName}`,
    target.companyDomain ? `Website domain: ${target.companyDomain}` : `Website domain: unknown.`,
    ...factLines.map((l) => `Known fact: ${l}`),
    ``,
    `Best sources: the organization's own leadership/about/team pages, the parent company's leadership page, LinkedIn company pages, press releases, state corporate registries, IRS 990 officer lists.`,
    ``,
    speedRules(STAGE_MAX_SEARCHES, STAGE_MAX_FETCHES),
    ``,
    `Then reply with ONLY a JSON object (no prose before or after) shaped exactly like this:`,
    `{"people": ${PEOPLE_JSON_SHAPE}}`,
    `Rules: only include people you found real evidence for (source_urls required, no guesses). Include publicly listed emails/phones only. Always fill linkedin_url when any page you visited shows or links to the person's LinkedIn profile. ${EVIDENCE_RULES} Each person's "notes" = one sentence on why they are the decision maker. If you found nobody, use an empty people array.`,
  ].join("\n")

  const r = await callAnthropicResearch(anthropicKey, prompt, {
    maxSearches: STAGE_MAX_SEARCHES, maxFetches: STAGE_MAX_FETCHES, maxFetchTokens: STAGE_FETCH_CONTENT_TOKENS, effort: STAGE_EFFORT,
  })
  const o = (extractFirstJson(r.text) || {}) as Record<string, unknown>
  const webDrafts = parsePeople(Array.isArray(o.people) ? o.people : Array.isArray(o) ? o as unknown[] : [])
  const savedWeb = await insertCandidates(admin, requestId, target, callerUserId, webDrafts)

  const results: Record<string, unknown> = {
    web_people_found: savedWeb.length,
    usage: r.usage,
    text: r.text.slice(0, 4000),
  }
  const patch: Record<string, unknown> = {}

  // Inline credit-free Lusha search, merged by person: a Lusha hit matching a
  // web-found candidate updates that row (adds the Lusha contact id that
  // enrich needs) instead of duplicating the person in the review queue.
  try {
    const lushaKey = await getLushaApiKey(admin)
    if (!lushaKey) throw new Error("LUSHA_API_KEY is not configured")
    const l = await runLushaSearch(lushaKey, target, jobTitles)
    if (l.providerRequestId) patch.orq_provider_request_id = l.providerRequestId
    const byName = new Map<string, { id: string }>()
    for (const row of savedWeb as Array<Record<string, unknown>>) {
      byName.set(normalizeName(row.orc_full_name as string), { id: row.id as string })
    }
    const freshLusha: CandidateDraft[] = []
    let merged = 0
    for (const c of l.candidates) {
      const existing = byName.get(normalizeName(c.full_name))
      if (existing) {
        await admin.from("owner_research_candidates")
          .update({
            orc_provider_contact_id: c.provider_contact_id || null,
            orc_has_emails: c.has_emails ?? null,
            orc_has_phones: c.has_phones ?? null,
            orc_seniority: c.seniority || undefined,
            orc_department: c.department || undefined,
            orc_updated_by: callerUserId,
            orc_updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
        merged++
      } else {
        freshLusha.push(c)
      }
    }
    const savedLusha = await insertCandidates(admin, requestId, target, callerUserId, freshLusha)
    results.lusha_people_found = savedLusha.length
    results.lusha_merged_into_web_candidates = merged
  } catch (e) {
    // Lusha being down/unconfigured must not sink the whole stage — the web
    // findings stand on their own and Lusha search can be run manually later.
    results.lusha_error = (e as Error).message
  }

  return { results, requestPatch: Object.keys(patch).length ? patch : undefined }
}

// Stage 4 — Contact Info Gathering: public contact info for found candidates.
// A candidate missing ANY field (email, phone, LinkedIn) gets a pass — a
// person with a phone but no LinkedIn is still incomplete. (Lusha enrich
// stays a manual, per-person paid action.)
async function stageContactInfoGathering(
  admin: SupabaseClient, anthropicKey: string, requestId: string, target: Target, callerUserId: string,
): Promise<StageOutcome> {
  const { data: cands } = await admin
    .from("owner_research_candidates")
    .select("id, orc_full_name, orc_job_title, orc_company_name, orc_emails, orc_phones, orc_linkedin_url")
    .eq("orc_request_id", requestId)
    .eq("orc_is_deleted", false)
  // Most-incomplete candidates first, so the per-run cap spends its budget
  // where the gaps are biggest.
  const gaps = (c: Record<string, unknown>) =>
    (c.orc_emails ? 0 : 1) + (c.orc_phones ? 0 : 1) + (c.orc_linkedin_url ? 0 : 1)
  const needing = (cands || [])
    .filter((c) => gaps(c) > 0)
    .sort((a, b) => gaps(b) - gaps(a))
    .slice(0, STAGE_CONTACT_INFO_MAX_PEOPLE)
  if (needing.length === 0) {
    return { results: { skipped: true, reason: "No candidates need public contact info" } }
  }

  const personLines = needing.map((c) => {
    const missing = [
      !c.orc_emails ? "work email" : null,
      !c.orc_phones ? "phone" : null,
      !c.orc_linkedin_url ? "LinkedIn profile URL" : null,
    ].filter(Boolean).join(", ")
    return `- ${c.orc_full_name}${c.orc_job_title ? `, ${c.orc_job_title}` : ""} at ${c.orc_company_name || target.companyName || "the organization"} — still need: ${missing}`
  })
  const prompt = [
    `Find PUBLICLY LISTED work contact information for the people below — each line says exactly what is still missing for that person. Good sources: the organization's own website (staff directory, contact page, press releases), state registry filings, HUD/PHA contact listings, conference speaker pages, news articles, and profile pages (Crunchbase, ZoomInfo, RocketReach) which usually list or link the person's LinkedIn.`,
    ``,
    `Organization: ${target.companyName || "?"}${target.companyDomain ? ` (${target.companyDomain})` : ""}`,
    `People:`,
    ...personLines,
    ``,
    `For LinkedIn: search "<name> <company> LinkedIn" directly — a person's public LinkedIn profile URL (linkedin.com/in/...) counts as found contact info and should almost always be findable for a named executive.`,
    ``,
    speedRules(STAGE_MAX_SEARCHES, STAGE_MAX_FETCHES),
    ``,
    `Then reply with ONLY a JSON object (no prose before or after) shaped exactly like this:`,
    `{"people": [{"full_name": string, "emails": string[]|null, "phones": string[]|null, "linkedin_url": string|null, "source_urls": [{"url": string, "title": string}], "notes": string}]}`,
    `Rules: publicly listed information only — never guess or fabricate an email pattern or profile URL. ${EVIDENCE_RULES} Omit people you found nothing new for.`,
  ].join("\n")

  const r = await callAnthropicResearch(anthropicKey, prompt, {
    maxSearches: STAGE_MAX_SEARCHES, maxFetches: STAGE_MAX_FETCHES, maxFetchTokens: STAGE_FETCH_CONTENT_TOKENS, effort: STAGE_EFFORT,
  })
  const o = (extractFirstJson(r.text) || {}) as Record<string, unknown>
  const people = Array.isArray(o.people) ? o.people as Array<Record<string, unknown>> : []

  const byName = new Map(needing.map((c) => [normalizeName(c.orc_full_name), c]))
  let updated = 0
  for (const p of people) {
    const cand = byName.get(normalizeName(typeof p.full_name === "string" ? p.full_name : ""))
    if (!cand) continue
    const emails = Array.isArray(p.emails) ? p.emails.filter((e) => typeof e === "string") : []
    const phones = Array.isArray(p.phones) ? p.phones.filter((e) => typeof e === "string") : []
    const linkedin = typeof p.linkedin_url === "string" && p.linkedin_url.trim() ? p.linkedin_url.trim() : null
    const sourceUrls = Array.isArray(p.source_urls) ? p.source_urls : []
    if (!emails.length && !phones.length && !linkedin) continue
    await admin.from("owner_research_candidates")
      .update({
        ...(emails.length ? { orc_emails: emails, orc_has_emails: true } : {}),
        ...(phones.length ? { orc_phones: phones, orc_has_phones: true } : {}),
        ...(linkedin && !cand.orc_linkedin_url ? { orc_linkedin_url: linkedin } : {}),
        ...(sourceUrls.length ? { orc_source_urls: sourceUrls } : {}),
        orc_updated_by: callerUserId,
        orc_updated_at: new Date().toISOString(),
      })
      .eq("id", cand.id)
    updated++
  }

  return {
    results: {
      candidates_checked: needing.length,
      candidates_updated: updated,
      usage: r.usage,
      text: r.text.slice(0, 4000),
    },
  }
}

// Runs one stage end-to-end: mark it started, execute, persist its results,
// then either chain to the next stage or finalize the request.
async function executeStage(
  admin: SupabaseClient, anthropicKey: string, requestId: string, stage: Stage, callerUserId: string,
): Promise<void> {
  const { data: row, error } = await admin
    .from("owner_research_requests")
    .select("*")
    .eq("id", requestId).maybeSingle()
  if (error || !row) throw new Error("Research request not found")

  // Rebuild the target from the live records, then overlay facts persisted by
  // earlier stages (an identified owner org supersedes the placeholder).
  const target = await resolveTarget(admin, {
    account_id: row.orq_account_id, property_id: row.orq_property_id,
  })
  if (typeof target === "string") throw new Error(target)
  if (row.orq_company_name && !isPlaceholderOrgName(row.orq_company_name)) {
    target.companyName = row.orq_company_name
    target.ownerUnknown = false
  }
  if (row.orq_company_domain && !target.companyDomain) target.companyDomain = row.orq_company_domain

  let jobTitles: string[] = Array.isArray(row.orq_target_job_titles) ? row.orq_target_job_titles : []
  if (jobTitles.length === 0) jobTitles = await defaultJobTitles(admin)

  await admin.from("owner_research_requests")
    .update({
      orq_status: "Research Request In Progress",
      orq_stage: stage,
      orq_stage_started_at: new Date().toISOString(),
      orq_updated_by: callerUserId,
      orq_updated_at: new Date().toISOString(),
    })
    .eq("id", requestId)

  const priorResults = (row.orq_stage_results || {}) as Record<string, unknown>
  let outcome: StageOutcome
  switch (stage) {
    case "Owner Identification":
      outcome = await stageOwnerIdentification(anthropicKey, target)
      break
    case "Organization Research":
      outcome = await stageOrganizationResearch(anthropicKey, target, priorResults)
      break
    case "Decision Maker Discovery":
      outcome = await stageDecisionMakerDiscovery(admin, anthropicKey, requestId, target, jobTitles, priorResults, callerUserId)
      break
    case "Contact Info Gathering":
      outcome = await stageContactInfoGathering(admin, anthropicKey, requestId, target, callerUserId)
      break
    default:
      throw new Error(`Unknown research stage: ${stage}`)
  }

  const stageResults = {
    ...priorResults,
    [stage]: { ...outcome.results, completed_at: new Date().toISOString() },
  }

  if (outcome.halt) {
    await finishRequest(admin, requestId, callerUserId, {
      orq_status: `Research Request ${outcome.halt}`,
      orq_stage_results: stageResults,
      orq_total_results: 0,
      ...(outcome.requestPatch || {}),
    })
    return
  }

  const next = nextStageAfter(stage)
  if (next) {
    await admin.from("owner_research_requests")
      .update({
        orq_stage_results: stageResults,
        ...(outcome.requestPatch || {}),
        orq_updated_by: callerUserId,
        orq_updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
    await selfInvokeStage(requestId, next, callerUserId)
    return
  }

  // Last stage done — count what there is to review and finalize.
  const { count } = await admin
    .from("owner_research_candidates")
    .select("id", { count: "exact", head: true })
    .eq("orc_request_id", requestId)
    .eq("orc_is_deleted", false)
  const peopleCount = count || 0
  const orgAwaitingApproval =
    (outcome.requestPatch?.orq_org_approval_status || row.orq_org_approval_status) === "Organization Approval Pending"
  await finishRequest(admin, requestId, callerUserId, {
    orq_status: (peopleCount > 0 || orgAwaitingApproval) ? "Research Request Ready for Review" : "Research Request No Results",
    orq_stage_results: stageResults,
    orq_total_results: peopleCount,
    ...(outcome.requestPatch || {}),
  })
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors })
  if (req.method !== "POST")    return json({ ok: false, error: "Method not allowed" }, 405)

  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> }
  catch { return json({ ok: false, error: "Invalid JSON body" }, 400) }

  const action = body.action as string
  if (!["deep_research", "run_stage", "web_research", "lusha_search", "lusha_enrich"].includes(action)) {
    return json({ ok: false, error: "action must be deep_research | run_stage | web_research | lusha_search | lusha_enrich" }, 400)
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

    // Self-healing: a background run killed by the platform wall clock can
    // leave a request stuck mid-flight. Fail anything stale before starting
    // new work so the UI never shows a zombie run as in-progress. Staged runs
    // are judged per stage (each stage resets orq_stage_started_at).
    const staleCutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString()
    await admin.from("owner_research_requests")
      .update({
        orq_status: "Research Request Failed",
        orq_error_message: `Run did not finish within ${STALE_RUN_MINUTES} minutes and was marked failed (edge worker time limit)`,
        orq_completed_at: new Date().toISOString(),
        orq_updated_at: new Date().toISOString(),
      })
      .eq("orq_status", "Research Request Submitted")
      .lt("orq_created_at", staleCutoff)
    await admin.from("owner_research_requests")
      .update({
        orq_status: "Research Request Failed",
        orq_error_message: `A research stage did not finish within ${STALE_RUN_MINUTES} minutes and was marked failed (edge worker time limit)`,
        orq_completed_at: new Date().toISOString(),
        orq_updated_at: new Date().toISOString(),
      })
      .eq("orq_status", "Research Request In Progress")
      .lt("orq_stage_started_at", staleCutoff)

    // ---- run_stage: execute one stage of an existing staged request --------
    if (action === "run_stage") {
      const requestId = body.request_id as string
      const stage = body.stage as Stage
      if (!requestId || !STAGES.includes(stage)) {
        return json({ ok: false, error: `request_id and a valid stage (${STAGES.join(" | ")}) are required` }, 400)
      }
      const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")
      if (!anthropicKey) return json({ ok: false, error: "ANTHROPIC_API_KEY is not configured" }, 500)
      const work = (async () => {
        try {
          await executeStage(admin, anthropicKey, requestId, stage, callerUserId)
        } catch (inner) {
          await finishRequest(admin, requestId, callerUserId, {
            orq_status: "Research Request Failed",
            orq_error_message: `${stage}: ${(inner as Error).message}`,
          })
        }
      })()
      // deno-lint-ignore no-explicit-any
      ;(globalThis as any).EdgeRuntime?.waitUntil?.(work)
      return json({ ok: true, background: true, request_id: requestId, stage }, 202)
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

    // ---- deep_research: create the request and start the stage chain ------
    if (action === "deep_research") {
      const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")
      if (!anthropicKey) return json({ ok: false, error: "ANTHROPIC_API_KEY is not configured" }, 500)
      const initialStage: Stage = target.companyName ? "Organization Research" : "Owner Identification"
      const { data: reqRow, error: reqErr } = await admin
        .from("owner_research_requests")
        .insert({
          orq_account_id: target.accountId,
          orq_property_id: target.propertyId,
          orq_company_name: target.companyName,
          orq_company_domain: target.companyDomain,
          orq_target_job_titles: jobTitles,
          orq_research_method: "Deep Research",
          orq_status: "Research Request In Progress",
          orq_stage: initialStage,
          orq_stage_started_at: new Date().toISOString(),
          orq_owner: callerUserId,
          orq_created_by: callerUserId,
        })
        .select().single()
      if (reqErr || !reqRow) {
        return json({ ok: false, error: `Failed to create research request: ${reqErr?.message}` }, 500)
      }
      const work = (async () => {
        try {
          await executeStage(admin, anthropicKey, reqRow.id, initialStage, callerUserId)
        } catch (inner) {
          await finishRequest(admin, reqRow.id, callerUserId, {
            orq_status: "Research Request Failed",
            orq_error_message: `${initialStage}: ${(inner as Error).message}`,
          })
        }
      })()
      // deno-lint-ignore no-explicit-any
      ;(globalThis as any).EdgeRuntime?.waitUntil?.(work)
      return json({ ok: true, background: true, request: reqRow }, 202)
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
          // Identifying the owner organization is a result in its own right —
          // persist it on the request so the panel can show it and the next
          // Lusha search can use it, even when no individuals were confirmed.
          const identified = target.ownerUnknown && r.identifiedOrg && !isPlaceholderOrgName(r.identifiedOrg)
          await finishRequest(admin, reqRow.id, callerUserId, {
            orq_status: (saved.length > 0 || identified) ? "Research Request Completed" : "Research Request No Results",
            orq_total_results: saved.length,
            ...(identified ? {
              orq_company_name: r.identifiedOrg,
              orq_company_domain: r.identifiedOrgDomain || null,
            } : {}),
            orq_raw_response: { ...(r.raw as Record<string, unknown>), identified_owner_organization: r.identifiedOrg, identification_notes: r.identificationNotes },
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
