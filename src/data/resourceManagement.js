// ---------------------------------------------------------------------------
// resourceManagement — data layer for the Resource Matrix surface inside
// the Dispatch Console. Reads field staff (Team Lead / Lead Technician /
// Project Site Lead / Trainee contacts), active skills, active
// certifications, and the contact ↔ skill/certification junctions.
//
// v1 is read-only: the matrix surfaces assignments and click-throughs to
// the contact's record detail. Inline add/remove of assignments lands in
// a later slice once the v1 surface has been used in anger.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase'

// Contact titles we consider "field staff". Captured here so the matrix
// stays in sync with the broader platform definition of field staff.
// Matches the same ILIKE patterns used by Dispatch Console for swimlane
// resolution (`contact_title ILIKE '%Team Lead%'` etc.).
export const FIELD_STAFF_TITLE_PATTERNS = [
  'Team Lead',
  'Lead Technician',
  'Project Site Lead',
  'Trainee',
]

// Build the PostgREST OR filter for the title patterns above. Output looks
// like `contact_title.ilike.%Team Lead%,contact_title.ilike.%Trainee%,...`.
function buildTitleOrFilter() {
  return FIELD_STAFF_TITLE_PATTERNS
    .map(p => `contact_title.ilike.%${p}%`)
    .join(',')
}

/**
 * All field-staff contacts. Returns one row per contact with display + filter
 * columns. The crew_label is the substring of contact_title between the
 * pipe characters when present (matches Dispatch Console's lane label).
 */
export async function fetchAllFieldStaff() {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, contact_record_number, contact_full_name, contact_title, contact_email, contact_phone')
    .eq('contact_is_deleted', false)
    .or(buildTitleOrFilter())
    .order('contact_full_name', { ascending: true })

  if (error) throw error

  return (data || []).map(c => ({
    id:              c.id,
    record_number:   c.contact_record_number,
    full_name:       c.contact_full_name || '(no name)',
    title:           c.contact_title || '',
    crew_label:      parseCrewLabel(c.contact_title),
    email:           c.contact_email || null,
    phone:           c.contact_phone || null,
  }))
}

// Crew labels are encoded as ` | <Crew Name>` inside contact_title (e.g.
// "Team Lead | Martinez Crew"). Mirror Dispatch Console's parsing so the
// matrix labels line up with the swimlanes.
function parseCrewLabel(title) {
  if (!title || typeof title !== 'string') return ''
  const pipeIdx = title.indexOf('|')
  if (pipeIdx < 0) return ''
  return title.slice(pipeIdx + 1).trim()
}

/**
 * All active (non-deleted) skills, ordered alphabetically. Each row carries
 * skill_requires_certification so the matrix can mark certification-backed
 * skills with a small badge — useful at a glance when reviewing crew gaps.
 */
export async function fetchAllActiveSkills() {
  const { data, error } = await supabase
    .from('skills')
    .select('id, skill_record_number, skill_name, skill_description, skill_issuing_body, skill_requires_certification, skill_validity_months')
    .eq('skill_is_deleted', false)
    .order('skill_name', { ascending: true })

  if (error) throw error
  return data || []
}

/**
 * All active certifications (certification_is_active = true AND not deleted).
 * Inactive certifications are still respected on existing contact_certifications
 * rows so the matrix shows them with a "(retired)" hint, but they don't appear
 * as columns for new assignments — see fetchInactiveCertificationsReferencedByStaff.
 */
export async function fetchAllActiveCertifications() {
  const { data, error } = await supabase
    .from('certifications')
    .select('id, certification_record_number, certification_name, certification_description, certification_issuing_body, certification_is_active')
    .eq('certification_is_deleted', false)
    .eq('certification_is_active', true)
    .order('certification_name', { ascending: true })

  if (error) throw error
  return data || []
}

/**
 * Contact ↔ skill junctions for the given contact IDs. Filters out
 * soft-deleted rows and expired ones (effective_end_date < today). One row
 * per (contact_id, skill_id). Returns a Map keyed by `${contact_id}::${skill_id}`
 * for O(1) lookup from the matrix renderer.
 */
export async function fetchContactSkillsForStaff(contactIds) {
  if (!contactIds || contactIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('contact_skills')
    .select('id, cs_record_number, contact_id, skill_id, cs_skill_level, cs_effective_start_date, cs_effective_end_date, cs_certification_number, cs_issuing_body, cs_notes')
    .in('contact_id', contactIds)
    .eq('cs_is_deleted', false)
    .order('cs_created_at', { ascending: false })

  if (error) throw error

  const today = new Date().toISOString().slice(0, 10)
  const map = new Map()
  for (const row of data || []) {
    if (row.cs_effective_end_date && row.cs_effective_end_date < today) continue
    map.set(`${row.contact_id}::${row.skill_id}`, row)
  }
  return map
}

/**
 * Contact ↔ certification junctions for the given contact IDs. One row per
 * (contact_id, certification_id). Returns a Map with `${contact_id}::${certification_id}`
 * keys. Expired certifications (cc_expires_date < today) are kept in the
 * result so the matrix can render them as expired warnings — they're a
 * compliance gap the dispatcher needs to see, not hide.
 */
export async function fetchContactCertificationsForStaff(contactIds) {
  if (!contactIds || contactIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('contact_certifications')
    .select('id, cc_record_number, contact_id, certification_id, cc_certificate_number, cc_issued_date, cc_expires_date, cc_notes')
    .in('contact_id', contactIds)
    .eq('cc_is_deleted', false)
    .order('cc_created_at', { ascending: false })

  if (error) throw error

  const map = new Map()
  for (const row of data || []) {
    // Annotate each row with its current state so the renderer doesn't have
    // to re-derive today's date everywhere. Three states: 'active',
    // 'expiring_soon' (≤30 days), 'expired'.
    map.set(`${row.contact_id}::${row.certification_id}`, {
      ...row,
      _state: describeCertState(row.cc_expires_date),
    })
  }
  return map
}

function describeCertState(expiresDate) {
  if (!expiresDate) return 'active'
  const today = new Date().toISOString().slice(0, 10)
  if (expiresDate < today) return 'expired'
  // 30-day window: compare date strings via Date math.
  const expires = new Date(expiresDate + 'T00:00:00Z')
  const cutoff  = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() + 30)
  if (expires <= cutoff) return 'expiring_soon'
  return 'active'
}
