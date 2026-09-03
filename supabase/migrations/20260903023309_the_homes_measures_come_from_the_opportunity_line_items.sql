-- "What work will be completed?" on the HOMES form comes from the opportunity's
-- line items.
--
-- Nicholas: "The measures only come from the opportunity line items."
--
-- They did not. `enrollments.enrollment_work_measures` is typed by hand -- no
-- function in the database writes it -- so the answer LEAP sends the programme
-- was a second, independently maintained opinion about the scope of work, sat
-- next to the products that ARE the scope of work. Two places to keep right is
-- one place to get wrong, and the one that gets stale is the one nobody prices
-- from.
--
-- SCOPE IS THE HOMES ENROLLMENT AND THE HOMES FORM ONLY (Nicholas, explicitly).
-- The HEAR reservation is signed off and is not touched: it keeps reading
-- enrollment_work_measures exactly as it does now. The table is keyed by
-- opportunity record type so HEAR can be added later by seeding rows, but no
-- HEAR row is seeded and no HEAR code path changes.
--
-- WHY A MAPPING TABLE AND NOT A DERIVATION. The form's options are more
-- specific than anything the product carries. `product_family` says
-- "Insulation" where the form asks whether it was Ceiling, Wall, Floor or
-- Foundation -- only the product knows it is the attic. `work_type_id` is NULL
-- on every product currently used on a line item, so there is no existing link
-- to lean on. And the same physical work is named differently per programme.
-- So product -> measure is a decision, recorded per row, editable without a
-- deploy -- the same shape as program_incentive_products, which already does
-- exactly this for the money side.
--
-- A PRODUCT THAT IS NOT A MEASURE SAYS SO. Energy Audit, the HOMES modelled-
-- savings lines and the Focus on Energy incentives are money, not work.
-- `pmp_is_measure = false` records that as a decision rather than leaving them
-- looking forgotten -- which matters because
-- `products_missing_a_measure_mapping()` reports anything with no row at all,
-- and a permanent false positive trains people to ignore the report.
--
-- The option strings are stored VERBATIM, including the non-breaking space
-- after "ENERGY STAR" and the registered mark on Cooling Equipment. A checkbox
-- whose value differs by one character is not ticked, and nothing on screen
-- says why -- so they are written as explicit chr(160) concatenation rather
-- than pasted, where an editor could normalise them into ordinary spaces.

CREATE TABLE IF NOT EXISTS public.program_measure_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pmp_record_number text NOT NULL DEFAULT '',
  pmp_opportunity_record_type uuid NOT NULL REFERENCES public.picklist_values(id),
  pmp_product_id uuid NOT NULL REFERENCES public.products(id),
  -- The form's own option string. NULL only when the product is not a measure.
  pmp_measure_value text,
  pmp_is_measure boolean NOT NULL DEFAULT true,
  pmp_notes text,
  pmp_is_active boolean NOT NULL DEFAULT true,
  pmp_owner uuid REFERENCES public.users(id),
  pmp_created_by uuid REFERENCES public.users(id),
  pmp_created_at timestamptz NOT NULL DEFAULT now(),
  pmp_updated_by uuid REFERENCES public.users(id),
  pmp_updated_at timestamptz NOT NULL DEFAULT now(),
  pmp_is_deleted boolean NOT NULL DEFAULT false,
  pmp_deleted_at timestamptz,
  pmp_deleted_by uuid REFERENCES public.users(id),
  pmp_deletion_reason text,
  is_seed_data boolean NOT NULL DEFAULT false,
  CONSTRAINT program_measure_products_value_check
    CHECK ((pmp_is_measure IS TRUE AND pmp_measure_value IS NOT NULL)
        OR (pmp_is_measure IS FALSE AND pmp_measure_value IS NULL))
);

COMMENT ON TABLE public.program_measure_products IS
  'Which form measure a line-item product ticks, per programme. One row per measure a product implies — a product may imply more than one (a heat pump is both heating and cooling equipment). pmp_is_measure=false records a product that is deliberately not work (an incentive or a service line).';

CREATE UNIQUE INDEX IF NOT EXISTS program_measure_products_unique_live
  ON public.program_measure_products (pmp_opportunity_record_type, pmp_product_id,
                                      COALESCE(pmp_measure_value, ''))
  WHERE pmp_is_deleted IS NOT TRUE;

