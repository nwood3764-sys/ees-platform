import { supabase, fetchAllPaged, fetchAllPagedParallel } from '../lib/supabase'
import { loadPicklists } from './outreachService'

/**
 * Outreach service
 *
 * Reads from the outreach_properties_v database view, which joins
 * properties → accounts → property_source_data → property_disaster_exposure
 * and computes has_active_opportunity. The view is the spine of the
 * Outreach module — list view, map view, and CSV export all read from it.
 */

/**
 * Returns properties without an active opportunity, shaped for the
 * Outreach list view. Picklist values resolved to labels.
 *
 * @param {Object} options
 * @param {boolean} options.includeEngaged - when true, returns ALL properties
 *   (including those with active opportunities). Defaults to false — the
 *   Outreach view filters them out.
 */
export async function fetchOutreachProperties({ includeEngaged = false } = {}) {
  const picklists = await loadPicklists()

  // Paginated full-table read: outreach today is ~6,800 rows; will
  // grow into the tens of thousands as the remaining program states
  // ingest. PostgREST caps every single response at 1000 rows, so the
  // only correct path is .range(from,to) in a loop via fetchAllPaged.
  const SELECT_COLS = `
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
      property_management_company_id,
      property_account_name,
      account_hud_participant_number,
      property_management_company_name,
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
    `

  // Paginated full-table read via fetchAllPagedParallel: a single HEAD
  // count first, then all page requests fire concurrently. For 6,785
  // properties this drops the wall time from ~40s (7 sequential 1000-row
  // round trips) to ~3s (8 concurrent page requests, bounded by the
  // slowest single page). countQuery applies the SAME has_active_opportunity
  // filter as the page builder when includeEngaged is false — without
  // that, the count would be the unfiltered total and we'd request
  // pages past the actual data.
  const data = await fetchAllPagedParallel(
    (from, to) => {
      let q = supabase
        .from('outreach_properties_v')
        .select(SELECT_COLS)
        .order('property_name', { ascending: true })
        .order('id',            { ascending: true })   // tie-breaker for stable pagination
        .range(from, to)
      if (!includeEngaged) q = q.eq('has_active_opportunity', false)
      return q
    },
    () => {
      let q = supabase
        .from('outreach_properties_v')
        .select('id', { count: 'exact', head: true })
      if (!includeEngaged) q = q.eq('has_active_opportunity', false)
      return q
    },
  )

  return data.map(r => ({
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
    // Underlying FK id for the Account column — surfaces to the
    // EditableListView so the Account lookup picker can write the
    // chosen account back to property_account_id.
    property_account_id: r.property_account_id || null,
    accountHudParticipantNumber: r.account_hud_participant_number || '',
    managingAccount:   r.property_management_company_name || '',
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
 * Returns lightweight counts for the Outreach Home dashboard.
 */
export async function fetchOutreachCounts() {
  const { count: withoutCount, error: e1 } = await supabase
    .from('outreach_properties_v')
    .select('id', { count: 'exact', head: true })
    .eq('has_active_opportunity', false)
  if (e1) throw e1

  const { count: withCount, error: e2 } = await supabase
    .from('outreach_properties_v')
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
 * download. Used by the Outreach list view's Export CSV button.
 *
 * @param {Array<Object>} rows  Shaped rows from fetchOutreachProperties
 * @param {string} filename     Defaults to "outreach-properties.csv"
 */
export function exportOutreachPropertiesCsv(rows, filename = 'outreach-properties.csv') {
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
  // Paginated full-table read. Import batches accumulate at ~1 row per
  // ingest pass; for any single program-state seed (200 chunks × 4
  // datasets = ~800 batches) this is well under the 1000-row PostgREST
  // cap, but using fetchAllPaged here is cheap insurance.
  const SELECT_COLS = `
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
      pib_created_at,
      pib_is_deleted
    `
  // NOTE: we filter is_deleted=false in JS rather than .eq(... false) so
  // rows where pib_is_deleted is NULL (older inserts before the column
  // had a default propagated) still show. Server-side .eq('col', false)
  // does NOT match NULL.
  const data = await fetchAllPaged((from, to) =>
    supabase
      .from('property_import_batches')
      .select(SELECT_COLS)
      .order('pib_started_at', { ascending: false, nullsFirst: false })
      .order('pib_created_at', { ascending: false })
      .range(from, to)
  )
  return data.filter(r => r.pib_is_deleted !== true).map(r => ({
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
 * Submits a batch of records to the import-outreach-properties edge
 * function. Returns the function's response payload.
 *
 * @param {string} sourceDataset  e.g. 'HUD_ACTIVE_PORTFOLIO', 'HUD_LIHTC',
 *                                'HUD_MULTIFAMILY_CONTRACTS', 'DOE_LEAD',
 *                                'MANUAL'
 * @param {Array<Object>} records Array of records (see RPC docstring)
 */
export async function submitPropertyImport(sourceDataset, records) {
  const { data, error } = await supabase.functions.invoke('import-outreach-properties', {
    body: { source_dataset: sourceDataset, records },
  })
  if (error) throw error
  if (data && data.ok === false) {
    throw new Error(data.error || 'Import failed')
  }
  return data
}

/**
 * Fetches the full HUD program detail for a single property, for the
 * map detail card. Reads the extended outreach view (all program blocks,
 * NC disaster exposure, DOE energy burden) plus the one-to-many HUD
 * contract lines from property_hud_contract_lines.
 *
 * Returns a shaped object the OutreachPropertyCard renders directly, or
 * null if the property isn't found. Program blocks that don't apply
 * (e.g. LIHTC fields on a Section 8-only property) come back as nulls and
 * the card hides their section.
 *
 * @param {string} propertyId  properties.id (uuid)
 */
export async function fetchPropertyDetail(propertyId) {
  if (!propertyId) return null

  const [{ data: row, error: rowErr }, { data: contracts, error: cErr }] = await Promise.all([
    supabase.from('outreach_properties_v').select('*').eq('id', propertyId).maybeSingle(),
    supabase
      .from('property_hud_contract_lines')
      .select('phcl_contract_number, phcl_program_type, phcl_assisted_units, phcl_expiration_date, phcl_contract_sequence')
      .eq('phcl_property_id', propertyId)
      .eq('phcl_is_deleted', false)
      .order('phcl_contract_sequence', { ascending: true }),
  ])
  if (rowErr) throw rowErr
  if (cErr) throw cErr
  if (!row) return null

  const isNC = (row.property_state || '').toUpperCase() === 'NC'

  return {
    id:           row.id,
    recordNumber: row.property_record_number || '',
    name:         row.property_name || 'Unnamed property',
    akaName:      row.property_aka_name || '',
    // Property Details
    street:   row.property_street || '',
    city:     row.property_city || '',
    county:   row.property_county || '',
    state:    row.property_state || '',
    zip:      row.property_zip || '',
    latitude:  row.property_latitude,
    longitude: row.property_longitude,
    category: row.property_category || row.property_mf_property_category || '',
    hudPropertyId:  row.property_hud_property_id || '',
    lihtcProjectId: row.property_lihtc_project_id || '',
    // Building Info
    buildingType: row.property_type || row.property_mf_property_category || '',
    totalUnits:   row.property_total_units ?? null,
    assistedUnits:row.property_assisted_units ?? null,
    totalBuildings: row.property_total_buildings ?? null,
    yearBuilt:    row.property_year_built ?? null,
    // Program presence flags
    inMfAssisted:    !!row.property_in_program_mf_assisted,
    inLihtc:         !!row.property_in_program_lihtc,
    inPublicHousing: !!row.property_in_program_public_housing,
    epcEligible:     row.property_epc_traditional_pathway_eligible, // true/false/null
    // Program flag detail (for the flag column)
    isSec8:       !!row.property_mf_is_sec8,
    is202811:     !!row.property_is_202_811,
    isPac:        !!row.property_mf_is_pac,
    isPrac:       !!row.property_mf_is_prac,
    isRadConverted: !!row.property_mf_is_rad_conversion,
    isSubsidized: !!row.property_mf_is_subsidized,
    // Owner / management
    accountId:        row.property_account_id || null,
    accountName:      row.property_account_name || '',
    managementOrg:    row.property_hud_management_org || '',
    managementPhone:  row.property_hud_management_phone || '',
    managementEmail:  row.property_hud_management_email || '',
    // MF detail
    reacScore: row.property_mf_reac_last_score || '',
    reacDate:  row.property_mf_reac_last_date || null,
    contractCount: row.property_mf_contract_count ?? (contracts ? contracts.length : 0),
    // Contracts (one-to-many)
    contracts: (contracts || []).map(c => ({
      number:     c.phcl_contract_number || '',
      programType:c.phcl_program_type || '',
      units:      c.phcl_assisted_units ?? null,
      expiration: c.phcl_expiration_date || null,
      sequence:   c.phcl_contract_sequence ?? null,
    })),
    // LIHTC block
    lihtc: row.property_in_program_lihtc ? {
      projectName:  row.property_lihtc_project_name || '',
      allocation:   row.property_lihtc_allocation_amount ?? null,
      totalUnits:   row.property_lihtc_total_units ?? null,
      lowIncomeUnits: row.property_lihtc_low_income_units ?? null,
      yearPlacedInService: row.property_lihtc_year_placed_in_service ?? null,
      creditType:   row.property_lihtc_credit_type || '',
      constructionType: row.property_lihtc_construction_type || '',
      targetElderly:  !!row.property_lihtc_target_elderly,
      targetDisabled: !!row.property_lihtc_target_disabled,
      targetHomeless: !!row.property_lihtc_target_homeless,
    } : null,
    // Public Housing block
    publicHousing: row.property_in_program_public_housing ? {
      participantCode: row.property_ph_participant_code || '',
      authorityName:   row.property_ph_authority_name || '',
      developmentCode: row.property_ph_development_code || '',
      projectName:     row.property_ph_project_name || '',
      totalUnits:      row.property_ph_total_units ?? null,
      totalOccupied:   row.property_ph_total_occupied ?? null,
      pctOccupied:     row.property_ph_pct_occupied ?? null,
      scatteredSite:   !!row.property_ph_scattered_site,
      authorityPhone:  row.property_ph_authority_phone || '',
      authorityEmail:  row.property_ph_authority_email || '',
      avgUtilityAllowance: row.property_ph_avg_utility_allowance ?? null,
      earliestConstructionYear: row.property_ph_earliest_construction_year ?? null,
    } : null,
    // Energy burden (DOE LEAD) — may be null
    energyBurden:      row.psd_doe_lead_energy_burden_score ?? null,
    avgEnergyCost:     row.psd_doe_lead_average_energy_cost ?? null,
    lowIncomePct:      row.psd_doe_lead_low_income_percentage ?? null,
    // Utilities & Heating (EIA electric, gas service, heating heuristic)
    electricUtility:     row.property_electric_utility || '',
    electricUtilityType: row.property_electric_utility_type || '',
    electricRate:        row.property_electric_rate_per_kwh ?? null,
    gasUtility:          row.property_gas_utility || '',
    hasGasService:       row.property_has_gas_service,
    heatingEstimate:     row.property_heating_system_estimate || '',
    // Disaster exposure (NC only)
    disaster: (isNC && row.has_disaster_exposure) ? {
      declarationCount:  row.pde_fema_declaration_count ?? 0,
      hurricaneCount:    row.pde_fema_hurricane_declaration_count ?? 0,
      mostRecent:        row.pde_fema_most_recent_declaration_date || null,
      declaredDisasters: row.pde_fema_declared_disasters || null,
    } : null,
    isNC,
  }
}
