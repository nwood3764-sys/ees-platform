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
        id, contact_id, saa_is_deleted,
        contacts ( id, contact_first_name, contact_last_name, contact_title )
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
    // service_appointment_assignments returns an array. The Team Lead is
    // the first non-deleted assignment whose contact has 'team lead' in
    // their title. (Crew Members live in the same table — that's coming
    // when we build the crew composition UI.)
    const assignments = Array.isArray(r.service_appointment_assignments)
      ? r.service_appointment_assignments.filter(a => !a.saa_is_deleted) : []
    const leadAssign = assignments.find(a =>
      (a.contacts?.contact_title || '').toLowerCase().includes('team lead'))
      || assignments[0] || null
    const lead = leadAssign?.contacts ? {
      id: leadAssign.contacts.id,
      full_name: `${leadAssign.contacts.contact_first_name || ''} ${leadAssign.contacts.contact_last_name || ''}`.trim(),
      crew_label: parseCrewLabel(leadAssign.contacts.contact_title || ''),
    } : null
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
      .select('id, contact_id, ra_start_datetime, ra_end_datetime, ra_reason, ra_is_deleted')
      .eq('ra_is_deleted', false)
      .lt('ra_start_datetime', endISO)
      .gt('ra_end_datetime', startISO)
    if (error) throw error
    return (data || []).map(r => ({
      id: r.id,
      contact_id: r.contact_id,
      start_at: r.ra_start_datetime,
      end_at: r.ra_end_datetime,
      reason: r.ra_reason || 'Out',
    }))
  } catch {
    return []
  }
}

// Active Team Leads (the lanes of the board). Same definition as the
// scheduler wizard uses — title ILIKE '%team lead%'.
export async function fetchActiveTeamLeads() {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, contact_first_name, contact_last_name, contact_title')
    .eq('contact_is_deleted', false)
    .ilike('contact_title', '%team lead%')
    .order('contact_last_name', { ascending: true })
  if (error) throw error
  return (data || []).map(c => ({
    id: c.id,
    full_name: `${c.contact_first_name || ''} ${c.contact_last_name || ''}`.trim(),
    title: c.contact_title || '',
    crew_label: parseCrewLabel(c.contact_title || ''),
  }))
}

function parseCrewLabel(title) {
  const em = title.match(/Team Lead\s*—\s*(.+)$/)
  if (em) return em[1].trim()
  const hy = title.match(/Team Lead\s*-\s*(.+)$/)
  if (hy) return hy[1].trim()
  return null
}
