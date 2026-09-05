-- A balance point that cannot contradict the design-day answer, and a ranking
-- that respects the cooling band.
--
-- Both defects were found by RUNNING the first cut against real Wisconsin
-- numbers (30,000 heating / 18,000 cooling at -3 degrees), not by reading it.
--
-- ── The balance point was lying ───────────────────────────────────────────
--
-- A machine that covered the load at -3 reported a balance point of 22 -- an
-- answer that contradicts itself on its own row. The cause is a property of the
-- published data that a physical intuition gets wrong: THE 47-DEGREE FIGURE IS
-- A RATED CAPACITY WHILE THE 5-DEGREE FIGURE IS THE BOOSTED MAXIMUM. They are
-- not the same measurement, so the line between them dips in the middle, and
-- asking for "the warmest temperature where output falls short" found that dip.
--
-- A balance point now exists ONLY when the machine cannot carry the load at the
-- design temperature, and is then the coldest temperature at which it still
-- keeps up alone. A number that disagrees with the design-day verdict beside it
-- is worse than no number.
--
-- ── The ranking ignored the summer ────────────────────────────────────────
--
-- Ordering on heating alone put a unit 133% oversized on cooling above one
-- sized at exactly 100%. Oversized cooling is what somebody lives with all
-- summer and what the sizing rules constrain, so a machine that does BOTH jobs
-- now sorts first.
--
-- ── What running it revealed, and it is not a defect ──────────────────────
--
-- For 30,000 heating and 18,000 cooling at -3 degrees, only FOUR machines in a
-- catalogue of 8,048 carry the whole heating load, while 196 are correctly
-- sized for cooling and need back-up heat. That is the real cold-climate
-- tension, not a bug: sizing to the heating load in Wisconsin means accepting
-- oversized cooling or accepting back-up heat. It is also why the acceptable
-- cooling band is a PARAMETER and not a constant -- 90-115 is a mixed-climate
-- rule and a heating-dominant climate allows more. Nothing here is hardcoded to
-- one programme's answer.
-- (function definition follows; identical to what production recorded, md5 560f2da8b4c0fe5dddcb1f4bbdd03db1)

