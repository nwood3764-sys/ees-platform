import { supabase } from '../lib/supabase'

// ---------------------------------------------------------------------------
// Roles (used by Permission Builder)
// ---------------------------------------------------------------------------

export async function fetchRoles() {
  const { data, error } = await supabase
    .from('roles')
    .select('id, role_name, role_description, role_is_active')
    .order('role_name', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.role_name,
    description: r.role_description || '—',
    status: r.role_is_active ? 'Active' : 'Inactive',
  }))
}

// ---------------------------------------------------------------------------
// Programs (Program Builder output — one record per program version)
// ---------------------------------------------------------------------------

export async function fetchPrograms() {
  const { data, error } = await supabase
    .from('programs')
    .select(`
      id, name, short_name, description, state, program_type, housing_type,
      role_type, administering_body, program_year, version, status, record_type
    `)
    .eq('is_deleted', false)
    .order('state', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.short_name || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.name,
    shortName: r.short_name || '—',
    state: r.state || '—',
    programType: r.program_type || '—',
    housingType: r.housing_type || '—',
    roleType: r.role_type || '—',
    administeringBody: r.administering_body || '—',
    year: r.program_year || '—',
    version: r.version || '1.0',
    status: r.status || '—',
    recordType: r.record_type || '—',
  }))
}

// ---------------------------------------------------------------------------
// Work types (Work Plan Builder output — what a crew does on site)
// ---------------------------------------------------------------------------

export async function fetchWorkTypes() {
  const { data, error } = await supabase
    .from('work_types')
    .select(`
      id, work_type_record_number, work_type_name, work_type_description,
      work_type_estimated_duration, work_type_duration_minutes,
      work_type_minimum_crew_size, work_type_recommended_crew_size,
      work_type_is_active, work_type_auto_create_service_appt
    `)
    .eq('work_type_is_deleted', false)
    .order('work_type_name', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.work_type_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.work_type_name,
    description: r.work_type_description || '—',
    estDuration: r.work_type_duration_minutes
      ? `${r.work_type_duration_minutes} min`
      : (r.work_type_estimated_duration ? `${r.work_type_estimated_duration}h` : '—'),
    minCrew: r.work_type_minimum_crew_size || '—',
    recCrew: r.work_type_recommended_crew_size || '—',
    autoCreateAppt: r.work_type_auto_create_service_appt ? 'Yes' : 'No',
    status: r.work_type_is_active ? 'Active' : 'Inactive',
  }))
}

// ---------------------------------------------------------------------------
// Email templates (Template Builder — email flavor)
// ---------------------------------------------------------------------------

export async function fetchEmailTemplates() {
  const { data, error } = await supabase
    .from('email_templates')
    .select(`
      id, et_record_number, name, description, subject, state, related_object,
      trigger_status, is_manual, is_automated, version,
      record_type:record_type ( picklist_label ),
      status:status ( picklist_label )
    `)
    .eq('is_deleted', false)
    .order('name', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.et_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.name,
    description: r.description || '—',
    subject: r.subject,
    state: r.state || '—',
    relatedObject: r.related_object || '—',
    recordType: r.record_type?.picklist_label || '—',
    triggerStatus: r.trigger_status || '—',
    manual: r.is_manual ? 'Yes' : 'No',
    automated: r.is_automated ? 'Yes' : 'No',
    version: r.version,
    status: r.status?.picklist_label || '—',
  }))
}

// ---------------------------------------------------------------------------
// Document templates (Template Builder — document flavor, for e-signature)
// ---------------------------------------------------------------------------

