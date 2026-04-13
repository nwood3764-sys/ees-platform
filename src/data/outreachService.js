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
      property_owner_id,
      property_owners:property_owner_id ( property_owner_name )
    `)
    .eq('property_is_deleted', false)
    .order('property_name', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.property_record_number || r.id,
    _id: r.id,
    name: r.property_name || '',
    owner: r.property_owners?.property_owner_name || '—',
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

export async function fetchPropertyOwners() {
  const { data, error } = await supabase
    .from('property_owners')
    .select('id, property_owner_record_number, property_owner_name, property_owner_billing_state, property_owner_phone, property_owner_email')
    .eq('property_owner_is_deleted', false)
    .order('property_owner_name', { ascending: true })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.property_owner_record_number || r.id,
    _id: r.id,
    name: r.property_owner_name,
    state: r.property_owner_billing_state || '',
    phone: r.property_owner_phone || '',
    email: r.property_owner_email || '',
  }))
}
