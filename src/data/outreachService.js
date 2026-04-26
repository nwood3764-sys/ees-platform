import { supabase } from '../lib/supabase'

// ---------------------------------------------------------------------------
// Picklist cache
// ---------------------------------------------------------------------------
// Many columns on property/building/unit are uuid foreign keys into
// picklist_values. The UI needs to display the human label, and the
// ListView component needs to know the full set of options so filter
// dropdowns work. We fetch picklist_values once per page load and build
// two maps: id → label, and (object,field) → [label,...].

let _picklistPromise = null

export function loadPicklists() {
  if (_picklistPromise) return _picklistPromise
  _picklistPromise = (async () => {
    const { data, error } = await supabase
      .from('picklist_values')
      .select('id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order')
      .order('picklist_sort_order', { ascending: true })
    if (error) throw error
    const byId = new Map()
    const byField = new Map()
    for (const row of data || []) {
      if (row.picklist_is_active === false) continue
      byId.set(row.id, row.picklist_label || row.picklist_value)
      const k = `${row.picklist_object}.${row.picklist_field}`
      if (!byField.has(k)) byField.set(k, [])
      byField.get(k).push(row.picklist_label || row.picklist_value)
    }
    return { byId, byField }
  })()
  return _picklistPromise
}

export function picklistOptions(picklists, object, field) {
  return picklists.byField.get(`${object}.${field}`) || []
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export async function fetchProperties() {
  const picklists = await loadPicklists()

  const { data, error } = await supabase
    .from('properties')
    .select(`
      id,
      property_record_number,
      property_name,
      property_street,
      property_city,
      property_state,
      property_zip,
      property_total_units,
      property_total_buildings,
      property_status,
      property_subsidy_type,
      property_account_id,
      accounts:property_account_id ( account_name )
    `)
    .eq('property_is_deleted', false)
    .order('property_name', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.property_record_number || r.id,
    _id: r.id,
    name: r.property_name || '',
    owner: r.accounts?.account_name || '—',
    address: [r.property_street, r.property_city].filter(Boolean).join(', '),
    units: r.property_total_units ?? 0,
    buildings: r.property_total_buildings ?? 0,
    status: picklists.byId.get(r.property_status) || '—',
    subsidy: picklists.byId.get(r.property_subsidy_type) || '—',
    state: r.property_state || '',
  }))
}

export async function fetchBuildings() {
  const picklists = await loadPicklists()

  const { data, error } = await supabase
    .from('buildings')
    .select(`
      id,
      building_record_number,
      building_name,
      building_number_or_name,
      building_status,
      building_type,
      building_heating_system_type,
      building_cooling_type,
      building_year_built,
      building_total_units,
      building_stories,
      property_id,
      properties:property_id ( property_name, property_state )
    `)
    .eq('building_is_deleted', false)
    .order('building_name', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.building_record_number || r.id,
    _id: r.id,
    name: r.building_name || r.building_number_or_name || '',
    property: r.properties?.property_name || '—',
    units: r.building_total_units ?? 0,
    stories: r.building_stories ?? 0,
    type: picklists.byId.get(r.building_type) || '—',
    status: picklists.byId.get(r.building_status) || '—',
    heating: picklists.byId.get(r.building_heating_system_type) || '—',
    cooling: picklists.byId.get(r.building_cooling_type) || '—',
    yearBuilt: r.building_year_built ?? '',
    state: r.properties?.property_state || '',
  }))
}

export async function fetchUnits() {
  const picklists = await loadPicklists()

  const { data, error } = await supabase
    .from('units')
    .select(`
      id,
      unit_record_number,
      unit_name,
      unit_number,
      unit_status,
      unit_bedrooms,
      unit_bathrooms,
      unit_square_footage,
      building_id,
      buildings:building_id (
        building_name,
        property_id,
        properties:property_id ( property_name, property_state )
      )
    `)
    .eq('unit_is_deleted', false)
    .order('unit_number', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.unit_record_number || r.id,
    _id: r.id,
    name: r.unit_name || r.unit_number || '',
    unit: r.unit_number || '',
    building: r.buildings?.building_name || '—',
    property: r.buildings?.properties?.property_name || '—',
    status: picklists.byId.get(r.unit_status) || '—',
    bedrooms: r.unit_bedrooms ?? '',
    bathrooms: r.unit_bathrooms ?? '',
    sqft: r.unit_square_footage ?? '',
    state: r.buildings?.properties?.property_state || '',
  }))
}

