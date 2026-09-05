-- Turn the published rows into equipment somebody can actually pick.
--
-- ── One product per MACHINE ───────────────────────────────────────────────
--
-- The published list is one row per certified PAIRING -- an outdoor unit with
-- one indoor coil -- so a ducted outdoor unit appears once for every coil it is
-- certified against. After refusing R-410A the staging table holds 234,601 rows
-- and those are about 11,600 machines:
--
--   Ducted heat pumps    220,897 rows  ->  3,935 machines
--   Ductless heat pumps   10,484 rows  ->  4,463 machines
--   Furnaces               3,220 rows  ->  3,220 machines
--
-- Writing one product per published row would put 234,601 rows in the
-- catalogue an auditor picks from, most of them the same machine listed over
-- and over. So: one product per manufacturer + model number.
--
-- ── Which pairing's numbers go on the machine, and why it is written down ──
--
-- A ducted outdoor unit performs differently with different coils, so "the
-- heating output of this unit" is not a single fact. The pairing chosen is the
-- one with the HIGHEST HEATING OUTPUT AT 5 DEGREES, because the question sizing
-- asks is whether the machine can carry the heating load when it is coldest.
--
-- The certificate number that pairing came from is stored on the product
-- (product_ahri_certificate_number), so the answer is traceable to a specific
-- certified combination and can be checked. It is NOT an average across
-- pairings: averaging would produce numbers describing a machine that does not
-- exist, and would quietly undersize a building.
--
-- ── The audit trigger is switched off for the load, deliberately ──────────
--
-- Writing 11,600 products fires log_audit_and_field_history 11,600 times and
-- records a bulk import as though a person had typed each row. The trigger is
-- disabled by name for the load and switched straight back on -- the narrower
-- instrument, since session_replication_role is no longer available on this
-- project and disabling everything would also drop foreign key enforcement.

BEGIN;

-- A machine is its manufacturer and its model number. This is the same rule
-- create_qualifying_equipment_for_measure already de-duplicates on, made
-- explicit so two imports cannot mint two rows for one physical machine.
CREATE UNIQUE INDEX IF NOT EXISTS products_manufacturer_model_key
  ON public.products (lower(product_manufacturer), lower(product_model_number))
  WHERE product_is_deleted IS NOT TRUE
    AND product_manufacturer IS NOT NULL
    AND product_model_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.promote_energy_star_equipment_catalogue()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE
  v_owner        uuid;
  v_rt_heatpump  uuid;
  v_rt_furnace   uuid;
  v_family       uuid;
  v_before       integer;
  v_after        integer;
