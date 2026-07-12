import { supabase } from '../lib/supabase'
import { getCurrentUserId } from './reportsService'

// ---------------------------------------------------------------------------
// ownerResearchService
//
// Data layer for the Property Owner Research tool (PropertyOwnerResearchPanel
// on account and property records) and the Owner Research review queue in the
// Outreach module. Finds decision makers for property owner groups and
// specific properties:
//
//   runOwnerResearch('deep_research', …) — the staged pipeline: Owner
//                                          Identification → Organization
//                                          Research → Decision Maker Discovery
//                                          (web + Lusha search merged) →
//                                          Contact Info Gathering. Ends
//                                          "Ready for Review".
//   runOwnerResearch('lusha_search', …)  — NO CREDITS: Lusha prospecting
//                                          search (names + titles only).
//   enrichCandidates(…)                  — PAID Lusha credits: reveal
//                                          email/phone for explicitly
//                                          selected candidates.
//
// Requests are ORQ- records (owner_research_requests); every person found is
// an ORC- record (owner_research_candidates). The review queue is the only
// path from research findings to real CRM records: approving a person creates
// a Contact; approving an identified organization matches/creates the Account
// and (with confirmation) repoints the property off its placeholder owner.
// Nothing here is hardcoded: target job titles come from the
// orq_target_job_title picklist (admin-manageable).
// ---------------------------------------------------------------------------

/** Target job titles (decision makers) — admin-managed picklist. */
export async function fetchTargetJobTitles() {
  const { data, error } = await supabase
    .from('picklist_values')
    .select('picklist_value, picklist_sort_order')
    .eq('picklist_object', 'owner_research_requests')
    .eq('picklist_field', 'orq_target_job_title')
    .eq('picklist_is_active', true)
    .order('picklist_sort_order')
  if (error) throw new Error(error.message)
  return (data || []).map(r => r.picklist_value)
}

/**
 * Resolve the research target shown in the panel header: the organization
 * name/domain/state behind an account or property record.
 */
export async function fetchResearchTarget(tableName, recordId) {
  if (tableName === 'accounts') {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, account_name, account_website, billing_state')
      .eq('id', recordId).maybeSingle()
    if (error || !data) throw new Error(error?.message || 'Account not found')
    const placeholder = isPlaceholderOrgName(data.account_name)
    return {
      accountId: data.id,
      companyName: placeholder ? null : data.account_name,
      companyDomain: extractDomain(data.account_website),
      state: data.billing_state || null,
      ownerUnknown: placeholder,
      propertyName: null,
    }
  }
  const { data, error } = await supabase
    .from('properties')
    .select('id, property_name, property_city, property_state, property_website, property_account_id, property_hud_owner_org, accounts:property_account_id (account_name, account_website)')
    .eq('id', recordId).maybeSingle()
  if (error || !data) throw new Error(error?.message || 'Property not found')
  const account = data.accounts || null
  // The CRM account wins unless it's a placeholder ("Unknown Owner"), in
  // which case fall back to the HUD-listed owner org; if that's missing too,
  // the owner is genuinely unknown and web research pivots to identifying it
  // from the property itself.
  let companyName = null
  if (account?.account_name && !isPlaceholderOrgName(account.account_name)) {
    companyName = account.account_name
  } else if (data.property_hud_owner_org && !isPlaceholderOrgName(data.property_hud_owner_org)) {
    companyName = data.property_hud_owner_org
  }
  return {
    propertyId: data.id,
    accountId: data.property_account_id || null,
    companyName,
    companyDomain: extractDomain(account?.account_website || data.property_website),
    state: data.property_state || null,
    ownerUnknown: !companyName,
    propertyName: data.property_name || null,
    propertyCity: data.property_city || null,
  }
}

/** Placeholder org names ("Unknown Owner", "N/A", ...) are not researchable. */
export function isPlaceholderOrgName(name) {
  if (!name || !String(name).trim()) return true
  return /^(unknown|unnamed|n\/?a\b|none\b|tbd\b|placeholder|no owner|not available)/i.test(String(name).trim())
}