export async function fetchDocumentTemplates() {
  const { data, error } = await supabase
    .from('document_templates')
    .select(`
      id, dt_record_number, name, description, template_type, state, related_object,
      requires_signature, signer_role, trigger_status, is_manual, is_automated, version,
      record_type:record_type ( picklist_label ),
      status:status ( picklist_label )
    `)
    .eq('is_deleted', false)
    .order('name', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.dt_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.name,
    description: r.description || '—',
    templateType: r.template_type,
    state: r.state || '—',
    relatedObject: r.related_object || '—',
    recordType: r.record_type?.picklist_label || '—',
    requiresSignature: r.requires_signature ? 'Yes' : 'No',
    signerRole: r.signer_role || '—',
    triggerStatus: r.trigger_status || '—',
    manual: r.is_manual ? 'Yes' : 'No',
    automated: r.is_automated ? 'Yes' : 'No',
    version: r.version,
    status: r.status?.picklist_label || '—',
  }))
}

// ---------------------------------------------------------------------------
// Envelopes (native e-signature envelope tracking)
// ---------------------------------------------------------------------------

export async function fetchEnvelopes() {
  const { data, error } = await supabase
    .from('envelopes')
    .select(`
      id, env_record_number, env_name, env_parent_object, env_parent_record_id,
      env_sent_at, env_completed_at, env_failed_at,
      template:document_template_id ( name ),
      status:env_status   ( picklist_label, picklist_value )
    `)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.env_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.env_name,
    template: r.template?.name || '—',
    parentObject: r.env_parent_object || '—',
    sentAt: r.env_sent_at ? new Date(r.env_sent_at).toLocaleString() : '—',
    completedAt: r.env_completed_at ? new Date(r.env_completed_at).toLocaleString() : '—',
    status: r.status?.picklist_label || '—',
  }))
}

// ---------------------------------------------------------------------------
// Automation rules (Automation Builder — Salesforce Flow Builder equivalent)
// ---------------------------------------------------------------------------

export async function fetchAutomationRules() {
  const { data, error } = await supabase
    .from('automation_rules')
    .select(`
      id, name, description, is_active, trigger_object, trigger_event,
      trigger_status, action_type, target_object, execution_order
    `)
    .order('trigger_object', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.name,
    description: r.description || '—',
    status: r.is_active ? 'Active' : 'Inactive',
    triggerObject: r.trigger_object,
    triggerEvent: r.trigger_event,
    triggerStatus: r.trigger_status || '—',
    actionType: r.action_type,
    executionOrder: r.execution_order || 1,
  }))
}

// ---------------------------------------------------------------------------
// Validation rules
// ---------------------------------------------------------------------------

export async function fetchValidationRules() {
  const { data, error } = await supabase
    .from('validation_rules')
    .select(`
      id, name, description, is_active, related_object,
      block_on_status, block_on_event, error_message
    `)
    .order('related_object', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.name,
    description: r.description || '—',
    status: r.is_active ? 'Active' : 'Inactive',
    relatedObject: r.related_object,
    blockOnStatus: r.block_on_status || '—',
    blockOnEvent: r.block_on_event || '—',
    errorMessage: r.error_message,
  }))
}

// ---------------------------------------------------------------------------
// Picklist values (central config — read-only list for now)
// ---------------------------------------------------------------------------

export async function fetchPicklistValues() {
  const { data, error } = await supabase
    .from('picklist_values')
    .select('id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order')
    .order('picklist_object', { ascending: true })
    .limit(500)

  if (error) throw error

  return (data || []).map(r => ({
    id: r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    object: r.picklist_object,
    field: r.picklist_field,
    value: r.picklist_value,
    label: r.picklist_label || r.picklist_value,
    sortOrder: r.picklist_sort_order || 0,
    status: r.picklist_is_active !== false ? 'Active' : 'Inactive',
  }))
}

// ---------------------------------------------------------------------------
// Object Manager fetchers — schema introspection via RPC and related queries
// ---------------------------------------------------------------------------

// Describe an object's columns (fields & relationships)
export async function describeObject(tableName) {
  const { data, error } = await supabase.rpc('describe_object_columns', { p_table: tableName })
  if (error) throw error
  return data || []
}

// Describe incoming FKs — which other tables reference this one (for Related Lookups)
export async function describeIncomingFKs(tableName) {
  const { data, error } = await supabase.rpc('describe_object_incoming_fks', { p_table: tableName })
  if (error) throw error
  return data || []
}

