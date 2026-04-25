import { supabase } from '../lib/supabase'
import { loadPicklists } from './outreachService'

// DB work-order statuses are short ("In Progress"); the UI filter options
// are long ("Work Order In Progress"). Map between them for display so the
// filter dropdowns still match.
const workOrderStatusLabel = raw => {
  if (!raw) return '—'
  return raw.startsWith('Work Order') ? raw : `Work Order ${raw}`
}

// Palette of fixed crew colors. Index by order of appearance so Alpha crew
// is always emerald, Bravo always sky, etc. Matches CHART_COLORS.
const CREW_COLORS = ['#3ecf8e', '#7eb3e8', '#e8a949', '#a78bfa', '#e85c5c', '#5eead4', '#fb923c']

// Parse a "Team Lead — Alpha Crew" title into just "Alpha Crew".
// Falls back to null if the title doesn't match that shape.
const crewNameFromTitle = (title) => {
  if (!title) return null
  const m = title.match(/Team Lead\s*[—\-]\s*(.+)$/)
  return m ? m[1].trim() : null
}

// Turn "Javier Martinez" into "JM". Used for the crew avatar circle.
const initialsFromName = (first, last) => {
  const a = (first || '').trim().charAt(0).toUpperCase()
  const b = (last  || '').trim().charAt(0).toUpperCase()
  return (a + b) || '?'
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function fetchProjects() {
  const picklists = await loadPicklists()

  const { data, error } = await supabase
    .from('projects')
    .select(`
      id,
      project_record_number,
      project_name,
      project_status,
      project_scheduled_date,
      project_completion_date,
      property_id,
      properties:property_id ( property_name, property_state )
    `)
    .eq('project_is_deleted', false)
    .order('project_scheduled_date', { ascending: true, nullsFirst: false })

  if (error) throw error

  // Also pull work order counts per project so the "WOs" column shows real data
  const { data: woRows } = await supabase
    .from('work_orders')
    .select('project_id')
    .eq('work_order_is_deleted', false)

  const woCountByProject = new Map()
  for (const w of woRows || []) {
    woCountByProject.set(w.project_id, (woCountByProject.get(w.project_id) || 0) + 1)
  }

  return (data || []).map(r => ({
    id: r.project_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.project_name,
    property: r.properties?.property_name || '—',
    program: '—', // populated in a follow-up pass once project↔program link is live
    status: picklists.byId.get(r.project_status) || '—',
    owner: 'Nicholas Wood',
    workOrders: woCountByProject.get(r.id) || 0,
    startDate: r.project_scheduled_date || '',
    endDate: r.project_completion_date || '',
    state: r.properties?.property_state || '',
  }))
}

// ---------------------------------------------------------------------------
// Work orders
// ---------------------------------------------------------------------------

export async function fetchWorkOrders() {
  const picklists = await loadPicklists()

  const { data, error } = await supabase
    .from('work_orders')
    .select(`
      id,
      work_order_record_number,
      work_order_name,
      work_order_status,
      work_order_scheduled_start_date,
      work_order_duration,
      work_type_id,
      property_id,
      building_id,
      work_types:work_type_id ( work_type_name ),
      properties:property_id ( property_name, property_state ),
      buildings:building_id ( building_name )
    `)
    .eq('work_order_is_deleted', false)
    .order('work_order_scheduled_start_date', { ascending: true, nullsFirst: false })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.work_order_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.work_order_name,
    property: r.properties?.property_name || '—',
    building: r.buildings?.building_name || '—',
    workType: r.work_types?.work_type_name || '—',
    status: workOrderStatusLabel(picklists.byId.get(r.work_order_status)),
    teamLead: 'Unassigned',
    scheduledDate: r.work_order_scheduled_start_date || '',
    duration: r.work_order_duration ? `${r.work_order_duration}h` : '—',
    state: r.properties?.property_state || '',
  }))
}

// ---------------------------------------------------------------------------
// Schedule (service appointments grouped by Team Lead crew)
// ---------------------------------------------------------------------------
// The Schedule view is a Gantt-style timeline. Each row is a crew (a Team
// Lead plus their crew members), and each bar is a service appointment on
// the selected date. We pull the appointments, their crew assignments, and
// enough work-order/property context to render a useful bar.
//
// Grouping rule: the assignee whose technician_title contains "Team Lead"
// is the crew's key. If no Team Lead is assigned, the appointment gets
// grouped under an "Unassigned" crew so it doesn't silently disappear.
//
// Times from Postgres are UTC; we convert to the browser's local timezone
// for display so the Gantt matches the user's wall clock.

