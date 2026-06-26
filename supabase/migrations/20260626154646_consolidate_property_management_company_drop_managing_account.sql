-- Consolidate the property management-company lookup onto the explicitly named
-- property_management_company_id and remove the redundant, awkwardly-named
-- property_managing_account_id. Repoints the page-layout widgets (field names and
-- contact-dependency arrays) and the outreach_properties_v view, then drops the
-- old column. The new column is already backfilled (3,295 rows).

-- 1. Rewrite layout widgets: replace every reference to the old field name with
--    the new one. Covers both "name" fields and lookup_dependency.depends_on arrays.
UPDATE page_layout_widgets
SET widget_config = replace(widget_config::text,
      'property_managing_account_id', 'property_management_company_id')::jsonb
WHERE is_deleted=false
  AND widget_config::text LIKE '%property_managing_account_id%';

-- 2. Recreate the outreach view sourcing the management-company column from the
--    consolidated field. Drop first since the column is about to go.
DROP VIEW IF EXISTS public.outreach_properties_v;

CREATE VIEW public.outreach_properties_v
WITH (security_invoker=on) AS
 SELECT v.id,
    v.property_record_number, v.property_name, v.property_aka_name,
    v.property_street, v.property_city, v.property_state, v.property_zip,
    v.property_county, v.property_total_units, v.property_total_buildings,
    v.property_year_built, v.property_latitude, v.property_longitude,
    v.property_hud_property_id, v.property_lihtc_project_id, v.property_subsidy_type,
    v.property_status, v.property_account_id,
    v.property_management_company_id,
    v.property_account_name, v.account_hud_participant_number,
    v.property_management_company_name,
    v.psd_id, v.psd_source_dataset, v.psd_source_imported_at,
    v.psd_hud_contract_number, v.psd_hud_contract_type, v.psd_hud_subsidy_type,
    v.psd_hud_contract_expiration_date, v.psd_doe_lead_energy_burden_score,
    v.psd_doe_lead_average_energy_cost, v.psd_doe_lead_low_income_percentage,
    v.pde_id, v.has_disaster_exposure, v.pde_fema_declaration_count,
    v.pde_fema_hurricane_declaration_count, v.pde_fema_most_recent_declaration_date,
    v.has_active_opportunity, v.property_category, v.property_type,
    v.property_assisted_units, v.property_in_program_mf_assisted,
    v.property_in_program_lihtc, v.property_in_program_public_housing,
    v.property_epc_traditional_pathway_eligible, v.property_mf_is_sec8,
    v.property_is_202_811, v.property_mf_is_pac, v.property_mf_is_prac,
    v.property_mf_is_rad_conversion, v.property_mf_is_subsidized,
    v.property_mf_property_category, v.property_mf_reac_last_score,
    v.property_mf_reac_last_date, v.property_mf_contract_count,
    v.property_hud_management_org, v.property_hud_management_phone,
    v.property_hud_management_email, v.property_primary_contract_number,
    v.property_primary_contract_expiration, v.property_lihtc_project_name,
    v.property_lihtc_allocation_amount, v.property_lihtc_total_units,
    v.property_lihtc_low_income_units, v.property_lihtc_year_placed_in_service,
    v.property_lihtc_credit_type, v.property_lihtc_construction_type,
    v.property_lihtc_target_elderly, v.property_lihtc_target_disabled,
    v.property_lihtc_target_homeless, v.property_ph_participant_code,
    v.property_ph_authority_name, v.property_ph_development_code,
    v.property_ph_project_name, v.property_ph_total_units,
    v.property_ph_total_occupied, v.property_ph_pct_occupied,
    v.property_ph_scattered_site, v.property_ph_authority_phone,
    v.property_ph_authority_email, v.property_data_source,
    v.pde_fema_declared_disasters,
    p.property_ph_avg_utility_allowance, p.property_ph_earliest_construction_year,
    p.property_electric_utility, p.property_electric_utility_type,
    p.property_electric_rate_per_kwh, p.property_gas_utility,
    p.property_has_gas_service, p.property_heating_system_estimate
   FROM ( SELECT p_1.id,
            p_1.property_record_number, p_1.property_name, p_1.property_aka_name,
            p_1.property_street, p_1.property_city, p_1.property_state, p_1.property_zip,
            p_1.property_county, p_1.property_total_units, p_1.property_total_buildings,
            p_1.property_year_built, p_1.property_latitude, p_1.property_longitude,
            p_1.property_hud_property_id, p_1.property_lihtc_project_id, p_1.property_subsidy_type,
            p_1.property_status, p_1.property_account_id,
            p_1.property_management_company_id,
            owner_account.account_name AS property_account_name,
            owner_account.account_hud_participant_number,
            managing_account.account_name AS property_management_company_name,
            psd.id AS psd_id, psd.psd_source_dataset, psd.psd_source_imported_at,
            psd.psd_hud_contract_number, psd.psd_hud_contract_type, psd.psd_hud_subsidy_type,
            psd.psd_hud_contract_expiration_date, psd.psd_doe_lead_energy_burden_score,
            psd.psd_doe_lead_average_energy_cost, psd.psd_doe_lead_low_income_percentage,
            pde.id AS pde_id, pde.id IS NOT NULL AS has_disaster_exposure,
            pde.pde_fema_declaration_count, pde.pde_fema_hurricane_declaration_count,
            pde.pde_fema_most_recent_declaration_date,
            (EXISTS ( SELECT 1 FROM opportunities o
                     JOIN picklist_values pv ON pv.id = o.opportunity_status AND pv.picklist_object = 'opportunities'::text AND pv.picklist_field = 'opportunity_status'::text AND pv.picklist_value = 'Open'::text
                    WHERE o.property_id = p_1.id AND COALESCE(o.opportunity_is_deleted, false) = false)) AS has_active_opportunity,
            p_1.property_category, p_1.property_type, p_1.property_assisted_units,
            p_1.property_in_program_mf_assisted, p_1.property_in_program_lihtc,
            p_1.property_in_program_public_housing, p_1.property_epc_traditional_pathway_eligible,
            p_1.property_mf_is_sec8, p_1.property_is_202_811, p_1.property_mf_is_pac,
            p_1.property_mf_is_prac, p_1.property_mf_is_rad_conversion, p_1.property_mf_is_subsidized,
            p_1.property_mf_property_category, p_1.property_mf_reac_last_score,
            p_1.property_mf_reac_last_date, p_1.property_mf_contract_count,
            p_1.property_hud_management_org, p_1.property_hud_management_phone,
            p_1.property_hud_management_email, p_1.property_primary_contract_number,
            p_1.property_primary_contract_expiration, p_1.property_lihtc_project_name,
            p_1.property_lihtc_allocation_amount, p_1.property_lihtc_total_units,
            p_1.property_lihtc_low_income_units, p_1.property_lihtc_year_placed_in_service,
            p_1.property_lihtc_credit_type, p_1.property_lihtc_construction_type,
            p_1.property_lihtc_target_elderly, p_1.property_lihtc_target_disabled,
            p_1.property_lihtc_target_homeless, p_1.property_ph_participant_code,
            p_1.property_ph_authority_name, p_1.property_ph_development_code,
            p_1.property_ph_project_name, p_1.property_ph_total_units,
            p_1.property_ph_total_occupied, p_1.property_ph_pct_occupied,
            p_1.property_ph_scattered_site, p_1.property_ph_authority_phone,
            p_1.property_ph_authority_email, p_1.property_data_source,
            pde.pde_fema_declared_disasters
           FROM properties p_1
             LEFT JOIN accounts owner_account ON owner_account.id = p_1.property_account_id AND COALESCE(owner_account.account_is_deleted, false) = false
             LEFT JOIN accounts managing_account ON managing_account.id = p_1.property_management_company_id AND COALESCE(managing_account.account_is_deleted, false) = false
             LEFT JOIN property_source_data psd ON psd.psd_property_id = p_1.id AND COALESCE(psd.psd_is_deleted, false) = false
             LEFT JOIN property_disaster_exposure pde ON pde.pde_property_id = p_1.id AND COALESCE(pde.pde_is_deleted, false) = false
          WHERE COALESCE(p_1.property_is_deleted, false) = false) v
     JOIN properties p ON p.id = v.id;

-- 3. Drop the redundant column (its FK drops with it).
ALTER TABLE properties DROP COLUMN property_managing_account_id;

NOTIFY pgrst, 'reload schema';
