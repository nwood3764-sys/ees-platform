-- Put in the loads, get back the machines that carry them.
--
-- Nicholas, 2026-09-05: "Think of an energy auditor that's not an HVAC expert.
-- He knows where the building's at, the heating load and the cooling design
-- load ... I want to create a process where there's only a limited number of
-- equipment that could be possible for a given installation type." And: "after
-- we make a selection, we're going to run it through [the cold-climate list]
-- ... to make sure that it's providing proper heating and cooling."
--
-- That check is this function. It runs against the same manufacturer-filed
-- numbers the public cold-climate list publishes, held in LEAP, so nobody
-- retypes a model number into a website to find out whether it heats the
-- building.
--
-- ── It takes NUMBERS, not a record ────────────────────────────────────────
--
-- Nothing here reads an assessment, an opportunity or a property, and nothing
-- here writes. That is deliberate and it is what lets one definition serve two
-- screens: a standalone tool where somebody types three numbers, and the
-- opportunity line item where the same three numbers are filled in from the
-- assessment. If this ever needs a record id to do its job, the two have been
-- mixed and the separation is gone.
--
-- ── The honest part: below 5 degrees nobody has published a number ─────────
--
-- The certified data gives heating output at exactly three outdoor
-- temperatures: 47, 17 and 5. Wisconsin designs to about -3. So for the coldest
-- hour of the year there IS no published figure, and the difference between
-- estimating one and pretending to know one is the difference between a heat
-- pump that heats the house and a callback in January.
--
-- So: between the published points the answer is interpolated and reported as
-- MEASURED. Below 5 it is extrapolated along the 17-to-5 slope and reported as
-- ESTIMATED, every time, on every row. A screen that does not show that
-- distinction is not finished.
--
-- And one trap that a physical intuition gets wrong: on many cold-climate
-- machines the published 5-degree output is HIGHER than the 17-degree output,
-- because the figure is the boosted maximum the compressor can reach when it is
-- cold (the Mitsubishi PUMY-HL60NKMU in the catalogue reads 66,000 at 47,
-- 44,500 at 17 and 62,000 at 5). Extrapolating downward along a RISING slope
-- would have output climbing forever as it gets colder. So below 5 degrees the
-- estimate is never allowed to exceed the 5-degree figure.

BEGIN;

-- ── What a machine puts out at a given outdoor temperature ────────────────
CREATE OR REPLACE FUNCTION public.heat_pump_output_at_temperature(
  p_output_47f numeric, p_output_17f numeric, p_output_5f numeric,
  p_outdoor_temp_f numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE
    -- Nothing is published above 47, and output does not fall as it warms, so
    -- the 47 figure is used rather than a straight line off the end.
    WHEN p_outdoor_temp_f >= 47 THEN p_output_47f
    WHEN p_outdoor_temp_f >= 17 AND p_output_47f IS NOT NULL AND p_output_17f IS NOT NULL
      THEN p_output_17f + (p_output_47f - p_output_17f) * (p_outdoor_temp_f - 17) / 30.0
    WHEN p_outdoor_temp_f >= 5 AND p_output_17f IS NOT NULL AND p_output_5f IS NOT NULL
      THEN p_output_5f + (p_output_17f - p_output_5f) * (p_outdoor_temp_f - 5) / 12.0
    WHEN p_output_17f IS NOT NULL AND p_output_5f IS NOT NULL
      THEN greatest(
             0,
             least(
               p_output_5f,   -- never estimate MORE than the coldest published figure
               p_output_5f - (p_output_17f - p_output_5f) * (5 - p_outdoor_temp_f) / 12.0))
    ELSE NULL
  END;
$fn$;

COMMENT ON FUNCTION public.heat_pump_output_at_temperature(numeric,numeric,numeric,numeric) IS
  'Heating output at an outdoor temperature, from the three published points. Below 5F this is an estimate and callers must say so.';

-- ── What the building needs at a given outdoor temperature ────────────────
-- A building loses heat in a straight line from the indoor temperature down.
-- At the design temperature it loses exactly the design load; at 70 it loses
-- nothing. That line is what a balance point is read off.
CREATE OR REPLACE FUNCTION public.building_heat_loss_at_temperature(
  p_design_heating_load_btuh numeric,
  p_winter_design_temp_f numeric,
  p_outdoor_temp_f numeric,
  p_indoor_design_temp_f numeric DEFAULT 70
) RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN p_indoor_design_temp_f <= p_winter_design_temp_f THEN NULL
    ELSE greatest(0, p_design_heating_load_btuh
                     * (p_indoor_design_temp_f - p_outdoor_temp_f)
                     / (p_indoor_design_temp_f - p_winter_design_temp_f))
  END;
$fn$;

COMMIT;
