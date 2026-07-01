import { supabase } from '../lib/supabase'

// ---------------------------------------------------------------------------
// Portal users — external users with access via the customer or partner portal.
//
// Schema rework: portal_users used to point at separate property_owners and
// partner_organizations tables. After consolidation, both org types live in
// the unified `accounts` table, and portal_users.portal_user_account_id is
// a single FK regardless of whether the portal user belongs to a property
// owner, a PMC, or a partner organization. The userType / portalType is
// derived from the linked account's record_type.
// ---------------------------------------------------------------------------

export async function fetchPortalUsers() {
  const { data, error } = await supabase
    .from('portal_users')
    .select(`
      id,
      full_name,
      email,
      phone,
      portal_role,
      role:portal_role ( picklist_label ),
      status,
      last_login,
      notes,
      portal_user_account_id,
      accounts:portal_user_account_id (
        account_name,
        account_record_type,
        record_type:account_record_type ( picklist_value, picklist_label )
      )
    `)
    .eq('is_deleted', false)
    .order('last_login', { ascending: false, nullsFirst: false })

  if (error) throw error

  return (data || []).map(r => {
    // The account's record_type tells us which portal flavor this is — a
    // property owner contact, a PMC contact, or a partner org contact. We
    // surface a friendly label so the UI can group/filter without needing
    // to know about the underlying picklist values.
    const rtValue = r.accounts?.record_type?.picklist_value
    const userType = (() => {
      if (rtValue === 'partner_organization') return 'Partner Portal'
      if (rtValue === 'property_owner')       return 'Property Owner Portal'
      if (rtValue === 'property_management_company') return 'Property Manager Portal'
      return 'Portal'
    })()

    return {
      id: r.id.slice(0, 8).toUpperCase(),
      _id: r.id,
      name: r.full_name,
      email: r.email || '—',
      phone: r.phone || '—',
      portalRole: r.role?.picklist_label || '—',
      status: r.status,
      lastLogin: r.last_login
        ? new Date(r.last_login).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'Never',
      organization: r.accounts?.account_name || '—',
      userType,
      notes: r.notes || '',
    }
  })
}

// ---------------------------------------------------------------------------
// Partner organizations
//
// Now a filtered view of accounts where record_type = 'partner_organization'.
// The function name and return shape are kept stable so PortalModule.jsx
// (which renders the Partner Organizations list) does not need to change
// at the call site.
// ---------------------------------------------------------------------------

export async function fetchPartnerOrganizations() {
  // Resolve the partner_organization record-type id once; we filter accounts
  // by it to get only partner orgs out of the unified table.
  const { data: rt, error: rtErr } = await supabase
    .from('picklist_values')
    .select('id')
    .eq('picklist_object', 'accounts')
    .eq('picklist_field', 'record_type')
    .eq('picklist_value', 'partner_organization')
    .maybeSingle()
  if (rtErr) throw rtErr
  if (!rt?.id) return []

  const { data, error } = await supabase
    .from('accounts')
    .select(`
      id,
      account_record_number,
      account_name,
      account_status,
      account_partner_type,
      account_phone,
      billing_street,
      billing_city,
      billing_state,
      billing_zip,
      account_notes,
      status_pl:account_status ( picklist_label )
    `)
    .eq('account_record_type', rt.id)
    .eq('account_is_deleted', false)
    .order('account_name', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.account_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.account_name,
    shortName: '—',
    status: r.status_pl?.picklist_label || '—',
    partnerType: r.account_partner_type || '—',
    phone: r.account_phone || '—',
    city: r.billing_city || '—',
    state: r.billing_state || '—',
    // The old "primary_contact" inline columns moved into the contacts table
    // proper. The Partner Portal UI can fetch contacts attached to the
    // account separately when it needs that data; we don't fold it into
    // the list view to keep the query tight.
    primaryContact: '—',
    primaryContactPhone: '—',
    primaryContactEmail: '—',
    address: [r.billing_street, r.billing_city, r.billing_state, r.billing_zip].filter(Boolean).join(', ') || '—',
    notes: r.account_notes || '',
  }))
}

// ---------------------------------------------------------------------------
// Add to Portal — invite a contact into the Multi-Family Project Portal and
// manage exactly which of their account's properties they may view.
//
// HARD SECURITY RULE: a portal user only ever sees properties on their own
// account, and every property toggle is validated server-side against the
// portal user's bound account (portal_users.portal_user_account_id). The
// browser never writes portal_users / grants directly — it calls the
// account-scoped, permission-gated SECURITY DEFINER RPCs below. Sending the
// invitation email is a separate, explicit step (invite-portal-user edge fn),
// so the whole flow can be tested without ever contacting the person.
// ---------------------------------------------------------------------------

