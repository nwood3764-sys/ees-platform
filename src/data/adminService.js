import { supabase, fetchAllPaged } from '../lib/supabase'
import { getCurrentUserId } from './layoutService'

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
// Automation Rule Builder — CRUD helpers driving the structured editor
// at Setup → Process Automation → Flows. The generic NodePage editor
// can't shape action_config per action_type, so the Builder owns the
// full create/read/update surface.
// ---------------------------------------------------------------------------

/**
 * Load one rule with every column populated, for the edit modal. Returns
 * the raw row shape — the Builder owns the rendering of action_config.
 */
export async function fetchAutomationRuleFull(ruleId) {
  const { data, error } = await supabase
    .from('automation_rules')
    .select(`
      id, name, description, is_active, execution_order,
      trigger_object, trigger_event, trigger_status, trigger_field, trigger_field_value,
      action_type, action_config, target_object, target_role_id,
      email_template_id, document_template_id, owner_id,
      created_by, created_at, updated_by, updated_at
    `)
    .eq('id', ruleId)
    .single()
  if (error) throw error
  return data
}

/**
 * Create a new rule. The Builder enforces required-fields client-side;
 * this helper makes no assumptions beyond what Postgres will enforce.
 * Returns the new row's id.
 */
export async function createAutomationRule(payload) {
  const { data, error } = await supabase
    .from('automation_rules')
    .insert(payload)
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

/**
 * Update an existing rule. Builder passes only the columns it knows about
 * so the DB-level updated_at trigger does the rest.
 */
export async function updateAutomationRule(ruleId, payload) {
  const { error } = await supabase
    .from('automation_rules')
    .update(payload)
    .eq('id', ruleId)
  if (error) throw error
}

/**
 * Flip is_active on a rule. Separate helper because the list view exposes
 * this as a one-click toggle without opening the edit modal.
 */
export async function setAutomationRuleActive(ruleId, isActive) {
  const { error } = await supabase
    .from('automation_rules')
    .update({ is_active: !!isActive })
    .eq('id', ruleId)
  if (error) throw error
}

/**
 * Soft delete: automation_rules has no is_deleted column (the table predates
 * the universal soft-delete convention). Set is_active=false instead — the
 * executor ignores inactive rules and they drop out of the default list.
 * Hard delete is reserved for admin via direct SQL if a rule truly needs to
 * disappear.
 */
export async function disableAutomationRule(ruleId) {
  return setAutomationRuleActive(ruleId, false)
}

/**
 * Lightweight pickers powering the Builder's structured form. Each returns
 * {value, label}[] for a <select> dropdown. Failure is non-fatal; the
 * Builder falls back to a free-text input if a picker is empty.
 */
export async function fetchAutomationTriggerObjects() {
  // Objects that have at least one active status_transitions row — these are
  // the targets where 'status_change' can fire today. Other trigger_events
  // can still be saved against any object, but this gives the picker a
  // sensible default scope when event='status_change'.
  const { data, error } = await supabase
    .from('status_transitions')
    .select('st_object')
    .eq('st_is_active', true)
    .eq('st_is_deleted', false)
  if (error) throw error
  const uniq = Array.from(new Set((data || []).map(r => r.st_object))).sort()
  return uniq.map(o => ({ value: o, label: o }))
}

export async function fetchAutomationStatusValues(triggerObject) {
  // Distinct status labels reachable as destinations on this object's
  // lifecycle. Joined through picklist_values because the transition table
  // stores status FKs, not labels. The picker offers only statuses
  // currently part of the lifecycle, matching what the executor will see.
  if (!triggerObject) return []
  const { data, error } = await supabase
    .from('status_transitions')
    .select('st_to_status_id, picklist_values:st_to_status_id ( picklist_label, picklist_value )')
    .eq('st_object', triggerObject)
    .eq('st_is_active', true)
    .eq('st_is_deleted', false)
  if (error) throw error
  const labels = (data || [])
    .map(r => r.picklist_values?.picklist_label || r.picklist_values?.picklist_value)
    .filter(Boolean)
  const uniq = Array.from(new Set(labels)).sort()
  return uniq.map(s => ({ value: s, label: s }))
}

export async function fetchAutomationRoles() {
  // The roles table uses role_is_active (no role_is_deleted). Inactive
  // roles drop out of the picker; existing rules referencing an inactive
  // role still save round-trippably because action_config stores the
  // role NAME, not the role id.
  const { data, error } = await supabase
    .from('roles')
    .select('id, role_name, role_is_active')
    .eq('role_is_active', true)
    .order('role_name', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({ value: r.role_name, label: r.role_name, _id: r.id }))
}

export async function fetchAutomationEmailTemplates() {
  // email_templates uses unprefixed canonical columns. status is a uuid FK
  // to picklist_values (not a text column), so we join through picklist
  // and filter on the resolved label. Active and Draft templates surface
  // in the picker; Archived templates drop out.
  const { data, error } = await supabase
    .from('email_templates')
    .select('id, name, status:picklist_values!status ( picklist_label )')
    .eq('is_deleted', false)
    .order('name', { ascending: true })
  if (error) throw error
  return (data || [])
    .filter(r => r.status?.picklist_label !== 'Archived')
    .map(r => {
      const statusLabel = r.status?.picklist_label || 'Draft'
      return {
        value: r.name,
        label: statusLabel === 'Active' ? r.name : `${r.name} (${statusLabel})`,
        _id: r.id,
      }
    })
}

export async function fetchAutomationWorkTypes() {
  const { data, error } = await supabase
    .from('work_types')
    .select('id, work_type_name')
    .eq('work_type_is_deleted', false)
    .eq('work_type_is_active', true)
    .order('work_type_name', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({ value: r.work_type_name, label: r.work_type_name, _id: r.id }))
}

// ---------------------------------------------------------------------------
// Automation run log — observability for fired rules
// ---------------------------------------------------------------------------

export async function fetchAutomationRunLog() {
  // Most recent 500 firings. The full log is unbounded so we cap; deeper
  // history can be reached via record-scoped filtering on the source record
  // detail page if we wire that in later.
  const { data, error } = await supabase
    .from('automation_run_log')
    .select(`
      id, arl_record_number, arl_rule_id, arl_rule_name,
      arl_trigger_object, arl_trigger_record_id, arl_trigger_event,
      arl_trigger_status, arl_action_type, arl_outcome, arl_outcome_message,
      arl_created_target_id, arl_fired_at, arl_fired_by
    `)
    .eq('arl_is_deleted', false)
    .order('arl_fired_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return (data || []).map(r => ({
    id: r.arl_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    ruleName: r.arl_rule_name || '—',
    triggerObject: r.arl_trigger_object,
    triggerEvent: r.arl_trigger_event,
    triggerStatus: r.arl_trigger_status || '—',
    actionType: r.arl_action_type,
    outcome: r.arl_outcome,
    outcomeMessage: r.arl_outcome_message || '',
    firedAt: r.arl_fired_at,
    triggerRecordId: r.arl_trigger_record_id,
    ruleId: r.arl_rule_id,
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
// Saved list views — per-module record listings (filters / sort / columns)
// ---------------------------------------------------------------------------

export async function fetchSavedListViews() {
  // Two-query shape so we can resolve the owner uuid → user_name for display
  // without making the NodePage's row data carry both raw uuid and join.
  const { data, error } = await supabase
    .from('saved_list_views')
    .select(`
      id, list_view_record_number, list_view_name,
      list_view_object, list_view_module,
      list_view_user_id, list_view_role_id,
      list_view_owner,
      list_view_is_default, list_view_is_shared,
      list_view_sort_field, list_view_sort_direction,
      list_view_visible_columns, list_view_filters,
      updated_at
    `)
    .eq('is_deleted', false)
    .order('list_view_object', { ascending: true })
    .order('list_view_name', { ascending: true })
    .limit(500)

  if (error) throw error
  const rows = data || []

  // Bulk-resolve owner names (NodePage row shows the owner). Skip if none.
  const ownerIds = [...new Set(rows.map(r => r.list_view_owner).filter(Boolean))]
  let ownerNames = {}
  if (ownerIds.length > 0) {
    const { data: users } = await supabase
      .from('users').select('id, user_name').in('id', ownerIds)
    ownerNames = Object.fromEntries((users || []).map(u => [u.id, u.user_name]))
  }

  // Bulk-resolve role names too (a list view can be scoped to a role
  // rather than a single user — list_view_role_id).
  const roleIds = [...new Set(rows.map(r => r.list_view_role_id).filter(Boolean))]
  let roleNames = {}
  if (roleIds.length > 0) {
    const { data: roles } = await supabase
      .from('roles').select('id, role_name').in('id', roleIds)
    roleNames = Object.fromEntries((roles || []).map(r => [r.id, r.role_name]))
  }

  return rows.map(r => {
    // Scope label: shared (everyone), role-scoped, user-scoped, or "owner only"
    let scope = 'Personal'
    if (r.list_view_is_shared) scope = 'Shared'
    else if (r.list_view_role_id) scope = `Role: ${roleNames[r.list_view_role_id] || r.list_view_role_id.slice(0, 8)}`
    else if (r.list_view_user_id) scope = `User: ${ownerNames[r.list_view_user_id] || r.list_view_user_id.slice(0, 8)}`

    const columnsCount = Array.isArray(r.list_view_visible_columns)
      ? r.list_view_visible_columns.length
      : (r.list_view_visible_columns && typeof r.list_view_visible_columns === 'object')
        ? Object.keys(r.list_view_visible_columns).length
        : 0
    const filtersCount = Array.isArray(r.list_view_filters)
      ? r.list_view_filters.length
      : (r.list_view_filters && typeof r.list_view_filters === 'object')
        ? Object.keys(r.list_view_filters).length
        : 0

    return {
      id: r.list_view_record_number || r.id.slice(0, 8).toUpperCase(),
      _id: r.id,
      name: r.list_view_name || '(untitled)',
      object: r.list_view_object || '',
      module: r.list_view_module || '',
      scope,
      isDefault: r.list_view_is_default ? 'Yes' : 'No',
      sort: r.list_view_sort_field
        ? `${r.list_view_sort_field} ${r.list_view_sort_direction === 'asc' ? '↑' : '↓'}`
        : '—',
      columnsCount,
      filtersCount,
      owner: ownerNames[r.list_view_owner] || '',
      updatedAt: r.updated_at ? new Date(r.updated_at).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
      }) : '',
    }
  })
}

// ---------------------------------------------------------------------------
// Service Territories — geographic regions field staff are assigned to.
// Hierarchical: parent_territory_id + top_level_territory_id self-refs.
// Each territory owns a set of zip codes via the service_territory_zips junction.
// ---------------------------------------------------------------------------

export async function fetchServiceTerritories() {
  const { data, error } = await supabase
    .from('service_territories')
    .select(`
      id, service_territory_record_number, service_territory_name,
      service_territory_is_active,
      service_territory_state, service_territory_country,
      service_territory_travel_time_buffer_minutes,
      parent_territory_id, top_level_territory_id,
      service_territory_owner,
      service_territory_updated_at
    `)
    .eq('service_territory_is_deleted', false)
    .order('service_territory_name', { ascending: true })
    .limit(500)

  if (error) throw error
  const rows = data || []

  // Bulk-resolve owner names so the row shape carries display text rather
  // than a raw uuid.
  const ownerIds = [...new Set(rows.map(r => r.service_territory_owner).filter(Boolean))]
  let ownerNames = {}
  if (ownerIds.length > 0) {
    const { data: users } = await supabase
      .from('users').select('id, user_name').in('id', ownerIds)
    ownerNames = Object.fromEntries((users || []).map(u => [u.id, u.user_name]))
  }

  // Bulk-resolve parent territory names. The parent_territory_id self-ref
  // means a territory can both be a parent and have a parent — we resolve
  // every distinct id mentioned in either slot against the same rowset
  // when possible, falling back to a small follow-up query for ids that
  // aren't in the loaded page.
  const knownNames = Object.fromEntries(rows.map(r => [r.id, r.service_territory_name]))
  const referencedIds = [...new Set([
    ...rows.map(r => r.parent_territory_id),
    ...rows.map(r => r.top_level_territory_id),
  ].filter(Boolean))]
  const missingIds = referencedIds.filter(id => !knownNames[id])
  if (missingIds.length > 0) {
    const { data: extras } = await supabase
      .from('service_territories')
      .select('id, service_territory_name')
      .in('id', missingIds)
    for (const e of (extras || [])) knownNames[e.id] = e.service_territory_name
  }

  // Bulk zip-count per territory. service_territory_zips has 0 rows in the
  // current install (zips haven't been imported yet), so this typically
  // returns nothing — but the query shape is correct for when it does.
  const territoryIds = rows.map(r => r.id)
  let zipCounts = {}
  if (territoryIds.length > 0) {
    const { data: zipRows } = await supabase
      .from('service_territory_zips')
      .select('service_territory_id')
      .in('service_territory_id', territoryIds)
      .eq('stz_is_deleted', false)
    if (zipRows) {
      for (const z of zipRows) {
        zipCounts[z.service_territory_id] = (zipCounts[z.service_territory_id] || 0) + 1
      }
    }
  }

  return rows.map(r => ({
    id: r.service_territory_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.service_territory_name || '(unnamed)',
    active: r.service_territory_is_active === false ? 'Inactive' : 'Active',
    parent: r.parent_territory_id ? (knownNames[r.parent_territory_id] || '—') : '—',
    state: r.service_territory_state || '',
    country: r.service_territory_country || '',
    zipCount: zipCounts[r.id] || 0,
    travelBufferMin: r.service_territory_travel_time_buffer_minutes ?? '',
    owner: ownerNames[r.service_territory_owner] || '',
    updatedAt: r.service_territory_updated_at ? new Date(r.service_territory_updated_at).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    }) : '',
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

// ── Per-record-type picklist availability (Salesforce hierarchy) ──────────
// Object → Field → (picklist) values → per Record Type, which values apply.
//
// Distinct picklist FIELDS on an object (each is a managed picklist field).
// Returns [{ field, valueCount }] excluding 'record_type' itself (record types
// are managed in their own pane, not as a value list here).
export async function fetchPicklistFieldsFor(tableName) {
  const { data, error } = await supabase
    .from('picklist_values')
    .select('picklist_field')
    .eq('picklist_object', tableName)
    .eq('picklist_is_active', true)
  if (error) throw error
  const counts = {}
  for (const r of (data || [])) {
    if (r.picklist_field === 'record_type') continue
    counts[r.picklist_field] = (counts[r.picklist_field] || 0) + 1
  }
  return Object.entries(counts)
    .map(([field, valueCount]) => ({ field, valueCount }))
    .sort((a, b) => a.field.localeCompare(b.field))
}

// All active values for ONE field on an object, in sort order.
export async function fetchFieldValues(tableName, field) {
  const { data, error } = await supabase
    .from('picklist_values')
    .select('id, picklist_value, picklist_label, picklist_sort_order, picklist_is_active')
    .eq('picklist_object', tableName)
    .eq('picklist_field', field)
    .order('picklist_sort_order', { ascending: true })
    .order('picklist_value', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    _id: r.id,
    value: r.picklist_value,
    label: r.picklist_label || r.picklist_value,
    sortOrder: r.picklist_sort_order ?? 0,
    active: r.picklist_is_active !== false,
  }))
}

// Record types for an object (rows where picklist_field='record_type').
export async function fetchRecordTypesFor(tableName) {
  const { data, error } = await supabase
    .from('picklist_values')
    .select('id, picklist_value, picklist_label, picklist_sort_order, picklist_is_active')
    .eq('picklist_object', tableName)
    .eq('picklist_field', 'record_type')
    .order('picklist_label', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    _id: r.id,
    value: r.picklist_value,
    label: r.picklist_label || r.picklist_value,
    sortOrder: r.picklist_sort_order ?? 0,
    active: r.picklist_is_active !== false,
  }))
}

