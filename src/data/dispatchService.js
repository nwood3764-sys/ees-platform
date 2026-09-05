// ─── dispatchService.js ──────────────────────────────────────────────────────
// The work orders a dispatcher still has to schedule, and the one call that
// schedules them.
//
// Nicholas, 2026-09-03: "You need to get the dispatch board in a place where
// somebody can use it. They need to see what work orders are to be scheduled so
// that they can schedule."
//
// This is deliberately NOT built on bulk_schedule_work_orders. That RPC places a
// whole project's batch and hard-requires every work order to be in "To Be
// Scheduled" status — a status no live work order is in — as well as a project,
// a building and a unit. It also has no notion of MOVING a job: run it twice and
// you get two appointments. Scheduling one work order is a different purpose and
// gets its own path, per the repo's build discipline.
//
// Scheduling is now just two fields on the work order. Since 2026-09-03 a
// technician's day is selected FROM work_orders — Assigned Technician plus
// Scheduled Start Date is the whole of it, and a service appointment can never
// gate a job. So this writes those two fields and nothing else: no appointment
// is created, which also means no customer is contacted.

import { supabase } from '../lib/supabase'
import { getCurrentUserId } from './layoutService'

// A work order is finished (or abandoned) in these states and is not the
// dispatcher's problem any more. Everything else can still be given a day.
export const NOT_SCHEDULABLE_STATUSES = [
  'To Be Verified', 'Verified', 'Closed', 'Unable to Complete',
]

/**
 * Work orders that still need a technician, a date, or both.
 *
 * Ordered by how blocked they are: a job with neither a technician nor a date
 * is further from happening than one that only needs a name against it.
 */
export async function fetchWorkOrdersToSchedule() {
  const { data, error } = await supabase
    .from('work_orders')
    .select(`
      id,
      work_order_record_number,
      work_order_name,
      work_order_scheduled_start_date,
      work_order_scheduled_start_time,
      assigned_technician_id,
      work_order_duration_minutes,
      work_types:work_type_id ( work_type_name, work_type_duration_minutes ),
      properties:property_id ( property_name, property_city, property_state ),
      buildings:building_id ( building_name, building_number_or_name ),
      units:unit_id ( unit_number, unit_name ),
      status:work_order_status ( picklist_value ),
      technician:assigned_technician_id ( user_first_name, user_last_name )
    `)
    .eq('work_order_is_deleted', false)
    .order('work_order_record_number', { ascending: true })
    .limit(500)
  if (error) throw error

  return (data || [])
    .filter(r => !NOT_SCHEDULABLE_STATUSES.includes(r.status?.picklist_value))
    .filter(r => !r.work_order_scheduled_start_date || !r.assigned_technician_id)
    .map(r => ({
      id: r.id,
      recordNumber: r.work_order_record_number,
      name: r.work_order_name,
      workType: r.work_types?.work_type_name || '—',
      // The work order's own duration wins; the work type's is the default.
      durationMinutes: r.work_order_duration_minutes || r.work_types?.work_type_duration_minutes || null,
      property: r.properties?.property_name || '—',
      place: [r.properties?.property_city, r.properties?.property_state].filter(Boolean).join(', '),
      building: r.buildings?.building_number_or_name || r.buildings?.building_name || null,
      unit: r.units?.unit_number || r.units?.unit_name || null,
      status: r.status?.picklist_value || '—',
      date: r.work_order_scheduled_start_date || null,
      time: r.work_order_scheduled_start_time || null,
      technicianId: r.assigned_technician_id || null,
      technician: r.technician
        ? [r.technician.user_first_name, r.technician.user_last_name].filter(Boolean).join(' ')
        : null,
      // What this job is still waiting for — the dispatcher's actual worklist.
      needs: !r.assigned_technician_id && !r.work_order_scheduled_start_date ? 'both'
        : !r.assigned_technician_id ? 'technician' : 'date',
    }))
    .sort((a, b) => {
      const rank = { both: 0, technician: 1, date: 2 }
      return (rank[a.needs] - rank[b.needs]) || a.recordNumber.localeCompare(b.recordNumber)
    })
}

