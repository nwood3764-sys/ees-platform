// ---------------------------------------------------------------------------
// dispatcherFollowups — data layer for the Dispatch Console's Follow-ups
// surface. Reads dispatcher_followup_requests filtered to the dispatcher's
// active triage queue (Open + In Progress) and exposes a status-flip
// helper for inline state changes (Open → In Progress, → Resolved, → Closed).
//
// Resolution flow stays at the record-detail page for now — this surface
// is queue-focused (see / claim / close), not full record editing.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase'

// The four valid dfr_status values; constants kept here so the UI can
// render buttons / labels without re-querying picklist_values every time.
export const DFR_STATUS_VALUES = ['Open', 'In Progress', 'Resolved', 'Closed']
export const DFR_ACTIVE_STATUSES = ['Open', 'In Progress']

// Cached map: picklist_value text → picklist row id. Populated once per
// session via fetchDfrPicklists; the matrix and the status-flip helper
// both rely on it for resolving labels and writing flips back.
let _picklistCache = null

/**
 * Fetch the dfr_reason + dfr_status picklist rows once and cache them
 * for the rest of the session. Returns
 *   { statusByValue: { 'Open': uuid, ... },
 *     reasonByValue: { 'out_of_territory': uuid, ... },
 *     statusByValueLabel: { 'Open': 'Open', ... },     // value → label
 *     reasonByValueLabel: { 'out_of_territory': 'Out of Territory', ... } }
 */
export async function fetchDfrPicklists() {
  if (_picklistCache) return _picklistCache

  const { data, error } = await supabase
    .from('picklist_values')
    .select('id, picklist_field, picklist_value, picklist_label')
    .eq('picklist_object', 'dispatcher_followup_requests')
    .eq('picklist_is_active', true)

  if (error) throw new Error(`fetchDfrPicklists: ${error.message}`)

  const cache = {
    statusByValue: {}, reasonByValue: {},
    statusByValueLabel: {}, reasonByValueLabel: {},
    statusById: {}, reasonById: {},
  }
  for (const row of data || []) {
    if (row.picklist_field === 'dfr_status') {
      cache.statusByValue[row.picklist_value] = row.id
      cache.statusByValueLabel[row.picklist_value] = row.picklist_label
      cache.statusById[row.id] = { value: row.picklist_value, label: row.picklist_label }
    } else if (row.picklist_field === 'dfr_reason') {
      cache.reasonByValue[row.picklist_value] = row.id
      cache.reasonByValueLabel[row.picklist_value] = row.picklist_label
      cache.reasonById[row.id] = { value: row.picklist_value, label: row.picklist_label }
    }
  }
  _picklistCache = cache
  return cache
}

/**
 * Fetch the active follow-up queue: every Open or In Progress DFR,
 * oldest-first (oldest unresolved = highest priority).
 *
 * Joins picklist_values inline so the UI can render label text without
 * resolving the picklist UUIDs separately. Joins work_types so the
 * work_type_name renders cleanly.
 */
export async function fetchOpenDispatcherFollowups() {
  const pl = await fetchDfrPicklists()
  const activeStatusIds = DFR_ACTIVE_STATUSES
    .map(v => pl.statusByValue[v])
    .filter(Boolean)

  if (activeStatusIds.length === 0) {
    // Picklist not yet seeded — shouldn't happen post-migration, but
    // guard anyway so the UI doesn't return arbitrary rows.
    return []
  }

  const { data, error } = await supabase
    .from('dispatcher_followup_requests')
    .select(`
      id,
      dfr_record_number,
      dfr_customer_first_name,
      dfr_customer_last_name,
      dfr_phone,
      dfr_email,
      dfr_address_street,
      dfr_address_city,
      dfr_address_state,
      dfr_address_zip,
      dfr_work_type_slug,
      dfr_preferred_start_at,
      dfr_reason,
      dfr_status,
      dfr_created_at,
      dfr_dispatcher_notes,
      work_type:work_type_id(id, work_type_name)
    `)
    .eq('dfr_is_deleted', false)
    .in('dfr_status', activeStatusIds)
    .order('dfr_created_at', { ascending: true })

  if (error) throw new Error(`fetchOpenDispatcherFollowups: ${error.message}`)

  // Annotate each row with resolved label strings so the UI is straight
  // forward — no per-row picklist lookups in the render path.
  return (data || []).map(row => ({
    ...row,
    _status_label: pl.statusById[row.dfr_status]?.label || '',
    _status_value: pl.statusById[row.dfr_status]?.value || '',
    _reason_label: pl.reasonById[row.dfr_reason]?.label || '',
    _reason_value: pl.reasonById[row.dfr_reason]?.value || '',
    _work_type_name: row.work_type?.work_type_name || row.dfr_work_type_slug || '',
  }))
}

/**
 * Flip a DFR's status. Used for the inline "Claim" (→ In Progress) and
 * "Close" buttons on the queue. Returns the updated row so the caller
 * can swap it locally without re-fetching.
 *
 * When transitioning to Resolved or Closed, also stamps dfr_resolved_at
 * + dfr_resolved_by (the calling user). Open / In Progress transitions
 * leave the resolution timestamps null.
 */
export async function updateDfrStatus({ dfr_id, new_status_value, current_user_id }) {
  if (!DFR_STATUS_VALUES.includes(new_status_value)) {
    throw new Error(`updateDfrStatus: invalid status ${new_status_value}`)
  }
  const pl = await fetchDfrPicklists()
  const statusId = pl.statusByValue[new_status_value]
  if (!statusId) throw new Error(`updateDfrStatus: status ${new_status_value} not found in picklist`)

  const patch = { dfr_status: statusId, dfr_updated_at: new Date().toISOString() }
  if (new_status_value === 'Resolved' || new_status_value === 'Closed') {
    patch.dfr_resolved_at = new Date().toISOString()
    if (current_user_id) patch.dfr_resolved_by = current_user_id
  } else {
    patch.dfr_resolved_at = null
    patch.dfr_resolved_by = null
  }

  const { data, error } = await supabase
    .from('dispatcher_followup_requests')
    .update(patch)
    .eq('id', dfr_id)
    .select('id, dfr_status, dfr_resolved_at, dfr_resolved_by')
    .single()

  if (error) throw new Error(`updateDfrStatus: ${error.message}`)
  return data
}

// Helper: pretty-print a row's address as one line for the queue display.
export function formatDfrAddressOneLine(row) {
  const street = row.dfr_address_street || ''
  const cityStateZip = [row.dfr_address_city, row.dfr_address_state]
    .filter(Boolean).join(', ') + (row.dfr_address_zip ? ` ${row.dfr_address_zip}` : '')
  return [street, cityStateZip.trim()].filter(Boolean).join(' — ')
}

// Helper: pretty-print created_at as "x hours ago" / "yesterday" / "Mon Jan 12".
export function formatDfrAge(isoCreatedAt) {
  if (!isoCreatedAt) return ''
  const created = new Date(isoCreatedAt)
  const ageMs = Date.now() - created.getTime()
  const ageH = ageMs / (1000 * 60 * 60)
  if (ageH < 1) {
    const ageM = Math.max(1, Math.round(ageMs / (1000 * 60)))
    return `${ageM} min ago`
  }
  if (ageH < 24) {
    return `${Math.round(ageH)} hr ago`
  }
  const ageD = Math.round(ageH / 24)
  if (ageD === 1) return 'yesterday'
  if (ageD < 7)   return `${ageD} days ago`
  return created.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