// The two portal roles (Property Administrator / Property Viewer), data-driven.
export async function fetchPortalRoles() {
  const { data, error } = await supabase
    .from('picklist_values')
    .select('id, picklist_label')
    .eq('picklist_object', 'portal_users')
    .eq('picklist_field', 'portal_role')
    .eq('picklist_is_active', true)
    .order('picklist_sort_order')
  if (error) throw error
  return (data || []).map(r => ({ id: r.id, label: r.picklist_label }))
}

// Contacts on an account, with their current portal-user link (if any) so the
// UI can show who already has access.
export async function fetchAccountContacts(accountId) {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, contact_name, contact_email, contact_portal_user_id, contact_has_portal_access')
    .eq('contact_account_id', accountId)
    .eq('contact_is_deleted', false)
    .order('contact_name')
  if (error) throw error
  return (data || []).map(c => ({
    id: c.id,
    name: c.contact_name || '(no name)',
    email: c.contact_email || '',
    portalUserId: c.contact_portal_user_id || null,
    hasPortalAccess: !!c.contact_has_portal_access,
  }))
}

// Every property on an account — the ONLY properties a portal user on that
// account can ever be granted. This is the account-scoped picker source.
export async function fetchAccountProperties(accountId) {
  const { data, error } = await supabase
    .from('properties')
    .select('id, property_record_number, property_name, property_city, property_state')
    .eq('property_account_id', accountId)
    .eq('property_is_deleted', false)
    .order('property_name')
  if (error) throw error
  return (data || []).map(p => ({
    id: p.id,
    recordNumber: p.property_record_number || '',
    name: p.property_name || 'Unnamed Property',
    city: p.property_city || '',
    state: p.property_state || '',
  }))
}

// A portal user's current status + set of granted property ids (for manage mode).
export async function fetchPortalUserAccess(portalUserId) {
  const [{ data: pu, error: puErr }, { data: grants, error: gErr }] = await Promise.all([
    supabase.from('portal_users')
      .select('id, full_name, email, status, portal_role, auth_user_id, portal_user_account_id, role:portal_role ( picklist_label )')
      .eq('id', portalUserId).eq('is_deleted', false).maybeSingle(),
    supabase.from('portal_user_property_grants')
      .select('pug_property_id')
      .eq('pug_portal_user_id', portalUserId)
      .eq('pug_is_deleted', false)
      .not('pug_property_id', 'is', null),
  ])
  if (puErr) throw puErr
  if (gErr) throw gErr
  if (!pu) return null
  return {
    portalUserId: pu.id,
    fullName: pu.full_name,
    email: pu.email,
    status: pu.status,
    portalRole: pu.portal_role,
    portalRoleLabel: pu.role?.picklist_label || '',
    accountId: pu.portal_user_account_id,
    isInvited: !!pu.auth_user_id,
    grantedPropertyIds: (grants || []).map(g => g.pug_property_id),
  }
}

// Create the PENDING portal user + grants for a contact (no email sent).
export async function createPortalInvite({ contactId, portalRoleId, propertyIds }) {
  const { data, error } = await supabase.rpc('portal_invite_create', {
    p_contact_id: contactId,
    p_portal_role: portalRoleId,
    p_property_ids: propertyIds,
  })
  if (error) throw error
  return data
}

// Reconcile a portal user's visible properties to exactly propertyIds.
export async function setPortalGrants({ portalUserId, propertyIds }) {
  const { data, error } = await supabase.rpc('portal_grants_set', {
    p_portal_user_id: portalUserId,
    p_property_ids: propertyIds,
  })
  if (error) throw error
  return data
}

// Revoke a portal user (soft-delete user + grants, unlink contact).
export async function revokePortalAccess({ portalUserId, reason }) {
  const { data, error } = await supabase.rpc('portal_revoke_access', {
    p_portal_user_id: portalUserId,
    p_reason: reason || null,
  })
  if (error) throw error
  return data
}

// Send the invitation email (creates the auth identity). Explicit, opt-in step.
export async function sendPortalInvite({ portalUserId }) {
  const { data, error } = await supabase.functions.invoke('invite-portal-user', {
    body: { portal_user_id: portalUserId },
  })
  if (error) {
    // Edge-function errors carry the JSON body on error.context; surface it.
    let detail = error.message
    try { const b = await error.context?.json?.(); if (b?.error) detail = b.error } catch { /* noop */ }
    throw new Error(detail)
  }
  if (data && data.ok === false) throw new Error(data.error || 'Invite failed')
  return data
}
