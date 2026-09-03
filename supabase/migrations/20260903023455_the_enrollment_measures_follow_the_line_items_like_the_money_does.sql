-- The enrollment's measures follow the line items, exactly like the money does.
--
-- recompute_opportunity_financials already cascades line items -> the
-- enrollment's project cost, rebate, equipment and installation halves. The
-- measures are the same kind of fact from the same source, so they ride the
-- same function rather than a second trigger with its own timing: one write,
-- one moment, no window where the money and the scope of work disagree.
--
-- WHY IT CANNOT SIMPLY WRITE EVERY ENROLLMENT. HEAR reads
-- enrollment_work_measures too, and no HEAR product mapping exists -- so a
-- blanket recompute would resolve to an empty list and WIPE the HEAR measures,
-- breaking a form that is signed off. The update is therefore gated on the
-- opportunity's record type having a mapping at all. That is data, not a name
-- test: seed HEAR rows later and HEAR starts deriving on its own, with nothing
-- here to change.
--
-- AN EMPTY RESULT IS WRITTEN, NOT SKIPPED. An opportunity whose line items are
-- only rebate and service lines states no work, so the form must report no
-- work. Keeping a previously typed list would be the second opinion this change
-- exists to remove -- and it is the dangerous direction, because it claims to a
-- programme that work is in scope which nothing on the opportunity prices.

CREATE OR REPLACE FUNCTION public.recompute_opportunity_financials(p_opportunity_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_catalog'
AS $fn$
DECLARE
  v_cost       numeric;
  v_rebate     numeric;
  v_equipment  numeric;
  v_install    numeric;
  v_measures   jsonb;
  v_mapped     boolean;
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

  -- Does this programme have a product -> measure mapping at all? Without one,
  -- the measures are still whatever a person entered, untouched.
  SELECT EXISTS (
    SELECT 1
      FROM public.opportunities o
      JOIN public.program_measure_products m
        ON m.pmp_opportunity_record_type = o.opportunity_record_type
       AND m.pmp_is_deleted IS NOT TRUE
     WHERE o.id = p_opportunity_id
  ) INTO v_mapped;

  IF v_mapped THEN
    v_measures := public.opportunity_form_measures(p_opportunity_id);
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
         enrollment_installation_costs            = COALESCE(v_install, e.enrollment_installation_costs),
         enrollment_work_measures =
           CASE WHEN v_mapped THEN v_measures ELSE e.enrollment_work_measures END
   WHERE e.opportunity_id = p_opportunity_id
     AND e.enrollment_is_deleted IS NOT TRUE
     AND (e.enrollment_total_project_cost IS DISTINCT FROM v_cost
          OR (v_rebate IS NOT NULL
              AND e.enrollment_requested_incentive_amount IS DISTINCT FROM v_rebate)
          OR (v_mapped AND e.enrollment_work_measures IS DISTINCT FROM v_measures)
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
END $fn$;

REVOKE ALL ON FUNCTION public.recompute_opportunity_financials(uuid) FROM PUBLIC, anon, authenticated;

-- One-time catch-up for enrollments that exist already. Under replica: the
-- audit log should not record these as edits somebody made, and the stamping
-- trigger would otherwise put a migration's clock on every touched record.
SET LOCAL session_replication_role = replica;

UPDATE public.enrollments e
   SET enrollment_work_measures = public.opportunity_form_measures(e.opportunity_id)
  FROM public.opportunities o
 WHERE o.id = e.opportunity_id
   AND e.enrollment_is_deleted IS NOT TRUE
   AND EXISTS (SELECT 1 FROM public.program_measure_products m
                WHERE m.pmp_opportunity_record_type = o.opportunity_record_type
                  AND m.pmp_is_deleted IS NOT TRUE)
   AND e.enrollment_work_measures IS DISTINCT FROM public.opportunity_form_measures(e.opportunity_id);

SET LOCAL session_replication_role = origin;

NOTIFY pgrst, 'reload schema';

DO $assert$
DECLARE v_bad text; v_hear int;
BEGIN
  -- Every mapped-programme enrollment now agrees with its own line items.
  SELECT string_agg(e.enrollment_record_number, ', ') INTO v_bad
    FROM public.enrollments e
    JOIN public.opportunities o ON o.id = e.opportunity_id
   WHERE e.enrollment_is_deleted IS NOT TRUE
     AND EXISTS (SELECT 1 FROM public.program_measure_products m
                  WHERE m.pmp_opportunity_record_type = o.opportunity_record_type
                    AND m.pmp_is_deleted IS NOT TRUE)
     AND e.enrollment_work_measures IS DISTINCT FROM public.opportunity_form_measures(e.opportunity_id);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'These enrollments still disagree with their line items: %', v_bad;
  END IF;

  -- And HEAR was not touched. No mapping exists for it, so every HEAR
  -- reservation that had measures must still have them.
  SELECT count(*) INTO v_hear
    FROM public.enrollments e
    JOIN public.picklist_values pv ON pv.id = e.enrollment_record_type
   WHERE pv.picklist_value = 'WI-IRA-MF-HEAR-Project-Reservation'
     AND e.enrollment_is_deleted IS NOT TRUE
     AND e.enrollment_work_measures IS NOT NULL
     AND jsonb_array_length(e.enrollment_work_measures) > 0;
  IF v_hear = 0 THEN
    RAISE EXCEPTION 'The HEAR measures were blanked — the mapping gate did not hold.';
  END IF;
END $assert$;
