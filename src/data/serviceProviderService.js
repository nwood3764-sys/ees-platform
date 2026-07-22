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
             spa_w9_document_id, spa_declined_reason, spa_notes,
             stage:spa_stage(picklist_value,picklist_label),
             trade:spa_service_provider_type(picklist_label),
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

// Decline → stage Declined, account status 'Service Provider Declined'.
export async function declineServiceProviderApplication(applicationId, reason) {
  const { data, error } = await supabase.rpc('decline_service_provider_application', {
    p_application_id: applicationId, p_reason: reason,
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}