// Current per-record-type assignments for an object+field. Returns a map of
// record_type_id -> Set(value_id). A record type ABSENT from the map (no rows)
// means "universal" — every value applies (Salesforce default).
export async function fetchRecordTypeValueAssignments(tableName, field) {
  // Resolve the field's value ids first, then pull assignments for them.
  const vals = await fetchFieldValues(tableName, field)
  const valueIds = vals.map(v => v._id)
  if (valueIds.length === 0) return { map: {}, valueIds: [] }
  const { data, error } = await supabase
    .from('picklist_value_record_type_assignments')
    .select('pvrta_record_type_id, pvrta_picklist_value_id')
    .eq('pvrta_is_deleted', false)
    .in('pvrta_picklist_value_id', valueIds)
  if (error) throw error
  const map = {}
  for (const r of (data || [])) {
    (map[r.pvrta_record_type_id] ||= new Set()).add(r.pvrta_picklist_value_id)
  }
  return { map, valueIds }
}

// Replace the available-value set for one (record type, field). Empty array =
// universal (all values). Drives the per-record-type editor's Save.
export async function setRecordTypePicklistValues(recordTypeId, object, field, valueIds) {
  const { data, error } = await supabase.rpc('set_record_type_picklist_values', {
    p_record_type_id: recordTypeId,
    p_object: object,
    p_field: field,
    p_value_ids: valueIds,
  })
  if (error) throw error
  return data
}

