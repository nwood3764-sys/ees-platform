-- =============================================================================
-- Materialize has_active_opportunity onto properties (fix Properties timeout).
--
-- The Outreach / Enrollment Properties list reads outreach_properties_v and
-- filters/sorts on has_active_opportunity — previously a COMPUTED column (a
-- semi-join), so PostgREST's `WHERE has_active_opportunity = false ORDER BY
-- property_name` forced a full seq scan of 17k wide rows + a full sort on EVERY
-- page, ×8 concurrent workers. Cold-cache / under concurrency this exceeded the
-- statement timeout → "Could not load records".
--
-- Fix: store has_active_opportunity as a real boolean on properties, kept
-- correct by a trigger on opportunities, and expose it in the view as a plain
-- column. Now the filter + sort push down to a composite index, turning each
-- page into an ordered index scan with no sort.
-- =============================================================================

alter table public.properties
  add column if not exists property_has_active_opportunity boolean not null default false;

-- ── Recompute helper: true iff the property has a non-deleted 'Open' opp ─────
create or replace function public.recompute_property_active_opp(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if p_property_id is null then return; end if;
  update public.properties p
     set property_has_active_opportunity = exists (
       select 1
       from public.opportunities o
       join public.picklist_values pv
         on pv.id = o.opportunity_status
        and pv.picklist_object = 'opportunities'
        and pv.picklist_field  = 'opportunity_status'
        and pv.picklist_value  = 'Open'
       where o.property_id = p_property_id
         and coalesce(o.opportunity_is_deleted, false) = false
     )
   where p.id = p_property_id
     and p.property_has_active_opportunity is distinct from (
       exists (
         select 1
         from public.opportunities o
         join public.picklist_values pv
           on pv.id = o.opportunity_status
          and pv.picklist_object = 'opportunities'
          and pv.picklist_field  = 'opportunity_status'
          and pv.picklist_value  = 'Open'
         where o.property_id = p_property_id
           and coalesce(o.opportunity_is_deleted, false) = false
       )
     );
end;
$function$;

-- ── Trigger: keep the flag correct as opportunities change ──────────────────
create or replace function public.trg_opportunities_active_flag()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if tg_op = 'INSERT' then
    perform public.recompute_property_active_opp(new.property_id);
  elsif tg_op = 'DELETE' then
    perform public.recompute_property_active_opp(old.property_id);
  else
    perform public.recompute_property_active_opp(new.property_id);
    if new.property_id is distinct from old.property_id then
      perform public.recompute_property_active_opp(old.property_id);
    end if;
  end if;
  return null;
end;
$function$;

drop trigger if exists opportunities_active_flag_aiud on public.opportunities;
create trigger opportunities_active_flag_aiud
  after insert or update or delete on public.opportunities
  for each row execute function public.trg_opportunities_active_flag();

-- ── Backfill the stored flag from current data ──────────────────────────────
update public.properties p
   set property_has_active_opportunity = exists (
     select 1
     from public.opportunities o
     join public.picklist_values pv
       on pv.id = o.opportunity_status
      and pv.picklist_object = 'opportunities'
      and pv.picklist_field  = 'opportunity_status'
      and pv.picklist_value  = 'Open'
     where o.property_id = p.id
       and coalesce(o.opportunity_is_deleted, false) = false
   )
 where coalesce(p.property_is_deleted, false) = false;

-- ── Composite index: filter by flag, ordered by name ────────────────────────
-- Predicate MUST match the view's own filter (`coalesce(property_is_deleted,
-- false) = false`) or the planner won't use it for outreach_properties_v.
-- With it: the count is a 36ms index scan (was 1453ms) and each page reads the
-- driving properties set via an ordered index scan (was a full seq scan +
-- sort), so the Enrollment/Outreach Properties list no longer times out.
create index if not exists idx_properties_active_opp_order
  on public.properties (property_has_active_opportunity, property_name, id)
  where (coalesce(property_is_deleted, false) = false);

-- ── View now exposes the stored column (filter + sort push down to index) ───
create or replace view public.outreach_properties_v as
select
  p.id, p.property_record_number, p.property_name, p.property_aka_name,
  p.property_street, p.property_city, p.property_state, p.property_zip, p.property_county,
  p.property_total_units, p.property_total_buildings, p.property_year_built,
  p.property_latitude, p.property_longitude, p.property_hud_property_id,
  p.property_lihtc_project_id, p.property_subsidy_type, p.property_status,
  p.property_account_id, p.property_management_company_id,
  owner_account.account_name as property_account_name, owner_account.account_hud_participant_number,
  managing_account.account_name as property_management_company_name,
  psd.id as psd_id, psd.psd_source_dataset, psd.psd_source_imported_at,
  psd.psd_hud_contract_number, psd.psd_hud_contract_type, psd.psd_hud_subsidy_type,
  psd.psd_hud_contract_expiration_date, psd.psd_doe_lead_energy_burden_score,
  psd.psd_doe_lead_average_energy_cost, psd.psd_doe_lead_low_income_percentage,
  pde.id as pde_id, (pde.id is not null) as has_disaster_exposure,
  pde.pde_fema_declaration_count, pde.pde_fema_hurricane_declaration_count, pde.pde_fema_most_recent_declaration_date,
  p.property_has_active_opportunity as has_active_opportunity,
  p.property_category, p.property_type, p.property_assisted_units,
  p.property_in_program_mf_assisted, p.property_in_program_lihtc, p.property_in_program_public_housing,
  p.property_epc_traditional_pathway_eligible, p.property_mf_is_sec8, p.property_is_202_811,
  p.property_mf_is_pac, p.property_mf_is_prac, p.property_mf_is_rad_conversion, p.property_mf_is_subsidized,
  p.property_mf_property_category, p.property_mf_reac_last_score, p.property_mf_reac_last_date, p.property_mf_contract_count,
  p.property_hud_management_org, p.property_hud_management_phone, p.property_hud_management_email,
  p.property_primary_contract_number, p.property_primary_contract_expiration,
  p.property_lihtc_project_name, p.property_lihtc_allocation_amount, p.property_lihtc_total_units,
  p.property_lihtc_low_income_units, p.property_lihtc_year_placed_in_service, p.property_lihtc_credit_type,
  p.property_lihtc_construction_type, p.property_lihtc_target_elderly, p.property_lihtc_target_disabled, p.property_lihtc_target_homeless,
  p.property_ph_participant_code, p.property_ph_authority_name, p.property_ph_development_code, p.property_ph_project_name,
  p.property_ph_total_units, p.property_ph_total_occupied, p.property_ph_pct_occupied, p.property_ph_scattered_site,
  p.property_ph_authority_phone, p.property_ph_authority_email, p.property_data_source, pde.pde_fema_declared_disasters,
  p.property_ph_avg_utility_allowance, p.property_ph_earliest_construction_year,
  p.property_electric_utility, p.property_electric_utility_type, p.property_electric_rate_per_kwh,
  p.property_gas_utility, p.property_has_gas_service, p.property_heating_system_estimate
from properties p
  left join accounts owner_account on owner_account.id = p.property_account_id and coalesce(owner_account.account_is_deleted, false) = false
  left join accounts managing_account on managing_account.id = p.property_management_company_id and coalesce(managing_account.account_is_deleted, false) = false
  left join property_source_data psd on psd.psd_property_id = p.id and coalesce(psd.psd_is_deleted, false) = false
  left join property_disaster_exposure pde on pde.pde_property_id = p.id and coalesce(pde.pde_is_deleted, false) = false
where coalesce(p.property_is_deleted, false) = false;

revoke all on function public.recompute_property_active_opp(uuid) from public, anon;

analyze public.properties;
