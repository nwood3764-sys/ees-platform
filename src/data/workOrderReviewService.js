import { supabase } from '../lib/supabase'

// ---------------------------------------------------------------------------
// workOrderReviewService
//
// Data layer for the desktop Work Order Review experience (Field module →
// Verification Reviews). The Project Coordinator reviews a submitted work
// order: layout-driven record fields (Review Page Layouts —
// page_layouts.page_layout_type='review', per object + record type, master
// default fallback; Salesforce approval-page-layout parity), every work step
// with its photo/video/measurement evidence, per-step Approve / Needs
// Correction, and a work-order-level Verify or Send Back that walks the
// status lifecycle (To Be Verified → Verified | Corrections Needed).
//
// Nothing here is hardcoded: which fields the reviewer sees is data on the
// review layout, editable in LEAP Admin per record type.
// ---------------------------------------------------------------------------

// Work orders awaiting review (and the ones already sent back, for context).
// Lookups resolve through explicit batch queries — no reliance on PostgREST
// FK-hint names.
export async function fetchReviewQueue() {
  const { data: statusRows, error: sErr } = await supabase
    .from('picklist_values')
    .select('id, picklist_value')
    .eq('picklist_object', 'work_orders')
    .eq('picklist_field', 'work_order_status')
    .in('picklist_value', ['To Be Verified', 'Corrections Needed'])
  if (sErr) throw sErr
  const statusById = new Map((statusRows || []).map(r => [r.id, r.picklist_value]))
  if (!statusById.size) return { awaiting: [], sentBack: [] }

  const { data, error } = await supabase
    .from('work_orders')
    .select('id, work_order_record_number, work_order_name, work_order_subject, work_order_updated_at, work_order_status, work_type_id, property_id, building_id, unit_id, work_order_owner, project_coordinator_id, work_order_building, work_order_unit')
    .in('work_order_status', Array.from(statusById.keys()))
    .not('work_order_is_deleted', 'is', true)
    .order('work_order_updated_at', { ascending: true })
    .limit(400)
  if (error) throw error
  const rows = data || []

  const collect = (col) => Array.from(new Set(rows.map(r => r[col]).filter(Boolean)))
  const lookup = async (table, field, ids) => {
    if (!ids.length) return new Map()
    const { data: found } = await supabase.from(table).select(`id, ${field}`).in('id', ids)
    return new Map((found || []).map(r => [r.id, r[field]]))
  }
  const [workTypes, properties, buildings, units, users] = await Promise.all([
    lookup('work_types', 'work_type_name', collect('work_type_id')),
    lookup('properties', 'property_name', collect('property_id')),
    lookup('buildings', 'building_name', collect('building_id')),
    lookup('units', 'unit_name', collect('unit_id')),
    lookup('users', 'user_name', Array.from(new Set([...collect('work_order_owner'), ...collect('project_coordinator_id')]))),
  ])

  const shaped = rows.map(r => ({
    id: r.id,
    recordNumber: r.work_order_record_number,
    name: r.work_order_name,
    subject: r.work_order_subject,
    status: statusById.get(r.work_order_status) || '',
    workType: workTypes.get(r.work_type_id) || '',
    property: properties.get(r.property_id) || '',
    building: r.work_order_building || buildings.get(r.building_id) || '',
    unit: r.work_order_unit || units.get(r.unit_id) || '',
    technician: users.get(r.work_order_owner) || '',
    coordinator: users.get(r.project_coordinator_id) || '',
    submittedAt: r.work_order_updated_at,
  }))
  return {
    awaiting: shaped.filter(r => r.status === 'To Be Verified'),
    sentBack: shaped.filter(r => r.status === 'Corrections Needed'),
  }
}

// Full reviewer payload: header, raw record row (for layout fields), steps
// with photos/videos/measurements and the PC's per-step review state.
export async function fetchReviewDetail(workOrderId) {
  const { data, error } = await supabase.rpc('work_order_detail_for_review', { p_wo_id: workOrderId })
  if (error) throw error
  if (data?.outcome !== 'ok') throw new Error(data?.message || 'Could not load the work order for review.')
  return data
}

// Review Page Layout resolution — record-type-specific first, master default
// fallback. Returns { layout, fieldGroups: [{ title, fields:[…] }] } or null
// when no review layout exists for the object.
export async function fetchReviewLayout(objectName, recordTypeId) {
  const { data: layouts, error } = await supabase
    .from('page_layouts')
    .select('id, page_layout_name, record_type_id')
    .eq('page_layout_object', objectName)
    .eq('page_layout_type', 'review')
    .eq('page_layout_is_default', true)
    .not('is_deleted', 'is', true)
  if (error) throw error
  if (!layouts?.length) return null

  const specific = recordTypeId ? layouts.find(l => l.record_type_id === recordTypeId) : null
  const master = layouts.find(l => !l.record_type_id)
  const layout = specific || master
  if (!layout) return null

  const { data: widgets, error: wErr } = await supabase
    .from('page_layout_widgets')
    .select('id, widget_type, widget_title, widget_config, widget_position, section_id')
    .eq('page_layout_id', layout.id)
    .not('is_deleted', 'is', true)
    .order('widget_position', { ascending: true })
  if (wErr) throw wErr

  const fieldGroups = (widgets || [])
    .filter(w => w.widget_type === 'field_group' && Array.isArray(w.widget_config?.fields))
    .map(w => ({ title: w.widget_title, fields: w.widget_config.fields }))
  return { layout, fieldGroups }
}

