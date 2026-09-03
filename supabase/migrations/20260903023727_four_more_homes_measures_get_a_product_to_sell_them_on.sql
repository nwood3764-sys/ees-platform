-- Four more HOMES measures get a product to sell them on.
--
-- Nicholas: "we should add Upgrade to High-Efficiency Boiler ... High Efficiency
-- PTAC Replacement ... the ENERGY STAR water heater on our side and ENERGY STAR
-- cooling equipment. And that's it for now."
--
-- The measures now come from the opportunity's line items, so a measure LEAP
-- cannot put on a line item is a measure it can never report. These four are on
-- the HOMES form and had no product behind them.
--
-- MODELLED ON THE HOMES COST PRODUCTS, NOT THE HEAR INCENTIVE ONES. Attic
-- Insulation and Low-Flow Showerheads are `MEAS-` coded, sit in the Wisconsin
-- IRA Multifamily HOMES price book, and carry NO unit price -- they are what the
-- work costs, priced per job. The HEAR products (HEAR-HPWH, HEAR-VENT) sit in
-- HEAR books at a fixed rebate amount. Same equipment, opposite purpose, so
-- these follow the cost pattern.
--
-- ENERGY STAR Water Heater is a NEW product rather than the existing
-- "ENERGY STAR Electric Heat Pump Water Heater" added to a second book. That
-- product exists to carry a $1,750 HEAR rebate; putting it in a cost book would
-- make one row mean both the price of the work and the size of the rebate, which
-- is the reuse this repo forbids. The HEAR product is ALSO mapped to the measure
-- below -- if it ever appears on a HOMES opportunity it is still a water heater
-- -- but the two rows stay separate artifacts.
--
-- Only Wisconsin IRA Multifamily HOMES is seeded: that is the programme in
-- scope. The other books are untouched.

-- ── 1. The products ──────────────────────────────────────────────────────
INSERT INTO public.products
  (product_record_number, product_name, product_code, product_record_type, product_family,
   product_description, product_is_active, product_owner, product_created_by, product_updated_by)
SELECT '', v.name, v.code,
       (SELECT id FROM public.picklist_values
         WHERE picklist_object='products' AND picklist_field='record_type' AND picklist_value='PRODUCT'),
       (SELECT id FROM public.picklist_values
         WHERE picklist_object='products' AND picklist_field='product_family' AND picklist_value=v.family),
       v.descr, true, ex.product_owner, ex.product_owner, ex.product_owner
FROM (SELECT product_owner FROM public.products WHERE product_name='Attic Insulation'
       AND product_is_deleted IS NOT TRUE LIMIT 1) ex,
LATERAL (VALUES
  ('Upgrade to High-Efficiency Boiler','MEAS-BOILER-HE','HVAC Equipment',
   'Replacement of an existing boiler with a high-efficiency unit. Reports as "Upgrade to High-Efficiency Boiler" on the IRA HOMES submittal.'),
  ('High Efficiency PTAC Replacement','MEAS-PTAC-HE','HVAC Equipment',
   'Replacement of packaged terminal air conditioners with high-efficiency units. Reports as "High Efficiency PTAC Replacement" on the IRA HOMES submittal.'),
  ('ENERGY STAR Water Heater','MEAS-WATER-HEATER-ES','Water Heating',
   'ENERGY STAR certified water heater, priced as work. Distinct from the HEAR heat pump water heater incentive product, which carries a fixed rebate amount.'),
  ('ENERGY STAR Cooling Equipment','MEAS-COOLING-ES','HVAC Equipment',
   'ENERGY STAR certified cooling equipment installed on its own. The combined heat pump product reports both heating and cooling; this one is cooling alone.')
) AS v(name, code, family, descr)
WHERE NOT EXISTS (
  SELECT 1 FROM public.products p
   WHERE p.product_name = v.name AND p.product_is_deleted IS NOT TRUE);

-- ── 2. Into the Wisconsin IRA Multifamily HOMES price book ───────────────
-- Chargeability in LEAP is price book membership. No unit price, matching the
-- other HOMES measure products: what the work costs is a per-job figure.
INSERT INTO public.price_book_entries
  (price_book_entry_record_number, price_book_entry_name, price_book_id, product_id,
   price_book_entry_product_code, price_book_entry_unit_price, price_book_entry_is_active,
   price_book_entry_use_standard_price, price_book_entry_owner,
   price_book_entry_created_by, price_book_entry_updated_by)
SELECT '', p.product_name || ' - ' || pb.price_book_name, pb.id, p.id,
       p.product_code, NULL, true, false, p.product_owner, p.product_owner, p.product_owner
FROM public.products p
CROSS JOIN (SELECT id, price_book_name FROM public.price_books
             WHERE price_book_name='Wisconsin IRA Multifamily HOMES'
               AND price_book_is_deleted IS NOT TRUE LIMIT 1) pb
WHERE p.product_code IN ('MEAS-BOILER-HE','MEAS-PTAC-HE','MEAS-WATER-HEATER-ES','MEAS-COOLING-ES')
  AND p.product_is_deleted IS NOT TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.price_book_entries e
     WHERE e.product_id = p.id AND e.price_book_id = pb.id
       AND e.price_book_entry_is_deleted IS NOT TRUE);

