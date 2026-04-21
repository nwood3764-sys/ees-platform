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
      id, name, description, subject, state, related_object, record_type,
      trigger_status, is_manual, is_automated, status
    `)
    .order('name', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.name,
    description: r.description || '—',
    subject: r.subject,
    state: r.state || '—',
    relatedObject: r.related_object || '—',
    recordType: r.record_type || '—',
    triggerStatus: r.trigger_status || '—',
    manual: r.is_manual ? 'Yes' : 'No',
    automated: r.is_automated ? 'Yes' : 'No',
    status: r.status,
  }))
}

// ---------------------------------------------------------------------------
// Document templates (Template Builder — document flavor, for e-signature)
// ---------------------------------------------------------------------------

export async function fetchDocumentTemplates() {
  const { data, error } = await supabase
    .from('document_templates')
    .select(`
      id, name, description, template_type, state, related_object, record_type,
      requires_signature, signer_role, trigger_status, is_manual, is_automated, status
    `)
    .order('name', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.name,
    description: r.description || '—',
    templateType: r.template_type,
    state: r.state || '—',
    relatedObject: r.related_object || '—',
    recordType: r.record_type || '—',
    requiresSignature: r.requires_signature ? 'Yes' : 'No',
    signerRole: r.signer_role || '—',
    triggerStatus: r.trigger_status || '—',
    manual: r.is_manual ? 'Yes' : 'No',
    automated: r.is_automated ? 'Yes' : 'No',
    status: r.status,
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
    .select('id, page_layout_record_number, page_layout_name, page_layout_object, page_layout_type, page_layout_is_default, page_layout_description, role_id, created_at, updated_at')
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
export async function fetchUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('id, user_record_number, user_first_name, user_last_name, user_email, user_phone, user_title, role_id, user_is_active, user_created_at')
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
    status: r.user_is_active ? 'Active' : 'Inactive',
  }))
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