ALTER TABLE public.program_measure_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pmp_select ON public.program_measure_products;
CREATE POLICY pmp_select ON public.program_measure_products FOR SELECT
  USING ((SELECT public.app_user_can('program_measure_products','read')));
DROP POLICY IF EXISTS pmp_insert ON public.program_measure_products;
CREATE POLICY pmp_insert ON public.program_measure_products FOR INSERT
  WITH CHECK ((SELECT public.app_user_can('program_measure_products','create')));
DROP POLICY IF EXISTS pmp_update ON public.program_measure_products;
CREATE POLICY pmp_update ON public.program_measure_products FOR UPDATE
  USING ((SELECT public.app_user_can('program_measure_products','edit')));

SELECT public.install_record_audit_stamping('program_measure_products');

-- ── The seed, for WI-IRA-MF-HOMES only ───────────────────────────────────
INSERT INTO public.program_measure_products
  (pmp_record_number, pmp_opportunity_record_type, pmp_product_id, pmp_measure_value,
   pmp_is_measure, pmp_notes, is_seed_data)
SELECT '', rt.id, p.id, v.measure, v.is_measure, v.note, true
FROM (SELECT id FROM public.picklist_values
       WHERE picklist_object='opportunities' AND picklist_field='record_type'
         AND picklist_value='WI-IRA-MF-HOMES') rt,
LATERAL (VALUES
  ('Attic Air Sealing',            'Air Sealing', true,  NULL::text),
  ('Attic Insulation',             'Ceiling Insulation', true,
     'The form distinguishes Ceiling from Wall, Floor and Foundation; the attic is the ceiling plane.'),
  ('ENERGY STAR Ventilation',      'Ventilation System', true, NULL),
  ('ENERGY STAR Electric Heat Pump for Space Heating and Cooling',
     'ENERGY STAR' || chr(160) || 'Heating Equipment', true,
     'One product, two measures: it heats and it cools, and the form asks separately.'),
  ('ENERGY STAR Electric Heat Pump for Space Heating and Cooling',
     'ENERGY STAR' || chr(160) || 'Cooling Equipment', true, NULL),
  ('Bathroom Faucet Aerators',     'Water Saving Measures', true, NULL),
  ('Kitchen Faucet Aerators',      'Water Saving Measures', true, NULL),
  ('Low-Flow Showerheads',         'Water Saving Measures', true, NULL),
  -- Money, not work. Recorded so they never show as an unmapped gap.
  ('Energy Audit',                 NULL, false, 'A service line, not work on the building.'),
  ('HOMES Project - 20% to 34% Modeled Savings', NULL, false, 'The rebate line.'),
  ('HOMES Project - 35% or Greater Modeled Savings', NULL, false, 'The rebate line.'),
  ('Focus on Energy - Attic Insulation Incentive (Baseline R-12 to R-19)', NULL, false, 'A Focus on Energy incentive line.'),
  ('Focus on Energy - Attic Insulation Incentive (Baseline R-20 to R-38)', NULL, false, 'A Focus on Energy incentive line.'),
  -- No HOMES option exists for it; it is a HEAR measure.
  ('Electrical Wiring',            NULL, false, 'No corresponding option on the HOMES form.')
) AS v(product_name, measure, is_measure, note)
JOIN public.products p ON p.product_name = v.product_name AND p.product_is_deleted IS NOT TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.program_measure_products x
   WHERE x.pmp_opportunity_record_type = rt.id AND x.pmp_product_id = p.id
     AND COALESCE(x.pmp_measure_value,'') = COALESCE(v.measure,'')
     AND x.pmp_is_deleted IS NOT TRUE);

-- The ® is applied after the fact so the concatenation above stays readable and
-- the mark cannot be lost to an encoding round trip in the middle of a literal.
UPDATE public.program_measure_products
   SET pmp_measure_value = 'ENERGY STAR' || chr(174) || chr(160) || 'Cooling Equipment'
 WHERE pmp_measure_value = 'ENERGY STAR' || chr(160) || 'Cooling Equipment';