function extractDomain(url) {
  if (!url) return null
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`
    return new URL(withProto).hostname.replace(/^www\./i, '') || null
  } catch {
    return null
  }
}

/** All research requests (with candidates) for an account or property record. */
export async function listResearchForRecord(tableName, recordId) {
  const fkColumn = tableName === 'accounts' ? 'orq_account_id' : 'orq_property_id'
  const { data: requests, error } = await supabase
    .from('owner_research_requests')
    .select('*')
    .eq(fkColumn, recordId)
    .eq('orq_is_deleted', false)
    .order('orq_created_at', { ascending: false })
  if (error) throw new Error(error.message)
  if (!requests || requests.length === 0) return { requests: [], candidates: [] }

  const { data: candidates, error: candErr } = await supabase
    .from('owner_research_candidates')
    .select('*')
    .in('orc_request_id', requests.map(r => r.id))
    .eq('orc_is_deleted', false)
    .order('orc_created_at', { ascending: false })
  if (candErr) throw new Error(candErr.message)
  return { requests, candidates: candidates || [] }
}

/**
 * Run a research pass via the property-owner-research edge function.
 * action: 'web_research' (free) | 'lusha_search' (no credits).
 * target: { accountId?, propertyId?, companyName?, companyDomain? }
 */
export async function runOwnerResearch(action, target, jobTitles) {
  const { data, error } = await supabase.functions.invoke('property-owner-research', {
    body: {
      action,
      account_id: target.accountId || undefined,
      property_id: target.propertyId || undefined,
      company_name: target.companyName || undefined,
      company_domain: target.companyDomain || undefined,
      job_titles: jobTitles && jobTitles.length ? jobTitles : undefined,
    },
  })
  if (error) {
    // functions.invoke surfaces non-2xx as FunctionsHttpError with the body on context
    let detail = error.message
    try {
      const body = await error.context?.json?.()
      if (body?.error) detail = body.error
    } catch { /* keep the generic message */ }
    throw new Error(detail || 'Research request failed')
  }
  if (data && data.ok === false) throw new Error(data.error || 'Research request failed')
  return data
}

/** Statuses that mean a run is still working server-side. */
const IN_FLIGHT_STATUSES = ['Research Request Submitted', 'Research Request In Progress']

/**
 * Wait for a background research run (deep_research / web_research return 202
 * immediately) to finish, by polling the ORQ row. A staged deep-research run
 * walks several stages, so the default timeout is generous; `onProgress`
 * receives each polled row (use orq_stage to show live stage progress).
 * Resolves with the final request row.
 */
export async function waitForRequestCompletion(requestId, { timeoutMs = 1200000, intervalMs = 5000, onProgress } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const { data, error } = await supabase
      .from('owner_research_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (data && !IN_FLIGHT_STATUSES.includes(data.orq_status)) return data
    if (data && onProgress) onProgress(data)
    if (Date.now() >= deadline) {
      throw new Error('Research is still running in the background — check back in a few minutes for results.')
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}

/** Reveal email/phone for selected Lusha candidates. SPENDS LUSHA CREDITS. */
export async function enrichCandidates(requestId, candidateIds) {
  const { data, error } = await supabase.functions.invoke('property-owner-research', {
    body: { action: 'lusha_enrich', request_id: requestId, candidate_ids: candidateIds },
  })
  if (error) {
    let detail = error.message
    try {
      const body = await error.context?.json?.()
      if (body?.error) detail = body.error
    } catch { /* keep the generic message */ }
    throw new Error(detail || 'Enrich failed')
  }
  if (data && data.ok === false) throw new Error(data.error || 'Enrich failed')
  return data
}

/** Dismiss a candidate (kept as an auditable record, status changes). */
export async function dismissCandidate(candidateId) {
  const userId = await getCurrentUserId()
  const { error } = await supabase
    .from('owner_research_candidates')
    .update({
      orc_status: 'Research Candidate Dismissed',
      orc_updated_by: userId,
      orc_updated_at: new Date().toISOString(),
    })
    .eq('id', candidateId)
  if (error) throw new Error(error.message)
}

// "jane p. henderson" → "janephenderson" — person-name key for contact dedupe.
function normalizePersonName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z]/g, '')
}

// contacts.contact_phone has a DB check constraint requiring exactly 10
// digits — normalize research-sourced forms ("573.443.2021", "(573) 443-2021",
// "+1 573-443-2021"). Anything that isn't a US 10-digit number is left off
// the contact; the raw value stays on the research candidate record.
// Exported so the approve dialog can preview the conversion live.
export function normalizePhoneForContact(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  return /^\d{10}$/.test(ten) ? ten : null
}

// contacts.contact_email has a DB check constraint requiring a valid email
// shape — anything else is left off the contact rather than failing the save.
export function normalizeEmailForContact(email) {
  const e = String(email || '').trim()
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(e) ? e : null
}

/**
 * Find existing Contacts that could BE this person, so approval links and
 * updates instead of creating a duplicate. Match strength: same email
 * (anywhere) or same normalized name on the same account = 'strong';
 * name containment on the same account = 'possible'.
 */
export async function findContactMatches({ fullName, email, accountId }) {
  const norm = normalizePersonName(fullName)
  const lastToken = String(fullName || '').trim().split(/\s+/).pop() || ''
  const ors = []
  if (accountId && lastToken.length >= 3) ors.push(`and(contact_account_id.eq.${accountId},contact_name.ilike.%${lastToken}%)`)
  if (email) ors.push(`contact_email.ilike.${email}`)
  if (ors.length === 0) return []
  const { data, error } = await supabase
    .from('contacts')
    .select('id, contact_record_number, contact_name, contact_title, contact_email, contact_phone, contact_linkedin, contact_account_id')
    .eq('contact_is_deleted', false)
    .or(ors.join(','))
    .limit(15)
  if (error) throw new Error(error.message)
  const matches = []
  for (const c of data || []) {
    const cNorm = normalizePersonName(c.contact_name)
    let strength = null
    if (email && c.contact_email && c.contact_email.toLowerCase() === String(email).toLowerCase()) strength = 'strong'
    else if (norm && cNorm === norm && c.contact_account_id === accountId) strength = 'strong'
    else if (norm && cNorm && (cNorm.includes(norm) || norm.includes(cNorm)) && c.contact_account_id === accountId) strength = 'possible'
    if (strength) matches.push({ ...c, matchStrength: strength })
  }
  matches.sort((a, b) => (a.matchStrength === 'strong' ? -1 : 1) - (b.matchStrength === 'strong' ? -1 : 1))
  return matches
}

/**
 * Promote a candidate to a real Contact on the owner-group account.
 * Duplicate-safe: an unambiguous existing match (same email, or same name on
 * the same account) is LINKED and filled in — never duplicated. The review
 * queue's edit-then-approve dialog surfaces matches for an explicit choice
 * (`existingContactId`: uuid = link that contact, null = force-create); the
 * panel's one-click promote and bulk approve auto-link strong matches.
 * `overrides` carries reviewer-corrected fields; `accountId` redirects the
 * contact onto an approved account (a person found under a placeholder owner
 * lands on the real account once the identified organization is approved).
 * Returns the contact row (with `existing: true` when linked).
 */
export async function promoteCandidateToContact(candidate, { overrides = {}, accountId: accountIdOverride = null, existingContactId } = {}) {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('Could not resolve the current LEAP user')
  const accountId = accountIdOverride || candidate.orc_account_id
  if (!accountId) throw new Error('This candidate has no owner-group account to attach the contact to')

  const fullName = (overrides.fullName ?? candidate.orc_full_name ?? '').trim()
  const firstName = overrides.firstName || candidate.orc_first_name || fullName.split(/\s+/)[0] || 'Unknown'
  const lastName = overrides.lastName || candidate.orc_last_name || fullName.split(/\s+/).slice(1).join(' ') || 'Unknown'
  const emails = Array.isArray(candidate.orc_emails) ? candidate.orc_emails : []
  const phones = Array.isArray(candidate.orc_phones) ? candidate.orc_phones : []
  const rawEmail = overrides.email !== undefined ? (overrides.email || null)
    : emails.map(e => (typeof e === 'string' ? e : e?.email || e?.emailAddress || e?.address)).find(Boolean) || null
  const rawPhone = overrides.phone !== undefined ? (overrides.phone || null)
    : phones.map(p => (typeof p === 'string' ? p : p?.number || p?.phoneNumber || p?.internationalNumber)).find(Boolean) || null
  const firstEmail = normalizeEmailForContact(rawEmail)
  const firstPhone = normalizePhoneForContact(rawPhone)
  const linkedin = overrides.linkedin !== undefined ? (overrides.linkedin || null) : (candidate.orc_linkedin_url || null)
  const title = overrides.title !== undefined ? (overrides.title || null) : (candidate.orc_job_title || null)

  // Resolve which existing contact (if any) this person already is.
  let linkTargetId = existingContactId !== undefined ? existingContactId : null
  if (existingContactId === undefined) {
    const matches = await findContactMatches({ fullName, email: firstEmail, accountId })
    const strong = matches.find(m => m.matchStrength === 'strong')
    if (strong) linkTargetId = strong.id
  }

  let contact
  if (linkTargetId) {
    // Link + fill blanks only — research never overwrites data a human put
    // on the contact.
    const { data: current, error: curErr } = await supabase
      .from('contacts')
      .select('id, contact_record_number, contact_title, contact_email, contact_phone, contact_linkedin')
      .eq('id', linkTargetId).maybeSingle()
    if (curErr || !current) throw new Error(curErr?.message || 'Selected contact not found')
    const { data, error } = await supabase
      .from('contacts')
      .update({
        ...(current.contact_title ? {} : (title ? { contact_title: title } : {})),
        ...(current.contact_email ? {} : (firstEmail ? { contact_email: firstEmail } : {})),
        ...(current.contact_phone ? {} : (firstPhone ? { contact_phone: firstPhone } : {})),
        ...(current.contact_linkedin ? {} : (linkedin ? { contact_linkedin: linkedin } : {})),
        contact_updated_by: userId,
        contact_updated_at: new Date().toISOString(),
      })
      .eq('id', linkTargetId)
      .select()
      .single()
    if (error) throw new Error(`Failed to update existing contact: ${error.message}`)
    contact = { ...data, existing: true }
  } else {
    const { data, error } = await supabase
      .from('contacts')
      .insert({
        contact_record_number: '',
        contact_name: fullName || `${firstName} ${lastName}`,
        contact_first_name: firstName,
        contact_last_name: lastName,
        contact_account_id: accountId,
        contact_title: title,
        contact_email: firstEmail,
        contact_phone: firstPhone,
        contact_linkedin: linkedin,
        contact_owner: userId,
        contact_created_by: userId,
      })
      .select()
      .single()
    if (error) throw new Error(`Failed to create contact: ${error.message}`)
    contact = data
  }

  const { error: updErr } = await supabase
    .from('owner_research_candidates')
    .update({
      orc_status: 'Research Candidate Promoted to Contact',
      orc_promoted_contact_id: contact.id,
      orc_updated_by: userId,
      orc_updated_at: new Date().toISOString(),
    })
    .eq('id', candidate.id)
  if (updErr) throw new Error(`Contact created (${contact.contact_record_number}) but candidate update failed: ${updErr.message}`)
  return contact
}

/**
 * Manual research shortcut links — free public searches the user can open in
 * a new tab (Google, LinkedIn, state corporate registries) when the
 * automated passes need a human follow-up.
 */
export function buildManualSearchLinks({ companyName, companyDomain, state, propertyName, propertyCity }) {
  // No known owner org: search the property itself to identify who owns it.
  if (!companyName && !companyDomain && propertyName) {
    const pq = encodeURIComponent([propertyName, propertyCity, state].filter(Boolean).join(' '))
    return [
      { label: 'Google — who owns this property', url: `https://www.google.com/search?q=${encodeURIComponent('who owns')}+${pq}` },
      { label: 'Google — property owner records', url: `https://www.google.com/search?q=${pq}+${encodeURIComponent('owner LLC assessor parcel')}` },
      { label: 'Google — property listing', url: `https://www.google.com/search?q=${pq}+${encodeURIComponent('apartments LIHTC affordable housing')}` },
    ]
  }
  const q = encodeURIComponent(companyName || companyDomain || '')
  const links = []
  if (!q) return links
  links.push({
    label: 'Google — leadership',
    url: `https://www.google.com/search?q=${q}+${encodeURIComponent('leadership team owner CEO "asset manager"')}`,
  })
  if (companyDomain) {
    links.push({
      label: 'Google — site pages',
      url: `https://www.google.com/search?q=${encodeURIComponent(`site:${companyDomain} (team OR leadership OR about OR staff)`)}`,
    })
  }
  links.push({
    label: 'LinkedIn — people',
    url: `https://www.linkedin.com/search/results/people/?keywords=${q}`,
  })
  links.push({
    label: 'LinkedIn — company',
    url: `https://www.linkedin.com/search/results/companies/?keywords=${q}`,
  })
  const registries = {
    NC: { label: 'NC Secretary of State registry', url: `https://www.sosnc.gov/online_services/search/by_title/_Business_Registration_Results?searchTerm=${q}` },
    WI: { label: 'WI DFI corporate registry', url: `https://apps.dfi.wi.gov/apps/corpsearch/Results.aspx?type=Simple&q=${q}` },
    CO: { label: 'CO Secretary of State registry', url: `https://www.coloradosos.gov/biz/BusinessEntityCriteriaExt.do?searchName=${q}` },
    MI: { label: 'MI LARA business registry', url: `https://cofs.lara.state.mi.us/SearchApi/Search/Search?searchTerm=${q}` },
    IN: { label: 'IN Secretary of State registry', url: `https://bsd.sos.in.gov/publicbusinesssearch?searchTerm=${q}` },
  }
  if (state && registries[state]) links.push(registries[state])
  return links
}