/**
 * The people a work order can be given to: active field technicians.
 *
 * Same stored fact the Assigned Technician picker uses
 * (users.user_is_field_technician), so the board and the record page can never
 * offer different people. It is a job fact, not a role — an Admin who carries a
 * work order is a technician, and deriving this from the role would drop them.
 */
export async function fetchSchedulableTechnicians() {
  const { data, error } = await supabase
    .from('users')
    .select('id, user_first_name, user_last_name, user_title, roles:role_id ( role_name )')
    .eq('user_is_deleted', false)
    .eq('user_is_active', true)
    .eq('user_is_field_technician', true)
    .order('user_first_name', { ascending: true })
  if (error) throw error
  return (data || []).map(u => ({
    id: u.id,
    name: [u.user_first_name, u.user_last_name].filter(Boolean).join(' ').trim(),
    title: u.user_title || u.roles?.role_name || '',
  }))
}

/**
 * Give a work order a technician and a day.
 *
 * Writes only the scheduling fields. No service appointment is created —
 * appointments are for assessments now, and creating one here would put a
 * customer into the notification pipeline for work nobody booked with them.
 *
 * Status is moved to Scheduled only from a status that precedes it, so a job
 * already In Progress does not get dragged backwards by a dispatcher moving it
 * to another day.
 */
export async function scheduleWorkOrder({ workOrderId, technicianId, date, time = null, currentStatus = null }) {
  if (!workOrderId) throw new Error('scheduleWorkOrder: a work order is required')
  if (!technicianId) throw new Error('Pick a technician — a work order reaches somebody by being assigned to them.')
  if (!date) throw new Error('Pick a date — a work order reaches a technician by being scheduled for a day.')

  const patch = {
    assigned_technician_id: technicianId,
    work_order_scheduled_start_date: date,
    work_order_scheduled_start_time: time || null,
    work_order_updated_at: new Date().toISOString(),
  }
  try {
    const userId = await getCurrentUserId()
    if (userId) patch.work_order_updated_by = userId
  } catch { /* the audit trigger stamps it anyway */ }

  const MOVES_TO_SCHEDULED = ['New', 'To Be Scheduled', 'To Be Assigned', 'Assigned', 'To Be Accepted']
  if (currentStatus && MOVES_TO_SCHEDULED.includes(currentStatus)) {
    const { data: sv } = await supabase
      .from('picklist_values')
      .select('id')
      .eq('picklist_object', 'work_orders')
      .eq('picklist_field', 'work_order_status')
      .eq('picklist_value', 'Scheduled')
      .maybeSingle()
    if (sv?.id) patch.work_order_status = sv.id
  }

  const { error } = await supabase.from('work_orders').update(patch).eq('id', workOrderId)
  if (error) throw new Error(error.message)
}

// ─── Outbound message approvals ─────────────────────────────────────────────
// Nicholas, 2026-09-03: "Any outgoing communications, emails, texts, anything
// must be approved by a human first. That's a hard rule for now."
//
// enqueue_notification holds every customer message instead of sending it, so
// these three calls are the handle on that valve. Approving SENDS, which is why
// it goes through an RPC rather than a table update: the fire-notification
// shared secret lives in the database and must never reach a browser.

export async function fetchMessagesAwaitingApproval() {
  const { data, error } = await supabase.rpc('outbound_messages_awaiting_approval')
  if (error) throw error
  return (data || []).map(r => ({
    id: r.oma_id,
    recordNumber: r.oma_record_number,
    requestedAt: r.requested_at,
    event: r.trigger_event,
    channel: r.channel,
    recipientName: r.recipient_name,
    recipientAddress: r.recipient_address,
    subject: r.subject_line,
    body: r.body_template,
    appointment: r.appointment,
    workOrder: r.work_order,
    workType: r.work_type,
    property: r.property_name,
    scheduledStart: r.scheduled_start,
  }))
}

export async function approveOutboundMessage(omaId) {
  const { data, error } = await supabase.rpc('approve_outbound_message', { p_oma_id: omaId })
  if (error) throw new Error(error.message)
  return data
}

export async function declineOutboundMessage(omaId, reason = null) {
  const { data, error } = await supabase.rpc('decline_outbound_message', {
    p_oma_id: omaId, p_reason: reason || null,
  })
  if (error) throw new Error(error.message)
  return data
}
