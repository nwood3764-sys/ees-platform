// =============================================================================
// providerPortalService — data layer for the Service Provider Portal.
//
// The Provider Portal is a standalone bypass surface (mounted at
// /provider-portal in main.jsx) that lets an approved service provider
// (subcontractor) review the work orders EES has issued to them, accept or
// reject the priced proposal, and track their invoices/payments.
//
// Access is resolved entirely server-side by the SECURITY DEFINER RPC
// get_provider_portal_data(), which maps auth.uid() -> portal_users
// (record_type 'Provider User') -> portal_user_account_id and returns ONLY
// that provider's own data. A provider can never see another provider's work,
// pricing, or pay, nor any customer contract value / margin.
// =============================================================================

import { supabase } from '../lib/supabase'

// Generic portal-user session resolution is shared with the customer portal.
export { fetchPortalUserSelf } from './projectPortalService'

// Everything the signed-in provider may see, in one call.
export async function fetchProviderPortalData() {
  const { data, error } = await supabase.rpc('get_provider_portal_data')
  if (error) throw error
  const payload = data || {}
  if (payload.error) {
    return { error: payload.error, provider: null, proposals: [], workOrders: [], invoices: [] }
  }
  return {
    error: null,
    provider: payload.provider || null,
    proposals: payload.proposals || [],
    workOrders: payload.work_orders || [],
    invoices: payload.invoices || [],
  }
}

// Accept or reject an issued proposal. declineReason required when accept=false.
export async function respondToProposal(proposalId, accept, declineReason) {
  const { data, error } = await supabase.rpc('provider_respond_to_proposal', {
    p_proposal_id: proposalId,
    p_accept: accept,
    p_decline_reason: declineReason || null,
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}