// ---------------------------------------------------------------------------
// Review queue — the cross-record workspace in the Outreach module.
// ---------------------------------------------------------------------------

/** Candidate statuses that mean "awaiting a reviewer's decision". */
export const PENDING_CANDIDATE_STATUSES = ['Research Candidate Found', 'Research Candidate Enriched']

/**
 * Everything awaiting review across all properties/accounts:
 *   orgs   — requests whose identified owner organization awaits approval
 *   people — candidates not yet approved/dismissed/rejected
 * Both come back with property/account context for display and filtering.
 */
export async function listReviewQueue() {
  const [orgsRes, peopleRes] = await Promise.all([
    supabase
      .from('owner_research_requests')
      .select(`*,
        property:properties!orq_property_id (id, property_name, property_city, property_state),
        account:accounts!owner_research_requests_orq_account_id_fkey (id, account_name)`)
      .eq('orq_is_deleted', false)
      .eq('orq_org_approval_status', 'Organization Approval Pending')
      .order('orq_created_at', { ascending: false }),
    supabase
      .from('owner_research_candidates')
      .select(`*,
        request:owner_research_requests!orc_request_id (id, orq_record_number, orq_company_name, orq_company_domain, orq_status, orq_org_approval_status, orq_approved_account_id),
        property:properties!orc_property_id (id, property_name, property_city, property_state),
        account:accounts!orc_account_id (id, account_name)`)
      .eq('orc_is_deleted', false)
      .in('orc_status', PENDING_CANDIDATE_STATUSES)
      .order('orc_created_at', { ascending: false }),
  ])
  if (orgsRes.error) throw new Error(orgsRes.error.message)
  if (peopleRes.error) throw new Error(peopleRes.error.message)
  return { orgs: orgsRes.data || [], people: peopleRes.data || [] }
}

