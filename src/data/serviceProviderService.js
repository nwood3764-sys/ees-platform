// =============================================================================
// serviceProviderService — internal (staff) data layer for the Service
// Providers module: reviewing intake applications, approving (which activates
// the account + auto-sends the provider portal invite) or declining them.
// =============================================================================

import { supabase } from '../lib/supabase'

// Applications with resolved stage / trade / account, newest first.
export async function fetchServiceProviderApplications() {
  const { data, error } = await supabase
    .from('service_provider_applications')
    .select(`id, spa_record_number, spa_company_legal_name, spa_dba_name, spa_home_state,
             spa_submitted_at, spa_source, spa_entity_type,
             spa_contact_first_name, spa_contact_last_name, spa_contact_title,
             spa_contact_email, spa_contact_phone, spa_business_phone, spa_business_email, spa_website,
             spa_license_number, spa_license_type, spa_license_state, spa_license_expiration_date,
             spa_general_liability_carrier, spa_workers_comp_carrier,
             spa_w9_document_id, spa_coi_document_id, spa_declined_reason, spa_notes, spa_decision_notes, spa_reviewed_at, spa_primary_contact_id,
             stage:spa_stage(picklist_value,picklist_label),
             trade:spa_service_provider_type(picklist_label),
             trades:service_provider_trades!spt_application_id(spt_name,spt_is_primary,spt_is_deleted),
             account:spa_account_id(id,account_name,account_service_provider_is_active)`)
    .eq('spa_is_deleted', false)
    .order('spa_submitted_at', { ascending: false, nullsFirst: false })
  if (error) throw error
  return data || []
}

