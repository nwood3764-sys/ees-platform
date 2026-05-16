// projectScheduler.js — data layer for the Project Scheduler wizard.
//
// Three public functions, all read-only except bulkScheduleWorkOrders with
// commit:true:
//
//   fetchUnscheduledWorkOrdersForProject(projectId)
//     → returns the WO list for the project filtered to status='To Be Scheduled',
//       with effective duration resolved from work_orders.work_order_duration_minutes
//       or work_types.work_type_duration_minutes, plus building/unit/work_type
//       labels for display.
//
//   fetchTeamLeads()
//     → returns contacts whose title contains 'Team Lead'. Each carries
//       a derived `crew_label` parsed from the trailing portion of the title
//       (e.g. 'Team Lead — Alpha Crew' → 'Alpha Crew') for picker display.
//
//   bulkScheduleWorkOrders({
//     projectId, workOrderIds, teamLeadContactId,
//     startDate, endDate,
//     // optional, defaults match the RPC defaults:
//     dailyStartTime, dailyEndTime, lunchStart, lunchEnd,
//     interWoBufferMinutes, timezone,
//     commit                  // false = preview, true = commit
//   })
//     → wraps the bulk_schedule_work_orders RPC. Same shape for both modes.

import { supabase } from '../lib/supabase'

const PV_TBS = (cache => async () => {
  if (cache.v) return cache.v
  const { data, error } = await supabase
    .from('picklist_values')
    .select('id')
    .eq('picklist_object', 'work_orders')
    .eq('picklist_field', 'work_order_status')
    .eq('picklist_value', 'To Be Scheduled')
    .eq('picklist_is_active', true)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error("picklist value work_orders.work_order_status='To Be Scheduled' not found")
  cache.v = data.id
  return cache.v
})({})

export async function fetchUnscheduledWorkOrdersForProject(projectId) {
  if (!projectId) throw new Error('projectId is required')
  const tbsId = await PV_TBS()

  const { data, error } = await supabase
    .from('work_orders')
    .select(`
      id,
      work_order_record_number,
      work_order_name,
      work_order_duration_minutes,
      work_type_id,
      building_id,
      unit_id,
      work_types:work_type_id (
        work_type_name,
        work_type_duration_minutes
      ),
      buildings:building_id (
        building_name,
        building_address,
        properties:property_id (
          property_name,
          property_street,
          property_city,
          property_state,
          property_zip
        )
      ),
      units:unit_id ( unit_name )
    `)
    .eq('project_id', projectId)
    .eq('work_order_status', tbsId)
    .eq('work_order_is_deleted', false)
    .order('work_order_record_number', { ascending: true })

  if (error) throw error
  return (data || []).map(r => {
    const effectiveDuration =
      (r.work_order_duration_minutes != null ? Number(r.work_order_duration_minutes) : null) ??
      (r.work_types?.work_type_duration_minutes != null
        ? Number(r.work_types.work_type_duration_minutes) : null)
    const prop = r.buildings?.properties
    const addressParts = [
      r.buildings?.building_address,
      prop?.property_street,
      prop?.property_city && prop?.property_state
        ? `${prop.property_city}, ${prop.property_state}${prop.property_zip ? ' ' + prop.property_zip : ''}`
        : null,
    ].filter(Boolean)
    return {
      id: r.id,
      record_number: r.work_order_record_number,
      name: r.work_order_name,
      work_type_id: r.work_type_id,
      work_type_name: r.work_types?.work_type_name || '(unknown work type)',
      building_id: r.building_id,
      building_name: r.buildings?.building_name || '',
      unit_id: r.unit_id,
      unit_name: r.units?.unit_name || '',
      property_name: prop?.property_name || '',
      // Pre-joined address string for the hover tooltip
      address: addressParts.join('\n'),
      duration_minutes: effectiveDuration,
      duration_source: r.work_order_duration_minutes != null
        ? 'work_order_override'
        : (r.work_types?.work_type_duration_minutes != null ? 'work_type_default' : null),
    }
  })
}