// Property owners moved into the unified `accounts` table with
// record_type = 'property_owner'. The function name is kept for backward
// compatibility with anything that imports it; the implementation now
// queries accounts and filters by record type.
export async function fetchPropertyOwners() {
  // Resolve the picklist row id for accounts.record_type = 'property_owner'
  // so we can filter accounts to only that record type.
  const { data: rt, error: rtErr } = await supabase
    .from('picklist_values')
    .select('id')
    .eq('picklist_object', 'accounts')
    .eq('picklist_field', 'record_type')
    .eq('picklist_value', 'property_owner')
    .maybeSingle()
  if (rtErr) throw rtErr
  if (!rt?.id) return []

  const { data, error } = await supabase
    .from('accounts')
    .select('id, account_record_number, account_name, billing_state, account_phone, account_email')
    .eq('account_record_type', rt.id)
    .eq('account_is_deleted', false)
    .order('account_name', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.account_record_number || r.id,
    _id: r.id,
    name: r.account_name,
    state: r.billing_state || '',
    phone: r.account_phone || '',
    email: r.account_email || '',
  }))
}

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export async function fetchOpportunities() {
  const picklists = await loadPicklists()

  const { data, error } = await supabase
    .from('opportunities')
    .select(`
      id,
      opportunity_record_number,
      opportunity_name,
      opportunity_stage,
      opportunity_status,
      opportunity_program,
      opportunity_amount,
      opportunity_close_date,
      opportunity_state,
      opportunity_owner,
      property_id,
      properties:property_id ( property_name, property_total_units )
    `)
    .eq('opportunity_is_deleted', false)
    .order('opportunity_close_date', { ascending: true })

  if (error) throw error

  const fmtAmount = n => n == null ? '—' : `$${Number(n).toLocaleString()}`
  return (data || []).map(r => ({
    id: r.opportunity_record_number || r.id,
    _id: r.id,
    name: r.opportunity_name || '',
    property: r.properties?.property_name || '—',
    stage: picklists.byId.get(r.opportunity_stage) || '—',
    program: r.opportunity_program || '—',
    owner: 'Nicholas Wood', // placeholder — user join comes in a follow-up pass
    amount: fmtAmount(r.opportunity_amount),
    _amountRaw: Number(r.opportunity_amount) || 0,
    units: r.properties?.property_total_units ?? 0,
    closeDate: r.opportunity_close_date || '',
    state: r.opportunity_state || '',
  }))
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export async function fetchContacts() {
  const picklists = await loadPicklists()

  const { data, error } = await supabase
    .from('contacts')
    .select(`
      id,
      contact_record_number,
      contact_name,
      contact_title,
      contact_role,
      contact_status,
      contact_phone,
      contact_email,
      contact_account_id,
      accounts:contact_account_id ( account_name, billing_state )
    `)
    .eq('contact_is_deleted', false)
    .order('contact_name', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.contact_record_number || r.id,
    _id: r.id,
    name: r.contact_name,
    title: r.contact_title || '',
    org: r.accounts?.account_name || '—',
    role: picklists.byId.get(r.contact_role) || '—',
    email: r.contact_email || '',
    phone: r.contact_phone || '',
    status: picklists.byId.get(r.contact_status) || '—',
    state: r.accounts?.billing_state || '',
  }))
}

// ---------------------------------------------------------------------------
// Enrollments (property_programs joined to properties + programs)
// ---------------------------------------------------------------------------
// The "enrollments" concept in the UI maps to rows in property_programs —
// the junction between a property and a program, with a lifecycle status.
// Each property can be enrolled in multiple programs simultaneously, and
// each enrollment has its own independent status.

