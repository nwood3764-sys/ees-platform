-- Total Project Cost and the programme's rebate are DERIVED, and they follow
-- their source for the life of the record -- not stamped once at creation.
--
-- Nicholas, 2026-09-02: "are you just not updating this on save and edit, and
-- only on creation? Come on, this has to be smarter." Correct, and the
-- distinction matters: the document inheritance is create-only ON PURPOSE (once
-- a record exists, which files hang off it is the preparer's decision). A total
-- is the opposite -- add a line item and every total that quotes it is wrong
-- until it recomputes. So these cascade on every insert, update and delete of a
-- line item, forever.
--
-- TWO TOTALS, from one opportunity (OPP-00198 is the worked example):
--   Total Project Cost   $42,910.60  every priced line -- what the project is
--                                    worth, and what the Grand Total shows
--   Programme rebate     $40,000.00  only the lines whose product is registered
--                                    as THIS opportunity record type's own
--                                    incentive. The $2,910.60 Focus on Energy
--                                    line is real money on the project and
--                                    shows on the proposal as an instant
--                                    discount, but it never reaches an IRA
--                                    submission: "We can't charge the IRA for
--                                    the focus stuff."
--
-- A programme with no registered incentive products yields NULL, not zero, and
-- a NULL never overwrites a figure someone entered: an unconfigured programme
-- must not silently blank a rebate that is already right.

CREATE OR REPLACE FUNCTION public.opportunity_program_incentive_total(p_opportunity_id uuid)
RETURNS numeric
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT sum(l.oli_total_price)
  FROM public.opportunity_line_items l
  JOIN public.opportunities o ON o.id = l.opportunity_id
  JOIN public.program_incentive_products pip
    ON pip.pip_product_id = l.product_id
   AND pip.pip_opportunity_record_type = o.opportunity_record_type
   AND pip.pip_is_active AND pip.pip_is_deleted IS NOT TRUE
  WHERE l.opportunity_id = p_opportunity_id
    AND l.oli_is_deleted IS NOT TRUE
    AND l.oli_total_price IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.opportunity_program_incentive_total(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.opportunity_program_incentive_total(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.opportunity_project_cost_total(p_opportunity_id uuid)
RETURNS numeric
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT sum(l.oli_total_price)
  FROM public.opportunity_line_items l
  WHERE l.opportunity_id = p_opportunity_id
    AND l.oli_is_deleted IS NOT TRUE
    AND l.oli_total_price IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.opportunity_project_cost_total(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.opportunity_project_cost_total(uuid) TO authenticated, service_role;

-- The one place the cascade is defined. SECURITY DEFINER throughout, and
-- EXECUTE revoked, so no trigger ever hangs on a grant to `authenticated` --
-- the trap that broke every property write on 2026-08-31.
CREATE OR REPLACE FUNCTION public.recompute_opportunity_financials(p_opportunity_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_cost    numeric;
  v_rebate  numeric;
BEGIN
  IF p_opportunity_id IS NULL THEN RETURN; END IF;

  v_cost   := public.opportunity_project_cost_total(p_opportunity_id);
  v_rebate := public.opportunity_program_incentive_total(p_opportunity_id);

  -- Only write when it actually changed, so this cannot re-enter itself
  -- through the opportunity's own AFTER UPDATE trigger.
  UPDATE public.opportunities
     SET opportunity_amount = v_cost
   WHERE id = p_opportunity_id
     AND opportunity_amount IS DISTINCT FROM v_cost;

  UPDATE public.enrollments e
     SET enrollment_total_project_cost = v_cost,
         enrollment_requested_incentive_amount =
           COALESCE(v_rebate, e.enrollment_requested_incentive_amount)
   WHERE e.opportunity_id = p_opportunity_id
     AND e.enrollment_is_deleted IS NOT TRUE
     AND (e.enrollment_total_project_cost IS DISTINCT FROM v_cost
          OR (v_rebate IS NOT NULL
              AND e.enrollment_requested_incentive_amount IS DISTINCT FROM v_rebate));

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

CREATE OR REPLACE FUNCTION public.trg_line_item_recompute_financials()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_opportunity_financials(OLD.opportunity_id);
    RETURN OLD;
  END IF;
  PERFORM public.recompute_opportunity_financials(NEW.opportunity_id);
  -- A line item moved between opportunities leaves the old one stale.
  IF TG_OP = 'UPDATE' AND OLD.opportunity_id IS DISTINCT FROM NEW.opportunity_id THEN
    PERFORM public.recompute_opportunity_financials(OLD.opportunity_id);
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.trg_line_item_recompute_financials() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_zz_line_item_financials ON public.opportunity_line_items;
CREATE TRIGGER trg_zz_line_item_financials
  AFTER INSERT OR UPDATE OR DELETE ON public.opportunity_line_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_line_item_recompute_financials();

-- Changing the opportunity's record type changes WHICH lines count as its own
-- programme incentive, so the rebate has to be recomputed with it.
CREATE OR REPLACE FUNCTION public.trg_opportunity_record_type_recompute_financials()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  PERFORM public.recompute_opportunity_financials(NEW.id);
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.trg_opportunity_record_type_recompute_financials() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_zz_opportunity_record_type_financials ON public.opportunities;
CREATE TRIGGER trg_zz_opportunity_record_type_financials
  AFTER UPDATE OF opportunity_record_type ON public.opportunities
  FOR EACH ROW
  WHEN (OLD.opportunity_record_type IS DISTINCT FROM NEW.opportunity_record_type)
  EXECUTE FUNCTION public.trg_opportunity_record_type_recompute_financials();

-- A child created (or repointed) later must arrive carrying the current
-- figures, not wait for the next line-item edit to notice it exists.
CREATE OR REPLACE FUNCTION public.pull_opportunity_financials_onto_child()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_cost numeric; v_rebate numeric;
BEGIN
  IF NEW.opportunity_id IS NULL THEN RETURN NEW; END IF;
  v_cost   := public.opportunity_project_cost_total(NEW.opportunity_id);
  v_rebate := public.opportunity_program_incentive_total(NEW.opportunity_id);

  IF TG_TABLE_NAME = 'enrollments' THEN
    NEW.enrollment_total_project_cost := v_cost;
    NEW.enrollment_requested_incentive_amount :=
      COALESCE(v_rebate, NEW.enrollment_requested_incentive_amount);
  ELSE
    NEW.ia_total_project_cost := v_cost;
    NEW.ia_total_ira_homes_rebate_requested :=
      COALESCE(v_rebate, NEW.ia_total_ira_homes_rebate_requested);
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.pull_opportunity_financials_onto_child() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_2_pull_opportunity_financials ON public.enrollments;
CREATE TRIGGER trg_2_pull_opportunity_financials
  BEFORE INSERT OR UPDATE OF opportunity_id ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.pull_opportunity_financials_onto_child();

DROP TRIGGER IF EXISTS trg_2_pull_opportunity_financials ON public.incentive_applications;
CREATE TRIGGER trg_2_pull_opportunity_financials
  BEFORE INSERT OR UPDATE OF opportunity_id ON public.incentive_applications
  FOR EACH ROW EXECUTE FUNCTION public.pull_opportunity_financials_onto_child();

-- Backfill every opportunity that has priced line items.
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT DISTINCT l.opportunity_id AS id
             FROM public.opportunity_line_items l
            WHERE l.oli_is_deleted IS NOT TRUE AND l.oli_total_price IS NOT NULL
  LOOP
    PERFORM public.recompute_opportunity_financials(r.id);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'recomputed % opportunities', n;
END $$;

-- The worked example must come out right, or this migration does not ship.
DO $$
DECLARE v_cost numeric; v_rebate numeric;
BEGIN
  SELECT opportunity_amount INTO v_cost FROM public.opportunities
   WHERE opportunity_record_number = 'OPP-00198';
  SELECT public.opportunity_program_incentive_total(id) INTO v_rebate
    FROM public.opportunities WHERE opportunity_record_number = 'OPP-00198';
  IF v_cost IS DISTINCT FROM 42910.60 THEN
    RAISE EXCEPTION 'OPP-00198 project cost came out %, expected 42910.60', v_cost;
  END IF;
  IF v_rebate IS DISTINCT FROM 40000 THEN
    RAISE EXCEPTION 'OPP-00198 IRA rebate came out %, expected 40000 (the Focus on Energy line must not be in it)', v_rebate;
  END IF;
END $$;
