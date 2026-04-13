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