// ── Module section-tab configuration ─────────────────────────────────────
// Modules are Salesforce-style apps; their tab strip is DB-driven via
// module_sections so admins can reorder/rename/show-hide without code.
export async function fetchModuleSections(moduleId) {
  const { data, error } = await supabase
    .from('module_sections')
    .select('id, ms_module_id, ms_section_id, ms_label, ms_sort_order, ms_is_visible, ms_is_system, ms_object_table')
    .eq('ms_module_id', moduleId)
    .eq('ms_is_deleted', false)
    .order('ms_sort_order', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    _id: r.id,
    moduleId: r.ms_module_id,
    sectionId: r.ms_section_id,
    label: r.ms_label,
    sortOrder: r.ms_sort_order,
    visible: r.ms_is_visible,
    isSystem: r.ms_is_system,
    objectTable: r.ms_object_table,
  }))
}

// All sections across all modules (for the Setup editor's module list).
export async function fetchAllModuleSections() {
  const { data, error } = await supabase
    .from('module_sections')
    .select('id, ms_module_id, ms_section_id, ms_label, ms_sort_order, ms_is_visible, ms_is_system, ms_object_table')
    .eq('ms_is_deleted', false)
    .order('ms_module_id', { ascending: true })
    .order('ms_sort_order', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    _id: r.id,
    moduleId: r.ms_module_id,
    sectionId: r.ms_section_id,
    label: r.ms_label,
    sortOrder: r.ms_sort_order,
    visible: r.ms_is_visible,
    isSystem: r.ms_is_system,
    objectTable: r.ms_object_table,
  }))
}

