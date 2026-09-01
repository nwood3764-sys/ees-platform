-- Which columns are money, and whose money.
--
-- Every one of the 96 field_metadata rows that carried a tier before this
-- carried tier 1 — "everyone" — so nothing on the platform was restricted at
-- all. This is what actually classifies them.
--
-- Curated explicitly, NOT matched by name pattern alone. A pattern over
-- "cost|value|amount|price" also catches assessment_insulation_r_value,
-- building_attic_linear_feet_of_air_sealing, diagnostic_square_feet_tested,
-- project_incentive_processing_time (days), opportunity_h_s_to_ee_cost_ratio
-- and work_step_field_values.wsfv_numeric_value — none of which are money, and
-- several of which a technician needs. Tiering those would break field work to
-- protect nothing.
--
-- TIER 3 — EES's own economics: what we pay out, what we earn, what it costs us
-- to operate. This is the set that answers "what is our margin on this job".
-- TIER 2 — the money the CUSTOMER and the PROGRAM see: contract values,
-- incentive and rebate amounts, invoice and payment totals, the project cost
-- model. A Project Manager needs these; a technician does not.
-- Everything else stays tier 1.

create or replace function pg_temp.fin_label(p_object text, p_column text)
returns text language sql immutable as $$
  select initcap(replace(
    regexp_replace(
      p_column,
      '^(' || regexp_replace(
                case when p_object like '%ies' then left(p_object, length(p_object)-3) || 'y'
                     when p_object like '%s'   then left(p_object, length(p_object)-1)
                     else p_object end,
              '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || ')_', ''),
    '_', ' '))
$$;

do $$
declare
  v_tier3 text[][] := array[
    ['service_provider_invoices',            'spi_total_amount'],
    ['service_provider_invoices',            'spi_amount_paid'],
    ['service_provider_invoice_line_items',  'spil_amount'],
    ['service_provider_payments',            'spp_amount'],
    ['service_provider_proposals',           'spro_total_amount'],
    ['service_provider_proposal_lines',      'sprl_amount'],
    ['work_orders',                          'work_order_agreed_payout_amount'],
    ['opportunities',                        'opportunity_expected_revenue'],
    ['equipment',                            'equipment_purchase_cost'],
    ['equipment_activities',                 'ea_equipment_activity_estimated_cost'],
    ['vehicle_activities',                   'va_vehicle_activity_cost'],
    ['vehicle_activities',                   'va_fuel_cost'],
    ['vehicle_activities',                   'va_fuel_price_per_gallon'],
    ['vehicle_activities',                   'va_maintenance_cost'],
    ['flow_ai_usage',                        'fau_estimated_cost_usd']
  ];
  v_tier2_tables text[] := array[
    'opportunities','opportunity_line_items','projects','incentive_applications',
    'enrollments','project_payment_requests','project_reservations','payment_receipts',
    'properties','price_book_entries','efr_reports','assessments'
  ];
  v_money_re     text := '(amount|cost|price|revenue|rebate|incentive|payment|allocation)';
  v_not_money_re text := '(r_value|square_feet|linear_feet|processing_time|ratio|_pct|percent|per_gallon)';
  v_row text[];
  v_n int;
begin
  foreach v_row slice 1 in array v_tier3 loop
    if not exists (select 1 from information_schema.columns
                   where table_schema='public' and table_name=v_row[1] and column_name=v_row[2]) then
      raise exception 'Tier 3 names a column that does not exist: %.%', v_row[1], v_row[2];
    end if;
    if exists (select 1 from public.field_metadata
               where fm_object=v_row[1] and fm_column=v_row[2] and fm_is_deleted is not true) then
      update public.field_metadata
         set fm_financial_tier = 3,
             fm_display_type   = coalesce(fm_display_type, 'currency'),
             fm_updated_at     = now()
       where fm_object=v_row[1] and fm_column=v_row[2] and fm_is_deleted is not true;
    else
      insert into public.field_metadata (fm_record_number, fm_object, fm_column, fm_label, fm_financial_tier, fm_display_type)
      values ('', v_row[1], v_row[2], pg_temp.fin_label(v_row[1], v_row[2]), 3, 'currency');
    end if;
  end loop;

  insert into public.field_metadata (fm_record_number, fm_object, fm_column, fm_label, fm_financial_tier, fm_display_type)
  select '', c.table_name, c.column_name, pg_temp.fin_label(c.table_name, c.column_name), 2, 'currency'
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = any(v_tier2_tables)
    and c.data_type in ('numeric','double precision','real')
    and c.column_name ~ v_money_re
    and c.column_name !~ v_not_money_re
    and not exists (
      select 1 from public.field_metadata fm
      where fm.fm_object = c.table_name and fm.fm_column = c.column_name and fm.fm_is_deleted is not true);

  update public.field_metadata fm
     set fm_financial_tier = 2,
         fm_display_type   = coalesce(fm.fm_display_type, 'currency'),
         fm_updated_at     = now()
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = fm.fm_object and c.column_name = fm.fm_column
    and c.table_name = any(v_tier2_tables)
    and c.data_type in ('numeric','double precision','real')
    and c.column_name ~ v_money_re
    and c.column_name !~ v_not_money_re
    and fm.fm_is_deleted is not true
    and fm.fm_financial_tier is distinct from 3;   -- never demote a tier 3

  -- ── Assertions ─────────────────────────────────────────────────────────
  select count(*) into v_n from public.field_metadata
   where fm_financial_tier = 3 and fm_is_deleted is not true;
  if v_n <> array_length(v_tier3, 1) then
    raise exception 'Expected % tier-3 fields, found %', array_length(v_tier3, 1), v_n;
  end if;

  select count(*) into v_n from public.field_metadata
   where fm_financial_tier in (2, 3) and fm_is_deleted is not true
     and fm_column ~ '(r_value|square_feet|linear_feet|processing_time|ratio)';
  if v_n <> 0 then
    raise exception '% non-money column(s) were tiered', v_n;
  end if;

  -- Scoped to the rows THIS migration restricts. Three pre-existing tier-1 rows
  -- name columns that were dropped long ago (ia_business_entity_*); they
  -- restrict nothing and tidying them is not this change's business.
  select count(*) into v_n from public.field_metadata fm
   where fm.fm_financial_tier in (2, 3) and fm.fm_is_deleted is not true
     and not exists (select 1 from information_schema.columns c
                     where c.table_schema='public' and c.table_name=fm.fm_object and c.column_name=fm.fm_column);
  if v_n <> 0 then
    raise exception '% restricted field(s) name a column that does not exist', v_n;
  end if;

  select count(*) into v_n from public.field_metadata where fm_financial_tier = 2 and fm_is_deleted is not true;
  raise notice 'financial tiers: % at tier 2, % at tier 3', v_n, array_length(v_tier3, 1);
end $$;