// Live record count for any public table. If the table has is_deleted, filter to not deleted.
export async function fetchRecordCount(tableName, excludeDeleted = true) {
  try {
    let query = supabase.from(tableName).select('*', { count: 'exact', head: true })
    if (excludeDeleted) {
      // Try to filter by is_deleted=false. If the column doesn't exist this will fail — we'll retry without.
      query = query.eq('is_deleted', false)
    }
    const { count, error } = await query
    if (error && excludeDeleted) {
      // Retry without the is_deleted filter if the column doesn't exist
      const r2 = await supabase.from(tableName).select('*', { count: 'exact', head: true })
      if (r2.error) return 0
      return r2.count ?? 0
    }
    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}

// Page Layouts for a specific object (returns raw rows — caller formats)
export async function fetchPageLayoutsFor(tableName) {
  const { data, error } = await supabase
    .from('page_layouts')
    .select(`
      id, page_layout_record_number, page_layout_name, page_layout_object,
      page_layout_type, page_layout_is_default, page_layout_description,
      role_id, record_type_id, created_at, updated_at,
      role:roles!page_layouts_role_id_fkey ( id, role_name ),
      record_type:picklist_values!page_layouts_record_type_id_fkey ( id, picklist_value, picklist_label )
    `)
    .eq('page_layout_object', tableName)
    .eq('is_deleted', false)
    .order('page_layout_name', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    id: r.page_layout_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.page_layout_name,
    type: r.page_layout_type,
    isDefault: r.page_layout_is_default ? 'Yes' : 'No',
    description: r.page_layout_description || '—',
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString().slice(0, 10) : '—',
    roleId: r.role_id,
    roleName: r.role?.role_name || null,
    recordTypeId: r.record_type_id,
    recordTypeLabel: r.record_type?.picklist_label || r.record_type?.picklist_value || null,
  }))
}

// Validation Rules for a specific object
export async function fetchValidationsFor(tableName) {
  const { data, error } = await supabase
    .from('validation_rules')
    .select('id, name, description, is_active, block_on_status, block_on_event, error_message')
    .eq('related_object', tableName)
    .order('name', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    id: r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.name,
    description: r.description || '—',
    status: r.is_active ? 'Active' : 'Inactive',
    blockOnEvent: r.block_on_event || '—',
    blockOnStatus: r.block_on_status || '—',
    errorMessage: r.error_message || '—',
  }))
}

// Automation Rules that trigger on a specific object
export async function fetchAutomationsFor(tableName) {
  const { data, error } = await supabase
    .from('automation_rules')
    .select('id, name, description, is_active, trigger_event, trigger_status, action_type, target_object, execution_order')
    .eq('trigger_object', tableName)
    .order('execution_order', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    id: r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.name,
    description: r.description || '—',
    status: r.is_active ? 'Active' : 'Inactive',
    triggerEvent: r.trigger_event,
    triggerStatus: r.trigger_status || '—',
    actionType: r.action_type,
    targetObject: r.target_object || '—',
    executionOrder: r.execution_order ?? '—',
  }))
}

// Picklist values scoped to one object (so Object Manager > Record Types / picklists works)
export async function fetchPicklistsFor(tableName) {
  const { data, error } = await supabase
    .from('picklist_values')
    .select('id, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order')
    .eq('picklist_object', tableName)
    .order('picklist_field', { ascending: true })
    .order('picklist_sort_order', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    id: r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    field: r.picklist_field,
    value: r.picklist_value,
    label: r.picklist_label || r.picklist_value,
    sortOrder: r.picklist_sort_order ?? 0,
    status: r.picklist_is_active !== false ? 'Active' : 'Inactive',
  }))
}

