import { supabase } from '../lib/supabase'
import { loadPicklists } from './outreachService'

// ---------------------------------------------------------------------------
// People services — post-rework.
//
// The technicians table is gone. Field workers are now contacts with one of
// the field-staff record types (Team Lead, Lead Technician, Technician in
// Training). Certifications were absorbed into the skills system —
// `contact_skills` rows hold the credential ledger (effective dates, cert
// number, document URL) and link a contact to a Skill.
//
// `fetchTechnicians` returns the same shape the People module expects so the
// UI doesn't need to change at the call site. It pulls from contacts filtered
// to the field-staff record types and surfaces the most recent BPI cert as
// the "BPI" column for back-compat. Once we build the dedicated Skills UI,
// the BPI-shaped column will be replaced by a "Skills" multi-value display.
// ---------------------------------------------------------------------------

// Users (all app user accounts) — unchanged from before.
export async function fetchUsers() {
  const { data, error } = await supabase
    .from('users')
    .select(`
      id,
      user_record_number,
      user_name,
      user_first_name,
      user_last_name,
      user_title,
      user_email,
      user_phone,
      user_is_active,
      role_id,
      roles:role_id ( role_name )
    `)
    .order('user_created_at', { ascending: false })

  if (error) throw error

  return (data || [])
    .filter(r => r.user_is_active !== false)
    .map(r => ({
      id: r.user_record_number || r.id.slice(0, 8).toUpperCase(),
      _id: r.id,
      name: r.user_name || `${r.user_first_name || ''} ${r.user_last_name || ''}`.trim(),
      firstName: r.user_first_name || '—',
      lastName: r.user_last_name || '—',
      title: r.user_title || '—',
      email: r.user_email || '—',
      phone: r.user_phone || '—',
      role: r.roles?.role_name || '—',
      status: r.user_is_active ? 'Active' : 'Inactive',
    }))
}

// ---------------------------------------------------------------------------
// Technicians — USERS who do field work.
//
// This used to read contacts filtered to four field-staff record TYPES. It was
// wrong in two ways at once: every one of those record types has since been
// retired (so the filter could only ever return the handful of scheduling
// placeholder contacts named "Wisconsin Single Family Auditor" and the like),
// and a technician was never a contact in the first place. The rest of the
// platform has always agreed on that — work_orders.assigned_technician_id is
// an FK to users, LEAP Pad signs in as a user, and the Technician Setup Wizard
// provisions a user. Only this function and the Field module's tab disagreed
// (Nicholas, 2026-09-02: "Where's Logan? Where's Roman? Where's Lucas?").
//
// Who counts is users.user_is_field_technician — a stored fact, maintained on
// the user record, deliberately NOT derived from the role: a role is an access
// grant and being on a crew is a job fact, and Nicholas is an Admin who also
// carries a work order.
//
// The return shape is unchanged so both call sites (the Field module's tab
// count and Project Planning's workforce list) keep working. The BPI columns
// are reported honestly as unknown rather than guessed: the credential ledger
// (contact_skills) is keyed to CONTACTS, so it cannot answer for a user. That
// is a real gap, not something to paper over with a wrong "No".
// ---------------------------------------------------------------------------
export async function fetchTechnicians() {
  const { data, error } = await supabase
    .from('users')
    .select(`
      id,
      user_record_number,
      user_name,
      user_first_name,
      user_last_name,
      user_title,
      user_email,
      user_phone,
      user_is_active,
      role_id,
      roles:role_id ( role_name )
    `)
    .eq('user_is_field_technician', true)
    .eq('user_is_deleted', false)
    .order('user_name', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.user_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.user_name || [r.user_first_name, r.user_last_name].filter(Boolean).join(' '),
    firstName: r.user_first_name || '—',
    lastName: r.user_last_name || '—',
    title: r.user_title || r.roles?.role_name || '—',
    role: r.roles?.role_name || '—',
    status: r.user_is_active ? 'Active' : 'Inactive',
    employeeId: '—',
    hireDate: '—',
    phone: r.user_phone || '—',
    email: r.user_email || '—',
    // The credential ledger is keyed to contacts, so it cannot speak for a
    // user. Unknown, not "No".
    bpiCertified: '—',
    bpiExpiry: '—',
    driversLicense: '—',
    licenseState: '—',
    licenseExpiry: '—',
  }))
}