// Returns Team Leads with qualification status for a given WO batch.
// When called with no workOrderIds (initial load), returns all leads as
// qualified=true. When called with a WO list, qualification reflects
// which leads hold every cert required by any work_type in the batch.
export async function fetchTeamLeads({ workOrderIds = null, startDate = null } = {}) {
  // For the no-WO case, fall back to the simple listing — the RPC will
  // happily return everyone with qualified=true since required is empty.
  const wos = Array.isArray(workOrderIds) && workOrderIds.length > 0 ? workOrderIds : []
  const start = startDate || new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase.rpc('team_leads_qualified_for_work_orders', {
    p_work_order_ids: wos,
    p_start_date: start,
  })
  if (error) throw error
  return (data || []).map(r => ({
    id: r.contact_id,
    full_name: r.full_name,
    title: r.contact_title || '',
    crew_label: r.crew_label,
    qualified: !!r.qualified,
    missing_certs: r.missing_certs || null,
  }))
}

export async function bulkScheduleWorkOrders({
  projectId,
  workOrderIds,
  teamLeadContactId,
  startDate,
  endDate,
  dailyStartTime,
  dailyEndTime,
  lunchStart,
  lunchEnd,
  interWoBufferMinutes,
  interPropertyBufferMinutes,
  timezone,
  commit = false,
  pinnedPlacements = [],
}) {
  if (!projectId)            throw new Error('projectId is required')
  if (!Array.isArray(workOrderIds) || workOrderIds.length === 0)
    throw new Error('workOrderIds must be a non-empty array')
  if (!teamLeadContactId)    throw new Error('teamLeadContactId is required')
  if (!startDate || !endDate) throw new Error('startDate and endDate are required')

  const params = {
    p_project_id: projectId,
    p_work_order_ids: workOrderIds,
    p_team_lead_contact_id: teamLeadContactId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_commit: !!commit,
  }
  if (dailyStartTime)              params.p_daily_start_time = dailyStartTime
  if (dailyEndTime)                params.p_daily_end_time = dailyEndTime
  if (lunchStart)                  params.p_lunch_start = lunchStart
  if (lunchEnd)                    params.p_lunch_end = lunchEnd
  if (interWoBufferMinutes != null) params.p_inter_wo_buffer_minutes = interWoBufferMinutes
  if (interPropertyBufferMinutes != null) params.p_inter_property_buffer_minutes = interPropertyBufferMinutes
  if (timezone)                    params.p_timezone = timezone
  if (Array.isArray(pinnedPlacements) && pinnedPlacements.length > 0) {
    params.p_pinned_placements = pinnedPlacements
  }

  const { data, error } = await supabase.rpc('bulk_schedule_work_orders', params)
  if (error) throw error
  return data || []
}

// ── Helpers exported for the wizard UI ──────────────────────────────────────

// Sum durations across a list of WOs (returns object with totals + counts of
// missing-duration WOs). Used to give the dispatcher a workload estimate in
// step 1 before they even pick a date range.
export function summarizeWorkOrderDurations(workOrders) {
  let totalMinutes = 0
  let missing = 0
  for (const wo of workOrders) {
    if (wo.duration_minutes == null || wo.duration_minutes <= 0) missing += 1
    else totalMinutes += Number(wo.duration_minutes)
  }
  return {
    totalMinutes,
    totalHours: totalMinutes / 60,
    missingCount: missing,
    placeableCount: workOrders.length - missing,
  }
}

// Convert "no_capacity_in_window" / "duration_not_set" placement_error codes
// into user-friendly sentences. Falls through to raw text for unknown codes.
export function describePlacementError(code) {
  switch (code) {
    case 'no_capacity_in_window':
      return 'Not enough open time in this date range — extend the window or reduce the WO selection.'
    case 'duration_not_set':
      return 'No duration set on this work type or work order — set one before scheduling.'
    case 'pin_outside_working_hours':
      return "Pinned start time is outside the scheduling window for the selected daily hours, or falls during lunch (11:30–12:00) or on a weekend — unpin and try a valid time."
    case 'pin_overlaps_existing':
      return 'Pinned time overlaps another pinned work order — unpin one of them.'
    default:
      return code || ''
  }
}
