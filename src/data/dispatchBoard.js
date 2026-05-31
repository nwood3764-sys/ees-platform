// dispatchBoard.js — read-only data layer for the multi-tech Dispatch
// Board view. Pulls all Scheduled service appointments for a date range,
// joined to their assigned Team Lead (via service_appointment_assignments),
// work_order → building → property, and work_type for color/label.
//
// Resource Absences are folded in as a second collection so the board can
// render them as gray bars inside a tech's lane.

import { supabase } from '../lib/supabase'

// Returns Scheduled SAs whose [start, end] overlaps [startDate, endDate],
// where the date inputs are local YYYY-MM-DD strings interpreted in the
// caller's timezone (we keep the engine's America/Chicago default).
//
// Returns an array of:
//   {
//     id, sa_record_number, sa_name, sa_status_value,
//     start_at, end_at,                    // ISO timestamptz from the DB
//     team_lead: { id, full_name, crew_label } | null,
//     work_order: { id, record_number, name } | null,
//     work_type:  { id, name } | null,
//     building:   { id, name, property_id, property_name } | null,
//     unit:       { id, name } | null,
//     project:    { id, record_number, name } | null,
//   }
export async function fetchScheduledServiceAppointmentsInRange({ startDate, endDate }) {
  if (!startDate || !endDate) throw new Error('startDate and endDate are required')
  // Range bounds: include the entire end day. The DB stores timestamptz,
  // so we pass an exclusive upper bound at midnight of the day AFTER endDate.
  const startISO = `${startDate}T00:00:00`
  const upperDate = new Date(`${endDate}T00:00:00`)
  upperDate.setDate(upperDate.getDate() + 1)
  const endISO = upperDate.toISOString().slice(0, 19)

  const { data, error } = await supabase
    .from('service_appointments')
    .select(`
      id, sa_record_number, sa_name,
      sa_scheduled_start_time, sa_scheduled_end_time,
      sa_status,
      work_order_id, project_id,
      work_orders!service_appointments_work_order_id_fkey (
        id, work_order_record_number, work_order_name,
        building_id, unit_id, work_type_id,
        buildings ( id, building_name, property_id, properties ( id, property_name ) ),
        units ( id, unit_name ),
        work_types ( id, work_type_name )
      ),
      projects ( id, project_record_number, project_name ),
      service_appointment_assignments!service_appointment_assignments_service_appointment_id_fkey (
        id, contact_id, saa_user_id, saa_is_deleted,
        contacts ( id, contact_first_name, contact_last_name, contact_title ),
        users:saa_user_id ( id, user_name, user_title )
      )
    `)
    .eq('sa_is_deleted', false)
    .gte('sa_scheduled_start_time', startISO)
    .lt('sa_scheduled_start_time', endISO)
    .order('sa_scheduled_start_time', { ascending: true })

  if (error) throw error

  // Resolve picklist value for sa_status in a second pass; saves N+1 by
  // collecting unique IDs and one filtered query.
  const statusIds = Array.from(new Set((data || []).map(r => r.sa_status).filter(Boolean)))
  let statusMap = new Map()
  if (statusIds.length > 0) {
    const { data: pvs } = await supabase
      .from('picklist_values')
      .select('id, picklist_value')
      .in('id', statusIds)
    statusMap = new Map((pvs || []).map(p => [p.id, p.picklist_value]))
  }

  return (data || []).map(r => {
    const wo = r.work_orders || null
    const building = wo?.buildings || null
    const property = building?.properties || null
    const unit = wo?.units || null
    const wt = wo?.work_types || null
    const project = r.projects || null
    // service_appointment_assignments returns an array. The Team Lead is the
    // user-linked assignment, or the first non-deleted assignment whose contact
    // has 'team lead' in their title. The lead's `id` is the underlying person
    // id (user or contact) so it matches the board lane id from fetchActiveTeamLeads.
    const assignments = Array.isArray(r.service_appointment_assignments)
      ? r.service_appointment_assignments.filter(a => !a.saa_is_deleted) : []
    const leadAssign = assignments.find(a => a.saa_user_id)
      || assignments.find(a => (a.contacts?.contact_title || '').toLowerCase().includes('team lead'))
      || assignments[0] || null
    let lead = null
    if (leadAssign?.saa_user_id && leadAssign.users) {
      lead = {
        id: leadAssign.users.id,
        full_name: leadAssign.users.user_name || '(user)',
        crew_label: parseCrewLabel(leadAssign.users.user_title || ''),
        source: 'user',
      }
    } else if (leadAssign?.contacts) {
      lead = {
        id: leadAssign.contacts.id,
        full_name: `${leadAssign.contacts.contact_first_name || ''} ${leadAssign.contacts.contact_last_name || ''}`.trim(),
        crew_label: parseCrewLabel(leadAssign.contacts.contact_title || ''),
        source: 'contact',
      }
    }
    return {
      id: r.id,
      sa_record_number: r.sa_record_number,
      sa_name: r.sa_name,
      sa_status_value: statusMap.get(r.sa_status) || null,
      start_at: r.sa_scheduled_start_time,
      end_at:   r.sa_scheduled_end_time,
      team_lead: lead,
      work_order: wo ? { id: wo.id, record_number: wo.work_order_record_number, name: wo.work_order_name } : null,
      work_type:  wt ? { id: wt.id, name: wt.work_type_name } : null,
      building: building ? { id: building.id, name: building.building_name, property_id: property?.id || null, property_name: property?.property_name || null } : null,
      unit: unit ? { id: unit.id, name: unit.unit_name } : null,
      project: project ? { id: project.id, record_number: project.project_record_number, name: project.project_name } : null,
    }
  })
}