// Users — for Administration > Users
//
// Includes the role name (joined) and a `hasAuthLink` boolean derived from
// whether the public.users row has an `auth_user_id` set. The Users pane
// uses `hasAuthLink` to surface a "Send invite" action for rows that exist
// in the directory but cannot yet sign in.
export async function fetchUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('id, user_record_number, user_first_name, user_last_name, user_email, user_phone, user_title, role_id, auth_user_id, user_is_active, user_created_at, roles:role_id ( role_name )')
    .eq('user_is_deleted', false)
    .order('user_last_name', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    id: r.user_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    firstName: r.user_first_name || '—',
    lastName: r.user_last_name || '—',
    name: [r.user_first_name, r.user_last_name].filter(Boolean).join(' ') || '—',
    email: r.user_email || '—',
    phone: r.user_phone || '—',
    title: r.user_title || '—',
    role: r.roles?.role_name || '—',
    hasAuthLink: Boolean(r.auth_user_id),
    status: r.user_is_active ? 'Active' : 'Inactive',
  }))
}

// ---------------------------------------------------------------------------
// User invitations
//
// Both functions invoke the `invite-user` Edge Function which holds the
// service-role key server-side and performs the privileged work of creating
// (or linking) an auth.users row and writing/updating the matching
// public.users row. The function also sends the Supabase Auth invite email
// so the recipient can set their own password via a one-time link.
//
// `inviteUser` — full new-account flow. Requires email + names + role.
// `relinkUser` — for an existing public.users row that has no auth link
//                yet (e.g. a seeded directory entry). Email is read from
//                the existing row; only the user_id is required.
// ---------------------------------------------------------------------------

async function callInviteFunction(payload) {
  const { data, error } = await supabase.functions.invoke('invite-user', {
    body: payload,
  })
  // The supabase-js functions client resolves with `{ data, error }` where
  // `error` is set on non-2xx responses. We unify the failure shape so
  // callers get a single consistent thing to surface in the UI.
  if (error) {
    // Try to pull the structured error body the function returns. The SDK
    // attaches the response on `error.context` for FunctionsHttpError.
    let detail = null
    try {
      const body = await error.context?.json?.()
      if (body?.error) detail = body.error
      else if (body?.detail) detail = body.detail
    } catch { /* ignore parse errors */ }
    const message = detail || error.message || 'Invite failed'
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export async function inviteUser({ email, firstName, lastName, roleId, title, phone }) {
  return callInviteFunction({
    email, first_name: firstName, last_name: lastName,
    role_id: roleId,
    title: title || undefined,
    phone: phone || undefined,
  })
}

export async function relinkUser({ existingUserId, roleId, title, phone } = {}) {
  return callInviteFunction({
    existing_user_id: existingUserId,
    role_id: roleId || undefined,
    title: title || undefined,
    phone: phone || undefined,
  })
}

// Audit Log — for Administration > Audit Log
export async function fetchAuditLog(limit = 200) {
  const { data, error } = await supabase
    .from('audit_log')
    .select('id, al_action, al_object, al_record_id, al_performed_by, al_performed_at, al_notes')
    .order('al_performed_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data || []).map(r => ({
    id: r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    action: r.al_action || '—',
    object: r.al_object || '—',
    recordId: r.al_record_id ? String(r.al_record_id).slice(0, 8).toUpperCase() : '—',
    timestamp: r.al_performed_at ? new Date(r.al_performed_at).toISOString().replace('T', ' ').slice(0, 19) : '—',
    notes: r.al_notes || '—',
  }))
}

// All page layouts across the system (for User Interface > Page Layouts)
export async function fetchAllPageLayouts() {
  const { data, error } = await supabase
    .from('page_layouts')
    .select('id, page_layout_record_number, page_layout_name, page_layout_object, page_layout_type, page_layout_is_default, updated_at')
    .eq('is_deleted', false)
    .order('page_layout_object', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    id: r.page_layout_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.page_layout_name,
    object: r.page_layout_object,
    type: r.page_layout_type,
    isDefault: r.page_layout_is_default ? 'Yes' : 'No',
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString().slice(0, 10) : '—',
  }))
}