export async function saveModuleSections(moduleId, sections) {
  // sections: [{ section_id, label, sort_order, is_visible }]
  const { data, error } = await supabase.rpc('set_module_sections', {
    p_module_id: moduleId,
    p_sections: sections,
  })
  if (error) throw error
  return data
}

// ── Picklist VALUE management (add / rename / activate / reorder) ─────────
// Values live in picklist_values, scoped by (object, field). Deactivation is
// is_active=false (there is no is_deleted column on this table). Writes are
// gated by the table's RLS (app_user_can('picklist_values', ...)).
export async function addFieldValue(object, field, value, label, sortOrder) {
  const { data, error } = await supabase
    .from('picklist_values')
    .insert({
      picklist_object: object,
      picklist_field: field,
      picklist_value: value,
      picklist_label: label || value,
      picklist_sort_order: sortOrder ?? 0,
      picklist_is_active: true,
    })
    .select('id')
    .single()
  if (error) throw error
  return data
}

export async function updateFieldValue(id, patch) {
  // patch: { label?, value?, sortOrder?, isActive? }
  const upd = {}
  if (patch.label !== undefined) upd.picklist_label = patch.label
  if (patch.value !== undefined) upd.picklist_value = patch.value
  if (patch.sortOrder !== undefined) upd.picklist_sort_order = patch.sortOrder
  if (patch.isActive !== undefined) upd.picklist_is_active = patch.isActive
  const { error } = await supabase.from('picklist_values').update(upd).eq('id', id)
  if (error) throw error
}

// Persist a full reordering: array of value ids in desired order.
export async function reorderFieldValues(ids) {
  // Sequential updates keep it simple and within RLS; lists are short.
  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase
      .from('picklist_values')
      .update({ picklist_sort_order: i })
      .eq('id', ids[i])
    if (error) throw error
  }
}

// ── Field metadata + DDL field creation ──────────────────────────────────
// Field metadata (label, help, description, tier, history flag) lives in
// field_metadata keyed by (object, column). New fields add a real column via
// the admin_add_custom_field RPC (whitelisted ALTER TABLE), then record
// metadata. Editing metadata uses admin_upsert_field_metadata.
export async function fetchFieldMetadata(object) {
  const { data, error } = await supabase
    .from('field_metadata')
    .select('fm_object, fm_column, fm_label, fm_help_text, fm_description, fm_example_value, fm_financial_tier, fm_track_history, fm_data_type, fm_is_custom')
    .eq('fm_object', object)
    .eq('fm_is_deleted', false)
  if (error) throw error
  const map = {}
  for (const r of (data || [])) {
    map[r.fm_column] = {
      object: r.fm_object, column: r.fm_column, label: r.fm_label,
      helpText: r.fm_help_text, description: r.fm_description, exampleValue: r.fm_example_value,
      financialTier: r.fm_financial_tier, trackHistory: r.fm_track_history,
      dataType: r.fm_data_type, isCustom: r.fm_is_custom,
    }
  }
  return map
}

export async function addCustomField(params) {
  // params: { object, column, label, dataType, helpText, description, exampleValue, financialTier, trackHistory, fkTable }
  const { data, error } = await supabase.rpc('admin_add_custom_field', {
    p_object: params.object,
    p_column: params.column,
    p_label: params.label,
    p_data_type: params.dataType,
    p_help_text: params.helpText || null,
    p_description: params.description || null,
    p_example_value: params.exampleValue || null,
    p_financial_tier: params.financialTier ?? 1,
    p_track_history: params.trackHistory ?? false,
    p_fk_table: params.fkTable || null,
  })
  if (error) throw error
  return data
}

export async function upsertFieldMetadata(params) {
  const { data, error } = await supabase.rpc('admin_upsert_field_metadata', {
    p_object: params.object,
    p_column: params.column,
    p_label: params.label,
    p_help_text: params.helpText || null,
    p_description: params.description || null,
    p_example_value: params.exampleValue || null,
    p_financial_tier: params.financialTier ?? 1,
    p_track_history: params.trackHistory ?? false,
  })
  if (error) throw error
  return data
}

// ── Home/app page builder ────────────────────────────────────────────────
export async function fetchHomePages() {
  const { data, error } = await supabase
    .from('home_pages')
    .select('id, hp_name, hp_template, hp_role_id, hp_is_active, hp_is_default, hp_updated_at')
    .eq('hp_is_deleted', false)
    .order('hp_updated_at', { ascending: false })
  if (error) throw error
  return (data || []).map(r => ({
    id: r.id, name: r.hp_name, template: r.hp_template, roleId: r.hp_role_id,
    isActive: r.hp_is_active, isDefault: r.hp_is_default, updatedAt: r.hp_updated_at,
  }))
}

export async function fetchHomePage(pageId) {
  const [{ data: page, error: e1 }, { data: comps, error: e2 }] = await Promise.all([
    supabase.from('home_pages').select('id, hp_name, hp_template, hp_role_id, hp_is_active, hp_is_default').eq('id', pageId).single(),
    supabase.from('home_page_components').select('id, hpc_region, hpc_type, hpc_source_id, hpc_title, hpc_config, hpc_sort_order').eq('hpc_page_id', pageId).eq('hpc_is_deleted', false).order('hpc_sort_order', { ascending: true }),
  ])
  if (e1) throw e1
  if (e2) throw e2
  return {
    id: page.id, name: page.hp_name, template: page.hp_template, roleId: page.hp_role_id,
    isActive: page.hp_is_active, isDefault: page.hp_is_default,
    components: (comps || []).map(c => ({
      id: c.id, region: c.hpc_region, type: c.hpc_type, sourceId: c.hpc_source_id,
      title: c.hpc_title, config: c.hpc_config || {}, sortOrder: c.hpc_sort_order,
    })),
  }
}

export async function saveHomePage(page, components) {
  const { data, error } = await supabase.rpc('save_home_page', {
    p_page: {
      id: page.id || null, name: page.name, template: page.template,
      role_id: page.roleId || null, is_active: !!page.isActive, is_default: !!page.isDefault,
    },
    p_components: components.map((c, i) => ({
      region: c.region, type: c.type, source_id: c.sourceId || null,
      title: c.title || null, config: c.config || {}, sort_order: i,
    })),
  })
  if (error) throw error
  return data
}

