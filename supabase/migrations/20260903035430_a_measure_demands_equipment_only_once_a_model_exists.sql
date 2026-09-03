-- A measure demands equipment only once there is a model to demand.
--
-- 20260903015923 flagged both HEAR-VENT and HEAR-HP-SPACE-HEAT-COOL as requiring
-- an equipment selection, but only ventilation had an approved model seeded. The
-- result: picking "ENERGY STAR Electric Heat Pump for Space Heating and Cooling"
-- opened an equipment step with nothing in it and no way forward — a product
-- that was addable before this work became unaddable, which is a straight
-- regression dressed up as a rule.
--
-- The flag stays a declaration of intent, not something derived from whether
-- models happen to exist right now: deriving it would mean a measure silently
-- stops requiring equipment the moment somebody deactivates its last model,
-- which is exactly when the requirement matters most. Instead the two must be
-- configured TOGETHER, and the assertion below enforces that pairing — flag a
-- measure and you must link at least one model in the same breath.
--
-- Heat pumps therefore stand down until a real model is linked. Not invented
-- here: PRD-00001 (Mitsubishi MSZ-FH15NA) sits in the catalogue as heat-pump
-- equipment, but whether it is an approved model for the WI HEAR measure is a
-- programme fact nobody in this session knows, and asserting it would put a
-- fabricated approval in front of an administrator.

BEGIN;

UPDATE public.products p
   SET product_requires_equipment_selection = false
 WHERE p.product_requires_equipment_selection
   AND NOT EXISTS (
     SELECT 1 FROM public.product_qualifying_equipment q
      WHERE q.pqe_measure_product_id = p.id
        AND q.pqe_is_active AND q.pqe_is_deleted IS NOT TRUE
   );

COMMIT;

-- The derived per-line flag follows. replica so the audit logger does not
-- record a migration as if a person had edited these line items.
BEGIN;
SET LOCAL session_replication_role = replica;

UPDATE public.opportunity_line_items oli
   SET oli_is_equipment_line = COALESCE(p.product_requires_equipment_selection, false)
  FROM public.products p
 WHERE p.id = oli.product_id
   AND oli.oli_is_equipment_line IS DISTINCT FROM COALESCE(p.product_requires_equipment_selection, false);

COMMIT;

DO $$
DECLARE v_orphan text; v_vent boolean; v_lines int;
BEGIN
  -- THE PAIRING RULE. A flagged measure with no approved model is a product
  -- nobody can add: the equipment step opens empty and the save is refused.
  SELECT string_agg(p.product_name, ', ') INTO v_orphan
    FROM public.products p
   WHERE p.product_requires_equipment_selection
     AND p.product_is_deleted IS NOT TRUE
     AND NOT EXISTS (
       SELECT 1 FROM public.product_qualifying_equipment q
        WHERE q.pqe_measure_product_id = p.id
          AND q.pqe_is_active AND q.pqe_is_deleted IS NOT TRUE);
  IF v_orphan IS NOT NULL THEN
    RAISE EXCEPTION 'These measures demand equipment but have no approved model, so they cannot be added at all: %', v_orphan;
  END IF;

  -- Ventilation must still demand it — that is the whole point of the build.
  SELECT product_requires_equipment_selection INTO v_vent
    FROM public.products WHERE product_code = 'HEAR-VENT';
  IF v_vent IS NOT TRUE THEN
    RAISE EXCEPTION 'The ventilation measure no longer demands an equipment selection';
  END IF;

  -- And the derived line flag must agree with the product flag everywhere.
  SELECT count(*) INTO v_lines
    FROM public.opportunity_line_items oli
    JOIN public.products p ON p.id = oli.product_id
   WHERE oli.oli_is_deleted IS NOT TRUE
     AND COALESCE(p.product_requires_equipment_selection, false)
         IS DISTINCT FROM oli.oli_is_equipment_line;
  IF v_lines > 0 THEN
    RAISE EXCEPTION 'oli_is_equipment_line disagrees with the product flag on % live rows', v_lines;
  END IF;
END $$;