// Resource absences for the same date range, also keyed by Team Lead /
// crew member so they can render as gray "OOO" bars in their lane.
// Best-effort: if resource_absences columns differ, returns empty.
export async function fetchResourceAbsencesInRange({ startDate, endDate }) {
  if (!startDate || !endDate) return []
  try {
    const startISO = `${startDate}T00:00:00`
    const upperDate = new Date(`${endDate}T00:00:00`)
    upperDate.setDate(upperDate.getDate() + 1)
    const endISO = upperDate.toISOString().slice(0, 19)
    const { data, error } = await supabase
      .from('resource_absences')
      .select('id, contact_id, ra_user_id, ra_start_datetime, ra_end_datetime, ra_reason, ra_is_deleted')
      .eq('ra_is_deleted', false)
      .lt('ra_start_datetime', endISO)
      .gt('ra_end_datetime', startISO)
    if (error) throw error
    return (data || []).map(r => ({
      id: r.id,
      contact_id: r.contact_id,
      user_id: r.ra_user_id,
      // Unified lane key — whichever resource the absence belongs to. Matches
      // the board lane id (user or contact) from fetchActiveTeamLeads.
      lane_id: r.ra_user_id || r.contact_id,
      start_at: r.ra_start_datetime,
      end_at: r.ra_end_datetime,
      reason: r.ra_reason || 'Out',
    }))
  } catch {
    return []
  }
}

