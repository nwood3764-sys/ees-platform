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