/** Reject a candidate from the review queue (auditable, keeps the row). */
export async function rejectCandidate(candidateId, reason) {
  const userId = await getCurrentUserId()
  const { error } = await supabase
    .from('owner_research_candidates')
    .update({
      orc_status: 'Research Candidate Rejected',
      orc_rejected_reason: reason || null,
      orc_updated_by: userId,
      orc_updated_at: new Date().toISOString(),
    })
    .eq('id', candidateId)
  if (error) throw new Error(error.message)
}

/** "Westminster Company, LLC" → "westminstercompany" — for account matching. */
function normalizeOrgName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(llc|l\.l\.c|inc|incorporated|lp|llp|ltd|corp|corporation|co|company|companies|group|holdings|partners|properties|apartments)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Find existing accounts that could BE the identified organization, so the
 * approve dialog can offer "link to existing" instead of creating a
 * duplicate. Match strength: exact normalized name or same website domain =
 * 'strong'; name contains/contained-by = 'possible'. Anything ambiguous is
 * only ever surfaced to the reviewer — never auto-merged.
 */
export async function findAccountMatches(orgName, orgDomain) {
  const norm = normalizeOrgName(orgName)
  const firstToken = String(orgName || '').trim().split(/\s+/)[0] || ''
  const ors = []
  if (firstToken.length >= 3) ors.push(`account_name.ilike.%${firstToken}%`)
  if (orgDomain) ors.push(`account_website.ilike.%${orgDomain}%`)
  if (ors.length === 0) return []
  const { data, error } = await supabase
    .from('accounts')
    .select('id, account_record_number, account_name, account_website, account_hud_participant_number')
    .eq('account_is_deleted', false)
    .or(ors.join(','))
    .limit(25)
  if (error) throw new Error(error.message)
  const matches = []
  for (const a of data || []) {
    if (isPlaceholderOrgName(a.account_name)) continue
    const aNorm = normalizeOrgName(a.account_name)
    const aDomain = extractDomain(a.account_website)
    let strength = null
    if (norm && aNorm === norm) strength = 'strong'
    else if (orgDomain && aDomain && aDomain.toLowerCase() === orgDomain.toLowerCase()) strength = 'strong'
    else if (norm && aNorm && (aNorm.includes(norm) || norm.includes(aNorm))) strength = 'possible'
    if (strength) matches.push({ ...a, matchStrength: strength })
  }
  matches.sort((a, b) => (a.matchStrength === 'strong' ? -1 : 1) - (b.matchStrength === 'strong' ? -1 : 1))
  return matches
}

