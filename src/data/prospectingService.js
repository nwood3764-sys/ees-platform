import { supabase } from '../lib/supabase'
import { loadPicklists } from './outreachService'

/**
 * Prospecting service
 *
 * Reads from the prospecting_properties_v database view, which joins
 * properties → accounts → property_source_data → property_disaster_exposure
 * and computes has_active_opportunity. The view is the spine of the
 * Prospecting module — list view, map view, and CSV export all read from it.
 */

/**
 * Returns properties without an active opportunity, shaped for the
 * Prospecting list view. Picklist values resolved to labels.
 *
 * @param {Object} options
 * @param {boolean} options.includeEngaged - when true, returns ALL properties
 *   (including those with active opportunities). Defaults to false — the
 *   Prospecting view filters them out.
 */
export async function fetchProspectingProperties({ includeEngaged = false } = {}) {
  const picklists = await loadPicklists()

  let query = supabase
    .from('prospecting_properties_v')
    .select(`
      id,
      property_record_number,
      property_name,
      property_aka_name,
      property_street,
      property_city,
      property_state,
      property_zip,
      property_county,
      property_total_units,
      property_total_buildings,
      property_year_built,
      property_latitude,
      property_longitude,
      property_hud_property_id,
      property_lihtc_project_id,
      property_subsidy_type,
      property_status,
      property_account_id,
      property_managing_account_id,
      property_account_name,
      account_hud_participant_number,
      property_managing_account_name,
      psd_source_dataset,
      psd_hud_contract_number,
      psd_hud_contract_type,
      psd_hud_subsidy_type,
      psd_hud_contract_expiration_date,
      psd_doe_lead_energy_burden_score,
      has_disaster_exposure,
      pde_fema_declaration_count,
      pde_fema_hurricane_declaration_count,
      pde_fema_most_recent_declaration_date,
      has_active_opportunity
    `)
    .order('property_name', { ascending: true })

  if (!includeEngaged) {
    query = query.eq('has_active_opportunity', false)
  }

  const { data, error } = await query
  if (error) throw error

  return (data || []).map(r => ({
    // ListView keys
    id:                r.property_record_number || r.id,
    _id:               r.id,
    name:              r.property_name || '',
    akaName:           r.property_aka_name || '',
    address:           [r.property_street, r.property_city].filter(Boolean).join(', '),
    state:             r.property_state || '',
    county:            r.property_county || '',
    zip:               r.property_zip || '',
    units:             r.property_total_units ?? 0,
    buildings:         r.property_total_buildings ?? 0,
    yearBuilt:         r.property_year_built ?? null,
    latitude:          r.property_latitude,
    longitude:         r.property_longitude,
    // HUD identifiers
    hudPropertyId:     r.property_hud_property_id || '',
    lihtcProjectId:    r.property_lihtc_project_id || '',
    // Account
    account:           r.property_account_name || '—',
    accountHudParticipantNumber: r.account_hud_participant_number || '',
    managingAccount:   r.property_managing_account_name || '',
    // Source data
    sourceDataset:     r.psd_source_dataset || '',
    hudContractNumber: r.psd_hud_contract_number || '',
    hudContractType:   r.psd_hud_contract_type || '',
    hudSubsidyType:    r.psd_hud_subsidy_type || '',
    contractExpiration:r.psd_hud_contract_expiration_date || null,
    energyBurden:      r.psd_doe_lead_energy_burden_score ?? null,
    // Disaster exposure
    hasDisasterExposure:     !!r.has_disaster_exposure,
    femaDeclarationCount:    r.pde_fema_declaration_count ?? 0,
    femaHurricaneCount:      r.pde_fema_hurricane_declaration_count ?? 0,
    femaMostRecentDeclaration: r.pde_fema_most_recent_declaration_date || null,
    // Picklist-resolved
    subsidyType:       picklists.byId.get(r.property_subsidy_type) || '—',
    status:            picklists.byId.get(r.property_status) || '—',
    // Engagement flag
    hasActiveOpportunity: !!r.has_active_opportunity,
  }))
}

/**
 * Returns lightweight counts for the Prospecting Home dashboard.
 */