// Active service provider accounts (approved + activated) for the
// "Issue to Provider" picker on a work order.
export async function fetchActiveServiceProviders() {
  const { data: rt } = await supabase
    .from('picklist_values').select('id')
    .eq('picklist_object', 'accounts').eq('picklist_field', 'record_type').eq('picklist_value', 'service_provider')
    .maybeSingle()
  let q = supabase
    .from('accounts')
    .select('id, account_name, account_service_provider_home_state, trade:account_service_provider_type(picklist_label)')
    .eq('account_service_provider_is_active', true)
    .eq('account_is_deleted', false)
    .order('account_name')
  if (rt?.id) q = q.eq('account_record_type', rt.id)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// Issue a priced proposal for a work order to a provider. The RPC prices the
// work order's installed measures via the state/per-provider payout book.
export async function issueWorkOrderToProvider(providerAccountId, workOrderId, notes) {
  const { data, error } = await supabase.rpc('generate_service_provider_proposal', {
    p_provider_account_id: providerAccountId,
    p_work_order_ids: [workOrderId],
    p_state: null,
    p_notes: notes || null,
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// A short-lived signed URL to view/download an application's uploaded W-9
// (or any document) from its private bucket. Returns null if no file is on file.
export async function getDocumentSignedUrl(documentId) {
  if (!documentId) return null
  const { data: doc, error } = await supabase
    .from('documents').select('storage_bucket, storage_path')
    .eq('id', documentId).maybeSingle()
  if (error) throw error
  if (!doc?.storage_bucket || !doc?.storage_path) return null
  const { data, error: e2 } = await supabase.storage
    .from(doc.storage_bucket).createSignedUrl(doc.storage_path, 300)
  if (e2) throw e2
  return data?.signedUrl || null
}

// ZIP areas of operation for an account.
export async function fetchServiceAreas(accountId) {
  const { data, error } = await supabase
    .from('service_provider_service_areas')
    .select('spsa_zip_code, spsa_state')
    .eq('spsa_account_id', accountId)
    .eq('spsa_is_deleted', false)
    .order('spsa_zip_code')
  if (error) throw error
  return data || []
}

// Approve → activates the account + provisions the provider portal login +
// AUTO-SENDS the auth invite (via the approve-service-provider edge function).
export async function approveServiceProviderApplication(applicationId) {
  const { data, error } = await supabase.functions.invoke('approve-service-provider', {
    body: { application_id: applicationId },
  })
  if (error) throw new Error(error.message || 'Approval failed')
  if (data && data.ok === false) throw new Error(data.error || data.detail || 'Approval failed')
  return data
}

// Approve WITHOUT emailing — activates the account and provisions the provider
// portal login as pending. The invite is sent separately, when staff choose.
export async function approveWithoutInvite(applicationId) {
  const { data, error } = await supabase.rpc('approve_service_provider_application', {
    p_application_id: applicationId, p_portal_role: 'service_provider_admin',
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// Send the portal invite when staff decide the provider is ready. Idempotent:
// re-runs approve (harmless) and emails the invite if not already sent.
export async function sendPortalInvite(applicationId) {
  const { data, error } = await supabase.functions.invoke('approve-service-provider', {
    body: { application_id: applicationId },
  })
  if (error) throw new Error(error.message || 'Invite failed')
  if (data && data.ok === false) throw new Error(data.error || data.detail || 'Invite failed')
  return data
}

// Staff-initiated onboarding: create an application (+ inactive account +
// contact) for a provider EES recruited, source 'Manual Entry'.
export async function createManualApplication({ company, firstName, lastName, email, phone, trade, state }) {
  const { data, error } = await supabase.rpc('create_service_provider_application', {
    p_payload: {
      company_legal_name: company,
      contact_first_name: firstName || null,
      contact_last_name: lastName || null,
      contact_email: email || null,
      contact_phone: phone || null,
      service_provider_type: trade || null,
      home_state: state || 'NC',
      source: 'Manual Entry',
    },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// Move an application to any pipeline stage (with an optional note).
export async function advanceApplication(applicationId, stageValue, note) {
  const { data, error } = await supabase.rpc('advance_service_provider_application', {
    p_application_id: applicationId, p_stage_value: stageValue, p_note: note || null,
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// ── Communication tracking ──────────────────────────────────────────────
// Every application carries a full communication/notes trail via the shared
// activity layer, anchored on the 'service_provider_applications' object.

// The activity log for an application, newest first (internal notes + logged
// pipeline actions + calls/emails staff record while working the applicant).
export async function fetchApplicationActivities(applicationId) {
  const { data, error } = await supabase.rpc('list_activities_for_record', {
    p_related_object: 'service_provider_applications', p_related_id: applicationId,
  })
  if (error) throw error
  return data || []
}

// Record a note / logged communication on an application. activityType is one
// of the shared activity picklist values (Note, Call, Email, Meeting, …).
export async function logApplicationActivity(applicationId, { activityType = 'Note', subject = null, body = null, direction = null } = {}) {
  const { data, error } = await supabase.rpc('log_activity', {
    p_related_object: 'service_provider_applications', p_related_id: applicationId,
    p_activity_type: activityType, p_subject: subject, p_body: body, p_direction: direction,
  })
  if (error) throw error
  return data
}

// ── Onboarding checklist ─────────────────────────────────────────────────
// The multi-step onboarding process (documents reviewed, initial interview,
// onboarding session, training) is tracked as a per-application checklist,
// instantiated from configurable templates. The portal invite is gated on it.

// Instantiate (idempotent) + return an application's onboarding steps in order.
export async function fetchOnboardingSteps(applicationId) {
  const { data, error } = await supabase.rpc('ensure_service_provider_onboarding_steps', {
    p_application_id: applicationId,
  })
  if (error) throw error
  return data || []
}

// Mark an onboarding step complete/incomplete (records who + when server-side).
export async function setOnboardingStep(stepId, complete, notes) {
  const { data, error } = await supabase.rpc('set_service_provider_onboarding_step', {
    p_step_id: stepId, p_complete: complete, p_notes: notes || null,
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// Decline → stage Declined, account status 'Service Provider Declined'.
export async function declineServiceProviderApplication(applicationId, reason) {
  const { data, error } = await supabase.rpc('decline_service_provider_application', {
    p_application_id: applicationId, p_reason: reason,
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}