export async function resolveHomePage() {
  const { data, error } = await supabase.rpc('resolve_home_page_for_current_user')
  if (error) throw error
  return data // null when no configured page
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

// Active permission sets — for the technician setup wizard's permission-set
// step and any other additive-permission picker.
export async function fetchActivePermissionSets() {
  const { data, error } = await supabase
    .from('permission_sets')
    .select('id, ps_name, ps_description')
    .eq('ps_is_deleted', false)
    .eq('ps_is_active', true)
    .order('ps_name', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({ id: r.id, name: r.ps_name, description: r.ps_description || '' }))
}

// Finish provisioning a field technician after the user record exists. Wraps
// the provision_field_technician RPC, which atomically writes program scopes,
// permission sets, and the user-linked service resource (FSL Service Resource).
export async function provisionFieldTechnician({
  userId, programIds = [], permissionSetIds = [], serviceTerritoryId = null,
} = {}) {
  const { data, error } = await supabase.rpc('provision_field_technician', {
    p_user_id: userId,
    p_program_ids: programIds,
    p_permission_set_ids: permissionSetIds,
    p_service_territory_id: serviceTerritoryId,
  })
  if (error) throw error
  return data
}

// Audit Log — for Administration > Audit Log
//
// Pulls audit_log rows joined to public.users for the performer's display
// name. Optional filters narrow the result set without paginating off the
// end of the list — admins typically know which table or which record they
// want to investigate.
//
// Filters (all optional):
//   • objectFilter  — exact match on al_object (e.g. 'permission_sets')
//   • recordFilter  — exact UUID match on al_record_id
//   • actionFilter  — exact match on al_action (INSERT/UPDATE/SOFT_DELETE/...)
//   • limit         — hard ceiling, default 200, max 1000
export async function fetchAuditLog({
  limit = 200, objectFilter = null, recordFilter = null, actionFilter = null,
} = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000)
  let q = supabase
    .from('audit_log')
    .select('id, al_action, al_object, al_record_id, al_performed_by, al_performed_at, al_notes')
    .order('al_performed_at', { ascending: false })
    .limit(safeLimit)
  if (objectFilter) q = q.eq('al_object', objectFilter)
  if (recordFilter) q = q.eq('al_record_id', recordFilter)
  if (actionFilter) q = q.eq('al_action', actionFilter)
  const { data, error } = await q
  if (error) throw error
  const rows = data || []

  // Resolve performer display names in one batched lookup. Audit rows
  // from service-role calls or pre-trigger seed data have al_performed_by
  // NULL; show 'System' for those.
  const userIds = Array.from(new Set(rows.map(r => r.al_performed_by).filter(Boolean)))
  let nameMap = {}
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, first_name, last_name, user_email')
      .in('id', userIds)
    nameMap = (users || []).reduce((acc, u) => {
      const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
      acc[u.id] = full || u.user_email || u.id.slice(0, 8).toUpperCase()
      return acc
    }, {})
  }

  return rows.map(r => ({
    id: r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    action: r.al_action || '—',
    object: r.al_object || '—',
    recordId: r.al_record_id ? String(r.al_record_id).slice(0, 8).toUpperCase() : '—',
    _recordIdFull: r.al_record_id || null,
    performedBy: r.al_performed_by ? (nameMap[r.al_performed_by] || 'Unknown user') : 'System',
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

// ─── Portal Builder ────────────────────────────────────────────────────────
// Setup-tree fetchers for the three portal-management list views: Portals,
// Portal Role Assignments, and Object Chat Settings. RLS already enforces
// who can read these — Admin and any role with the relevant
// role_object_access entry. Each fetcher follows the existing list-pane
// shape: returns rows with `id` shown as the leftmost column and `_id`
// carrying the actual UUID for routing into RecordDetail.

export async function fetchPortals() {
  const { data, error } = await supabase
    .from('portals')
    .select(`
      id, portal_record_number, portal_name, portal_url_path, portal_hostname,
      portal_description, portal_is_active, portal_theme_color
    `)
    .eq('is_deleted', false)
    .order('portal_name', { ascending: true })

  if (error) throw error

  return (data || []).map(p => ({
    id:          p.portal_record_number || p.id.slice(0, 8).toUpperCase(),
    _id:         p.id,
    name:        p.portal_name,
    urlPath:     p.portal_url_path,
    hostname:    p.portal_hostname || '—',
    description: p.portal_description || '—',
    active:      p.portal_is_active ? 'Active' : 'Inactive',
  }))
}

export async function fetchPortalRoleAssignments() {
  const { data, error } = await supabase
    .from('portal_role_assignments')
    .select(`
      id, pra_is_default,
      portal:portals(id, portal_record_number, portal_name),
      role:roles(id, role_name)
    `)
    .eq('is_deleted', false)

  if (error) throw error

  return (data || []).map(r => ({
    id:        (r.portal?.portal_record_number || '—') + ' / ' + (r.role?.role_name || '—'),
    _id:       r.id,
    portal:    r.portal?.portal_name || '—',
    role:      r.role?.role_name || '—',
    isDefault: r.pra_is_default ? 'Yes' : 'No',
  }))
}

export async function fetchObjectChatEnabled() {
  const { data, error } = await supabase
    .from('object_chat_enabled')
    .select(`id, oce_object_name, oce_chat_enabled, updated_at`)
    .order('oce_object_name', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id:        r.oce_object_name,
    _id:       r.id,
    object:    r.oce_object_name,
    enabled:   r.oce_chat_enabled ? 'Enabled' : 'Disabled',
    updatedAt: r.updated_at ? new Date(r.updated_at).toLocaleDateString() : '—',
  }))
}

// ─── Outbound mailboxes (Communications Module v1) ──────────────────────────
//
// The shared M365 mailboxes that send-email-v1 routes outbound through. State
// separation is in the domain (assessments@EES-WI.org for WI, etc.); per-
// program mailboxes can be layered on top later with the same lookup logic.
//
// Listed under Setup → Communication Templates → Outbound Mailboxes. Clicking
// a row opens the standard record-detail surface so the address, display name,
// active flag, and program assignment can be edited inline.

export async function fetchOutboundMailboxesForListView() {
  const { data, error } = await supabase
    .from('outbound_mailboxes')
    .select(`
      id, obm_record_number, obm_address, obm_display_name, obm_state,
      obm_is_active,
      program:obm_program_id ( name )
    `)
    .eq('obm_is_deleted', false)
    .order('obm_state', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id:           r.obm_record_number || r.id.slice(0, 8).toUpperCase(),
    _id:          r.id,
    address:      r.obm_address,
    displayName:  r.obm_display_name || '—',
    state:        r.obm_state || '—',
    program:      r.program?.name || '— state-only —',
    active:       r.obm_is_active ? 'Active' : 'Inactive',
  }))
}