export async function fetchProspectingCounts() {
  const { count: withoutCount, error: e1 } = await supabase
    .from('prospecting_properties_v')
    .select('id', { count: 'exact', head: true })
    .eq('has_active_opportunity', false)
  if (e1) throw e1

  const { count: withCount, error: e2 } = await supabase
    .from('prospecting_properties_v')
    .select('id', { count: 'exact', head: true })
    .eq('has_active_opportunity', true)
  if (e2) throw e2

  const { count: batchCount, error: e3 } = await supabase
    .from('property_import_batches')
    .select('id', { count: 'exact', head: true })
    .eq('pib_is_deleted', false)
  if (e3) throw e3

  return {
    propertiesWithoutOpportunity: withoutCount ?? 0,
    propertiesWithOpportunity:    withCount    ?? 0,
    importBatches:                batchCount   ?? 0,
  }
}

/**
 * Serialises an array of property rows to CSV and triggers a browser
 * download. Used by the Prospecting list view's Export CSV button.
 *
 * @param {Array<Object>} rows  Shaped rows from fetchProspectingProperties
 * @param {string} filename     Defaults to "prospecting-properties.csv"
 */
export function exportProspectingPropertiesCsv(rows, filename = 'prospecting-properties.csv') {
  const columns = [
    ['id',                       'Record #'],
    ['name',                     'Property'],
    ['hudPropertyId',            'HUD Property ID'],
    ['lihtcProjectId',           'LIHTC Project ID'],
    ['account',                  'Account'],
    ['accountHudParticipantNumber', 'HUD Participant #'],
    ['address',                  'Address'],
    ['state',                    'State'],
    ['county',                   'County'],
    ['zip',                      'ZIP'],
    ['units',                    'Units'],
    ['buildings',                'Buildings'],
    ['yearBuilt',                'Year Built'],
    ['subsidyType',              'Subsidy Type'],
    ['hudContractNumber',        'HUD Contract #'],
    ['hudContractType',          'HUD Contract Type'],
    ['contractExpiration',       'Contract Expiration'],
    ['energyBurden',             'Energy Burden Score'],
    ['hasDisasterExposure',      'Disaster Exposure'],
    ['femaDeclarationCount',     'FEMA Declarations'],
    ['femaHurricaneCount',       'FEMA Hurricane Declarations'],
    ['femaMostRecentDeclaration','FEMA Most Recent Declaration'],
    ['sourceDataset',            'Source Dataset'],
  ]

  const escape = (v) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }

  const header = columns.map(([, label]) => escape(label)).join(',')
  const body   = rows.map(r => columns.map(([key]) => escape(r[key])).join(',')).join('\n')
  const csv    = header + '\n' + body + '\n'

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Fetches the list of import batches for the Imports section list view.
 * Most-recent first.
 */
export async function fetchImportBatches() {
  const { data, error } = await supabase
    .from('property_import_batches')
    .select(`
      id,
      pib_record_number,
      pib_source_dataset,
      pib_status,
      pib_records_total,
      pib_records_created,
      pib_records_updated,
      pib_records_skipped,
      pib_records_errored,
      pib_accounts_created,
      pib_accounts_matched,
      pib_started_at,
      pib_completed_at,
      pib_error_report_path,
      pib_owner,
      pib_created_at
    `)
    .eq('pib_is_deleted', false)
    .order('pib_started_at', { ascending: false, nullsFirst: false })
    .order('pib_created_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return (data || []).map(r => ({
    id:             r.pib_record_number || r.id,
    _id:            r.id,
    name:           r.pib_record_number || '',
    sourceDataset:  r.pib_source_dataset || '',
    status:         r.pib_status || '',
    total:          r.pib_records_total ?? 0,
    created:        r.pib_records_created ?? 0,
    updated:        r.pib_records_updated ?? 0,
    skipped:        r.pib_records_skipped ?? 0,
    errored:        r.pib_records_errored ?? 0,
    accountsCreated:r.pib_accounts_created ?? 0,
    accountsMatched:r.pib_accounts_matched ?? 0,
    startedAt:      r.pib_started_at || null,
    completedAt:    r.pib_completed_at || null,
  }))
}

/**
 * Submits a batch of records to the import-prospecting-properties edge
 * function. Returns the function's response payload.
 *
 * @param {string} sourceDataset  e.g. 'HUD_ACTIVE_PORTFOLIO', 'HUD_LIHTC',
 *                                'HUD_MULTIFAMILY_CONTRACTS', 'DOE_LEAD',
 *                                'MANUAL'
 * @param {Array<Object>} records Array of records (see RPC docstring)
 */
export async function submitPropertyImport(sourceDataset, records) {
  const { data, error } = await supabase.functions.invoke('import-prospecting-properties', {
    body: { source_dataset: sourceDataset, records },
  })
  if (error) throw error
  if (data && data.ok === false) {
    throw new Error(data.error || 'Import failed')
  }
  return data
}
