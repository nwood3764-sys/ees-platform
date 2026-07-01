-- =============================================================================
-- List-view performance — ordered pagination indexes + outreach view rewrite.
--
-- The app loads list views by paging through a table ordered by (name, id) with
-- 8 concurrent range requests. Without an index matching that sort, every page
-- re-sorts the ENTIRE table (measured: 17,411-row quicksort + 384k buffer hits,
-- ~410ms PER page, ×8 workers ×~17 pages). These partial indexes on
-- (name, id) WHERE not deleted turn each page into a cheap ordered index scan
-- and also make the exact-count HEAD query index-only.
--
-- outreach_properties_v is rewritten to (a) drop a pointless second self-join
-- back to properties, and (b) compute has_active_opportunity ONCE as a hashed
-- semi-join instead of a correlated per-row EXISTS. Output columns are unchanged.
-- =============================================================================

-- ── Ordered pagination indexes (name, id) — soft-delete partial ─────────────
-- The partial predicate MUST match the app's actual filter (`_is_deleted = false`,
-- not a COALESCE wrapper) or the planner cannot prove the index applies and will
-- fall back to a full sort. Verified: with these, the deep-page query drops from
-- ~410ms (17k-row quicksort) to ~16ms (ordered index scan).
create index if not exists idx_properties_list_order
  on public.properties (property_name, id)
  where (property_is_deleted = false);

create index if not exists idx_buildings_list_order
  on public.buildings (building_name, id)
  where (building_is_deleted = false);

create index if not exists idx_accounts_list_order
  on public.accounts (account_name, id)
  where (account_is_deleted = false);

-- ── outreach_properties_v — remove self-join + hash the open-opp check ───────
create or replace view public.outreach_properties_v as
select
  p.id,
  p.property_record_number,
  p.property_name,
  p.property_aka_name,
  p.property_street,
  p.property_city,
  p.property_state,
  p.property_zip,
  p.property_county,
  p.property_total_units,
  p.property_total_buildings,
  p.property_year_built,
  p.property_latitude,
  p.property_longitude,
  p.property_hud_property_id,
  p.property_lihtc_project_id,
  p.property_subsidy_type,
  p.property_status,
  p.property_account_id,
  p.property_management_company_id,
  owner_account.account_name as property_account_name,
  owner_account.account_hud_participant_number,
  managing_account.account_name as property_management_company_name,
  psd.id as psd_id,
  psd.psd_source_dataset,
  psd.psd_source_imported_at,
  psd.psd_hud_contract_number,
  psd.psd_hud_contract_type,
  psd.psd_hud_subsidy_type,
  psd.psd_hud_contract_expiration_date,
  psd.psd_doe_lead_energy_burden_score,
  psd.psd_doe_lead_average_energy_cost,
  psd.psd_doe_lead_low_income_percentage,
  pde.id as pde_id,
  (pde.id is not null) as has_disaster_exposure,
  pde.pde_fema_declaration_count,
  pde.pde_fema_hurricane_declaration_count,
  pde.pde_fema_most_recent_declaration_date,
  (active_opp.property_id is not null) as has_active_opportunity,
  p.property_category,
  p.property_type,
  p.property_assisted_units,
  p.property_in_program_mf_assisted,
  p.property_in_program_lihtc,
  p.property_in_program_public_housing,
  p.property_epc_traditional_pathway_eligible,
  p.property_mf_is_sec8,
  p.property_is_202_811,
  p.property_mf_is_pac,
  p.property_mf_is_prac,
  p.property_mf_is_rad_conversion,
  p.property_mf_is_subsidized,
  p.property_mf_property_category,
  p.property_mf_reac_last_score,
  p.property_mf_reac_last_date,
  p.property_mf_contract_count,
  p.property_hud_management_org,
  p.property_hud_management_phone,
  p.property_hud_management_email,
  p.property_primary_contract_number,
  p.property_primary_contract_expiration,
  p.property_lihtc_project_name,
  p.property_lihtc_allocation_amount,
  p.property_lihtc_total_units,
  p.property_lihtc_low_income_units,
  p.property_lihtc_year_placed_in_service,
  p.property_lihtc_credit_type,
  p.property_lihtc_construction_type,
  p.property_lihtc_target_elderly,
  p.property_lihtc_target_disabled,
  p.property_lihtc_target_homeless,
  p.property_ph_participant_code,
  p.property_ph_authority_name,
  p.property_ph_development_code,
  p.property_ph_project_name,
  p.property_ph_total_units,
  p.property_ph_total_occupied,
  p.property_ph_pct_occupied,
  p.property_ph_scattered_site,
  p.property_ph_authority_phone,
  p.property_ph_authority_email,
  p.property_data_source,
  pde.pde_fema_declared_disasters,
  p.property_ph_avg_utility_allowance,
  p.property_ph_earliest_construction_year,
  p.property_electric_utility,
  p.property_electric_utility_type,
  p.property_electric_rate_per_kwh,
  p.property_gas_utility,
  p.property_has_gas_service,
  p.property_heating_system_estimate
from properties p
  left join accounts owner_account
    on owner_account.id = p.property_account_id
   and coalesce(owner_account.account_is_deleted, false) = false
  left join accounts managing_account
    on managing_account.id = p.property_management_company_id
   and coalesce(managing_account.account_is_deleted, false) = false
  left join property_source_data psd
    on psd.psd_property_id = p.id
   and coalesce(psd.psd_is_deleted, false) = false
  left join property_disaster_exposure pde
    on pde.pde_property_id = p.id
   and coalesce(pde.pde_is_deleted, false) = false
  left join (
    select distinct o.property_id
    from opportunities o
    join picklist_values pv
      on pv.id = o.opportunity_status
     and pv.picklist_object = 'opportunities'
     and pv.picklist_field  = 'opportunity_status'
     and pv.picklist_value  = 'Open'
    where coalesce(o.opportunity_is_deleted, false) = false
      and o.property_id is not null
  ) active_opp on active_opp.property_id = p.id
where coalesce(p.property_is_deleted, false) = false;

-- Refresh planner stats so the new indexes are chosen immediately.
analyze public.properties;
analyze public.buildings;
analyze public.accounts;