-- ── Reading the measures off the line items ──────────────────────────────
CREATE OR REPLACE FUNCTION public.opportunity_form_measures(p_opportunity_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public','pg_catalog'
AS $fn$
  SELECT COALESCE(jsonb_agg(DISTINCT m.pmp_measure_value), '[]'::jsonb)
    FROM public.opportunity_line_items oli
    JOIN public.opportunities o ON o.id = oli.opportunity_id
    JOIN public.program_measure_products m
      ON m.pmp_product_id = oli.product_id
     AND m.pmp_opportunity_record_type = o.opportunity_record_type
     AND m.pmp_is_measure IS TRUE
     AND m.pmp_is_active IS TRUE
     AND m.pmp_is_deleted IS NOT TRUE
   WHERE oli.opportunity_id = p_opportunity_id
     AND oli.oli_is_deleted IS NOT TRUE;
$fn$;
REVOKE ALL ON FUNCTION public.opportunity_form_measures(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.opportunity_form_measures(uuid) TO authenticated, service_role;

-- What is on a line item and has no ruling at all. A product here is silently
-- contributing nothing to the form, which is the failure this table exists to
-- make visible.
CREATE OR REPLACE FUNCTION public.products_missing_a_measure_mapping()
RETURNS TABLE (opportunity_record_type text, product_name text, line_items bigint)
LANGUAGE sql STABLE SET search_path TO 'public','pg_catalog'
AS $fn$
  SELECT rt.picklist_value, p.product_name, count(*)
    FROM public.opportunity_line_items oli
    JOIN public.opportunities o ON o.id = oli.opportunity_id
    JOIN public.picklist_values rt ON rt.id = o.opportunity_record_type
    JOIN public.products p ON p.id = oli.product_id
   WHERE oli.oli_is_deleted IS NOT TRUE
     AND o.opportunity_is_deleted IS NOT TRUE
     AND rt.picklist_value = 'WI-IRA-MF-HOMES'
     AND NOT EXISTS (
       SELECT 1 FROM public.program_measure_products m
        WHERE m.pmp_product_id = oli.product_id
          AND m.pmp_opportunity_record_type = o.opportunity_record_type
          AND m.pmp_is_deleted IS NOT TRUE)
   GROUP BY 1,2 ORDER BY 3 DESC;
$fn$;
REVOKE ALL ON FUNCTION public.products_missing_a_measure_mapping() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.products_missing_a_measure_mapping() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

DO $assert$
DECLARE v_rows int; v_measures int; v_gap text; v_hp int;
BEGIN
  SELECT count(*) INTO v_rows FROM public.program_measure_products WHERE pmp_is_deleted IS NOT TRUE;
  IF v_rows <> 14 THEN
    RAISE EXCEPTION 'Expected 14 seeded product rulings, found %', v_rows;
  END IF;

  SELECT count(*) INTO v_measures FROM public.program_measure_products
   WHERE pmp_is_measure IS TRUE AND pmp_is_deleted IS NOT TRUE;
  IF v_measures <> 8 THEN
    RAISE EXCEPTION 'Expected 8 measure rulings, found %', v_measures;
  END IF;

  -- One product genuinely implies two measures. If a future edit collapses that
  -- to one, a heat pump silently stops reporting half of what it does.
  SELECT count(*) INTO v_hp FROM public.program_measure_products m
    JOIN public.products p ON p.id = m.pmp_product_id
   WHERE p.product_name = 'ENERGY STAR Electric Heat Pump for Space Heating and Cooling'
     AND m.pmp_is_measure IS TRUE AND m.pmp_is_deleted IS NOT TRUE;
  IF v_hp <> 2 THEN
    RAISE EXCEPTION 'The heat pump should imply 2 measures, it implies %', v_hp;
  END IF;

  -- The non-breaking space and the registered mark survived. An ordinary space
  -- here means the checkbox is never ticked and nothing says why.
  IF NOT EXISTS (SELECT 1 FROM public.program_measure_products
                  WHERE pmp_measure_value = 'ENERGY STAR' || chr(160) || 'Heating Equipment') THEN
    RAISE EXCEPTION 'The heating measure lost its non-breaking space.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.program_measure_products
                  WHERE pmp_measure_value = 'ENERGY STAR' || chr(174) || chr(160) || 'Cooling Equipment') THEN
    RAISE EXCEPTION 'The cooling measure lost its registered mark or its non-breaking space.';
  END IF;

  -- Every product currently on a HOMES line item has a ruling.
  SELECT string_agg(product_name, ', ') INTO v_gap FROM public.products_missing_a_measure_mapping();
  IF v_gap IS NOT NULL THEN
    RAISE EXCEPTION 'These HOMES line-item products have no ruling: %', v_gap;
  END IF;
END $assert$;