export async function fetchSchedule(date = new Date()) {
  const picklists = await loadPicklists()

  // Build [startOfLocalDay, endOfLocalDay) window in ISO so Postgres sees
  // a UTC range that covers the selected calendar day in the user's local tz.
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
  const end   = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0)

  const { data: saRows, error: saErr } = await supabase
    .from('service_appointments')
    .select(`
      id,
      sa_record_number,
      sa_name,
      sa_subject,
      sa_status,
      sa_scheduled_start_time,
      sa_scheduled_end_time,
      sa_duration_minutes,
      work_order_id,
      work_orders:work_order_id (
        id,
        work_order_record_number,
        work_order_name,
        work_order_status,
        work_type_id,
        property_id,
        building_id,
        work_types:work_type_id ( work_type_name ),
        properties:property_id ( property_name, property_state ),
        buildings:building_id ( building_name )
      )
    `)
    .gte('sa_scheduled_start_time', start.toISOString())
    .lt('sa_scheduled_start_time', end.toISOString())
    .eq('sa_is_deleted', false)
    .order('sa_scheduled_start_time', { ascending: true })

  if (saErr) throw saErr

  const saIds = (saRows || []).map(r => r.id)
  let assignments = []
  if (saIds.length > 0) {
    const { data: aRows, error: aErr } = await supabase
      .from('service_appointment_assignments')
      .select(`
        id,
        service_appointment_id,
        contact_id,
        contacts:contact_id (
          id,
          contact_first_name,
          contact_last_name,
          contact_title,
          contact_record_type
        )
      `)
      .in('service_appointment_id', saIds)
      .eq('saa_is_deleted', false)
    if (aErr) throw aErr
    assignments = aRows || []
  }

  // Vehicles carry the crew in their name ("Truck 01 — Alpha Crew"). Until
  // a proper crew table lands, we match by that suffix so the correct truck
  // shows up next to each crew. Only active (non-deleted) trucks.
  const { data: vehicleRows } = await supabase
    .from('vehicles')
    .select('id, vehicle_name')
    .eq('vehicle_is_deleted', false)
  const vehicleByCrew = new Map()
  for (const v of vehicleRows || []) {
    const m = (v.vehicle_name || '').match(/[—\-]\s*(.+?\s*Crew)\s*$/i)
    if (m) vehicleByCrew.set(m[1].trim().toLowerCase(), v.vehicle_name)
  }

  // Group assignments by appointment for quick lookup.
  const assignmentsBySa = new Map()
  for (const a of assignments) {
    if (!assignmentsBySa.has(a.service_appointment_id)) assignmentsBySa.set(a.service_appointment_id, [])
    assignmentsBySa.get(a.service_appointment_id).push(a)
  }

  // Walk appointments and bucket them under their Team Lead's crew.
  const crewsByKey = new Map()
  const UNASSIGNED = '__unassigned__'

  for (const sa of saRows || []) {
    const members = assignmentsBySa.get(sa.id) || []
    const leadAssn = members.find(a => {
      const title = a.contacts?.contact_title || ''
      return /Team Lead/i.test(title)
    })

    let key, crewLabel, leadName, leadFirst, leadLast, crewMembers
    if (leadAssn) {
      const t = leadAssn.contacts
      leadFirst = t.contact_first_name
      leadLast  = t.contact_last_name
      leadName  = `${leadFirst} ${leadLast}`.trim()
      crewLabel = crewNameFromTitle(t.contact_title) || `${leadLast} Crew`
      key = `lead:${t.id}`
      crewMembers = members
        .map(a => `${a.contacts?.contact_first_name || ''} ${a.contacts?.contact_last_name || ''}`.trim())
        .filter(Boolean)
    } else {
      key = UNASSIGNED
      crewLabel = 'Unassigned'
      leadName = ''
      crewMembers = members
        .map(a => `${a.contacts?.contact_first_name || ''} ${a.contacts?.contact_last_name || ''}`.trim())
        .filter(Boolean)
    }

    // Job timing: convert UTC ISO to local decimal hours so the Gantt math
    // (pct, fH) works with the existing view. Clamp to a minimum duration
    // so very-short bars still have a visible click target.
    const startDt = sa.sa_scheduled_start_time ? new Date(sa.sa_scheduled_start_time) : null
    const endDt   = sa.sa_scheduled_end_time   ? new Date(sa.sa_scheduled_end_time)   : null
    if (!startDt) continue

    const startHr = startDt.getHours() + startDt.getMinutes() / 60
    let durationHr
    if (endDt) {
      durationHr = (endDt.getTime() - startDt.getTime()) / 3600000
    } else if (sa.sa_duration_minutes != null) {
      durationHr = Number(sa.sa_duration_minutes) / 60
    } else {
      durationHr = 1
    }
    if (durationHr < 0.25) durationHr = 0.25

    const wo = sa.work_orders
    const job = {
      id: sa.id,
      saRecordNumber: sa.sa_record_number,
      workOrderId: wo?.id,
      workOrderRecordNumber: wo?.work_order_record_number,
      name: sa.sa_name || wo?.work_order_name || 'Untitled appointment',
      subject: sa.sa_subject || '',
      property: wo?.properties?.property_name || '—',
      building: wo?.buildings?.building_name || '',
      workType: wo?.work_types?.work_type_name || '—',
      status: workOrderStatusLabel(picklists.byId.get(wo?.work_order_status)),
      saStatus: picklists.byId.get(sa.sa_status) || '',
      start: startHr,
      duration: durationHr,
      color: null, // filled in after crew colors are assigned
      state: wo?.properties?.property_state || '',
    }

    if (!crewsByKey.has(key)) {
      crewsByKey.set(key, {
        key,
        id: key,
        name: crewLabel,
        leadName,
        initials: leadFirst && leadLast ? initialsFromName(leadFirst, leadLast) : '—',
        vehicle: vehicleByCrew.get(crewLabel.toLowerCase()) || '—',
        members: [],
        jobs: [],
      })
    }
    const crew = crewsByKey.get(key)
    for (const m of crewMembers) {
      if (!crew.members.includes(m)) crew.members.push(m)
    }
    crew.jobs.push(job)
  }

  // Stable ordering: Unassigned last, everyone else alphabetical by crew name.
  const crews = Array.from(crewsByKey.values()).sort((a, b) => {
    if (a.key === UNASSIGNED) return 1
    if (b.key === UNASSIGNED) return -1
    return a.name.localeCompare(b.name)
  })

  // Assign crew colors once the order is fixed, then paint each job the
  // same color as its crew so the bars read as a team.
  crews.forEach((c, i) => {
    c.color = CREW_COLORS[i % CREW_COLORS.length]
    c.jobs.forEach(j => { j.color = c.color })
    // Sort a crew's jobs chronologically so the bars line up left-to-right.
    c.jobs.sort((a, b) => a.start - b.start)
  })

  return crews
}