// Active Team Leads (the lanes of the board) — unioned across Contacts
// (subcontractor crews, title ILIKE '%team lead%') and Users (internal W-2 crew
// in the 'Team Lead' role). Each lane carries `source` ('contact'|'user'), the
// service_territory_id, and the array of held (unexpired) certification_ids so
// the filter rail can filter client-side. User leads have no tracked certs yet,
// so their certification_ids is empty.
export async function fetchActiveTeamLeads() {
  const todayYMD = new Date().toLocaleDateString('en-CA')

  const [contactRes, userRes] = await Promise.all([
    supabase
      .from('contacts')
      .select(`
        id, contact_first_name, contact_last_name, contact_title,
        contact_service_territory_id,
        contact_certifications!contact_certifications_contact_id_fkey (
          certification_id, cc_expires_date, cc_is_deleted
        )
      `)
      .eq('contact_is_deleted', false)
      .ilike('contact_title', '%team lead%')
      .order('contact_last_name', { ascending: true }),
    supabase
      .from('users')
      .select(`
        id, user_name, user_title, user_last_name,
        roles:role_id!inner ( role_name ),
        service_territory_members!service_territory_members_stm_user_id_fkey (
          service_territory_id, stm_is_primary, stm_is_deleted
        )
      `)
      .eq('user_is_deleted', false)
      .eq('user_is_active', true)
      .eq('roles.role_name', 'Team Lead')
      .order('user_last_name', { ascending: true }),
  ])
  if (contactRes.error) throw contactRes.error
  if (userRes.error) throw userRes.error

  const contactLanes = (contactRes.data || []).map(c => {
    const certs = (Array.isArray(c.contact_certifications) ? c.contact_certifications : [])
      .filter(cc => !cc.cc_is_deleted)
      .filter(cc => !cc.cc_expires_date || cc.cc_expires_date >= todayYMD)
      .map(cc => cc.certification_id)
    return {
      id: c.id,
      source: 'contact',
      full_name: `${c.contact_first_name || ''} ${c.contact_last_name || ''}`.trim(),
      title: c.contact_title || '',
      crew_label: parseCrewLabel(c.contact_title || ''),
      service_territory_id: c.contact_service_territory_id || null,
      certification_ids: certs,
    }
  })

  const userLanes = (userRes.data || []).map(u => {
    // Prefer the primary territory membership; fall back to the first active one.
    const memberships = (Array.isArray(u.service_territory_members) ? u.service_territory_members : [])
      .filter(m => !m.stm_is_deleted)
    const primary = memberships.find(m => m.stm_is_primary) || memberships[0] || null
    return {
      id: u.id,
      source: 'user',
      full_name: u.user_name || '(user)',
      title: u.user_title || 'Team Lead',
      crew_label: parseCrewLabel(u.user_title || ''),
      service_territory_id: primary?.service_territory_id || null,
      certification_ids: [],   // user certs not tracked yet
    }
  })

  return [...userLanes, ...contactLanes]
    .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name), undefined, { sensitivity: 'base' }))
}

function parseCrewLabel(title) {
  const em = title.match(/Team Lead\s*—\s*(.+)$/)
  if (em) return em[1].trim()
  const hy = title.match(/Team Lead\s*-\s*(.+)$/)
  if (hy) return hy[1].trim()
  return null
}

// ─── Phase 3: dispatch console additions ───────────────────────────────
//
// The console adds three filter dimensions (service territory, certifications,
// crew) and an unscheduled-WO palette that the dispatcher drags onto lanes.
//
// fetchServiceTerritories — flat list for the filter rail multi-select.
// fetchActiveCertifications — flat list for the filter rail multi-select.
// fetchUnscheduledWorkOrdersForDispatch — every WO in 'To Be Scheduled'
//   across all projects, joined to building → property → territory, work_type,
//   and work_type_required_certifications so the palette can filter by
//   territory + required cert client-side.
// dispatchAssignWorkOrder — drop-from-palette commit. Wraps
//   bulk_schedule_work_orders with a one-element WO array and a pinned
//   placement so the engine path is identical to the bulk wizard.
//   (dispatchRescheduleServiceAppointment lives in projectScheduler.js
//   and handles the drag-between-lanes / drag-within-lane cases.)

export async function fetchServiceTerritories() {
  const { data, error } = await supabase
    .from('service_territories')
    .select('id, service_territory_name')
    .eq('service_territory_is_deleted', false)
    .eq('service_territory_is_active', true)
    .order('service_territory_name', { ascending: true })
  if (error) throw error
  return (data || []).map(t => ({ id: t.id, name: t.service_territory_name }))
}

export async function fetchActiveCertifications() {
  const { data, error } = await supabase
    .from('certifications')
    .select('id, certification_name')
    .eq('certification_is_active', true)
    .eq('certification_is_deleted', false)
    .order('certification_name', { ascending: true })
  if (error) throw error
  return (data || []).map(c => ({ id: c.id, name: c.certification_name }))
}

