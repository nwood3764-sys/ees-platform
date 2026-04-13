import { supabase } from '../lib/supabase'
import { loadPicklists } from './outreachService'

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export async function fetchVehicles() {
  const picklists = await loadPicklists()

  const { data, error } = await supabase
    .from('vehicles')
    .select(`
      id,
      vehicle_record_number,
      vehicle_name,
      vehicle_year,
      vehicle_make,
      vehicle_model,
      vehicle_vin,
      vehicle_vin_last_3,
      vehicle_license_plate,
      vehicle_license_plate_state,
      vehicle_status,
      vehicle_type,
      vehicle_current_odometer,
      vehicle_odometer_updated_at,
      vehicle_color,
      vehicle_insurance_policy,
      vehicle_insurance_expiry,
      vehicle_registration_expiry,
      assigned_to_id
    `)
    .eq('vehicle_is_deleted', false)
    .order('vehicle_created_at', { ascending: false })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.vehicle_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.vehicle_name,
    yearMakeModel: `${r.vehicle_year || ''} ${r.vehicle_make || ''} ${r.vehicle_model || ''}`.trim(),
    year: r.vehicle_year || '—',
    make: r.vehicle_make || '—',
    model: r.vehicle_model || '—',
    vinLast3: r.vehicle_vin_last_3 || (r.vehicle_vin ? r.vehicle_vin.slice(-3) : '—'),
    plate: r.vehicle_license_plate || '—',
    plateState: r.vehicle_license_plate_state || '—',
    status: picklists.byId.get(r.vehicle_status) || '—',
    type: picklists.byId.get(r.vehicle_type) || '—',
    odometer: r.vehicle_current_odometer ? Number(r.vehicle_current_odometer) : 0,
    odometerUpdatedAt: r.vehicle_odometer_updated_at || '',
    color: r.vehicle_color || '—',
    insuranceExpiry: r.vehicle_insurance_expiry || '—',
    registrationExpiry: r.vehicle_registration_expiry || '—',
    assignedTo: 'Nicholas Wood', // TODO: join users table in a follow-up
  }))
}

// ---------------------------------------------------------------------------
// Vehicle activities (inspections, fuel, maintenance, mileage logs)
// ---------------------------------------------------------------------------

export async function fetchVehicleActivities() {
  const picklists = await loadPicklists()

  const { data, error } = await supabase
    .from('vehicle_activities')
    .select(`
      id,
      va_record_number,
      va_name,
      va_activity_type,
      va_activity_date,
      va_odometer_reading,
      va_fuel_gallons,
      va_fuel_cost,
      va_fuel_station,
      va_maintenance_type,
      va_maintenance_cost,
      va_maintenance_vendor,
      va_next_service_date,
      va_next_service_odometer,
      va_notes,
      vehicle_id,
      vehicles:vehicle_id ( vehicle_name, vehicle_license_plate )
    `)
    .eq('va_is_deleted', false)
    .order('va_activity_date', { ascending: false })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.va_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.va_name,
    vehicle: r.vehicles?.vehicle_name || '—',
    plate: r.vehicles?.vehicle_license_plate || '—',
    activityType: picklists.byId.get(r.va_activity_type) || '—',
    activityDate: r.va_activity_date || '',
    odometer: r.va_odometer_reading ? Number(r.va_odometer_reading) : null,
    fuelGallons: r.va_fuel_gallons ? Number(r.va_fuel_gallons) : null,
    fuelCost: r.va_fuel_cost ? Number(r.va_fuel_cost) : null,
    fuelStation: r.va_fuel_station || '',
    maintenanceType: r.va_maintenance_type || '',
    maintenanceCost: r.va_maintenance_cost ? Number(r.va_maintenance_cost) : null,
    maintenanceVendor: r.va_maintenance_vendor || '',
    nextServiceDate: r.va_next_service_date || '',
    notes: r.va_notes || '',
    performedBy: 'Nicholas Wood',
  }))
}

// ---------------------------------------------------------------------------
// Equipment containers (kits stored on vehicles)
// ---------------------------------------------------------------------------

export async function fetchEquipmentContainers() {
  const { data, error } = await supabase
    .from('equipment_containers')
    .select(`
      id,
      ec_record_number,
      ec_name,
      ec_expected_contents,
      ec_notes,
      issued_to_vehicle_id,
      vehicles:issued_to_vehicle_id ( vehicle_name )
    `)
    .eq('ec_is_deleted', false)
    .order('ec_created_at', { ascending: false })

  if (error) throw error

  return (data || []).map(r => ({
    id: r.ec_record_number || r.id.slice(0, 8).toUpperCase(),
    _id: r.id,
    name: r.ec_name,
    vehicle: r.vehicles?.vehicle_name || 'Shop',
    expectedContents: r.ec_expected_contents || '—',
    notes: r.ec_notes || '',
  }))
}