// ─── Recycle Bin (Phase 1) ────────────────────────────────────────────────
//
// fetchDeletedRecords: pulls soft-deleted rows from a single table via the
//   fetch_deleted_records RPC. The RPC handles all the prefix-variance
//   gymnastics (project_is_deleted vs ps_is_deleted vs is_deleted) and
//   returns a normalized {id, name, deletion_reason, deleted_at, deleted_by}
//   shape, so the front-end doesn't need a per-table mapping.
//
// restoreRecord: flips is_deleted back to false and clears the deletion
//   audit trio. Audit log gets a RESTORE row automatically via the
//   table's trigger. Returns the restored record's id.

// Internal: resolve a set of user ids → display-name map. Single batched
// SELECT; falls back to email then short id when name fields are empty.
async function _resolveUserNames(userIds) {
  if (!userIds || userIds.length === 0) return {}
  const { data } = await supabase
    .from('users')
    .select('id, first_name, last_name, user_email')
    .in('id', userIds)
  return (data || []).reduce((acc, u) => {
    const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
    acc[u.id] = full || u.user_email || u.id.slice(0, 8).toUpperCase()
    return acc
  }, {})
}

// Internal: shape a single RPC row into the UI-friendly object the
// recycle bin renders. Carries _table so cross-table mode can group +
// restore correctly.
function _shapeDeletedRow(row, tableName, nameMap) {
  return {
    id:             row.name || (row.id ? String(row.id).slice(0, 8).toUpperCase() : '—'),
    _id:            row.id,
    _table:         tableName,
    table:          tableName,
    name:           row.name || '—',
    deletionReason: row.deletion_reason || '—',
    deletedAt:      row.deleted_at ? new Date(row.deleted_at).toISOString().replace('T', ' ').slice(0, 19) : '—',
    deletedBy:      row.deleted_by ? (nameMap[row.deleted_by] || 'Unknown user') : '—',
  }
}

export async function fetchDeletedRecords(tableName, { limit = 200 } = {}) {
  const { data, error } = await supabase.rpc('fetch_deleted_records', {
    p_table: tableName,
    p_limit: Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000),
  })
  if (error) throw error
  const rows = data || []
  const userIds = Array.from(new Set(rows.map(r => r.deleted_by).filter(Boolean)))
  const nameMap = await _resolveUserNames(userIds)
  return rows.map(r => _shapeDeletedRow(r, tableName, nameMap))
}

// fetchDeletedRecordsAcrossTables — All-Tables mode for the recycle bin.
// Fans out fetch_deleted_records across the caller-supplied table list
// in parallel, merges results, and sorts by deletedAt descending. Each
// row carries _table so the UI can group + dispatch restore/purge to
// the right table. Per-table limit caps the depth of any one table so
// a single very-deleted table can't dominate the result.
//
// Failures on individual tables are caught and logged silently so one
// dead table doesn't poison the whole view (an admin investigating
// 'where did my record go' shouldn't have the page error out because
// of an unrelated table).
export async function fetchDeletedRecordsAcrossTables(tableNames, { perTableLimit = 50 } = {}) {
  if (!tableNames || tableNames.length === 0) return []
  const safeLimit = Math.min(Math.max(parseInt(perTableLimit, 10) || 50, 1), 200)

  const results = await Promise.all(tableNames.map(async (t) => {
    try {
      const { data, error } = await supabase.rpc('fetch_deleted_records', {
        p_table: t,
        p_limit: safeLimit,
      })
      if (error) {
        console.warn(`fetchDeletedRecordsAcrossTables: ${t} failed`, error.message)
        return { table: t, rows: [] }
      }
      return { table: t, rows: data || [] }
    } catch (err) {
      console.warn(`fetchDeletedRecordsAcrossTables: ${t} threw`, err)
      return { table: t, rows: [] }
    }
  }))

  // Pool every user id from every result for a single batched name lookup.
  const allUserIds = Array.from(new Set(
    results.flatMap(r => r.rows.map(row => row.deleted_by).filter(Boolean))
  ))
  const nameMap = await _resolveUserNames(allUserIds)

  // Flatten + tag with table, then sort by deletedAt desc. Rows with
  // null deletedAt land at the bottom — those are pre-trigger records
  // from before audit-tracking was wired.
  return results
    .flatMap(({ table, rows }) => rows.map(r => _shapeDeletedRow(r, table, nameMap)))
    .sort((a, b) => {
      if (a.deletedAt === '—' && b.deletedAt === '—') return 0
      if (a.deletedAt === '—') return 1
      if (b.deletedAt === '—') return -1
      return b.deletedAt.localeCompare(a.deletedAt)
    })
}

export async function restoreRecord(tableName, recordId) {
  const { data, error } = await supabase.rpc('restore_record', {
    p_table:     tableName,
    p_record_id: recordId,
  })
  if (error) throw error
  if (!data) throw new Error('restore_record returned no id')
  return data
}

// purgeRecord — Recycle Bin Phase 2. Permanently deletes a soft-deleted
// record. Admin-only (the RPC enforces; UI gates the button additionally).
// On FK violation the Postgres error message names the referencing table;
// we surface that as the actionable error so the admin knows what's
// blocking the purge.
export async function purgeRecord(tableName, recordId) {
  const { data, error } = await supabase.rpc('purge_record', {
    p_table:     tableName,
    p_record_id: recordId,
  })
  if (error) {
    // foreign_key_violation (23503) is the common case — surface the
    // referenced table from the error details so the front-end can
    // show a useful message.
    if (error.code === '23503') {
      const refTable = error.details?.match(/from table "([^"]+)"/)?.[1]
      if (refTable) {
        const friendly = refTable.replace(/_/g, ' ')
        throw new Error(`Cannot purge — record is still referenced by ${friendly}. Purge or reassign the dependent records first.`)
      }
    }
    throw error
  }
  if (!data) throw new Error('purge_record returned no id')
  return data
}

