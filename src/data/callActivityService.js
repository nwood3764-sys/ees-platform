// -----------------------------------------------------------------------------
// callActivityService.js
//
// Data layer for manually-logged activities on a record — primarily "Log a
// Call" for outreach on opportunities, but the plumbing is object-agnostic
// (it writes to the polymorphic public.activities table via related_object/
// related_id, so it works on any record that shows the Activity tab).
//
// Backed by two RLS-respecting RPCs (migration
// 20260701120000_call_logging_activities_v1):
//   - list_activities_for_record(p_related_object, p_related_id)
//   - log_activity(p_related_object, p_related_id, p_activity_type, …)
//
// activity_type and direction options are managed picklist values
// (picklist_object='activities'), never hardcoded here.
// -----------------------------------------------------------------------------

import { supabase } from '../lib/supabase'

// Fetch every logged activity (calls, notes, meetings…) for one record,
// newest first. Rows already carry the performer name and, when linked, the
// contact name — resolved server-side by the RPC.
export async function fetchActivitiesForRecord(tableName, recordId) {
  if (!tableName || !recordId) return []
  const { data, error } = await supabase.rpc('list_activities_for_record', {
    p_related_object: tableName,
    p_related_id: recordId,
  })
  if (error) throw error
  return data || []
}

// Fetch the active picklist values for an activities.* field (e.g.
// 'activity_type', 'direction') as [{ value, label }], sorted.
export async function fetchActivityPicklist(field) {
  const { data, error } = await supabase
    .from('picklist_values')
    .select('picklist_value, picklist_label, picklist_sort_order')
    .eq('picklist_object', 'activities')
    .eq('picklist_field', field)
    .eq('picklist_is_active', true)
    .order('picklist_sort_order', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    value: r.picklist_value,
    label: r.picklist_label || r.picklist_value,
  }))
}

// Contacts a logged call can be attributed to. For opportunities this is the
// set of contacts joined through opportunity_contact_roles (the Salesforce
// OpportunityContactRole equivalent). For other objects there's no defined
// contact linkage yet, so we return an empty list and the contact field is
// simply left optional in the composer.
export async function fetchLinkedContactsForRecord(tableName, recordId) {
  if (tableName !== 'opportunities' || !recordId) return []
  const { data, error } = await supabase
    .from('opportunity_contact_roles')
    .select('contact_id, ocr_is_primary, contacts:contact_id (id, contact_name, contact_phone, contact_mobile_phone, contact_email)')
    .eq('opportunity_id', recordId)
    .eq('ocr_is_deleted', false)
  if (error) throw error
  return (data || [])
    .map(r => {
      const c = r.contacts
      if (!c) return null
      return {
        id: c.id,
        name: c.contact_name || c.contact_email || 'Unnamed contact',
        phone: c.contact_mobile_phone || c.contact_phone || null,
        email: c.contact_email || null,
        isPrimary: !!r.ocr_is_primary,
      }
    })
    .filter(Boolean)
    // Primary contact first, then alphabetical.
    .sort((a, b) => (b.isPrimary - a.isPrimary) || a.name.localeCompare(b.name))
}

// The connected parent records a user can also link an activity to when
// logging from a given record (its property/account/building/opportunity).
// Returns [{ object, id, label, typeLabel }]. Contacts are handled separately.
export async function fetchRelatableRecords(tableName, recordId) {
  if (!tableName || !recordId) return []
  const { data, error } = await supabase.rpc('list_relatable_records', {
    p_object: tableName,
    p_id: recordId,
  })
  if (error) throw error
  return (data || []).map(r => ({
    object: r.rel_object,
    id: r.rel_id,
    label: r.rel_label || r.rel_type_label,
    typeLabel: r.rel_type_label,
  }))
}

// Log an activity against a record (call, email, meeting, site visit, event,
// note, …). Returns the new activity id. `activityType` is a managed picklist
// value. duration is taken in minutes from the composer and stored as seconds.
// occurredAt is an ISO string (defaults server-side to now() when null).
// contactId, when provided, is stored as the activity's secondary link. The
// activity is also related to every record in `relations` ([{object, id}]) so
// it rolls up onto each of those records' Activity timelines.
export async function logActivity({
  tableName,
  recordId,
  activityType = 'Call',
  subject,
  direction = null,
  durationMinutes = null,
  occurredAt = null,
  contactId = null,
  comments = null,
  relations = [],
}) {
  if (!tableName || !recordId) throw new Error('A record is required to log an activity.')
  if (!activityType) throw new Error('An activity type is required.')

  const minutes = Number(durationMinutes)
  const durationSeconds =
    Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : null

  const relPayload = (relations || [])
    .filter(r => r && r.object && r.id)
    .map(r => ({ object: r.object, id: r.id, role: r.role || 'related' }))

  const { data, error } = await supabase.rpc('log_activity', {
    p_related_object: tableName,
    p_related_id: recordId,
    p_activity_type: activityType,
    p_subject: (subject && subject.trim()) || activityType,
    p_body: (comments && comments.trim()) || null,
    p_direction: direction || null,
    p_duration_seconds: durationSeconds,
    p_performed_at: occurredAt || null,
    p_secondary_object: contactId ? 'contacts' : null,
    p_secondary_id: contactId || null,
    p_relations: relPayload,
  })
  if (error) throw error
  return data // new activity uuid
}
