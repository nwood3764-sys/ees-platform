// flowBuilderService — client bridge for Setup → Process Automation → Flow Builder.
//
// Covers both flow modes against the live backend:
//   • screen  — guided, interactive flows committed via commit_screen_flow_run
//   • silent  — server-side automation walked by execute_flow / execute_flows_for
//
// The element graph is persisted as a linear chain: start → … → finish, with
// fe_next_element_id wired in fe_order sequence and decision branches stored on
// fe_decision_branches. saveFlowElements is the single write path: soft-delete
// every current element, re-insert from editor state, rewire pointers. This is
// race-free for a single-author builder and matches the execute_flow /
// commit_screen_flow_run interpreters which walk start → next → … → finish.
//
// All lifecycle transitions go through the verified RPCs:
//   publish_flow(p_flow_id) · set_flow_active(p_flow_id,p_active)
//   archive_flow(p_flow_id) · clone_flow(p_flow_id,p_new_name)

import { supabase } from '../lib/supabase'

// ─── Editor vocabularies ─────────────────────────────────────────────────────

// Element types offered in each mode. start/finish are fixed brackets seeded on
// create and never user-added; the editor inserts only the middle types.
export const SCREEN_ELEMENT_TYPES = [
  { value: 'screen',   label: 'Screen (questions)' },
  { value: 'decision', label: 'Decision (branch)' },
  { value: 'action',   label: 'Action' },
]
export const SILENT_ELEMENT_TYPES = [
  { value: 'decision', label: 'Decision (branch)' },
  { value: 'action',   label: 'Action' },
]

