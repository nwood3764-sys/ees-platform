-- A measure declares its own Measure Type, and cannot demand a model that does
-- not exist.
--
-- Nicholas, on the heat pump: "it didn't give me the option to pick the
-- equipment" — correct, because 20260903035430 stood the heat pump measure down
-- when it had no approved models. Asked how he wanted to proceed: "I'll set them
-- up myself", and on how a space-conditioning heat pump prints: "Two rows per
-- unit — Heating and Cooling."
--
-- ── Measure Type belongs to the MEASURE, not the equipment record type ────
--
-- The first cut keyed the sheet's Measure Type column off the equipment
-- product's record type. The data already disproves that: PRD-00002 (Rheem
-- ProTerra) is a heat pump WATER HEATER sitting on HEAT-PUMP-EQUIPMENT beside
-- space-conditioning heat pumps. Keyed by equipment type it prints as Heating
-- and Cooling. The programme pays for a MEASURE, and "Water Heating" is what
-- belongs in the column.
--
-- So the values ride on the measure. An array, because one measure can be two
-- Measure Types: the administrator's dropdown has no "Heating and Cooling", and
-- the same physical heat pump legitimately carries both — hence two rows per
-- unit, which is what Nicholas chose.
--
-- ── The guard that makes self-serve setup safe ────────────────────────────
--
-- Ticking "Requires Equipment Selection" on a measure with no approved model
-- makes that product UNADDABLE: the equipment step opens empty and the line is
-- refused. That is exactly the regression this session shipped and then had to
-- undo. Nicholas is setting the heat pump models up himself, so the platform
-- must refuse the half-configuration rather than let him discover it on an
-- opportunity. Guarded from both directions:
--
--   · turning the flag ON with no live approved model is refused, and
--   · removing or deactivating the LAST approved model of a flagged measure is
--     refused, which is the same broken state arrived at backwards.

BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS product_supplemental_measure_types text[];

COMMENT ON COLUMN public.products.product_supplemental_measure_types IS
  'The Measure Type value(s) this incentive measure prints as on the IRA Quality Installation Supplemental Data Sheet. Every value must appear on the programme workbook''s own "Data Validation" tab or Excel flags the cell. More than one value emits one row per value per unit — a space-conditioning heat pump is Heating AND Cooling, because the administrator''s dropdown has no combined value. NULL means the measure does not print on the sheet.';

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_supplemental_measure_types_ck;
ALTER TABLE public.products
  ADD CONSTRAINT products_supplemental_measure_types_ck CHECK (
    product_supplemental_measure_types IS NULL
    OR (
      array_length(product_supplemental_measure_types, 1) > 0
      AND product_supplemental_measure_types <@ ARRAY[
        'Heating', 'Cooling', 'Ventilation', 'Water Heating',
        'ENERGY STAR Refrigerator', 'ENERGY STAR Dishwasher', 'ENERGY STAR Freezer',
        'ENERGY STAR Electric Cooking Product', 'ENERGY STAR Clothes Washer',
        'ENERGY STAR Clothes Dryer', 'ENERGY STAR Pool Pump'
      ]::text[]
    )
  );

UPDATE public.products SET product_supplemental_measure_types = ARRAY['Ventilation']
 WHERE product_code = 'HEAR-VENT';
UPDATE public.products SET product_supplemental_measure_types = ARRAY['Heating', 'Cooling']
 WHERE product_code = 'HEAR-HP-SPACE-HEAT-COOL';
UPDATE public.products SET product_supplemental_measure_types = ARRAY['Water Heating']
 WHERE product_code = 'HEAR-HPWH';