CREATE OR REPLACE FUNCTION public.select_equipment_for_load(
  p_design_heating_load_btuh numeric,
  p_design_cooling_load_btuh numeric,
  p_winter_design_temp_f     numeric,
  p_ducting                  text    DEFAULT NULL,
  p_measure_product_id       uuid    DEFAULT NULL,
  p_cooling_min_pct          numeric DEFAULT 90,
  p_cooling_max_pct          numeric DEFAULT 115,
  p_limit                    integer DEFAULT 25
)
RETURNS TABLE (
  product_id uuid, record_number text, equipment_name text, manufacturer text,
  model_number text, ducting text, compressor text, certificate_number integer,
  output_at_design_btuh integer, output_basis text, heating_coverage_pct numeric,
  balance_point_f numeric, supplemental_heat_kw numeric,
  cooling_capacity_btuh integer, cooling_coverage_pct numeric,
  seer2 numeric, hspf2 numeric, efficiency_at_5f numeric, verdict text
)
LANGUAGE sql STABLE SET search_path TO 'public', 'pg_catalog'
AS $fn$
WITH pool AS (
  SELECT p.id, p.product_record_number, p.product_name, p.product_manufacturer,
         p.product_model_number, p.product_ahri_certificate_number,
         p.product_heating_capacity_47f AS h47,
         p.product_heating_capacity_17f AS h17,
         p.product_heating_capacity_5f  AS h5,
         p.product_cooling_capacity_95f AS cool,
         p.product_seer2, p.product_hspf2_region_iv, p.product_heating_cop_5f,
         dv.picklist_value AS duct, cv.picklist_value AS comp
    FROM public.products p
    LEFT JOIN public.picklist_values dv ON dv.id = p.product_ducting_configuration
    LEFT JOIN public.picklist_values cv ON cv.id = p.product_variable_capacity
   WHERE p.product_is_deleted IS NOT TRUE
     AND p.product_is_active
     AND p.product_record_type = (SELECT id FROM public.picklist_values
                                   WHERE picklist_object='products' AND picklist_field='record_type'
                                     AND picklist_value='HEAT-PUMP-EQUIPMENT')
     AND (p_ducting IS NULL OR dv.picklist_value = p_ducting)
     AND (p_measure_product_id IS NULL OR EXISTS (
            SELECT 1 FROM public.product_qualifying_equipment q
             WHERE q.pqe_measure_product_id = p_measure_product_id
               AND q.pqe_equipment_product_id = p.id
               AND q.pqe_is_active AND q.pqe_is_deleted IS NOT TRUE))
     AND (p_design_cooling_load_btuh IS NULL OR p.product_cooling_capacity_95f IS NULL
          OR p.product_cooling_capacity_95f
             BETWEEN p_design_cooling_load_btuh * 0.70 AND p_design_cooling_load_btuh * 1.60)
), scored AS (
  SELECT pool.*,
         public.heat_pump_output_at_temperature(h47, h17, h5, p_winter_design_temp_f) AS out_design,
         CASE WHEN h17 IS NULL OR h5 IS NULL THEN 'not published'
              WHEN p_winter_design_temp_f >= 5 THEN 'measured'
              ELSE 'estimated' END AS basis
    FROM pool
), ranked AS (
  SELECT s.*,
         CASE WHEN p_design_heating_load_btuh > 0 AND s.out_design IS NOT NULL
              THEN round(100.0 * s.out_design / p_design_heating_load_btuh, 1) END AS heat_pct,
         CASE WHEN p_design_cooling_load_btuh > 0 AND s.cool IS NOT NULL
              THEN round(100.0 * s.cool / p_design_cooling_load_btuh, 1) END AS cool_pct
    FROM scored s
   WHERE s.out_design IS NOT NULL
), sorted AS (
  SELECT r.*,
         (r.out_design >= p_design_heating_load_btuh)                 AS carries_heat,
         (r.cool_pct BETWEEN p_cooling_min_pct AND p_cooling_max_pct) AS cooling_in_band
    FROM ranked r
   ORDER BY
     ((r.out_design >= p_design_heating_load_btuh)
      AND (r.cool_pct BETWEEN p_cooling_min_pct AND p_cooling_max_pct)) DESC,
     (r.out_design >= p_design_heating_load_btuh) DESC,
     abs(coalesce(r.cool_pct, 100) - 100) ASC,
     r.product_hspf2_region_iv DESC NULLS LAST
   LIMIT p_limit
)
SELECT
  s.id, s.product_record_number, s.product_name, s.product_manufacturer,
  s.product_model_number, s.duct, s.comp, s.product_ahri_certificate_number,
  round(s.out_design)::integer, s.basis, s.heat_pct,
  CASE WHEN s.carries_heat THEN NULL
       ELSE (SELECT min(t.temp)
               FROM generate_series(ceil(p_winter_design_temp_f)::integer, 70) AS t(temp)
              WHERE public.heat_pump_output_at_temperature(s.h47, s.h17, s.h5, t.temp)
                    >= public.building_heat_loss_at_temperature(
                         p_design_heating_load_btuh, p_winter_design_temp_f, t.temp))
  END,
  CASE WHEN s.carries_heat THEN 0
       ELSE round((p_design_heating_load_btuh - s.out_design) / 3412.0, 1) END,
  s.cool, s.cool_pct, s.product_seer2, s.product_hspf2_region_iv, s.product_heating_cop_5f,
  CASE
    WHEN s.carries_heat AND s.cooling_in_band
      THEN 'Carries the heating load on the coldest day, cooling sized right'
    WHEN s.carries_heat AND s.cool_pct > p_cooling_max_pct
      THEN 'Carries the heating load, but cooling is oversized at '
           || s.cool_pct::text || '% of the cooling load'
    WHEN s.carries_heat
      THEN 'Carries the heating load; cooling is '
           || coalesce(s.cool_pct::text,'?') || '% of the cooling load'
    ELSE 'Covers ' || coalesce(s.heat_pct::text,'?')
         || '% of the heating load on the coldest day and needs back-up heat below the balance point'
  END
   || CASE WHEN s.basis = 'estimated'
           THEN ' | output at ' || p_winter_design_temp_f
                || 'F is ESTIMATED, nothing is published below 5F'
           ELSE '' END
FROM sorted s;
$fn$;

REVOKE ALL ON FUNCTION public.select_equipment_for_load(numeric,numeric,numeric,text,uuid,numeric,numeric,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.select_equipment_for_load(numeric,numeric,numeric,text,uuid,numeric,numeric,integer) TO authenticated;