// ---------------------------------------------------------------------------
// Certifications — the certifications table is gone. The credential ledger
// now lives on contact_skills (FSL: ServiceResourceSkill). Function name is
// kept for back-compat; result shape mirrors the old certs list so
// PeopleModule's Certifications tab works without changes.
// ---------------------------------------------------------------------------
export async function fetchCertifications() {
  const { data, error } = await supabase
    .from('contact_skills')
    .select(`
      id,
      cs_certification_number,
      cs_issuing_body,
      cs_effective_start_date,
      cs_effective_end_date,
      cs_document_url,
      contacts:contact_id   ( contact_name ),
      skills:skill_id       ( skill_name, skill_category, skill_issuing_body )
    `)
    .eq('cs_is_deleted', false)
    .order('cs_effective_end_date', { ascending: true, nullsFirst: false })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.skills?.skill_name || '—',
    technician: r.contacts?.contact_name || '—',
    // The old "type" column (e.g., BPI / NATE / OSHA) is no longer a
    // separate field — surface a coarse label by inspecting the skill name.
    type: (r.skills?.skill_name || '').split(' ')[0] || '—',
    issuingBody: r.cs_issuing_body || r.skills?.skill_issuing_body || '—',
    certNumber: r.cs_certification_number || '—',
    issueDate:      r.cs_effective_start_date || '—',
    expirationDate: r.cs_effective_end_date   || '—',
    // Status derived from expiry date — anything still in the future is Active.
    status: !r.cs_effective_end_date || r.cs_effective_end_date >= new Date().toISOString().slice(0, 10)
      ? 'Active'
      : 'Expired',
  }))
}

// ---------------------------------------------------------------------------
// Time sheets — repointed at contacts (the technician_id column became
// contact_id during the rework). Same shape as before so the UI is unchanged.
// ---------------------------------------------------------------------------
export async function fetchTimeSheets() {
  const picklists = await loadPicklists()

  const { data, error } = await supabase
    .from('time_sheets')
    .select(`
      id,
      ts_record_number,
      ts_name,
      ts_week_start_date,
      ts_week_end_date,
      ts_status,
      ts_total_hours,
      ts_notes,
      contact_id,
      contacts:contact_id ( contact_name )
    `)
    .eq('ts_is_deleted', false)
    .order('ts_week_start_date', { ascending: false })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.ts_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.ts_name,
    technician: r.contacts?.contact_name || '—',
    weekStart: r.ts_week_start_date || '—',
    weekEnd: r.ts_week_end_date || '—',
    status: picklists.byId.get(r.ts_status) || '—',
    totalHours: r.ts_total_hours ? Number(r.ts_total_hours) : 0,
    notes: r.ts_notes || '',
  }))
}

// ---------------------------------------------------------------------------
// Resource absences — PTO, training, sick days, etc.
// ---------------------------------------------------------------------------
// The slot engine in compute-availability already consults resource_absences
// — any row whose [ra_start_datetime, ra_end_datetime] overlaps a candidate
// slot is filtered out of customer-facing availability. The UI's job is just
// to let staff CRUD these rows.
//
// fetchUpcomingAbsences returns active + future absences across all Techs,
// joining the Tech contact and the absence_type picklist label so the list
// view can render names and types without further lookups.

export async function fetchUpcomingAbsences({ days = 60 } = {}) {
  const picklists = await loadPicklists()

  // Window: from start of today (Chicago) to N days out. Capture currently-
  // active absences (started in past, still ongoing) and any future ones.
  const now = new Date()
  const windowEnd = new Date(now.getTime() + days * 24 * 3600 * 1000)

  const { data, error } = await supabase
    .from('resource_absences')
    .select(`
      id,
      ra_record_number,
      ra_name,
      ra_start_datetime,
      ra_end_datetime,
      ra_is_all_day,
      ra_absence_type,
      ra_notes,
      contact_id,
      contacts:contact_id (
        id, contact_first_name, contact_last_name, contact_title
      )
    `)
    .eq('ra_is_deleted', false)
    .gte('ra_end_datetime', now.toISOString())
    .lte('ra_start_datetime', windowEnd.toISOString())
    .order('ra_start_datetime', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id:           r.ra_record_number || r.id.slice(0, 8).toUpperCase(),
    _id:          r.id,
    technician:   `${r.contacts?.contact_first_name || ''} ${r.contacts?.contact_last_name || ''}`.trim() || '—',
    technicianId: r.contact_id,
    title:        r.contacts?.contact_title || '—',
    type:         picklists.byId.get(r.ra_absence_type) || 'Other',
    startDate:    r.ra_start_datetime,
    endDate:      r.ra_end_datetime,
    allDay:       r.ra_is_all_day === true,
    notes:        r.ra_notes || '',
    name:         r.ra_name || '—',
  }))
}