// fetchAdminHealthSummary — small dashboard aggregate for the Setup
// welcome pane. Single RPC round-trip; returns a parsed object with
// counts and the last dispatch timestamp.
export async function fetchAdminHealthSummary() {
  const { data, error } = await supabase.rpc('admin_health_summary')
  if (error) throw error
  if (!data) return null
  return {
    audit24h:          data.audit_24h ?? 0,
    recycleBinTotal:   data.recycle_bin_total ?? 0,
    activeUsers:       data.active_users ?? 0,
    permissionSets:    data.permission_sets ?? 0,
    lastDispatch:      data.last_dispatch ? new Date(data.last_dispatch) : null,
    dispatchErrors24h: data.dispatch_errors_24h ?? 0,
    generatedAt:       data.generated_at ? new Date(data.generated_at) : new Date(),
  }
}

// ---------------------------------------------------------------------------
// Lifecycle Builder — status_transitions
// ---------------------------------------------------------------------------
// Two-tier interface:
//   1. fetchStatusLifecycleSummary() — the "which objects have lifecycles"
//      pane. Aggregates picklist_values rows whose picklist_field looks like
//      a status field, joining transition counts from status_transitions.
//   2. fetchStatusTransitionsFor(object, field) — drill-in: returns the
//      ordered list of statuses on this picklist plus every active
//      transition between them.
//
// Both queries return raw uuid identifiers in addition to display strings,
// so the pane can pass them straight back into create/update calls without
// re-resolving.
// ---------------------------------------------------------------------------

// Status fields are conventionally named '<prefix>status', e.g.
// 'work_order_status', 'ia_status', 'prt_status', or plain 'status' on the
// admin-config tables (document_templates, email_templates, accounts).
// This matcher catches all of them while excluding compound state fields
// like 'unit_occupancy_status' or 'recipient_status' that are not master
// lifecycles — those still appear, but with no transitions until an admin
// authors them. Approval-status fields ('work_order_approval_status',
// 'work_step_pc_approval_status') are intentionally included so they can
// have their own transition graphs.
function _looksLikeStatusField(field) {
  if (!field) return false
  if (field === 'status') return true
  if (field === 'stage') return true
  return /(_status|_state|_stage)$/.test(field)
}

export async function fetchStatusLifecycleSummary() {
  // Paginated: picklist_values is past 900 rows and growing. Without
  // pagination this fetch silently truncates and the Status Lifecycle
  // Builder shows partial / wrong lifecycle data for the objects whose
  // picklist rows happen to fall past the 1000-row PostgREST cutoff.
  const pls = await fetchAllPaged((from, to) =>
    supabase
      .from('picklist_values')
      .select('id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_sort_order, picklist_is_active')
      .order('picklist_object',     { ascending: true })
      .order('picklist_field',      { ascending: true })
      .order('picklist_sort_order', { ascending: true })
      .order('id',                  { ascending: true })
      .range(from, to)
  )

  // Pull active transitions; group by (st_object, st_status_field).
  const { data: txns, error: txnsErr } = await supabase
    .from('status_transitions')
    .select('id, st_object, st_status_field, st_is_active')
    .eq('st_is_deleted', false)
  if (txnsErr) throw txnsErr

  // Index transitions by (object, field).
  const txnIdx = new Map()
  for (const t of (txns || [])) {
    const key = `${t.st_object}::${t.st_status_field}`
    const slot = txnIdx.get(key) || { total: 0, active: 0 }
    slot.total++
    if (t.st_is_active) slot.active++
    txnIdx.set(key, slot)
  }

  // Group picklists by (object, field), filtering to status-shaped fields.
  const groups = new Map()
  for (const pv of (pls || [])) {
    if (!_looksLikeStatusField(pv.picklist_field)) continue
    const key = `${pv.picklist_object}::${pv.picklist_field}`
    if (!groups.has(key)) {
      groups.set(key, {
        object:      pv.picklist_object,
        statusField: pv.picklist_field,
        statusCount: 0,
        activeStatusCount: 0,
      })
    }
    const g = groups.get(key)
    g.statusCount++
    if (pv.picklist_is_active) g.activeStatusCount++
  }

  // Materialize into the shape the ListView expects. Stable sort by object
  // then status_field so related lifecycles cluster (work_orders shows its
  // work_order_status alongside work_order_approval_status).
  return Array.from(groups.values())
    .map(g => {
      const t = txnIdx.get(`${g.object}::${g.statusField}`) || { total: 0, active: 0 }
      return {
        id:           `${g.object}::${g.statusField}`,
        _object:      g.object,
        _statusField: g.statusField,
        object:       g.object,
        statusField:  g.statusField,
        statusCount:  g.activeStatusCount,
        statusCountTotal: g.statusCount,
        transitionCount: t.active,
        transitionCountTotal: t.total,
      }
    })
    .sort((a, b) => {
      if (a.object !== b.object) return a.object.localeCompare(b.object)
      return a.statusField.localeCompare(b.statusField)
    })
}

export async function fetchStatusTransitionsFor(object, statusField) {
  if (!object || !statusField) throw new Error('object and statusField required')

  // Statuses for this (object, field) — ordered, including inactive so the
  // graph view can show greyed-out picklist values that still have
  // historical transitions attached.
  const { data: statuses, error: stErr } = await supabase
    .from('picklist_values')
    .select('id, picklist_value, picklist_label, picklist_sort_order, picklist_is_active')
    .eq('picklist_object', object)
    .eq('picklist_field',  statusField)
    .order('picklist_sort_order', { ascending: true })
    .order('picklist_label',      { ascending: true })
  if (stErr) throw stErr

  const { data: txns, error: txnErr } = await supabase
    .from('status_transitions')
    .select(`
      id, st_record_number, st_from_status_id, st_to_status_id,
      st_transition_label, st_description, st_sort_order, st_is_active,
      st_created_at, st_updated_at
    `)
    .eq('st_object',       object)
    .eq('st_status_field', statusField)
    .eq('st_is_deleted',   false)
    .order('st_sort_order', { ascending: true })
    .order('st_created_at', { ascending: true })
  if (txnErr) throw txnErr

  return {
    statuses: (statuses || []).map(s => ({
      id:        s.id,
      value:     s.picklist_value,
      label:     s.picklist_label || s.picklist_value,
      sortOrder: s.picklist_sort_order || 0,
      isActive:  s.picklist_is_active !== false,
    })),
    transitions: (txns || []).map(t => ({
      id:          t.id,
      recordNumber: t.st_record_number,
      fromStatusId: t.st_from_status_id,
      toStatusId:   t.st_to_status_id,
      label:        t.st_transition_label,
      description:  t.st_description,
      sortOrder:    t.st_sort_order || 0,
      isActive:     t.st_is_active,
      createdAt:    t.st_created_at,
      updatedAt:    t.st_updated_at,
    })),
  }
}