// Full structure of a single page layout — sections + widgets ordered.
// Returns: { layout, sections: [{...section, widgets: [...]}] }
export async function fetchPageLayoutStructure(layoutId) {
  const { data: layout, error: le } = await supabase
    .from('page_layouts')
    .select('id, page_layout_record_number, page_layout_name, page_layout_object, page_layout_type, page_layout_description, page_layout_is_default, updated_at')
    .eq('id', layoutId)
    .maybeSingle()
  if (le) throw le
  if (!layout) return null

  const { data: sections, error: se } = await supabase
    .from('page_layout_sections')
    .select('id, section_label, section_order, section_columns, section_is_collapsible, section_is_collapsed_by_default, section_tab')
    .eq('page_layout_id', layoutId)
    .eq('is_deleted', false)
    .order('section_order', { ascending: true })
  if (se) throw se

  const sectionIds = (sections || []).map(s => s.id)
  let widgets = []
  if (sectionIds.length > 0) {
    const { data: wData, error: we } = await supabase
      .from('page_layout_widgets')
      .select('id, page_layout_widget_record_number, section_id, widget_type, widget_title, widget_column, widget_position, widget_size, widget_config, widget_is_required')
      .in('section_id', sectionIds)
      .eq('is_deleted', false)
      .order('widget_position', { ascending: true })
    if (we) throw we
    widgets = wData || []
  }

  // Group widgets by section
  const widgetsBySection = {}
  for (const w of widgets) {
    if (!widgetsBySection[w.section_id]) widgetsBySection[w.section_id] = []
    widgetsBySection[w.section_id].push(w)
  }

  return {
    layout: {
      id: layout.id,
      recordNumber: layout.page_layout_record_number,
      name: layout.page_layout_name,
      object: layout.page_layout_object,
      type: layout.page_layout_type,
      isDefault: layout.page_layout_is_default,
      description: layout.page_layout_description || '',
      updatedAt: layout.updated_at,
    },
    sections: (sections || []).map(s => ({
      id: s.id,
      label: s.section_label,
      order: s.section_order,
      columns: s.section_columns,
      isCollapsible: s.section_is_collapsible,
      isCollapsedByDefault: s.section_is_collapsed_by_default,
      tab: s.section_tab,
      widgets: widgetsBySection[s.id] || [],
    })),
  }
}

// ---------------------------------------------------------------------------
// Work Plan Templates (Work Plan Builder — list view with step-count rollup)
// ---------------------------------------------------------------------------

export async function fetchWorkPlanTemplates() {
  // 1. Plan headers
  const { data: plans, error: planErr } = await supabase
    .from('work_plan_templates')
    .select(`
      id, wpt_record_number, wpt_name, wpt_description,
      wpt_is_active, wpt_relative_execution_order
    `)
    .eq('wpt_is_deleted', false)
    .order('wpt_name', { ascending: true })
  if (planErr) throw planErr

  if (!plans || plans.length === 0) return []

  // 2. All entries for these plans — join to step templates for duration rollup
  const planIds = plans.map(p => p.id)
  const { data: entries, error: entErr } = await supabase
    .from('work_plan_template_entries')
    .select(`
      work_plan_template_id,
      wpte_execution_order,
      work_step_templates:work_step_template_id (
        id, wst_estimated_duration_minutes, wst_is_deleted
      )
    `)
    .in('work_plan_template_id', planIds)
    .eq('wpte_is_deleted', false)
  if (entErr) throw entErr

  // 3. Rollups per plan
  const rollup = new Map()   // plan_id -> { stepCount, totalMinutes }
  for (const e of (entries || [])) {
    const step = e.work_step_templates
    if (!step || step.wst_is_deleted) continue
    const r = rollup.get(e.work_plan_template_id) || { stepCount: 0, totalMinutes: 0 }
    r.stepCount += 1
    r.totalMinutes += Number(step.wst_estimated_duration_minutes || 0)
    rollup.set(e.work_plan_template_id, r)
  }

  // 4. Flatten
  return plans.map(p => {
    const r = rollup.get(p.id) || { stepCount: 0, totalMinutes: 0 }
    const hrs = r.totalMinutes / 60
    const totalLabel = r.totalMinutes === 0
      ? '—'
      : (r.totalMinutes >= 60 ? `${hrs.toFixed(2).replace(/\.00$/, '')} hr (${r.totalMinutes} min)` : `${r.totalMinutes} min`)
    return {
      id: p.wpt_record_number || p.id.slice(0, 8).toUpperCase(),
      _id: p.id,
      name: p.wpt_name,
      description: p.wpt_description || '—',
      stepCount: r.stepCount,
      totalDuration: totalLabel,
      status: p.wpt_is_active ? 'Active' : 'Inactive',
    }
  })
}