-- ── 3. What each one ticks on the form ───────────────────────────────────
-- Values verbatim from the form, including the non-breaking space after
-- "ENERGY STAR" and the registered mark on Cooling Equipment.
INSERT INTO public.program_measure_products
  (pmp_record_number, pmp_opportunity_record_type, pmp_product_id, pmp_measure_value,
   pmp_is_measure, pmp_notes, is_seed_data)
SELECT '', rt.id, p.id, v.measure, true, v.note, true
FROM (SELECT id FROM public.picklist_values
       WHERE picklist_object='opportunities' AND picklist_field='record_type'
         AND picklist_value='WI-IRA-MF-HOMES') rt,
LATERAL (VALUES
  ('Upgrade to High-Efficiency Boiler', 'Upgrade to High-Efficiency Boiler', NULL::text),
  ('High Efficiency PTAC Replacement',  'High Efficiency PTAC Replacement', NULL),
  ('ENERGY STAR Water Heater',          'ENERGY STAR' || chr(160) || 'Water Heater', NULL),
  ('ENERGY STAR Cooling Equipment',     'ENERGY STAR' || chr(174) || chr(160) || 'Cooling Equipment', NULL),
  ('ENERGY STAR Electric Heat Pump Water Heater',
                                        'ENERGY STAR' || chr(160) || 'Water Heater',
   'The HEAR incentive product. Mapped too, because on a HOMES opportunity it is still a water heater.')
) AS v(product_name, measure, note)
JOIN public.products p ON p.product_name = v.product_name AND p.product_is_deleted IS NOT TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.program_measure_products x
   WHERE x.pmp_opportunity_record_type = rt.id AND x.pmp_product_id = p.id
     AND x.pmp_measure_value = v.measure AND x.pmp_is_deleted IS NOT TRUE);

NOTIFY pgrst, 'reload schema';

DO $assert$
DECLARE v_products int; v_entries int; v_maps int; v_bad text;
BEGIN
  SELECT count(*) INTO v_products FROM public.products
   WHERE product_code IN ('MEAS-BOILER-HE','MEAS-PTAC-HE','MEAS-WATER-HEATER-ES','MEAS-COOLING-ES')
     AND product_is_deleted IS NOT TRUE;
  IF v_products <> 4 THEN
    RAISE EXCEPTION 'Expected 4 new products, found %', v_products;
  END IF;

  -- A product outside the price book cannot be put on a line item at all, so
  -- it would be a measure nobody can ever select.
  SELECT count(*) INTO v_entries
    FROM public.price_book_entries e
    JOIN public.products p ON p.id = e.product_id
    JOIN public.price_books pb ON pb.id = e.price_book_id
   WHERE p.product_code IN ('MEAS-BOILER-HE','MEAS-PTAC-HE','MEAS-WATER-HEATER-ES','MEAS-COOLING-ES')
     AND pb.price_book_name = 'Wisconsin IRA Multifamily HOMES'
     AND e.price_book_entry_is_deleted IS NOT TRUE;
  IF v_entries <> 4 THEN
    RAISE EXCEPTION 'Expected 4 price book entries, found %', v_entries;
  END IF;

  SELECT count(*) INTO v_maps FROM public.program_measure_products
   WHERE pmp_is_measure IS TRUE AND pmp_is_deleted IS NOT TRUE;
  IF v_maps <> 13 THEN
    RAISE EXCEPTION 'Expected 13 measure rulings, found %', v_maps;
  END IF;

  -- Every measure value must be one the HOMES form actually offers. A value
  -- that is not an option ticks nothing and says nothing.
  SELECT string_agg(DISTINCT pmp_measure_value, ' / ') INTO v_bad
    FROM public.program_measure_products
   WHERE pmp_is_measure IS TRUE AND pmp_is_deleted IS NOT TRUE
     AND pmp_measure_value NOT IN (
       'Air Sealing','Ceiling Insulation','Duct Insulation','Duct Sealing','Floor Insulation',
       'Foundation Insulation','Wall Insulation','Ventilation System',
       'ENERGY STAR' || chr(160) || 'Window, Door, Skylight Replacement',
       'ENERGY STAR' || chr(160) || 'Water Heater',
       'ENERGY STAR' || chr(174) || chr(160) || 'Cooling Equipment',
       'ENERGY STAR' || chr(160) || 'Heating Equipment',
       'ENERGY STAR' || chr(160) || 'Appliance Replacement',
       'Replace HVAC PSZ HP + DOAS','Upgrade to High-Efficiency Chiller',
       'High Efficiency Rooftop Heat Pump Replacement','Replace HVAC with VRF + DOAS',
       'High Efficiency PTAC Replacement','High Efficiency WLHP Replacement',
       'Replace HVAC with WLHP + DOAS','High Efficiency PTHP Replacement',
       'High Efficiency Rooftop AC Replacement','Upgrade to High-Efficiency Boiler',
       'Water Saving Measures');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'These measure values are not options on the HOMES form: %', v_bad;
  END IF;
END $assert$;
