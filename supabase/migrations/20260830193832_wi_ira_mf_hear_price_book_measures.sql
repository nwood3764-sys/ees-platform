-- Wisconsin IRA Multifamily HEAR — price book contents
--
-- PB-00005 "Wisconsin IRA Multifamily HEAR" already existed and was already
-- mapped to the WI-IRA-MF-HEAR opportunity record type (ORTPB-00006), and the
-- Line Items grid is already on that record type's page layout (PL-00341).
-- The book was EMPTY, and list_products_for_opportunity() scopes the product
-- picker to the opportunity's own price book -- so "Add Product" on every live
-- WI-IRA-MF-HEAR opportunity offered nothing at all. This fills the book; no
-- schema change and no new mechanism is needed.
--
-- Amounts and measure wording are taken from EES's own HEAR Proposal-Contract
-- worksheet (public/paperwork/invoice_workbook.xlsx, sheet "HEAR
-- Proposal-Contract", rebate lookup table P31:Q38), NOT from an outside
-- summary of the program. They are the per-dwelling-unit HEAR rebate caps.
--
-- Pricing semantics -- this is the one thing to understand before editing:
--   price_book_entry_unit_price = the HEAR cap for that measure. trg_oli_defaults
--     copies it onto opportunity_line_items.oli_list_price when the product is
--     added, so the cap travels with the line and is visible on screen.
--   oli_unit_price (Sales Price) defaults to the cap and stays editable, because
--     HEAR pays the LESSER of actual project cost and the cap -- a line that
--     claims less than the cap is normal, and the variance against List Price is
--     then readable straight off the grid.
--   oli_quantity = dwelling units receiving that measure (the worksheet's "Unit").
-- This is why the caps are prices rather than a hardcoded table: the HOMES
-- measure products carry a null price because HOMES has no per-measure cap, and
-- HEAR does.
--
-- Deliberately NOT built here: the $14,000 per-dwelling-unit aggregate HEAR cap
-- across all measures. That is a validation rule that would refuse saves on live
-- opportunities, and whether EES wants a hard block or a soft warning is a
-- business call -- it is recorded as an open item rather than guessed at.



-- 1. "Electrical" product family -----------------------------------------------
-- Panel upgrades and wiring are core HEAR electrification measures and the
-- family taxonomy had no Electrical value; filing them under Services would have
-- been a workaround. Additive, admin-manageable, nothing hardcoded.
INSERT INTO picklist_values (
  picklist_object, picklist_field, picklist_value, picklist_label,
  picklist_is_active, picklist_sort_order
)
SELECT 'products', 'product_family', 'Electrical', 'Electrical', true, 11
WHERE NOT EXISTS (
  SELECT 1 FROM picklist_values
  WHERE picklist_object = 'products' AND picklist_field = 'product_family'
    AND picklist_value = 'Electrical'
);

-- 2. The seven HEAR measure products -------------------------------------------
WITH owner_user AS (
  SELECT COALESCE(
    (SELECT id FROM users WHERE user_email = 'nicholas.wood@ees-wi.org' LIMIT 1),
    (SELECT id FROM users WHERE user_is_active IS TRUE LIMIT 1)
  ) AS id
),
measure(code, name, family, descr) AS (
  VALUES
    ('HEAR-HPWH',
     'ENERGY STAR Electric Heat Pump Water Heater',
     'Water Heating',
     'HEAR measure line: ENERGY STAR electric heat pump water heater. Quantity = dwelling units receiving the measure. List price is the HEAR rebate cap of $1,750 per dwelling unit; sales price is what the project actually claims (HEAR pays the lesser of cost and cap).'),
    ('HEAR-HP-SPACE-HEAT-COOL',
     'ENERGY STAR Electric Heat Pump for Space Heating and Cooling',
     'HVAC Equipment',
     'HEAR measure line: ENERGY STAR electric heat pump for space heating and cooling. Quantity = dwelling units receiving the measure. List price is the HEAR rebate cap of $8,000 per dwelling unit; sales price is what the project actually claims (HEAR pays the lesser of cost and cap).'),
    ('HEAR-PANEL',
     'Electrical Load Service Center (Electrical Panel)',
     'Electrical',
     'HEAR measure line: electrical load service center (electrical panel) upgrade. Quantity = dwelling units receiving the measure. List price is the HEAR rebate cap of $4,000 per dwelling unit; sales price is what the project actually claims (HEAR pays the lesser of cost and cap).'),
    ('HEAR-WIRING',
     'Electrical Wiring',
     'Electrical',
     'HEAR measure line: electrical wiring. Quantity = dwelling units receiving the measure. List price is the HEAR rebate cap of $2,500 per dwelling unit; sales price is what the project actually claims (HEAR pays the lesser of cost and cap).'),
    ('HEAR-VENT',
     'ENERGY STAR Ventilation',
     'Ventilation',
     'HEAR measure line: ENERGY STAR ventilation. Quantity = dwelling units receiving the measure. List price is the HEAR rebate cap of $1,600 per dwelling unit; sales price is what the project actually claims (HEAR pays the lesser of cost and cap).'),
    ('HEAR-DRYER',
     'ENERGY STAR Electric Heat Pump Clothes Dryer',
     'Appliances',
     'HEAR measure line: ENERGY STAR electric heat pump clothes dryer. Quantity = dwelling units receiving the measure. List price is the HEAR rebate cap of $840 per dwelling unit; sales price is what the project actually claims (HEAR pays the lesser of cost and cap).'),
    ('HEAR-STOVE',
     'ENERGY STAR Electric Stove, Cooktop, or Range',
     'Appliances',
     'HEAR measure line: ENERGY STAR electric stove, cooktop, or range. Quantity = dwelling units receiving the measure. List price is the HEAR rebate cap of $840 per dwelling unit; sales price is what the project actually claims (HEAR pays the lesser of cost and cap).')
)
INSERT INTO products (
  product_record_number, product_name, product_code, product_record_type,
  product_family, product_description, product_is_active,
  product_owner, product_created_by
)
SELECT
  '',                                            -- trg_product_rn fills PRD-#####
  m.name, m.code,
  (SELECT id FROM picklist_values
    WHERE picklist_object = 'products' AND picklist_field = 'record_type'
      AND picklist_value = 'PRODUCT' LIMIT 1),
  (SELECT id FROM picklist_values
    WHERE picklist_object = 'products' AND picklist_field = 'product_family'
      AND picklist_value = m.family LIMIT 1),
  m.descr, true,
  (SELECT id FROM owner_user), (SELECT id FROM owner_user)
FROM measure m
WHERE NOT EXISTS (
  SELECT 1 FROM products p
  WHERE p.product_code = m.code AND p.product_is_deleted IS NOT TRUE
);

-- 3. Price book entries in PB-00005 --------------------------------------------
WITH owner_user AS (
  SELECT COALESCE(
    (SELECT id FROM users WHERE user_email = 'nicholas.wood@ees-wi.org' LIMIT 1),
    (SELECT id FROM users WHERE user_is_active IS TRUE LIMIT 1)
  ) AS id
),
book AS (
  SELECT id FROM price_books
  WHERE price_book_name = 'Wisconsin IRA Multifamily HEAR'
    AND price_book_is_deleted IS NOT TRUE
  LIMIT 1
),
cap(code, amount) AS (
  VALUES
    ('HEAR-HPWH',               1750.00::numeric),
    ('HEAR-HP-SPACE-HEAT-COOL', 8000.00::numeric),
    ('HEAR-PANEL',              4000.00::numeric),
    ('HEAR-WIRING',             2500.00::numeric),
    ('HEAR-VENT',               1600.00::numeric),
    ('HEAR-DRYER',               840.00::numeric),
    ('HEAR-STOVE',               840.00::numeric)
)
INSERT INTO price_book_entries (
  price_book_entry_record_number, price_book_entry_name, price_book_id, product_id,
  price_book_entry_product_code, price_book_entry_unit_price,
  price_book_entry_is_active, price_book_entry_use_standard_price,
  price_book_entry_owner, price_book_entry_created_by
)
SELECT
  '',                                            -- trg_pbe_rn fills PBE-#####
  '',                                            -- trg_pbe_defaults derives the name
  (SELECT id FROM book), p.id, c.code, c.amount, true, false,
  (SELECT id FROM owner_user), (SELECT id FROM owner_user)
FROM cap c
JOIN products p ON p.product_code = c.code AND p.product_is_deleted IS NOT TRUE
WHERE (SELECT id FROM book) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM price_book_entries e
    WHERE e.price_book_id = (SELECT id FROM book) AND e.product_id = p.id
  );

-- 4. Prove it, rather than assume it -------------------------------------------
DO $$
DECLARE
  v_book  uuid;
  v_count integer;
  v_opp   uuid;
  v_total numeric;
BEGIN
  SELECT id INTO v_book FROM price_books
   WHERE price_book_name = 'Wisconsin IRA Multifamily HEAR'
     AND price_book_is_deleted IS NOT TRUE;
  IF v_book IS NULL THEN
    RAISE EXCEPTION 'Price book "Wisconsin IRA Multifamily HEAR" not found';
  END IF;

  SELECT count(*), sum(price_book_entry_unit_price) INTO v_count, v_total
  FROM price_book_entries
  WHERE price_book_id = v_book
    AND price_book_entry_is_deleted IS NOT TRUE
    AND COALESCE(price_book_entry_is_active, true);
  IF v_count <> 7 THEN
    RAISE EXCEPTION 'Expected 7 active HEAR price book entries, found %', v_count;
  END IF;

  -- The seven caps sum to $19,530 of measure headroom against a $14,000
  -- per-dwelling-unit aggregate cap. Asserting the sum pins every individual
  -- amount against EES's worksheet, so a silent edit to one of them fails here.
  IF v_total <> 19530.00 THEN
    RAISE EXCEPTION 'HEAR caps sum to %, expected 19530.00', v_total;
  END IF;

  -- The actual defect was that the product picker came back empty. Check the
  -- function the picker calls, on a real WI-IRA-MF-HEAR opportunity.
  SELECT o.id INTO v_opp
  FROM opportunities o
  JOIN picklist_values rt ON rt.id = o.opportunity_record_type
  WHERE rt.picklist_value = 'WI-IRA-MF-HEAR'
    AND o.opportunity_is_deleted IS NOT TRUE
  LIMIT 1;

  IF v_opp IS NOT NULL THEN
    SELECT count(*) INTO v_count
    FROM list_products_for_opportunity(ARRAY[v_opp]::uuid[], NULL);
    IF v_count <> 7 THEN
      RAISE EXCEPTION
        'Product picker on a WI-IRA-MF-HEAR opportunity returned % products, expected 7',
        v_count;
    END IF;
  END IF;
END $$;