// ---------------------------------------------------------------------------
// Work Step Templates (Work Plan Builder — reusable step library)
// ---------------------------------------------------------------------------
//
// Standalone list view of step templates. Steps are the building blocks
// assembled into work plans via the WPTE junction; this view lets admins
// author and edit the step library without having to open a specific plan.
// Mirrors the shape of fetchWorkPlanTemplates so the NodePage + ListView
// wiring behaves identically.
// ---------------------------------------------------------------------------

export async function fetchWorkStepTemplates() {
  // 1. Step template headers.
  const { data: steps, error: stepErr } = await supabase
    .from('work_step_templates')
    .select(`
      id, wst_record_number, wst_name, wst_description,
      wst_estimated_duration_minutes,
      wst_required_evidence_type_id,
      wst_assigned_owner_role_id,
      wst_is_active
    `)
    .eq('wst_is_deleted', false)
    .order('wst_name', { ascending: true })
  if (stepErr) throw stepErr

  if (!steps || steps.length === 0) return []

  // 2. Resolve evidence-type labels (picklist_values) and role labels in batch.
  const evidenceIds = new Set()
  const roleIds     = new Set()
  for (const s of steps) {
    if (s.wst_required_evidence_type_id) evidenceIds.add(s.wst_required_evidence_type_id)
    if (s.wst_assigned_owner_role_id)    roleIds.add(s.wst_assigned_owner_role_id)
  }

  const [evRes, roleRes] = await Promise.all([
    evidenceIds.size > 0
      ? supabase.from('picklist_values').select('id, picklist_label, picklist_value').in('id', [...evidenceIds])
      : Promise.resolve({ data: [] }),
    roleIds.size > 0
      ? supabase.from('roles').select('id, role_name').in('id', [...roleIds])
      : Promise.resolve({ data: [] }),
  ])
  if (evRes.error)   throw evRes.error
  if (roleRes.error) throw roleRes.error

  const evMap   = new Map((evRes.data   || []).map(p => [p.id, p.picklist_label || p.picklist_value]))
  const roleMap = new Map((roleRes.data || []).map(r => [r.id, r.role_name]))

  // 3. Flatten for the ListView.
  return steps.map(s => {
    const mins = Number(s.wst_estimated_duration_minutes || 0)
    const durationLabel = mins === 0
      ? '—'
      : (mins >= 60
          ? `${(mins / 60).toFixed(2).replace(/\.00$/, '')} hr (${mins} min)`
          : `${mins} min`)
    return {
      id:          s.wst_record_number || s.id.slice(0, 8).toUpperCase(),
      _id:         s.id,
      name:        s.wst_name,
      description: s.wst_description || '—',
      duration:    durationLabel,
      evidenceType: evMap.get(s.wst_required_evidence_type_id) || '—',
      ownerRole:    roleMap.get(s.wst_assigned_owner_role_id)  || '—',
      status:      s.wst_is_active ? 'Active' : 'Inactive',
    }
  })
}