// Resolve display values for the layout's lookup + picklist fields against
// the raw record row. Returns { [fieldName]: displayString }.
export async function resolveLayoutFieldValues(fieldGroups, record) {
  const display = {}
  const lookupsByTable = new Map()
  const picklistIds = new Set()

  for (const group of fieldGroups) {
    for (const f of group.fields) {
      const raw = record?.[f.name]
      if (raw == null || raw === '') continue
      if (f.type === 'lookup' && f.lookup_table && f.lookup_field) {
        if (!lookupsByTable.has(f.lookup_table)) lookupsByTable.set(f.lookup_table, { field: f.lookup_field, ids: new Set(), byId: new Map() })
        lookupsByTable.get(f.lookup_table).ids.add(raw)
      } else if (f.type === 'picklist') {
        picklistIds.add(raw)
      }
    }
  }

  await Promise.all([
    ...Array.from(lookupsByTable.entries()).map(async ([table, info]) => {
      const { data } = await supabase.from(table).select(`id, ${info.field}`).in('id', Array.from(info.ids))
      for (const row of data || []) info.byId.set(row.id, row[info.field])
    }),
    (async () => {
      if (!picklistIds.size) return
      const { data } = await supabase.from('picklist_values').select('id, picklist_label, picklist_value').in('id', Array.from(picklistIds))
      for (const row of data || []) display[`__pv_${row.id}`] = row.picklist_label || row.picklist_value
    })(),
  ])

  for (const group of fieldGroups) {
    for (const f of group.fields) {
      const raw = record?.[f.name]
      if (raw == null || raw === '') { display[f.name] = null; continue }
      if (f.type === 'lookup' && f.lookup_table) {
        display[f.name] = lookupsByTable.get(f.lookup_table)?.byId.get(raw) ?? String(raw)
      } else if (f.type === 'picklist') {
        display[f.name] = display[`__pv_${raw}`] ?? String(raw)
      } else if (f.type === 'date' && typeof raw === 'string') {
        display[f.name] = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw).toLocaleDateString()
      } else {
        display[f.name] = String(raw)
      }
    }
  }
  return display
}

// Per-step review decision. Approve needs no comment; Needs Correction does.
export async function reviewWorkStep(workStepId, approved, comment) {
  const { data, error } = await supabase.rpc('review_work_step', {
    p_work_step_id: workStepId, p_approved: approved, p_comment: comment || null,
  })
  if (error) throw error
  if (data?.outcome !== 'ok') throw new Error(data?.message || 'Could not save the step review.')
  return data
}

// Work-order-level outcome: 'verified' or 'corrections_needed'.
export async function completeWorkOrderReview(workOrderId, outcome, comment) {
  const { data, error } = await supabase.rpc('complete_work_order_review', {
    p_wo_id: workOrderId, p_outcome: outcome, p_comment: comment || null,
  })
  if (error) throw error
  if (data?.outcome !== 'ok') throw new Error(data?.message || 'Could not complete the review.')
  return data
}

// Step evidence lives in the private work-evidence bucket — signed URLs only.
export async function signedEvidenceUrl(bucket, path, { expiresIn = 3600 } = {}) {
  if (!bucket || !path) return null
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn)
    if (error) return null
    return data?.signedUrl || null
  } catch {
    return null
  }
}

// Batch signer: one storage call per bucket for the whole work order's
// evidence. Returns a Map keyed `${bucket}/${path}` → signed URL.
export async function signedEvidenceUrls(items, { expiresIn = 3600 } = {}) {
  const byBucket = new Map()
  for (const it of items || []) {
    if (!it?.bucket || !it?.path) continue
    if (!byBucket.has(it.bucket)) byBucket.set(it.bucket, new Set())
    byBucket.get(it.bucket).add(it.path)
  }
  const out = new Map()
  await Promise.all(Array.from(byBucket.entries()).map(async ([bucket, paths]) => {
    const list = Array.from(paths)
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(list, expiresIn)
      if (error) return
      for (const row of data || []) {
        if (row?.signedUrl && row?.path) out.set(`${bucket}/${row.path}`, row.signedUrl)
      }
    } catch { /* leave unsigned; UI shows placeholders */ }
  }))
  return out
}
