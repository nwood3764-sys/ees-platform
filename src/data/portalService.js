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
      portalRole: r.portal_role,
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