// Full drill-in: plan header + ordered steps with role/evidence labels resolved
export async function fetchWorkPlanTemplateDetail(planId) {
  // 1. Plan header
  const { data: plan, error: planErr } = await supabase
    .from('work_plan_templates')
    .select('id, wpt_record_number, wpt_name, wpt_description, wpt_is_active, wpt_relative_execution_order')
    .eq('id', planId)
    .single()
  if (planErr) throw planErr

  // 2. Entries with step templates
  const { data: entries, error: entErr } = await supabase
    .from('work_plan_template_entries')
    .select(`
      id, wpte_execution_order,
      work_step_templates:work_step_template_id (
        id, wst_record_number, wst_name, wst_description,
        wst_estimated_duration_minutes,
        wst_required_evidence_type_id,
        wst_assigned_owner_role_id,
        wst_verifier_role_id,
        wst_photos_required_count,
        wst_photo_before_required,
        wst_photo_after_required,
        wst_is_active, wst_is_deleted
      )
    `)
    .eq('work_plan_template_id', planId)
    .eq('wpte_is_deleted', false)
    .order('wpte_execution_order', { ascending: true })
  if (entErr) throw entErr

  const steps = (entries || [])
    .map(e => ({ order: e.wpte_execution_order, wste: e.id, step: e.work_step_templates }))
    .filter(s => s.step && !s.step.wst_is_deleted)

  // 3. Resolve roles and evidence type labels in batch
  const roleIds = new Set()
  const evidenceIds = new Set()
  steps.forEach(s => {
    if (s.step.wst_assigned_owner_role_id) roleIds.add(s.step.wst_assigned_owner_role_id)
    if (s.step.wst_verifier_role_id)       roleIds.add(s.step.wst_verifier_role_id)
    if (s.step.wst_required_evidence_type_id) evidenceIds.add(s.step.wst_required_evidence_type_id)
  })

  const [roleRes, evRes] = await Promise.all([
    roleIds.size > 0
      ? supabase.from('roles').select('id, role_name').in('id', [...roleIds])
      : Promise.resolve({ data: [] }),
    evidenceIds.size > 0
      ? supabase.from('picklist_values').select('id, picklist_label').in('id', [...evidenceIds])
      : Promise.resolve({ data: [] }),
  ])
  if (roleRes.error) throw roleRes.error
  if (evRes.error)   throw evRes.error

  const roleMap = new Map((roleRes.data || []).map(r => [r.id, r.role_name]))
  const evMap   = new Map((evRes.data   || []).map(p => [p.id, p.picklist_label]))

  // 4. Find associated work types that use this plan as default
  const { data: workTypes, error: wtErr } = await supabase
    .from('work_types')
    .select('id, work_type_record_number, work_type_name')
    .eq('work_type_default_work_plan_template_id', planId)
    .eq('work_type_is_deleted', false)
  if (wtErr) throw wtErr

  // 5. Shape output
  const totalMinutes = steps.reduce((sum, s) => sum + Number(s.step.wst_estimated_duration_minutes || 0), 0)

  return {
    plan: {
      id: plan.id,
      recordNumber: plan.wpt_record_number,
      name: plan.wpt_name,
      description: plan.wpt_description || '',
      isActive: plan.wpt_is_active,
      totalMinutes,
      totalHours: totalMinutes / 60,
      stepCount: steps.length,
    },
    workTypes: (workTypes || []).map(wt => ({
      id: wt.id,
      recordNumber: wt.work_type_record_number,
      name: wt.work_type_name,
    })),
    steps: steps.map(({ order, step }) => ({
      order,
      recordNumber: step.wst_record_number,
      id: step.id,
      name: step.wst_name,
      description: step.wst_description || '',
      durationMinutes: Number(step.wst_estimated_duration_minutes || 0),
      evidenceType: evMap.get(step.wst_required_evidence_type_id) || '—',
      ownerRole:    roleMap.get(step.wst_assigned_owner_role_id)  || '—',
      verifierRole: roleMap.get(step.wst_verifier_role_id)         || '—',
      photosRequired: step.wst_photos_required_count || 0,
      photoBefore:    !!step.wst_photo_before_required,
      photoAfter:     !!step.wst_photo_after_required,
      isActive:       !!step.wst_is_active,
    })),
  }
}

