import { supabase } from '../lib/supabase'
import { getCurrentUserId } from './reportsService'

// ---------------------------------------------------------------------------
// ownerResearchService
//
// Data layer for the Property Owner Research tool (PropertyOwnerResearchPanel
// on account and property records). Finds decision makers for property owner
// groups and specific properties, tiered by cost:
//
//   runOwnerResearch('web_research', …)  — FREE: AI web research (domain,
//                                          leadership pages, parent companies,
//                                          registries) via the
//                                          property-owner-research edge fn.
//   runOwnerResearch('lusha_search', …)  — NO CREDITS: Lusha prospecting
//                                          search (names + titles only).
//   enrichCandidates(…)                  — PAID Lusha credits: reveal
//                                          email/phone for explicitly
//                                          selected candidates.
//
// Requests are ORQ- records (owner_research_requests); every person found is
// an ORC- record (owner_research_candidates) that can be promoted to a real
// Contact or dismissed. Nothing here is hardcoded: target job titles come
// from the orq_target_job_title picklist (admin-manageable).
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
    return {
      accountId: data.id,
      companyName: data.account_name,
      companyDomain: extractDomain(data.account_website),
      state: data.billing_state || null,
    }
  }
  const { data, error } = await supabase
    .from('properties')
    .select('id, property_name, property_state, property_website, property_account_id, property_hud_owner_org, accounts:property_account_id (account_name, account_website)')
    .eq('id', recordId).maybeSingle()
  if (error || !data) throw new Error(error?.message || 'Property not found')
  const account = data.accounts || null
  return {
    propertyId: data.id,
    accountId: data.property_account_id || null,
    companyName: account?.account_name || data.property_hud_owner_org || null,
    companyDomain: extractDomain(account?.account_website || data.property_website),
    state: data.property_state || null,
  }
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

/**
 * Wait for a background research run (web_research returns 202 immediately)
 * to finish, by polling the ORQ row. Resolves with the final request row.
 */
export async function waitForRequestCompletion(requestId, { timeoutMs = 300000, intervalMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const { data, error } = await supabase
      .from('owner_research_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (data && data.orq_status !== 'Research Request Submitted') return data
    if (Date.now() >= deadline) {
      throw new Error('Web research is still running in the background — check back in a minute for results.')
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

/**
 * Promote a candidate to a real Contact on the owner-group account.
 * Creates the contact (CT-), links it back on the candidate, and flips the
 * candidate status. Returns the new contact row.
 */
export async function promoteCandidateToContact(candidate) {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('Could not resolve the current LEAP user')
  const accountId = candidate.orc_account_id
  if (!accountId) throw new Error('This candidate has no owner-group account to attach the contact to')

  const fullName = (candidate.orc_full_name || '').trim()
  const firstName = candidate.orc_first_name || fullName.split(/\s+/)[0] || 'Unknown'
  const lastName = candidate.orc_last_name || fullName.split(/\s+/).slice(1).join(' ') || 'Unknown'
  const emails = Array.isArray(candidate.orc_emails) ? candidate.orc_emails : []
  const phones = Array.isArray(candidate.orc_phones) ? candidate.orc_phones : []
  const firstEmail = emails.map(e => (typeof e === 'string' ? e : e?.email || e?.emailAddress || e?.address)).find(Boolean) || null
  const firstPhone = phones.map(p => (typeof p === 'string' ? p : p?.number || p?.phoneNumber || p?.internationalNumber)).find(Boolean) || null

  const { data: contact, error } = await supabase
    .from('contacts')
    .insert({
      contact_record_number: '',
      contact_name: fullName || `${firstName} ${lastName}`,
      contact_first_name: firstName,
      contact_last_name: lastName,
      contact_account_id: accountId,
      contact_title: candidate.orc_job_title || null,
      contact_email: firstEmail,
      contact_phone: firstPhone,
      contact_linkedin: candidate.orc_linkedin_url || null,
      contact_owner: userId,
      contact_created_by: userId,
    })
    .select()
    .single()
  if (error) throw new Error(`Failed to create contact: ${error.message}`)

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
export function buildManualSearchLinks({ companyName, companyDomain, state }) {
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