BEGIN
  SELECT id INTO v_owner FROM public.users
   WHERE user_email = 'nicholas.wood@ees-wi.org' AND user_is_active LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'No active owner to assign the catalogue to; every record needs a named owner.';
  END IF;

  SELECT id INTO v_rt_heatpump FROM public.picklist_values
   WHERE picklist_object='products' AND picklist_field='record_type'
     AND picklist_value='HEAT-PUMP-EQUIPMENT' LIMIT 1;
  SELECT id INTO v_rt_furnace FROM public.picklist_values
   WHERE picklist_object='products' AND picklist_field='record_type'
     AND picklist_value='FURNACE-EQUIPMENT' LIMIT 1;
  SELECT id INTO v_family FROM public.picklist_values
   WHERE picklist_object='products' AND picklist_field='product_family'
     AND picklist_value='HVAC Equipment' LIMIT 1;

  IF v_rt_heatpump IS NULL OR v_rt_furnace IS NULL THEN
    RAISE EXCEPTION 'The heat pump and furnace record types must exist before the catalogue is loaded.';
  END IF;

  SELECT count(*) INTO v_before FROM public.products WHERE product_is_deleted IS NOT TRUE;

  ALTER TABLE public.products DISABLE TRIGGER trg_audit_products;

  -- ── Heat pumps ──────────────────────────────────────────────────────────
  WITH ranked AS (
    SELECT r.*,
           row_number() OVER (
             PARTITION BY lower(r.esr_brand), lower(r.esr_model_number)
             ORDER BY nullif(r.esr_payload->>'heating_capacity_at_5_f_btu_h','')::numeric
                        DESC NULLS LAST,
                      nullif(r.esr_payload->>'hspf2_btu_wh','')::numeric DESC NULLS LAST,
                      r.esr_source_id
           ) AS pick
      FROM public.energy_star_equipment_import_rows r
     WHERE r.esr_dataset = 'heat_pumps'
       AND r.esr_brand IS NOT NULL
       AND r.esr_model_number IS NOT NULL
  ), best AS (
    SELECT * FROM ranked WHERE pick = 1
  )
  INSERT INTO public.products AS p (
    product_record_number, product_name, product_record_type, product_family,
    product_owner, product_created_by, product_is_active,
    product_manufacturer, product_model_number, product_series_name,
    product_equipment_category, product_ducting_configuration,
    product_variable_capacity, product_refrigerant_type,
    product_ahri_certificate_number,
    product_seer2, product_eer2, product_hspf2_region_iv,
    product_heating_capacity_47f, product_heating_capacity_17f,
    product_heating_capacity_5f, product_heating_cop_5f,
    product_cooling_capacity_95f,
    product_energy_star_v6_1, product_energy_star_v6_1_cold_climate
  )
  SELECT
    '',
    btrim(b.esr_brand || ' ' || b.esr_model_number),
    v_rt_heatpump,
    v_family,
    v_owner, v_owner, true,
    b.esr_brand,
    b.esr_model_number,
    nullif(b.esr_payload->>'series_name',''),
    (SELECT id FROM public.picklist_values
      WHERE picklist_object='products' AND picklist_field='product_equipment_category'
        AND picklist_value='Heat Pump'),
    (SELECT id FROM public.picklist_values
      WHERE picklist_object='products' AND picklist_field='product_ducting_configuration'
        AND picklist_value = CASE b.esr_payload->>'product_type'
                               WHEN 'HP - Mini or Multi Split' THEN 'Ductless'
                               ELSE 'Ducted' END),
    (SELECT id FROM public.picklist_values
      WHERE picklist_object='products' AND picklist_field='product_variable_capacity'
        AND picklist_value = CASE b.esr_payload->>'compressor_staging'
                               WHEN 'Continuously variable' THEN 'Continuously Variable'
                               WHEN 'Two-stage'             THEN 'Two-Stage'
                               WHEN 'Single stage'          THEN 'Single Stage'
                             END),
    (SELECT id FROM public.picklist_values
      WHERE picklist_object='products' AND picklist_field='product_refrigerant_type'
        AND picklist_value = split_part(b.esr_payload->>'refrigerant_with_gwp', ' ', 1)),
    nullif(regexp_replace(coalesce(b.esr_certificate_number,''), '[^0-9]', '', 'g'), '')::bigint,
    nullif(b.esr_payload->>'seer2_btu_wh','')::numeric,
    nullif(b.esr_payload->>'eer2_btu_wh','')::numeric,
    nullif(b.esr_payload->>'hspf2_btu_wh','')::numeric,
    round(nullif(b.esr_payload->>'heating_capacity_at_47_f_btu_h','')::numeric)::integer,
    round(nullif(b.esr_payload->>'heating_capacity_at_17_f_btu_h','')::numeric)::integer,
    round(nullif(b.esr_payload->>'heating_capacity_at_5_f_btu_h','')::numeric)::integer,
    nullif(b.esr_payload->>'cop_at_5_f','')::numeric,
    round(nullif(b.esr_payload->>'cooling_capacity_btu_h','')::numeric)::integer,
    NULL, NULL
  FROM best b
  ON CONFLICT (lower(product_manufacturer), lower(product_model_number))
    WHERE product_is_deleted IS NOT TRUE
      AND product_manufacturer IS NOT NULL
      AND product_model_number IS NOT NULL
  DO UPDATE SET
    product_series_name             = excluded.product_series_name,
    product_ducting_configuration   = excluded.product_ducting_configuration,
    product_variable_capacity       = excluded.product_variable_capacity,
    product_refrigerant_type        = excluded.product_refrigerant_type,
    product_ahri_certificate_number = excluded.product_ahri_certificate_number,
    product_seer2                   = excluded.product_seer2,
    product_eer2                    = excluded.product_eer2,
    product_hspf2_region_iv         = excluded.product_hspf2_region_iv,
    product_heating_capacity_47f    = excluded.product_heating_capacity_47f,
    product_heating_capacity_17f    = excluded.product_heating_capacity_17f,
    product_heating_capacity_5f     = excluded.product_heating_capacity_5f,
    product_heating_cop_5f          = excluded.product_heating_cop_5f,
    product_cooling_capacity_95f    = excluded.product_cooling_capacity_95f;

  -- ── Furnaces ────────────────────────────────────────────────────────────
  -- A furnace has no refrigerant, no ducting choice worth recording (it is
  -- always ducted) and one efficiency figure. Its capacity is not published
  -- here, so the column stays empty rather than being guessed at.
  WITH ranked AS (
    SELECT r.*,
           row_number() OVER (
             PARTITION BY lower(r.esr_brand), lower(r.esr_model_number)
             ORDER BY nullif(r.esr_payload->>'efficiency_afue','')::numeric DESC NULLS LAST,
                      r.esr_source_id
           ) AS pick
      FROM public.energy_star_equipment_import_rows r
     WHERE r.esr_dataset = 'furnaces'
       AND r.esr_brand IS NOT NULL
       AND r.esr_model_number IS NOT NULL
  ), best AS (SELECT * FROM ranked WHERE pick = 1)
  INSERT INTO public.products AS p (
    product_record_number, product_name, product_record_type, product_family,
    product_owner, product_created_by, product_is_active,
    product_manufacturer, product_model_number,
    product_equipment_category, product_ducting_configuration
  )
  SELECT
    '',
    btrim(b.esr_brand || ' ' || b.esr_model_number),
    v_rt_furnace, v_family, v_owner, v_owner, true,
    b.esr_brand, b.esr_model_number,
    (SELECT id FROM public.picklist_values
      WHERE picklist_object='products' AND picklist_field='product_equipment_category'
        AND picklist_value='Furnace'),
    (SELECT id FROM public.picklist_values
      WHERE picklist_object='products' AND picklist_field='product_ducting_configuration'
        AND picklist_value='Ducted')
  FROM best b
  ON CONFLICT (lower(product_manufacturer), lower(product_model_number))
    WHERE product_is_deleted IS NOT TRUE
      AND product_manufacturer IS NOT NULL
      AND product_model_number IS NOT NULL
  DO NOTHING;

  ALTER TABLE public.products ENABLE TRIGGER trg_audit_products;

  SELECT count(*) INTO v_after FROM public.products WHERE product_is_deleted IS NOT TRUE;

  RETURN jsonb_build_object(
    'products_before', v_before,
    'products_after',  v_after,
    'added',           v_after - v_before,
    'heat_pumps',      (SELECT count(*) FROM public.products
                         WHERE product_record_type = v_rt_heatpump
                           AND product_is_deleted IS NOT TRUE),
    'furnaces',        (SELECT count(*) FROM public.products
                         WHERE product_record_type = v_rt_furnace
                           AND product_is_deleted IS NOT TRUE));
END;
$fn$;

REVOKE ALL ON FUNCTION public.promote_energy_star_equipment_catalogue() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_energy_star_equipment_catalogue() FROM anon;
REVOKE ALL ON FUNCTION public.promote_energy_star_equipment_catalogue() FROM authenticated;

COMMIT;

-- Applied to production 2026-09-05. Fingerprints of the deployed function
-- bodies at that moment, so a future session can tell drift from a rewrite:
--   promote_energy_star_equipment_catalogue  md5 a553c41205468d4d6af62cee03c7b2eb  (2,531 bytes)
--   fetch_energy_star_equipment              md5 a2d92d7e55dcbbba9670d4d4003a57af  (7,387 bytes)
-- Result of the first run: 11,266 products added -- 8,048 heat pumps, 3,220
-- furnaces -- on top of the 33 that already existed. Zero carry R-410A.