// ---------------------------------------------------------------------------
// Skills (Salesforce Field Service: Skill master catalog)
// ---------------------------------------------------------------------------
export async function fetchSkills() {
  const { data, error } = await supabase
    .from('skills')
    .select(`
      id,
      skill_record_number,
      skill_name,
      skill_description,
      skill_issuing_body,
      skill_requires_certification,
      skill_validity_months,
      category:skill_category ( picklist_label )
    `)
    .eq('skill_is_deleted', false)
    .order('skill_name', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    id: r.skill_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.skill_name,
    description: r.skill_description || '—',
    category: r.category?.picklist_label || '—',
    issuingBody: r.skill_issuing_body || '—',
    requiresCert: r.skill_requires_certification ? 'Yes' : 'No',
    validityMonths: r.skill_validity_months ?? '—',
  }))
}

// ---------------------------------------------------------------------------
// Work Type Skill Requirements (FSL: SkillRequirement on WorkType)
// ---------------------------------------------------------------------------
export async function fetchWorkTypeSkillRequirements() {
  const { data, error } = await supabase
    .from('work_type_skill_requirements')
    .select(`
      id,
      wtsr_record_number,
      wtsr_minimum_level,
      work_types:work_type_id ( work_type_record_number, work_type_name ),
      skills:skill_id ( skill_record_number, skill_name )
    `)
    .eq('wtsr_is_deleted', false)
  if (error) throw error
  return (data || []).map(r => ({
    id: r.wtsr_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    workType: r.work_types?.work_type_name || '—',
    workTypeNumber: r.work_types?.work_type_record_number || '—',
    skill: r.skills?.skill_name || '—',
    skillNumber: r.skills?.skill_record_number || '—',
    minLevel: r.wtsr_minimum_level ?? 1,
  }))
}

// ---------------------------------------------------------------------------
// Project Report Templates (Project Report Template Builder)
// ---------------------------------------------------------------------------
//
// List shell for the Builder pane. Returns one row per active template with
// rolled-up section count and assignment count so admins can see at a glance
// which templates are wired up. Click-through opens the standard RecordDetail
// page driven by PL-RD-PRT.
// ---------------------------------------------------------------------------

export async function fetchProjectReportTemplates() {
  // 1. Headers — including resolved status/orientation/paper picklist labels
  const { data: prts, error: prtErr } = await supabase
    .from('project_report_templates')
    .select(`
      id, prt_record_number, prt_name, prt_description, prt_version,
      prt_is_default_for_unmapped,
      status:prt_status ( picklist_label ),
      orientation:prt_orientation ( picklist_label ),
      paper:prt_paper_size ( picklist_label )
    `)
    .eq('prt_is_deleted', false)
    .order('prt_name', { ascending: true })
  if (prtErr) throw prtErr
  if (!prts || prts.length === 0) return []

  const ids = prts.map(p => p.id)

  // 2. Section count per template
  const { data: sections, error: sErr } = await supabase
    .from('project_report_template_sections')
    .select('prt_id')
    .in('prt_id', ids)
    .eq('prts_is_deleted', false)
  if (sErr) throw sErr
  const sectionCount = new Map()
  for (const s of (sections || [])) {
    sectionCount.set(s.prt_id, (sectionCount.get(s.prt_id) || 0) + 1)
  }

  // 3. Assignment count per template
  const { data: assigns, error: aErr } = await supabase
    .from('project_report_template_record_type_assignments')
    .select('prt_id')
    .in('prt_id', ids)
    .eq('prtrta_is_deleted', false)
  if (aErr) throw aErr
  const assignCount = new Map()
  for (const a of (assigns || [])) {
    assignCount.set(a.prt_id, (assignCount.get(a.prt_id) || 0) + 1)
  }

  return prts.map(p => ({
    id: p.prt_record_number || p.id.slice(0, 8).toUpperCase(),
    _id: p.id,
    name: p.prt_name,
    description: p.prt_description || '—',
    status: p.status?.picklist_label || '—',
    orientation: p.orientation?.picklist_label || '—',
    paperSize: p.paper?.picklist_label || '—',
    version: p.prt_version,
    isDefaultForUnmapped: p.prt_is_default_for_unmapped ? 'Yes' : 'No',
    sectionCount: sectionCount.get(p.id) || 0,
    assignmentCount: assignCount.get(p.id) || 0,
  }))
}