export async function createStatusTransition({
  object, statusField, fromStatusId, toStatusId, label, description, sortOrder, isActive,
}) {
  const ownerId = await getCurrentUserId()
  if (!ownerId) throw new Error('Not authenticated — cannot author a transition without a user_id.')

  const payload = {
    st_record_number:    '',
    st_object:           object,
    st_status_field:     statusField,
    st_from_status_id:   fromStatusId || null,
    st_to_status_id:     toStatusId,
    st_transition_label: label,
    st_description:      description || null,
    st_sort_order:       sortOrder ?? 0,
    st_is_active:        isActive !== false,
    st_owner:            ownerId,
    st_created_by:       ownerId,
  }
  const { data, error } = await supabase
    .from('status_transitions')
    .insert(payload)
    .select('id, st_record_number')
    .single()
  if (error) throw error
  return data
}

export async function updateStatusTransition(transitionId, patch) {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('Not authenticated.')

  const mapped = {}
  if ('label'        in patch) mapped.st_transition_label = patch.label
  if ('description'  in patch) mapped.st_description      = patch.description
  if ('sortOrder'    in patch) mapped.st_sort_order       = patch.sortOrder
  if ('isActive'     in patch) mapped.st_is_active        = patch.isActive
  if ('fromStatusId' in patch) mapped.st_from_status_id   = patch.fromStatusId || null
  if ('toStatusId'   in patch) mapped.st_to_status_id     = patch.toStatusId
  mapped.st_updated_by = userId
  mapped.st_updated_at = new Date().toISOString()

  const { error } = await supabase
    .from('status_transitions')
    .update(mapped)
    .eq('id', transitionId)
  if (error) throw error
}

export async function softDeleteStatusTransition(transitionId, reason) {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('Not authenticated.')

  const { error } = await supabase
    .from('status_transitions')
    .update({
      st_is_deleted:      true,
      st_deletion_reason: reason || 'Removed via Lifecycle Builder',
      st_deleted_at:      new Date().toISOString(),
      st_deleted_by:      userId,
    })
    .eq('id', transitionId)
  if (error) throw error
}

// ───────────────────────────────────────────────────────────────────────────
// Scheduling resources (= service_territory_members)
//
// In Salesforce Field Service this is the "Service Resource" object.
// In LEAP it's a junction row pairing a Contact with a Service
// Territory, plus an effective-date window and a primary-territory flag.
// A Contact can sit on multiple territories (one as primary), which is
// the field-team-on-call rotation across territories.
// ───────────────────────────────────────────────────────────────────────────
export async function fetchServiceTerritoryMembers() {
  const data = await fetchAllPaged((from, to) =>
    supabase
      .from('service_territory_members')
      .select(`
        id, stm_record_number,
        service_territory_id,
        contact_id,
        stm_is_primary,
        stm_effective_start_date,
        stm_effective_end_date,
        stm_owner,
        stm_updated_at,
        service_territories:service_territory_id ( service_territory_name, service_territory_state ),
        contacts:contact_id ( contact_name, contact_role ),
        stm_user_id,
        users:stm_user_id ( user_name, user_title )
      `)
      .eq('stm_is_deleted', false)
      .order('stm_updated_at', { ascending: false })
      .order('id',             { ascending: true })
      .range(from, to)
  )

  return data.map(r => {
    // A resource is either contact-linked (service provider) or user-linked
    // (internal W-2 crew). Surface which for the Setup resources list.
    // (internal W-2 crew). Resolve the display person from whichever is set.
    const personName = r.contacts?.contact_name || r.users?.user_name || '—'
    const personRole = r.contacts?.contact_role || r.users?.user_title || ''
    const sourceLabel = r.stm_user_id ? 'Internal (User)' : (r.contact_id ? 'Service Provider (Contact)' : '—')
    return {
      id:        r.stm_record_number || r.id,
      _id:       r.id,
      name:      personName,
      contact:   personName,
      contactRole: personRole,
      source:    sourceLabel,
      territory: r.service_territories?.service_territory_name || '—',
      state:     r.service_territories?.service_territory_state || '',
      primary:   r.stm_is_primary ? 'Yes' : 'No',
      effectiveStart: r.stm_effective_start_date || '',
      effectiveEnd:   r.stm_effective_end_date   || '',
      // Underlying FK ids for the editable list view
      contact_id:          r.contact_id,
      stm_user_id:         r.stm_user_id,
      service_territory_id:r.service_territory_id,
      stm_is_primary:      r.stm_is_primary,
      stm_effective_start_date: r.stm_effective_start_date,
      stm_effective_end_date:   r.stm_effective_end_date,
    }
  })
}

// Resource Absences — calendared time off / unavailability for a
// scheduling resource. Drives dispatch board availability shading.
export async function fetchResourceAbsences() {
  const data = await fetchAllPaged((from, to) =>
    supabase
      .from('resource_absences')
      .select(`
        id, ra_record_number, ra_name,
        contact_id,
        ra_absence_type,
        ra_start_datetime, ra_end_datetime,
        ra_is_all_day, ra_notes,
        ra_owner, ra_updated_at,
        contacts:contact_id ( contact_name )
      `)
      .eq('ra_is_deleted', false)
      .order('ra_start_datetime', { ascending: false, nullsFirst: false })
      .order('id',                { ascending: true })
      .range(from, to)
  )

  return data.map(r => ({
    id:        r.ra_record_number || r.id,
    _id:       r.id,
    name:      r.ra_name || r.contacts?.contact_name || '—',
    contact:   r.contacts?.contact_name || '—',
    absenceType: r.ra_absence_type || '',
    startDate: r.ra_start_datetime ? r.ra_start_datetime.slice(0,10) : '',
    endDate:   r.ra_end_datetime   ? r.ra_end_datetime.slice(0,10)   : '',
    allDay:    r.ra_is_all_day ? 'Yes' : 'No',
    notes:     r.ra_notes || '',
    // Underlying FK ids
    contact_id: r.contact_id,
    ra_name: r.ra_name,
    ra_absence_type: r.ra_absence_type,
    ra_start_datetime: r.ra_start_datetime,
    ra_end_datetime: r.ra_end_datetime,
    ra_is_all_day: r.ra_is_all_day,
    ra_notes: r.ra_notes,
  }))
}
