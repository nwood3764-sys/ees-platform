-- A HEAR measure always comes with its equipment. There is no option.
--
-- Nicholas: "If I pick a HEAR measure, a piece of equipment has to come with it.
-- There's no option. We must have an equipment record in order for an
-- opportunity product line item to be installed. Just like you have the
-- ventilation... It did not do that for the heat pump."
--
-- ── What I got wrong ─────────────────────────────────────────────────────
--
-- 20260903035430 made the requirement CONDITIONAL on approved models already
-- existing, and unflagged the heat pump because none did. That turned a rule
-- into a preference: the measure Nicholas wanted gated became the one that
-- waved you through. The reasoning was not wrong about the symptom — a flagged
-- measure with no models genuinely could not be added — but it was aimed at the
-- wrong end. The requirement is not the problem. The DEAD END is.
--
-- So the requirement becomes unconditional, and the empty state becomes
-- recoverable: create_qualifying_equipment_for_measure lets the equipment step
-- create the product itself, so "no approved models yet" is a form to fill in
-- rather than a wall. The two guard triggers from 20260903043012 are dropped —
-- they enforced the conditional rule, and with the dead end gone they only stand
-- between a person and the thing they are trying to do.
--
-- ── Which measures ───────────────────────────────────────────────────────
--
-- Every HEAR measure that installs a discrete, model-numbered device:
-- ventilation, the space-conditioning heat pump, the heat pump water heater,
-- the clothes dryer, the cooking product. NOT Electrical Wiring (labour and
-- materials, no one device) and NOT the Load Service Center — neither has any
-- Measure Type on the programme's own dropdown, so neither can be reported on
-- the supplemental sheet at all. Both are left unflagged, and now that the dead
-- end is gone, ticking the box on either is a checkbox away if that is wrong.

BEGIN;

-- ── 1. The two conditional guards go ─────────────────────────────────────
DROP TRIGGER IF EXISTS trg_zz_measure_requires_a_model ON public.products;
DROP TRIGGER IF EXISTS trg_zz_keep_last_model ON public.product_qualifying_equipment;
DROP FUNCTION IF EXISTS public.enforce_measure_has_a_model_before_demanding_one();
DROP FUNCTION IF EXISTS public.enforce_last_model_stays_while_measure_demands_one();

-- ── 2. An equipment record type for appliances ───────────────────────────
INSERT INTO public.picklist_values (
  picklist_object, picklist_field, picklist_value, picklist_label,
  picklist_is_active, picklist_sort_order, picklist_description
)
SELECT 'products', 'record_type', 'APPLIANCE-EQUIPMENT', 'Appliance Equipment', true, 50,
       'A real, installable ENERGY STAR appliance — a clothes dryer, a cooking product — carrying its manufacturer, model number and supporting documentation.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values
   WHERE picklist_object='products' AND picklist_field='record_type'
     AND picklist_value='APPLIANCE-EQUIPMENT');

-- ── 3. A measure declares what KIND of equipment satisfies it ────────────
--
-- So the equipment step can create a product of the right record type without a
-- measure-to-record-type list living in code.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS product_equipment_record_type_id uuid
    REFERENCES public.picklist_values(id);

COMMENT ON COLUMN public.products.product_equipment_record_type_id IS
  'For an incentive measure that requires an equipment selection: the products record type its approved models carry. Lets the equipment picker create a correctly typed product on the spot instead of dead-ending when no model is set up yet. NULL on anything that is not such a measure.';

UPDATE public.products m
   SET product_equipment_record_type_id = rt.id
  FROM public.picklist_values rt
 WHERE rt.picklist_object='products' AND rt.picklist_field='record_type'
   AND (
     (m.product_code = 'HEAR-VENT'                AND rt.picklist_value='VENTILATION-EQUIPMENT') OR
     (m.product_code = 'HEAR-HP-SPACE-HEAT-COOL'  AND rt.picklist_value='HEAT-PUMP-EQUIPMENT')   OR
     (m.product_code = 'HEAR-HPWH'                AND rt.picklist_value='HEAT-PUMP-EQUIPMENT')   OR
     (m.product_code = 'HEAR-DRYER'               AND rt.picklist_value='APPLIANCE-EQUIPMENT')   OR
     (m.product_code = 'HEAR-STOVE'               AND rt.picklist_value='APPLIANCE-EQUIPMENT')
   );

-- ── 4. The requirement, unconditionally ──────────────────────────────────
UPDATE public.products
   SET product_requires_equipment_selection = true
 WHERE product_code IN ('HEAR-VENT','HEAR-HP-SPACE-HEAT-COOL','HEAR-HPWH','HEAR-DRYER','HEAR-STOVE')
   AND product_is_deleted IS NOT TRUE;

UPDATE public.products SET product_supplemental_measure_types = ARRAY['ENERGY STAR Clothes Dryer']
 WHERE product_code = 'HEAR-DRYER';
