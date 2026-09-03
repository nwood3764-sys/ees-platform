-- Equipment & Materials Costs, Installation Costs and Total IRA HEAR Costs
-- were blank on every enrollment, and no function in the database referenced
-- the first two.
--
-- Nicholas, 2026-09-02: "Equipment and material costs, or 50% of the total
-- project cost and installation is labor. It's 50%."
--
-- So all three are derived from the project cost, which already follows the
-- opportunity's line items:
--
--   Total IRA HEAR Costs        the project cost
--   Equipment & Materials       half of it
--   Installation (labour)       THE REMAINDER, not a second half
--
-- The remainder, deliberately. Half of an odd cent rounds twice and the two
-- halves then sum to a cent more or less than the total -- on a document a
-- programme administrator reconciles, a line that does not add up is a
-- correction request. Taking equipment as the rounded half and installation as
-- what is left makes them sum to the total exactly, always.
--
-- Derived on the same path as the project cost itself, so a line item added
-- tomorrow moves all three. They cannot drift from the total they split.

CREATE OR REPLACE FUNCTION public.recompute_opportunity_financials(p_opportunity_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_cost       numeric;
  v_rebate     numeric;
  v_equipment  numeric;
  v_install    numeric;
BEGIN
  IF p_opportunity_id IS NULL THEN RETURN; END IF;

  v_cost   := public.opportunity_project_cost_total(p_opportunity_id);
  v_rebate := public.opportunity_program_incentive_total(p_opportunity_id);

  -- Equipment takes the rounded half; installation takes what is left, so the
  -- two always sum to the total exactly.
  IF v_cost IS NOT NULL THEN
    v_equipment := round(v_cost / 2, 2);
    v_install   := v_cost - v_equipment;
  END IF;

  UPDATE public.opportunities
     SET opportunity_amount = v_cost
   WHERE id = p_opportunity_id
     AND opportunity_amount IS DISTINCT FROM v_cost;

  UPDATE public.enrollments e
     SET enrollment_total_project_cost = v_cost,
         enrollment_requested_incentive_amount =
           COALESCE(v_rebate, e.enrollment_requested_incentive_amount),
         enrollment_total_ira_hear_cost           = COALESCE(v_cost, e.enrollment_total_ira_hear_cost),
         enrollment_equipment_and_materials_costs = COALESCE(v_equipment, e.enrollment_equipment_and_materials_costs),
         enrollment_installation_costs            = COALESCE(v_install, e.enrollment_installation_costs)
   WHERE e.opportunity_id = p_opportunity_id
     AND e.enrollment_is_deleted IS NOT TRUE
     AND (e.enrollment_total_project_cost IS DISTINCT FROM v_cost
          OR (v_rebate IS NOT NULL
              AND e.enrollment_requested_incentive_amount IS DISTINCT FROM v_rebate)
          OR (v_cost IS NOT NULL
              AND (e.enrollment_total_ira_hear_cost IS DISTINCT FROM v_cost
                OR e.enrollment_equipment_and_materials_costs IS DISTINCT FROM v_equipment
                OR e.enrollment_installation_costs IS DISTINCT FROM v_install)));

  UPDATE public.incentive_applications ia
     SET ia_total_project_cost = v_cost,
         ia_total_ira_homes_rebate_requested =
           COALESCE(v_rebate, ia.ia_total_ira_homes_rebate_requested)
   WHERE ia.opportunity_id = p_opportunity_id
     AND ia.ia_is_deleted IS NOT TRUE
     AND (ia.ia_total_project_cost IS DISTINCT FROM v_cost
          OR (v_rebate IS NOT NULL
              AND ia.ia_total_ira_homes_rebate_requested IS DISTINCT FROM v_rebate));
END $function$;
REVOKE ALL ON FUNCTION public.recompute_opportunity_financials(uuid) FROM PUBLIC, anon, authenticated;

-- A child created later must arrive carrying the split too.
CREATE OR REPLACE FUNCTION public.pull_opportunity_financials_onto_child()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_cost numeric; v_rebate numeric; v_equipment numeric; v_install numeric;
BEGIN
  IF NEW.opportunity_id IS NULL THEN RETURN NEW; END IF;
  v_cost   := public.opportunity_project_cost_total(NEW.opportunity_id);
  v_rebate := public.opportunity_program_incentive_total(NEW.opportunity_id);
  IF v_cost IS NOT NULL THEN
    v_equipment := round(v_cost / 2, 2);
    v_install   := v_cost - v_equipment;
  END IF;

  IF TG_TABLE_NAME = 'enrollments' THEN
    NEW.enrollment_total_project_cost := v_cost;
    NEW.enrollment_requested_incentive_amount :=
      COALESCE(v_rebate, NEW.enrollment_requested_incentive_amount);
    NEW.enrollment_total_ira_hear_cost           := COALESCE(v_cost, NEW.enrollment_total_ira_hear_cost);
    NEW.enrollment_equipment_and_materials_costs := COALESCE(v_equipment, NEW.enrollment_equipment_and_materials_costs);
    NEW.enrollment_installation_costs            := COALESCE(v_install, NEW.enrollment_installation_costs);
  ELSE
    NEW.ia_total_project_cost := v_cost;
    NEW.ia_total_ira_homes_rebate_requested :=
      COALESCE(v_rebate, NEW.ia_total_ira_homes_rebate_requested);
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.pull_opportunity_financials_onto_child() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE r record; n int := 0; v_bad text;
BEGIN
  FOR r IN SELECT DISTINCT l.opportunity_id AS id
             FROM public.opportunity_line_items l
            WHERE l.oli_is_deleted IS NOT TRUE AND l.oli_total_price IS NOT NULL
  LOOP
    PERFORM public.recompute_opportunity_financials(r.id);
    n := n + 1;
  END LOOP;

  -- The halves must sum to the total, to the cent, on every record.
  SELECT string_agg(e.enrollment_record_number || ' (' ||
           e.enrollment_equipment_and_materials_costs || ' + ' ||
           e.enrollment_installation_costs || ' <> ' || e.enrollment_total_project_cost || ')', ', ')
    INTO v_bad
  FROM public.enrollments e
  WHERE e.enrollment_is_deleted IS NOT TRUE
    AND e.enrollment_total_project_cost IS NOT NULL
    AND e.enrollment_equipment_and_materials_costs IS NOT NULL
    AND (e.enrollment_equipment_and_materials_costs + e.enrollment_installation_costs)
        IS DISTINCT FROM e.enrollment_total_project_cost;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'equipment + installation does not equal the project cost on: %', v_bad;
  END IF;
  RAISE NOTICE 'recomputed % opportunities', n;
END $$;