// Returns To-Be-Scheduled WOs with everything the palette needs to render
// and the filter rail needs to filter:
//   {
//     id, record_number, name, duration_minutes,
//     work_type: { id, name, required_certification_ids: [uuid] },
//     building: { id, name, property_id, property_name },
//     unit:     { id, name },
//     project:  { id, record_number, name },
//     service_territory_id,  -- from WO, falling back to building's
//   }
export async function fetchUnscheduledWorkOrdersForDispatch() {
  // First resolve the 'To Be Scheduled' picklist id
  const { data: pv, error: pvErr } = await supabase
    .from('picklist_values')
    .select('id')
    .eq('picklist_object', 'work_orders')
    .eq('picklist_field', 'work_order_status')
    .eq('picklist_value', 'To Be Scheduled')
    .eq('picklist_is_active', true)
    .maybeSingle()
  if (pvErr) throw pvErr
  if (!pv) throw new Error("picklist value 'work_orders.work_order_status'=To Be Scheduled not found")

  const { data, error } = await supabase
    .from('work_orders')
    .select(`
      id, work_order_record_number, work_order_name,
      work_order_duration_minutes, service_territory_id,
      work_type_id, building_id, unit_id, project_id,
      work_types ( id, work_type_name, work_type_duration_minutes,
        work_type_required_certifications!work_type_required_certifications_work_type_id_fkey (
          certification_id, wtrc_is_deleted
        )
      ),
      buildings ( id, building_name, service_territory_id,
        properties ( id, property_name )
      ),
      units ( id, unit_name ),
      projects ( id, project_record_number, project_name )
    `)
    .eq('work_order_status', pv.id)
    .eq('work_order_is_deleted', false)
    .order('work_order_record_number', { ascending: true })
  if (error) throw error

  return (data || []).map(r => {
    const wt = r.work_types || null
    const requiredCertIds = (Array.isArray(wt?.work_type_required_certifications)
      ? wt.work_type_required_certifications
      : [])
      .filter(rc => !rc.wtrc_is_deleted)
      .map(rc => rc.certification_id)
    const effectiveDuration =
      (r.work_order_duration_minutes != null ? Number(r.work_order_duration_minutes) : null) ??
      (wt?.work_type_duration_minutes != null ? Number(wt.work_type_duration_minutes) : null)
    const territoryId =
      r.service_territory_id || r.buildings?.service_territory_id || null
    return {
      id: r.id,
      record_number: r.work_order_record_number,
      name: r.work_order_name,
      duration_minutes: effectiveDuration,
      work_type: wt ? { id: wt.id, name: wt.work_type_name, required_certification_ids: requiredCertIds } : null,
      building: r.buildings ? {
        id: r.buildings.id,
        name: r.buildings.building_name,
        property_id: r.buildings.properties?.id || null,
        property_name: r.buildings.properties?.property_name || null,
      } : null,
      unit: r.units ? { id: r.units.id, name: r.units.unit_name } : null,
      project: r.projects ? { id: r.projects.id, record_number: r.projects.project_record_number, name: r.projects.project_name } : null,
      service_territory_id: territoryId,
      project_id: r.project_id,
    }
  })
}

// Drop a palette WO onto a (lane × day) cell at a specific local start time.
// Reuses bulk_schedule_work_orders via a one-element array + pinned placement —
// same engine as the wizard and the single-WO modal. Returns the result row
// from the RPC: {placed, placement_error, service_appointment_id, ...}.
export async function dispatchAssignWorkOrder({
  workOrderId,
  projectId,
  teamLeadContactId = null,
  teamLeadUserId = null,
  teamLeadSource = null,   // 'contact' | 'user'
  startISO,           // RFC3339 with explicit offset, e.g. '2026-05-18T09:00:00-05:00'
  dateYMD,            // 'YYYY-MM-DD' for the start_date/end_date single-day window
  force = false,
}) {
  // Resolve the lead resource (exactly one of contact/user).
  let leadContactId = null
  let leadUserId = null
  if (teamLeadSource === 'user') leadUserId = teamLeadUserId
  else if (teamLeadSource === 'contact') leadContactId = teamLeadContactId
  else if (teamLeadUserId) leadUserId = teamLeadUserId
  else leadContactId = teamLeadContactId

  if (!workOrderId || !projectId || !startISO || !dateYMD || (!leadContactId && !leadUserId)) {
    throw new Error('workOrderId, projectId, a team lead (contact or user), startISO, dateYMD are required')
  }
  const { data, error } = await supabase.rpc('bulk_schedule_work_orders', {
    p_project_id: projectId,
    p_work_order_ids: [workOrderId],
    p_team_lead_contact_id: leadContactId,
    p_team_lead_user_id: leadUserId,
    p_start_date: dateYMD,
    p_end_date: dateYMD,
    p_commit: true,
    p_pinned_placements: [{ work_order_id: workOrderId, start_ts: startISO, force }],
  })
  if (error) throw error
  return Array.isArray(data) && data.length > 0 ? data[0] : null
}