COMMIT;

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_measure_has_a_model_before_demanding_one()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.product_requires_equipment_selection
     AND COALESCE(OLD.product_requires_equipment_selection, false) IS DISTINCT FROM true
     AND NOT EXISTS (
       SELECT 1 FROM public.product_qualifying_equipment q
        WHERE q.pqe_measure_product_id = NEW.id
          AND q.pqe_is_active AND q.pqe_is_deleted IS NOT TRUE)
  THEN
    RAISE EXCEPTION
      '"%" has no approved equipment models yet, so it cannot require one — the equipment picker would open empty and the line could not be saved. Add at least one model under Qualifying Equipment on this product''s Related tab first, then tick this box.',
      NEW.product_name;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_measure_has_a_model_before_demanding_one()
  FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_zz_measure_requires_a_model ON public.products;
CREATE TRIGGER trg_zz_measure_requires_a_model
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.enforce_measure_has_a_model_before_demanding_one();

CREATE OR REPLACE FUNCTION public.enforce_last_model_stays_while_measure_demands_one()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_measure text;
  v_remaining int;
BEGIN
  IF NEW.pqe_is_active AND NEW.pqe_is_deleted IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT p.product_name INTO v_measure
    FROM public.products p
   WHERE p.id = NEW.pqe_measure_product_id AND p.product_requires_equipment_selection;
  IF v_measure IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_remaining
    FROM public.product_qualifying_equipment q
   WHERE q.pqe_measure_product_id = NEW.pqe_measure_product_id
     AND q.id <> NEW.id
     AND q.pqe_is_active AND q.pqe_is_deleted IS NOT TRUE;

  IF v_remaining = 0 THEN
    RAISE EXCEPTION
      'This is the last approved model for "%", which requires an equipment selection. Removing it would make that measure impossible to add. Add a replacement model first, or untick Requires Equipment Selection on the measure.',
      v_measure;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_last_model_stays_while_measure_demands_one()
  FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_zz_keep_last_model ON public.product_qualifying_equipment;
CREATE TRIGGER trg_zz_keep_last_model
  BEFORE UPDATE ON public.product_qualifying_equipment
  FOR EACH ROW EXECUTE FUNCTION public.enforce_last_model_stays_while_measure_demands_one();

COMMIT;

DO $$
DECLARE v_types text[]; v_bad text;
BEGIN
  SELECT product_supplemental_measure_types INTO v_types
    FROM public.products WHERE product_code = 'HEAR-HP-SPACE-HEAT-COOL';
  IF v_types IS DISTINCT FROM ARRAY['Heating','Cooling'] THEN
    RAISE EXCEPTION 'The space-conditioning heat pump measure does not print as Heating + Cooling (got %)', v_types;
  END IF;

  SELECT product_supplemental_measure_types INTO v_types
    FROM public.products WHERE product_code = 'HEAR-VENT';
  IF v_types IS DISTINCT FROM ARRAY['Ventilation'] THEN
    RAISE EXCEPTION 'The ventilation measure does not print as Ventilation (got %)', v_types;
  END IF;

  -- The water heater is the reason this moved off the equipment record type.
  SELECT product_supplemental_measure_types INTO v_types
    FROM public.products WHERE product_code = 'HEAR-HPWH';
  IF v_types IS DISTINCT FROM ARRAY['Water Heating'] THEN
    RAISE EXCEPTION 'The heat pump water heater measure does not print as Water Heating (got %)', v_types;
  END IF;

  SELECT string_agg(p.product_name, ', ') INTO v_bad
    FROM public.products p
   WHERE p.product_requires_equipment_selection AND p.product_is_deleted IS NOT TRUE
     AND NOT EXISTS (SELECT 1 FROM public.product_qualifying_equipment q
                      WHERE q.pqe_measure_product_id = p.id
                        AND q.pqe_is_active AND q.pqe_is_deleted IS NOT TRUE);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Measures demand equipment with no approved model: %', v_bad;
  END IF;

  IF EXISTS (SELECT 1 FROM public.find_trigger_function_privilege_gaps()) THEN
    RAISE EXCEPTION 'A trigger function now depends on an EXECUTE grant that is revoked';
  END IF;
END $$;