/**
 * Owner organizations come in layers — holding companies, property LLCs,
 * management subsidiaries. Research captures the structure as structured
 * facts; this derives the related organizations the reviewer can choose to
 * create as linked accounts alongside the main approval. Relationships:
 * 'parent' (becomes the approved account's parent), 'subsidiary' (child of
 * the approved account), 'management' (standalone — a property manager is
 * not necessarily owned by the owner).
 */
export function buildRelatedOrgOptions(request) {
  const stages = request.orq_stage_results || {}
  const ident = stages['Owner Identification'] || {}
  const orgResearch = stages['Organization Research'] || {}
  const seen = new Set([normalizeOrgName(request.orq_company_name)])
  const options = []
  const push = (name, relationship) => {
    if (!name || typeof name !== 'string' || !name.trim()) return
    if (isPlaceholderOrgName(name)) return
    const norm = normalizeOrgName(name)
    if (!norm || seen.has(norm)) return
    seen.add(norm)
    options.push({ name: name.trim(), relationship })
  }
  push(orgResearch.parent_company, 'parent')
  for (const s of Array.isArray(orgResearch.subsidiaries) ? orgResearch.subsidiaries : []) push(s, 'subsidiary')
  push(ident.management_organization, 'management')
  return options
}

// Account Notes content for an account created from research — the clean
// name goes in account_name; everything narrative lands here.
function buildAccountNotesFromResearch(request) {
  const stages = request.orq_stage_results || {}
  const ident = stages['Owner Identification'] || {}
  const orgResearch = stages['Organization Research'] || {}
  const bits = []
  if (orgResearch.organization_type) bits.push(orgResearch.organization_type)
  if (orgResearch.headquarters) bits.push(`Headquarters: ${orgResearch.headquarters}`)
  if (orgResearch.parent_company) bits.push(`Parent company: ${orgResearch.parent_company}`)
  const subs = Array.isArray(orgResearch.subsidiaries) ? orgResearch.subsidiaries.filter(s => typeof s === 'string') : []
  if (subs.length) bits.push(`Subsidiaries/affiliates: ${subs.join(', ')}`)
  if (ident.management_organization) bits.push(`Management organization: ${ident.management_organization}`)
  if (ident.identification_notes) bits.push(ident.identification_notes)
  bits.push(`Identified by owner research ${request.orq_record_number}.`)
  return bits.join('\n')
}

