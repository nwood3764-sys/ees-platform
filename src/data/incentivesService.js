import { supabase } from '../lib/supabase'

// Format dollars as "$NNN,NNN"
const fmtDollar = n => n == null ? '—' : `$${Number(n).toLocaleString()}`

// Compute days between ISO date string and today
const daysSince = iso => {
  if (!iso) return 0
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)))
}


// ---------------------------------------------------------------------------
// Incentive applications
// ---------------------------------------------------------------------------
// The Incentives module home read project_payment_requests and payment_receipts
// and nothing else, so with both tables empty every tile on it read 0 and $0
// while ten real incentive applications sat one tab away (Nicholas,
// 2026-08-29: "there are several incentives created… why is the inside
// dashboard blank?"). An application IS the incentive being pursued, so the
// module home reports on it.
//
// Purpose-built for that home screen: the counts and money it shows, resolved
// to readable status and program labels. Not a list view — the Incentive
// Applications tab is the list.

export async function fetchIncentiveApplications() {
  const { data, error } = await supabase
    .from('incentive_applications')
    .select(`
      id, ia_record_number, ia_name, ia_status, ia_record_type,
      ia_requested_incentive_amount, ia_approved_incentive_amount,
      ia_rebate_amount, ia_submission_date, ia_created_at,
      properties:property_id ( property_name, property_state )
    `)
    .eq('ia_is_deleted', false)
    .order('ia_created_at', { ascending: false })
  if (error) throw error
  const rows = data || []

  // ia_status and ia_record_type are uuid FKs to picklist_values; a uuid on a
  // dashboard is not an answer, so both resolve to their labels here.
  const ids = [...new Set(rows.flatMap(r => [r.ia_status, r.ia_record_type]).filter(Boolean))]
  const labels = new Map()
  if (ids.length) {
    const { data: pv } = await supabase
      .from('picklist_values')
      .select('id, picklist_label, picklist_value')
      .in('id', ids)
    for (const v of pv || []) labels.set(v.id, v.picklist_label || v.picklist_value)
  }

  return rows.map(r => ({
    id: r.ia_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.ia_name || '—',
    property: r.properties?.property_name || '—',
    state: r.properties?.property_state || '',
    program: labels.get(r.ia_record_type) || '—',
    status: labels.get(r.ia_status) || 'No status',
    // Approved beats requested once it exists — the approved figure is the one
    // the program has actually committed to.
    amount: Number(r.ia_approved_incentive_amount ?? r.ia_requested_incentive_amount
      ?? r.ia_rebate_amount) || 0,
    requested: Number(r.ia_requested_incentive_amount) || 0,
    approved: Number(r.ia_approved_incentive_amount) || 0,
    submittedDate: r.ia_submission_date || null,
    daysOpen: daysSince(r.ia_submission_date || r.ia_created_at),
  }))
}

// ---------------------------------------------------------------------------
// Project payment requests
// ---------------------------------------------------------------------------

export async function fetchPaymentRequests() {
  const { data, error } = await supabase
    .from('project_payment_requests')
    .select(`
      id,
      payment_request_number,
      status,
      submitted_date,
      approved_date,
      payment_received_date,
      requested_amount,
      approved_amount,
      created_at,
      program_id,
      project_id,
      property_id,
      programs:program_id ( name, short_name, state ),
      projects:project_id ( project_name ),
      properties:property_id ( property_name, property_state )
    `)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data || []).map(r => {
    // "days open" is number of days since the request entered the pipeline
    // — we use submitted_date if present, otherwise created_at.
    const baseDate = r.submitted_date || r.created_at
    const days = daysSince(baseDate)
    const amountNum = Number(r.approved_amount ?? r.requested_amount) || 0
    return {
      id: r.payment_request_number || r.id.slice(0, 8).toUpperCase(),
      _id: r.id,
      name: r.projects?.project_name || r.programs?.short_name || '—',
      property: r.properties?.property_name || '—',
      program: r.programs?.short_name || r.programs?.name || '—',
      status: r.status || '—',
      owner: 'Nicholas Wood',
      amount: amountNum, // numeric — prCell formats it
      paymentBody: r.programs?.name || '—',
      daysOpen: days,
      state: r.properties?.property_state || r.programs?.state?.slice(0, 2) || '',
    }
  })
}

// ---------------------------------------------------------------------------
// Payment receipts
// ---------------------------------------------------------------------------

export async function fetchPaymentReceipts() {
  const { data, error } = await supabase
    .from('payment_receipts')
    .select(`
      id,
      receipt_number,
      amount_received,
      received_date,
      payment_method,
      payment_reference,
      program_id,
      project_id,
      project_payment_request_id,
      programs:program_id ( name, short_name, state ),
      projects:project_id ( project_name, property_id, properties:property_id ( property_name, property_state ) )
    `)
    .eq('is_deleted', false)
    .order('received_date', { ascending: false })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.receipt_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.projects?.project_name || r.programs?.short_name || '—',
    property: r.projects?.properties?.property_name || '—',
    program: r.programs?.short_name || r.programs?.name || '—',
    paymentBody: r.programs?.name || '—',
    amount: Number(r.amount_received) || 0,
    receivedDate: r.received_date || '',
    paymentRef: r.payment_reference || '—',
    state: r.projects?.properties?.property_state || '',
  }))
}
