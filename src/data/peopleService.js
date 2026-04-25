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
// Technicians — now a filtered view of contacts with a field-staff record
// type. The function name and return shape are kept so PeopleModule.jsx
// continues to work unchanged.
// ---------------------------------------------------------------------------
export async function fetchTechnicians() {
  // Resolve the picklist row ids for the four field-staff record types so
  // we can filter contacts to just those people.
  const { data: rts, error: rtErr } = await supabase
    .from('picklist_values')
    .select('id, picklist_value')
    .eq('picklist_object', 'contacts')
    .eq('picklist_field', 'record_type')
    .in('picklist_value', ['team_lead', 'lead_technician', 'technician_in_training', 'technician'])
  if (rtErr) throw rtErr
  const rtIds = (rts || []).map(r => r.id)
  if (rtIds.length === 0) return []

  const { data, error } = await supabase
    .from('contacts')
    .select(`
      id,
      contact_record_number,
      contact_name,
      contact_first_name,
      contact_last_name,
      contact_title,
      contact_status,
      contact_employee_id,
      contact_hire_date,
      contact_phone,
      contact_email,
      contact_drivers_license,
      contact_drivers_license_state,
      contact_drivers_license_expiry
    `)
    .in('contact_record_type', rtIds)
    .eq('contact_is_deleted', false)
    .order('contact_hire_date', { ascending: false, nullsFirst: false })

  if (error) throw error

  if ((data || []).length === 0) return []

  const picklists = await loadPicklists()

  // Pull the BPI-related contact_skills in one query so we can surface a
  // BPI column on each row without an N+1 fetch. Any skill whose name
  // starts with "BPI" counts. The matching engine doesn't care about this —
  // it's purely for the legacy People > Technicians display column.
  const contactIds = data.map(r => r.id)
  const { data: bpiRows, error: bpiErr } = await supabase
    .from('contact_skills')
    .select(`
      contact_id,
      cs_effective_end_date,
      skills:skill_id ( skill_name )
    `)
    .in('contact_id', contactIds)
    .eq('cs_is_deleted', false)
  if (bpiErr) throw bpiErr

  const bpiByContact = new Map()
  for (const row of bpiRows || []) {
    if (!row.skills?.skill_name?.startsWith('BPI')) continue
    const existing = bpiByContact.get(row.contact_id)
    // Keep the latest expiry per contact (multiple BPI certs are possible)
    if (!existing || (row.cs_effective_end_date || '') > (existing.expiry || '')) {
      bpiByContact.set(row.contact_id, { expiry: row.cs_effective_end_date || '' })
    }
  }

  return data.map(r => {
    const bpi = bpiByContact.get(r.id)
    return {
      id: r.contact_record_number || r.id.slice(0, 8).toUpperCase(),
      _id: r.id,
      name: r.contact_name,
      firstName: r.contact_first_name,
      lastName: r.contact_last_name,
      title: r.contact_title || '—',
      status: picklists.byId.get(r.contact_status) || '—',
      employeeId: r.contact_employee_id || '—',
      hireDate: r.contact_hire_date || '—',
      phone: r.contact_phone || '—',
      email: r.contact_email || '—',
      bpiCertified: bpi ? 'Yes' : 'No',
      bpiExpiry: bpi?.expiry || '—',
      driversLicense: r.contact_drivers_license || '—',
      licenseState: r.contact_drivers_license_state || '—',
      licenseExpiry: r.contact_drivers_license_expiry || '—',
    }
  })
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