/**
 * Approve an identified owner organization: link it to an existing account
 * (existingAccountId) or create a new one (research context lands in Account
 * Notes, never in the name), optionally repoint the property off its
 * placeholder account (explicit reviewer confirmation), optionally create the
 * related organization accounts the reviewer selected (parent/subsidiary
 * linked via parent_account_id), and move the request's pending candidates
 * onto the real account. Returns { account, relatedAccounts, relatedErrors }.
 */
export async function approveIdentifiedOrganization(request, { existingAccountId = null, repointProperty = false, accountName = null, relatedOrgs = [] } = {}) {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('Could not resolve the current LEAP user')
  // The reviewer edits the final account name in the approve dialog.
  const orgName = (accountName || request.orq_company_name || '').trim()
  if (!orgName || isPlaceholderOrgName(orgName)) {
    throw new Error('This request has no identified organization to approve')
  }

  let account
  if (existingAccountId) {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, account_record_number, account_name, parent_account_id')
      .eq('id', existingAccountId).maybeSingle()
    if (error || !data) throw new Error(error?.message || 'Selected account not found')
    account = data
  } else {
    const { data, error } = await supabase
      .from('accounts')
      .insert({
        account_record_number: '',
        account_name: orgName,
        account_website: request.orq_company_domain ? `https://${request.orq_company_domain}` : null,
        account_notes: buildAccountNotesFromResearch(request),
        account_owner: userId,
        account_created_by: userId,
      })
      .select('id, account_record_number, account_name, parent_account_id')
      .single()
    if (error) throw new Error(`Failed to create account: ${error.message}`)
    account = data
  }

  // Build the reviewer-selected corporate structure. Existing accounts are
  // matched by normalized name (never duplicated); hierarchy links are only
  // ever set where they are currently empty.
  const relatedAccounts = []
  const relatedErrors = []
  for (const org of relatedOrgs) {
    try {
      const matches = await findAccountMatches(org.name, null)
      const exact = matches.find(m => m.matchStrength === 'strong')
      let related
      if (exact) {
        related = { id: exact.id, account_record_number: exact.account_record_number, account_name: exact.account_name, existing: true }
      } else {
        const relationshipNote = org.relationship === 'parent'
          ? `Parent company of ${account.account_name}.`
          : org.relationship === 'subsidiary'
            ? `Subsidiary/affiliate of ${account.account_name}.`
            : `Management organization related to ${account.account_name}.`
        const { data, error } = await supabase
          .from('accounts')
          .insert({
            account_record_number: '',
            account_name: org.name,
            account_notes: `${relationshipNote} Identified by owner research ${request.orq_record_number}.`,
            account_owner: userId,
            account_created_by: userId,
            ...(org.relationship === 'subsidiary' ? { parent_account_id: account.id } : {}),
          })
          .select('id, account_record_number, account_name')
          .single()
        if (error) throw new Error(error.message)
        related = { ...data, existing: false }
      }
      if (org.relationship === 'parent' && !account.parent_account_id) {
        const { error: linkErr } = await supabase
          .from('accounts')
          .update({ parent_account_id: related.id, account_updated_by: userId, account_updated_at: new Date().toISOString() })
          .eq('id', account.id)
        if (linkErr) throw new Error(`created ${related.account_record_number} but parent link failed: ${linkErr.message}`)
        account.parent_account_id = related.id
      } else if (org.relationship === 'subsidiary' && related.existing) {
        // Existing account chosen as the subsidiary — only claim it if it has
        // no parent yet.
        const { error: linkErr } = await supabase
          .from('accounts')
          .update({ parent_account_id: account.id, account_updated_by: userId, account_updated_at: new Date().toISOString() })
          .eq('id', related.id)
          .is('parent_account_id', null)
        if (linkErr) throw new Error(`linked ${related.account_record_number} but parent link failed: ${linkErr.message}`)
      }
      relatedAccounts.push({ ...related, relationship: org.relationship })
    } catch (e) {
      relatedErrors.push(`${org.name}: ${e?.message || 'failed'}`)
    }
  }

  const { error: reqErr } = await supabase
    .from('owner_research_requests')
    .update({
      orq_org_approval_status: 'Organization Approved',
      orq_approved_account_id: account.id,
      orq_updated_by: userId,
      orq_updated_at: new Date().toISOString(),
    })
    .eq('id', request.id)
  if (reqErr) throw new Error(`Account ready (${account.account_record_number}) but request update failed: ${reqErr.message}`)

  if (repointProperty && request.orq_property_id) {
    const { error: propErr } = await supabase
      .from('properties')
      .update({
        property_account_id: account.id,
        property_updated_by: userId,
        property_updated_at: new Date().toISOString(),
      })
      .eq('id', request.orq_property_id)
    if (propErr) throw new Error(`Account approved (${account.account_record_number}) but the property repoint failed: ${propErr.message}`)
  }

  // Pending people from this request belong to the real account now, so
  // approving them creates contacts in the right place.
  const { error: candErr } = await supabase
    .from('owner_research_candidates')
    .update({
      orc_account_id: account.id,
      orc_updated_by: userId,
      orc_updated_at: new Date().toISOString(),
    })
    .eq('orc_request_id', request.id)
    .in('orc_status', PENDING_CANDIDATE_STATUSES)
  if (candErr) throw new Error(`Account approved (${account.account_record_number}) but candidate re-link failed: ${candErr.message}`)

  return { account, relatedAccounts, relatedErrors }
}

/** Reject an identified organization (kept on the request, auditable). */
export async function rejectIdentifiedOrganization(requestId) {
  const userId = await getCurrentUserId()
  const { error } = await supabase
    .from('owner_research_requests')
    .update({
      orq_org_approval_status: 'Organization Rejected',
      orq_updated_by: userId,
      orq_updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
  if (error) throw new Error(error.message)
}