export async function fetchEnrollments() {
  const { data, error } = await supabase
    .from('property_programs')
    .select(`
      id,
      status,
      enrollment_date,
      affordability_category,
      census_tract,
      is_dac,
      property_id,
      program_id,
      properties:property_id ( property_name, property_state, property_total_units ),
      programs:program_id ( name, short_name, state )
    `)
    .order('enrollment_date', { ascending: false })

  if (error) throw error

  // The list-view columns defined in the Outreach module expect a set of
  // sub-status fields (hafAgreement, incomeQual, censusTract, rentRoll,
  // dacDesignation). property_programs.status is a single text lifecycle,
  // so we derive those sub-statuses from the main status string. The
  // dedicated tracking columns live on related docs/records and get wired
  // in a follow-up pass.
  const derive = status => {
    const s = status || ''
    const hafAgreement =
      s.includes('HAF Agreement Pending') ? 'Pending' :
      (s.includes('Complete') || s.includes('Executed') || s.includes('Income Qualification') || s.includes('Census Tract')) ? 'Executed' :
      'Not Started'
    const incomeQual =
      s.includes('Income Qualification In Progress') ? 'In Progress' :
      s.includes('Complete') ? 'Complete' :
      s.includes('Review') ? 'In Review' :
      'Not Started'
    const censusTract =
      s.includes('Census Tract Verification') ? 'Pending' :
      s.includes('Complete') ? 'Verified' :
      'Pending'
    return { hafAgreement, incomeQual, censusTract }
  }

  return (data || []).map(r => {
    const d = derive(r.status)
    // Strip "Enrollment — " prefix for the name column, keep full for status
    const propertyName = r.properties?.property_name || '—'
    const programShort = r.programs?.short_name || r.programs?.name || '—'
    return {
      id: r.id.slice(0, 8).toUpperCase(),
      _id: r.id,
      name: `${propertyName} – ${programShort}`,
      property: propertyName,
      program: programShort,
      status: r.status || '—',
      owner: 'Nicholas Wood',
      hafAgreement: d.hafAgreement,
      incomeQual: d.incomeQual,
      censusTract: d.censusTract,
      dacDesignation: r.is_dac ? 'Yes' : 'No',
      rentRoll: d.hafAgreement === 'Executed' ? 'Received' : 'Not Received',
      state: r.properties?.property_state || r.programs?.state || '',
      units: r.properties?.property_total_units || 0,
    }
  })
}

// ---------------------------------------------------------------------------
// Accounts — unified org/household table (Salesforce-style).
//
// Replaces the old fetchPropertyOwners as the canonical org list. Returns
// every account regardless of record type, with the record-type label
// surfaced as a column so the user can filter (Property Owner vs PMC vs
// Partner Org vs Customer Household vs EES-WI Internal, etc.).
//
// fetchPropertyOwners() above is kept around as a back-compat shim that
// returns only the property_owner subset for callers that haven't been
// migrated yet (e.g., property-detail dropdowns).
// ---------------------------------------------------------------------------
export async function fetchAccounts() {
  const { data, error } = await supabase
    .from('accounts')
    .select(`
      id,
      account_record_number,
      account_name,
      account_organization_name,
      account_phone,
      account_email,
      account_website,
      billing_city,
      billing_state,
      billing_zip,
      record_type:account_record_type ( picklist_label ),
      type_pl:account_type            ( picklist_label ),
      status_pl:account_status        ( picklist_label )
    `)
    .eq('account_is_deleted', false)
    .order('account_name', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.account_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.account_name || '—',
    orgName: r.account_organization_name || '—',
    recordType: r.record_type?.picklist_label || '—',
    type: r.type_pl?.picklist_label || '—',
    status: r.status_pl?.picklist_label || '—',
    phone: r.account_phone || '—',
    email: r.account_email || '—',
    website: r.account_website || '—',
    city: r.billing_city || '—',
    state: r.billing_state || '—',
  }))
}