export const QUESTION_TYPES = [
  { value: 'text',     label: 'Text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'number',   label: 'Number' },
  { value: 'date',     label: 'Date' },
  { value: 'boolean',  label: 'Yes / No' },
  { value: 'picklist', label: 'Picklist' },
  { value: 'lookup',   label: 'Lookup' },
]

// Trigger events for silent flows. screen flows are launched, not triggered.
export const TRIGGER_EVENTS = [
  { value: 'status_change', label: 'Status change' },
  { value: 'record_create', label: 'Record created' },
  { value: 'date_based',    label: 'Date reached' },
]

// Action subtypes. Silent and screen share the executor library
// (_automation_action_*); the editor surfaces the same set for both modes.
export const SILENT_ACTION_TYPES = [
  { value: 'record_create',  label: 'Create record' },
  { value: 'record_update',  label: 'Update record' },
  { value: 'status_change',  label: 'Change status' },
  { value: 'task_create',    label: 'Create task' },
  { value: 'send_email',     label: 'Send email' },
]
export const SCREEN_ACTION_TYPES = SILENT_ACTION_TYPES

export const DECISION_OPERATORS = [
  { value: 'eq',        label: 'equals' },
  { value: 'neq',       label: 'does not equal' },
  { value: 'gt',        label: 'greater than' },
  { value: 'lt',        label: 'less than' },
  { value: 'is_null',   label: 'is empty' },
  { value: 'not_null',  label: 'is not empty' },
  { value: 'contains',  label: 'contains' },
]

// ─── Flow list / get ─────────────────────────────────────────────────────────

export async function listFlows() {
  const { data, error } = await supabase
    .from('flows')
    .select('id, flow_record_number, flow_name, flow_description, flow_type, flow_status, ' +
            'flow_trigger_object, flow_trigger_event, flow_launch_object, ' +
            'flow_current_version, flow_active_version_id, updated_at')
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getFlow(flowId) {
  const { data, error } = await supabase
    .from('flows')
    .select('*')
    .eq('id', flowId)
    .eq('is_deleted', false)
    .single()
  if (error) throw error
  return data
}

export async function getFlowElements(flowId) {
  const { data, error } = await supabase
    .from('flow_elements')
    .select('*')
    .eq('fe_flow_id', flowId)
    .eq('is_deleted', false)
    .order('fe_order', { ascending: true })
  if (error) throw error
  return data || []
}

export async function getFlowRuns(flowId, limit = 25) {
  const { data, error } = await supabase
    .from('flow_runs')
    .select('id, fr_record_number, fr_flow_type, fr_trigger_object, fr_trigger_event, ' +
            'fr_status, fr_outcome_message, fr_started_at, fr_completed_at, fr_ai_assisted')
    .eq('fr_flow_id', flowId)
    .eq('is_deleted', false)
    .order('fr_started_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

// ─── Create / update ─────────────────────────────────────────────────────────

export async function createFlow({ name, description, flowType, launchObject,
  triggerObject, triggerEvent }) {
  const { data: uid } = await supabase.rpc('current_app_user_id')
  if (!uid) throw new Error('Not authenticated')

  const { data: flow, error } = await supabase
    .from('flows')
    .insert({
      flow_record_number: '',
      flow_name: name,
      flow_description: description || null,
      flow_type: flowType,
      flow_status: 'draft',
      flow_launch_object: flowType === 'screen' ? (launchObject || null) : null,
      flow_launch_contexts:
        flowType === 'screen' && launchObject ? [{ object: launchObject }] : [],
      flow_trigger_object: flowType === 'silent' ? (triggerObject || null) : null,
      flow_trigger_event: flowType === 'silent' ? (triggerEvent || null) : null,
      owner_id: uid,
      created_by: uid,
      updated_by: uid,
    })
    .select('id')
    .single()
  if (error) throw error

  await seedStartFinish(flow.id, uid)
  return flow.id
}

async function seedStartFinish(flowId, uid) {
  // start (order 0) → finish (order 1). next_element_id wired start→finish.
  const { data: rows, error } = await supabase
    .from('flow_elements')
    .insert([
      { fe_record_number: '', fe_flow_id: flowId, fe_element_type: 'start',  fe_order: 0, fe_label: 'Start',  owner_id: uid, created_by: uid, updated_by: uid },
      { fe_record_number: '', fe_flow_id: flowId, fe_element_type: 'finish', fe_order: 1, fe_label: 'Finish', owner_id: uid, created_by: uid, updated_by: uid },
    ])
    .select('id, fe_element_type')
  if (error) throw error
  const start = rows.find(r => r.fe_element_type === 'start')
  const finish = rows.find(r => r.fe_element_type === 'finish')
  if (start && finish) {
    await supabase.from('flow_elements')
      .update({ fe_next_element_id: finish.id })
      .eq('id', start.id)
  }
}

export async function updateFlowMeta(flowId, patch) {
  const { data: uid } = await supabase.rpc('current_app_user_id')
  const { error } = await supabase
    .from('flows')
    .update({ ...patch, updated_by: uid })
    .eq('id', flowId)
  if (error) throw error
}

// Persist the full ordered element list for a flow. Soft-deletes existing
// elements and re-inserts the provided set, renumbering fe_order and rewiring
// fe_next_element_id into a linear chain start → … → finish. Decision branches
// are stored as provided. This is the builder's single save path.
export async function saveFlowElements(flowId, elements) {
  const { data: uid } = await supabase.rpc('current_app_user_id')
  if (!uid) throw new Error('Not authenticated')

  // Soft-delete every current element, then re-insert from the editor state.
  // Simpler and race-free for a single-author builder versus diffing.
  const { error: delErr } = await supabase
    .from('flow_elements')
    .update({ is_deleted: true, updated_by: uid })
    .eq('fe_flow_id', flowId)
    .eq('is_deleted', false)
  if (delErr) throw delErr

  // Build ordered rows: start, …middle…, finish.
  const ordered = [...elements].sort((a, b) => a.fe_order - b.fe_order)
  const rows = ordered.map((el, i) => ({
    fe_record_number: '',
    fe_flow_id: flowId,
    fe_element_type: el.fe_element_type,
    fe_order: i,
    fe_label: el.fe_label || null,
    fe_api_name: el.fe_api_name || null,
    fe_config: el.fe_config || {},
    fe_decision_branches: el.fe_decision_branches || [],
    owner_id: uid,
    created_by: uid,
    updated_by: uid,
  }))

  const { data: inserted, error: insErr } = await supabase
    .from('flow_elements')
    .insert(rows)
    .select('id, fe_order, fe_element_type, fe_decision_branches')
  if (insErr) throw insErr

  // Rewire linear next-element pointers in fe_order sequence.
  const byOrder = [...inserted].sort((a, b) => a.fe_order - b.fe_order)
  for (let i = 0; i < byOrder.length - 1; i++) {
    await supabase.from('flow_elements')
      .update({ fe_next_element_id: byOrder[i + 1].id })
      .eq('id', byOrder[i].id)
  }
  return inserted
}

// ─── Lifecycle (RPC wrappers) ────────────────────────────────────────────────

export async function publishFlow(flowId) {
  const { data, error } = await supabase.rpc('publish_flow', { p_flow_id: flowId })
  if (error) throw error
  return data
}

export async function setFlowActive(flowId, active) {
  const { error } = await supabase.rpc('set_flow_active', { p_flow_id: flowId, p_active: active })
  if (error) throw error
}

export async function archiveFlow(flowId) {
  const { error } = await supabase.rpc('archive_flow', { p_flow_id: flowId })
  if (error) throw error
}

export async function cloneFlow(flowId, newName) {
  const { data, error } = await supabase.rpc('clone_flow', { p_flow_id: flowId, p_new_name: newName })
  if (error) throw error
  return data
}

// Record-create trigger attach/detach for a silent flow's object.
export async function enableRecordCreateDispatch(object) {
  const { error } = await supabase.rpc('admin_enable_record_create_dispatch', { p_object: object })
  if (error) throw error
}
export async function disableRecordCreateDispatch(object) {
  const { error } = await supabase.rpc('admin_disable_record_create_dispatch', { p_object: object })
  if (error) throw error
}

// ─── Metadata for editors ────────────────────────────────────────────────────

// Objects that carry a status lifecycle — valid status_change trigger targets
// and status-action objects. Read from object_lifecycle_config when present,
// falling back to the known lifecycle objects.
export async function fetchTriggerObjects() {
  const { data, error } = await supabase
    .from('object_lifecycle_config')
    .select('object_name')
    .eq('is_deleted', false)
    .order('object_name', { ascending: true })
  if (error || !data || data.length === 0) {
    return [
      'projects', 'opportunities', 'work_orders',
      'incentive_applications', 'project_payment_requests', 'contacts',
    ].map(o => ({ value: o, label: o }))
  }
  return data.map(r => ({ value: r.object_name, label: r.object_name }))
}

// Resolve an object's canonical status column (the field the automation engine
// reads), e.g. projects → project_status. Returns null for non-lifecycle
// objects. Single source of truth shared with the silent-flow dispatcher.
export async function fetchStatusColumn(object) {
  const { data, error } = await supabase.rpc('_automation_status_column_for', { p_object: object })
  if (error) return null
  return data || null
}

// Status picklist values for an object's status field, in sort order. The field
// name is object-prefixed (project_status, work_order_status, …) and resolved
// via fetchStatusColumn rather than assumed.
export async function fetchStatusValues(object) {
  const field = await fetchStatusColumn(object)
  if (!field) return []
  const { data, error } = await supabase
    .from('picklist_values')
    .select('picklist_value, sort_order')
    .eq('picklist_object', object)
    .eq('picklist_field', field)
    .eq('is_deleted', false)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({ value: r.picklist_value, label: r.picklist_value }))
}

// describe_object_columns returns one composite row per column. supabase-js
// surfaces each as a string "(name,type,nullable,default,...,fk_table,fk_col)".
// Parse the leading name and type; tolerate quoted segments.
function parseDescribedColumn(row) {
  const raw = typeof row === 'string' ? row : (row?.col ?? '')
  const inner = raw.replace(/^\(/, '').replace(/\)$/, '')
  // Split on commas not inside double quotes.
  const parts = inner.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []
  const clean = parts.map(p => p.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim())
  return { name: clean[0] || '', type: clean[1] || '' }
}

// Column names for an object — used in decision/action field pickers.
export async function fetchObjectColumns(object) {
  const { data, error } = await supabase.rpc('describe_object_columns', { p_table: object })
  if (error || !Array.isArray(data)) return []
  return data
    .map(parseDescribedColumn)
    .filter(c => c.name && !c.name.startsWith('contact_deleted') && c.name !== 'is_seed_data')
    .map(c => ({ value: c.name, label: c.name }))
}

// Date/timestamp columns for an object — used as date_based trigger anchors.
export async function fetchObjectDateColumns(object) {
  const { data, error } = await supabase.rpc('describe_object_columns', { p_table: object })
  if (error || !Array.isArray(data)) return []
  return data
    .map(parseDescribedColumn)
    .filter(c => c.name && (c.type.includes('date') || c.type.includes('timestamp')))
    .map(c => ({ value: c.name, label: c.name }))
}

export async function fetchRoles() {
  const { data, error } = await supabase
    .from('roles')
    .select('id, name')
    .eq('is_deleted', false)
    .order('name', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({ value: r.id, label: r.name }))
}

export async function fetchEmailTemplates() {
  const { data, error } = await supabase
    .from('email_templates')
    .select('id, name')
    .eq('is_deleted', false)
    .order('name', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({ value: r.id, label: r.name }))
}