UPDATE public.products SET product_supplemental_measure_types = ARRAY['ENERGY STAR Electric Cooking Product']
 WHERE product_code = 'HEAR-STOVE';

COMMIT;

BEGIN;

-- ── 5. Create the equipment from inside the picker ───────────────────────
--
-- The escape hatch that makes an unconditional requirement workable. Creates the
-- equipment product AND its approval link together, so the pair can never be
-- half-made — a product with no link is invisible to the picker that just
-- created it, which reads as "nothing happened".
--
-- Refuses when the session is not a LEAP user rather than letting the NOT NULL
-- on product_owner surface as a constraint error naming a column the person
-- never filled in. Every record in LEAP has a named owner; there is no sensible
-- fallback.
CREATE OR REPLACE FUNCTION public.create_qualifying_equipment_for_measure(
  p_measure_product_id uuid,
  p_manufacturer       text,
  p_model_number       text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER            -- the caller's own create-products permission applies
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_rt      uuid;
  v_name    text;
  v_id      uuid;
  v_owner   uuid;
  v_make    text := nullif(btrim(p_manufacturer), '');
  v_model   text := nullif(btrim(p_model_number), '');
BEGIN
  IF v_model IS NULL THEN
    RAISE EXCEPTION 'A model number is required — it is what the programme''s supplemental data sheet reports for every unit.';
  END IF;

  v_owner := public.current_app_user_id();
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Cannot create equipment: this session is not signed in as a LEAP user, and every product needs a named owner.';
  END IF;

  SELECT product_equipment_record_type_id INTO v_rt
    FROM public.products
   WHERE id = p_measure_product_id AND product_requires_equipment_selection;
  IF v_rt IS NULL THEN
    RAISE EXCEPTION 'That measure does not take an equipment selection, or has no equipment record type configured.';
  END IF;

  v_name := btrim(concat_ws(' ', v_make, v_model));

  -- Reuse an identical model rather than minting a duplicate product: two
  -- catalogue rows for one physical fan is how a report starts double-counting.
  SELECT id INTO v_id FROM public.products
   WHERE product_is_deleted IS NOT TRUE
     AND coalesce(product_manufacturer,'') = coalesce(v_make,'')
     AND product_model_number = v_model
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.products (
      product_record_number, product_name, product_record_type,
      product_manufacturer, product_model_number, product_is_active,
      product_owner, product_created_by
    ) VALUES ('', v_name, v_rt, v_make, v_model, true, v_owner, v_owner)
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.product_qualifying_equipment (
    pqe_record_number, pqe_measure_product_id, pqe_equipment_product_id,
    pqe_is_active, pqe_owner, pqe_created_by
  )
  SELECT '', p_measure_product_id, v_id, true, v_owner, v_owner
  WHERE NOT EXISTS (
    SELECT 1 FROM public.product_qualifying_equipment q
     WHERE q.pqe_measure_product_id = p_measure_product_id
       AND q.pqe_equipment_product_id = v_id
       AND q.pqe_is_deleted IS NOT TRUE);

  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.create_qualifying_equipment_for_measure(uuid, text, text) IS
  'Creates an equipment product of the measure''s declared record type and approves it for that measure, atomically. Called from the opportunity line item equipment step so an unconditional equipment requirement never dead-ends on "no approved models yet". SECURITY INVOKER: the caller needs create rights on products.';

REVOKE ALL ON FUNCTION public.create_qualifying_equipment_for_measure(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_qualifying_equipment_for_measure(uuid, text, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Assertions ───────────────────────────────────────────────────────────
DO $$
DECLARE v_n int; v_missing text;
BEGIN
  SELECT count(*) INTO v_n FROM public.products
   WHERE product_requires_equipment_selection AND product_is_deleted IS NOT TRUE;
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'Expected 5 HEAR measures to require equipment; found %', v_n;
  END IF;

  -- Every flagged measure must know what kind of equipment satisfies it, or the
  -- create-on-the-spot path cannot type the product and the dead end returns.
  SELECT string_agg(product_name, ', ') INTO v_missing FROM public.products
   WHERE product_requires_equipment_selection AND product_is_deleted IS NOT TRUE
     AND product_equipment_record_type_id IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'These measures require equipment but declare no equipment record type: %', v_missing;
  END IF;

  -- The negative control: labour and a service upgrade are not equipment lines.
  IF EXISTS (SELECT 1 FROM public.products
              WHERE product_code IN ('HEAR-WIRING','HEAR-PANEL')
                AND product_requires_equipment_selection) THEN
    RAISE EXCEPTION 'Electrical wiring or the service panel was flagged as installing a device';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_zz_measure_requires_a_model','trg_zz_keep_last_model')) THEN
    RAISE EXCEPTION 'A conditional equipment guard is still installed';
  END IF;

  IF EXISTS (SELECT 1 FROM public.find_trigger_function_privilege_gaps()) THEN
    RAISE EXCEPTION 'A trigger function now depends on an EXECUTE grant that is revoked';
  END IF;
END $$;
