-- Opportunity line items: charge products, price book entries, scoped pickers
--
-- Ruling (Nicholas, 2026-07-26): the Product picker on an opportunity line
-- item must show the things EES CHARGES FOR — program measures and incentive
-- lines ("HOMES Project 35% or greater", "Insulation", "Air sealing",
-- "Focus on Energy Wisconsin") — not the physical install/equipment catalog.
--
-- Mechanism (Salesforce parity): a product is sellable on an opportunity only
-- through a price book entry. The line-item Product picker therefore lists
-- products that have an ACTIVE price book entry — scoped to the opportunity's
-- price book when one is set, falling back to any active entry when the
-- opportunity has no price book yet (no opportunity carried a price book at
-- ship time; the picker must never dead-end). Physical/equipment products
-- (no price book entries) stop appearing on line items automatically, with
-- zero hardcoded type filters — pricing a product into a book is what makes
-- it chargeable, all manageable in LEAP going forward.
--
-- Contents:
--   1. Dependent-lookup RPCs (SECURITY INVOKER, RLS applies to caller):
--      list_products_for_opportunity, list_price_book_entries_for_opportunity,
--      list_units_for_opportunity (units via buildings on the opportunity's
--      property — parent-chain rule, same rationale as
--      list_opportunities_for_property).
--   2. Line-item defaults trigger: price book entry drives product + prices,
--      name derives from the product when blank, total = quantity x sales
--      price (recomputed when inputs change unless the total was hand-edited).
--   3. Price book entry defaults trigger: name derives from product + book
--      when blank; product code copies from the product.
--   4. Seed the WI HOMES/FOE charge products + price book entries. Items and
--      rates come from docs/leap-project-paperwork-port.md §3 (invoiceModel):
--      HOMES >=35% -> $10,000/unit, 20-34% -> $5,000/unit; Focus on Energy
--      attic rate from BASELINE attic R: <R-11 $1.00/sqft, R-12-19 $0.70,
--      R-20-38 $0.55. Measure lines (attic insulation, attic air sealing,
--      bath/kitchen aerators, showerheads) carry no fixed price — their line
--      costs are breakout fractions of the project total, so their entries
--      ship with NULL unit price and the price is entered per proposal.
--   5. Page layout config: curated labels + scoped pickers on the line-item
--      layout; Price Book lookup added to every opportunity layout (the
--      column existed but no layout exposed it, so no opportunity could ever
--      set its price book).

-- ---------------------------------------------------------------------------
-- 1. Dependent-lookup RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_products_for_opportunity(
  p_opportunity_ids uuid[],
  p_include_product_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(id uuid, product_name text)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH opp_books AS (
    SELECT o.price_book_id
    FROM opportunities o
    WHERE o.id = ANY(p_opportunity_ids) AND o.price_book_id IS NOT NULL
  )
  SELECT p.id, p.product_name
  FROM products p
  WHERE p.product_is_deleted = false
    AND COALESCE(p.product_is_active, true) = true
    AND (
      EXISTS (
        SELECT 1 FROM price_book_entries pbe
        WHERE pbe.product_id = p.id
          AND pbe.price_book_entry_is_deleted = false
          AND COALESCE(pbe.price_book_entry_is_active, true) = true
          AND COALESCE(pbe.price_book_entry_is_archived, false) = false
          AND (
            pbe.price_book_id IN (SELECT price_book_id FROM opp_books)
            OR NOT EXISTS (SELECT 1 FROM opp_books)
          )
      )
      OR (p_include_product_id IS NOT NULL AND p.id = p_include_product_id)
    )
  ORDER BY p.product_name ASC, p.id ASC;
$function$;

REVOKE ALL ON FUNCTION public.list_products_for_opportunity(uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_products_for_opportunity(uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_products_for_opportunity(uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_products_for_opportunity(uuid[], uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.list_price_book_entries_for_opportunity(
  p_opportunity_ids uuid[],
  p_product_id uuid DEFAULT NULL::uuid,
  p_include_entry_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(id uuid, price_book_entry_name text)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH opp_books AS (
    SELECT o.price_book_id
    FROM opportunities o
    WHERE o.id = ANY(p_opportunity_ids) AND o.price_book_id IS NOT NULL
  )
  SELECT pbe.id, pbe.price_book_entry_name
  FROM price_book_entries pbe
  WHERE pbe.price_book_entry_is_deleted = false
    AND (
      (
        COALESCE(pbe.price_book_entry_is_active, true) = true
        AND COALESCE(pbe.price_book_entry_is_archived, false) = false
        AND (
          pbe.price_book_id IN (SELECT price_book_id FROM opp_books)
          OR NOT EXISTS (SELECT 1 FROM opp_books)
        )
        AND (p_product_id IS NULL OR pbe.product_id = p_product_id)
      )
      OR (p_include_entry_id IS NOT NULL AND pbe.id = p_include_entry_id)
    )
  ORDER BY pbe.price_book_entry_name ASC, pbe.id ASC;
$function$;

REVOKE ALL ON FUNCTION public.list_price_book_entries_for_opportunity(uuid[], uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_price_book_entries_for_opportunity(uuid[], uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_price_book_entries_for_opportunity(uuid[], uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_price_book_entries_for_opportunity(uuid[], uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.list_units_for_opportunity(
  p_opportunity_ids uuid[],
  p_include_unit_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(id uuid, unit_name text)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT u.id, u.unit_name
  FROM units u
  LEFT JOIN buildings b ON b.id = u.building_id AND b.building_is_deleted = false
  WHERE u.unit_is_deleted = false
    AND (
      b.property_id IN (
        SELECT o.property_id FROM opportunities o
        WHERE o.id = ANY(p_opportunity_ids) AND o.property_id IS NOT NULL
      )
      OR (p_include_unit_id IS NOT NULL AND u.id = p_include_unit_id)
    )
  ORDER BY u.unit_name ASC, u.id ASC;
$function$;

REVOKE ALL ON FUNCTION public.list_units_for_opportunity(uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_units_for_opportunity(uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_units_for_opportunity(uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_units_for_opportunity(uuid[], uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Line-item defaults: price book entry drives product + prices; name from
--    product; total = quantity x sales price. SECURITY DEFINER (with explicit
--    REVOKEs, matching the opportunity-account trigger pattern) so the price
--    lookup can never be silently skipped by the caller's RLS.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_opportunity_line_item_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pbe_product_id uuid;
  v_pbe_price numeric;
  v_product_name text;
BEGIN
  -- The price book entry is authoritative for the product and the list price.
  IF NEW.price_book_entry_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.price_book_entry_id IS DISTINCT FROM OLD.price_book_entry_id) THEN
    SELECT pbe.product_id, pbe.price_book_entry_unit_price
      INTO v_pbe_product_id, v_pbe_price
    FROM price_book_entries pbe
    WHERE pbe.id = NEW.price_book_entry_id;
    IF v_pbe_product_id IS NOT NULL THEN
      NEW.product_id := v_pbe_product_id;
    END IF;
    IF NEW.oli_list_price IS NULL THEN
      NEW.oli_list_price := v_pbe_price;
    END IF;
    IF NEW.oli_unit_price IS NULL THEN
      NEW.oli_unit_price := COALESCE(v_pbe_price, NEW.oli_list_price);
    END IF;
  END IF;

  -- Name derives from the product when left blank ('NEW' is the client-side
  -- required-field placeholder, same convention as record numbers).
  IF (NEW.oli_name IS NULL OR btrim(NEW.oli_name) = '' OR NEW.oli_name = 'NEW')
     AND NEW.product_id IS NOT NULL THEN
    SELECT p.product_name INTO v_product_name FROM products p WHERE p.id = NEW.product_id;
    IF v_product_name IS NOT NULL THEN
      NEW.oli_name := v_product_name;
    END IF;
  END IF;

  -- Total = quantity x sales price. Computed when blank, and recomputed when
  -- quantity or sales price change without the total being hand-edited in the
  -- same save.
  IF NEW.oli_quantity IS NOT NULL AND NEW.oli_unit_price IS NOT NULL THEN
    IF NEW.oli_total_price IS NULL
       OR (TG_OP = 'UPDATE'
           AND NEW.oli_total_price IS NOT DISTINCT FROM OLD.oli_total_price
           AND (NEW.oli_quantity IS DISTINCT FROM OLD.oli_quantity
                OR NEW.oli_unit_price IS DISTINCT FROM OLD.oli_unit_price)) THEN
      NEW.oli_total_price := round(NEW.oli_quantity * NEW.oli_unit_price, 2);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_opportunity_line_item_defaults() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_opportunity_line_item_defaults() FROM anon;
REVOKE ALL ON FUNCTION public.set_opportunity_line_item_defaults() FROM authenticated;

DROP TRIGGER IF EXISTS trg_oli_defaults ON public.opportunity_line_items;
CREATE TRIGGER trg_oli_defaults
  BEFORE INSERT OR UPDATE ON public.opportunity_line_items
  FOR EACH ROW EXECUTE FUNCTION public.set_opportunity_line_item_defaults();

-- ---------------------------------------------------------------------------
-- 3. Price book entry defaults: name from product + book when blank;
--    product code copies from the product.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_price_book_entry_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_product_name text;
  v_product_code text;
  v_book_name text;
BEGIN
  IF NEW.price_book_entry_name IS NULL
     OR btrim(NEW.price_book_entry_name) = ''
     OR NEW.price_book_entry_name = 'NEW' THEN
    SELECT p.product_name, p.product_code INTO v_product_name, v_product_code
    FROM products p WHERE p.id = NEW.product_id;
    SELECT pb.price_book_name INTO v_book_name
    FROM price_books pb WHERE pb.id = NEW.price_book_id;
    NEW.price_book_entry_name := trim(BOTH ' -' FROM
      COALESCE(v_product_name, '') ||
      CASE WHEN v_book_name IS NOT NULL THEN ' - ' || v_book_name ELSE '' END);
    IF NEW.price_book_entry_name = '' THEN
      NEW.price_book_entry_name := 'Price Book Entry';
    END IF;
    IF NEW.price_book_entry_product_code IS NULL THEN
      NEW.price_book_entry_product_code := v_product_code;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_price_book_entry_defaults() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_price_book_entry_defaults() FROM anon;
REVOKE ALL ON FUNCTION public.set_price_book_entry_defaults() FROM authenticated;

DROP TRIGGER IF EXISTS trg_pbe_defaults ON public.price_book_entries;
CREATE TRIGGER trg_pbe_defaults
  BEFORE INSERT OR UPDATE ON public.price_book_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_price_book_entry_defaults();

-- ---------------------------------------------------------------------------
-- 4. Seed the WI charge products + price book entries.
--    Rates: docs/leap-project-paperwork-port.md §3. Owner: Nicholas Wood.
--    Guarded by product_code so re-running never duplicates.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_owner uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'; -- Nicholas Wood
  v_rt_product uuid := '569485f7-d71b-42d7-a44c-76ba74b83413'; -- record_type 'Product'
  v_fam_insulation uuid := '4ab5ee11-3076-434f-b851-4b7fbebc9db3';
  v_fam_air_sealing uuid := '8404d2d7-b102-47fd-b2aa-e2e976a61983';
  v_fam_water uuid := '7c2443ac-2d11-4da9-8fea-10e433d6ff82';
  v_fam_services uuid := '3e0d1ef2-5383-4491-856f-4c2f72d969a7';
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('MEAS-ATTIC-INS',   'Attic Insulation',                                                    v_fam_insulation,  'Attic insulation measure line. Quantity = Total Gross Roof Area (sq ft) from the baseline Asset Score report. Line cost is the program breakout fraction of the project total.'),
      ('MEAS-ATTIC-AS',    'Attic Air Sealing',                                                   v_fam_air_sealing, 'Attic air sealing measure line. Quantity = Total Gross Roof Area (sq ft). Line cost is the program breakout fraction of the project total.'),
      ('MEAS-AER-BATH',    'Bathroom Faucet Aerators',                                            v_fam_water,       'Low-flow bathroom faucet aerator measure line. Quantity = count installed. Line cost is the program breakout fraction of the project total.'),
      ('MEAS-AER-KITCHEN', 'Kitchen Faucet Aerators',                                             v_fam_water,       'Low-flow kitchen faucet aerator measure line. Quantity = count installed. Line cost is the program breakout fraction of the project total.'),
      ('MEAS-SHOWERHEAD',  'Low-Flow Showerheads',                                                v_fam_water,       'Low-flow showerhead measure line. Quantity = count installed. Line cost is the program breakout fraction of the project total.'),
      ('SVC-ENERGY-AUDIT', 'Energy Audit',                                                        v_fam_services,    'Energy audit service charge (Energy Audit Invoice). Price set per engagement.'),
      ('HOMES-35-PLUS',    'HOMES Project - 35% or Greater Modeled Savings',                      v_fam_services,    'Wisconsin IRA HOMES incentive: modeled energy savings of 35% or greater. $10,000 per dwelling unit. Quantity = dwelling units.'),
      ('HOMES-20-34',      'HOMES Project - 20% to 34% Modeled Savings',                          v_fam_services,    'Wisconsin IRA HOMES incentive: modeled energy savings of 20% to 34%. $5,000 per dwelling unit. Quantity = dwelling units.'),
      ('FOE-ATTIC-LT-R11', 'Focus on Energy - Attic Insulation Incentive (Baseline Below R-11)',  v_fam_services,    'Focus on Energy Wisconsin attic insulation incentive, baseline attic below R-11: $1.00 per sq ft. Quantity = Total Gross Roof Area (sq ft).'),
      ('FOE-ATTIC-R12-19', 'Focus on Energy - Attic Insulation Incentive (Baseline R-12 to R-19)', v_fam_services,   'Focus on Energy Wisconsin attic insulation incentive, baseline attic R-12 to R-19: $0.70 per sq ft. Quantity = Total Gross Roof Area (sq ft).'),
      ('FOE-ATTIC-R20-38', 'Focus on Energy - Attic Insulation Incentive (Baseline R-20 to R-38)', v_fam_services,   'Focus on Energy Wisconsin attic insulation incentive, baseline attic R-20 to R-38: $0.55 per sq ft. Quantity = Total Gross Roof Area (sq ft).')
    ) AS t(code, name, family, description)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM products p
      WHERE p.product_code = r.code AND p.product_is_deleted = false
    ) THEN
      INSERT INTO products (
        product_record_number, product_name, product_record_type, product_owner,
        product_created_by, product_code, product_family, product_description,
        product_is_active
      ) VALUES (
        'NEW', r.name, v_rt_product, v_owner, v_owner, r.code, r.family,
        r.description, true
      );
    END IF;
  END LOOP;

  -- Price book entries. HOMES books carry the full proposal line set
  -- (measures + both HOMES tiers + the three FOE rates); the current-year
  -- Focus on Energy book carries measures + FOE rates; the audit books carry
  -- the Energy Audit charge. Measure/audit entries have no fixed price.
  INSERT INTO price_book_entries (
    price_book_entry_record_number, price_book_entry_name, price_book_entry_owner,
    price_book_entry_created_by, price_book_id, product_id,
    price_book_entry_product_code, price_book_entry_unit_price,
    price_book_entry_is_active, price_book_entry_use_standard_price
  )
  SELECT
    'NEW', 'NEW', v_owner, v_owner, pb.id, p.id, p.product_code, e.unit_price,
    true, false
  FROM (VALUES
    -- book,                  product code,       unit price
    ('WI-IRA-MF-HOMES',      'MEAS-ATTIC-INS',   NULL::numeric),
    ('WI-IRA-MF-HOMES',      'MEAS-ATTIC-AS',    NULL),
    ('WI-IRA-MF-HOMES',      'MEAS-AER-BATH',    NULL),
    ('WI-IRA-MF-HOMES',      'MEAS-AER-KITCHEN', NULL),
    ('WI-IRA-MF-HOMES',      'MEAS-SHOWERHEAD',  NULL),
    ('WI-IRA-MF-HOMES',      'HOMES-35-PLUS',    10000),
    ('WI-IRA-MF-HOMES',      'HOMES-20-34',      5000),
    ('WI-IRA-MF-HOMES',      'FOE-ATTIC-LT-R11', 1.00),
    ('WI-IRA-MF-HOMES',      'FOE-ATTIC-R12-19', 0.70),
    ('WI-IRA-MF-HOMES',      'FOE-ATTIC-R20-38', 0.55),
    ('WI-IRA-FOE-SF-HOMES',  'MEAS-ATTIC-INS',   NULL),
    ('WI-IRA-FOE-SF-HOMES',  'MEAS-ATTIC-AS',    NULL),
    ('WI-IRA-FOE-SF-HOMES',  'MEAS-AER-BATH',    NULL),
    ('WI-IRA-FOE-SF-HOMES',  'MEAS-AER-KITCHEN', NULL),
    ('WI-IRA-FOE-SF-HOMES',  'MEAS-SHOWERHEAD',  NULL),
    ('WI-IRA-FOE-SF-HOMES',  'HOMES-35-PLUS',    10000),
    ('WI-IRA-FOE-SF-HOMES',  'HOMES-20-34',      5000),
    ('WI-IRA-FOE-SF-HOMES',  'FOE-ATTIC-LT-R11', 1.00),
    ('WI-IRA-FOE-SF-HOMES',  'FOE-ATTIC-R12-19', 0.70),
    ('WI-IRA-FOE-SF-HOMES',  'FOE-ATTIC-R20-38', 0.55),
    ('FOE-2026-WI',          'MEAS-ATTIC-INS',   NULL),
    ('FOE-2026-WI',          'MEAS-ATTIC-AS',    NULL),
    ('FOE-2026-WI',          'FOE-ATTIC-LT-R11', 1.00),
    ('FOE-2026-WI',          'FOE-ATTIC-R12-19', 0.70),
    ('FOE-2026-WI',          'FOE-ATTIC-R20-38', 0.55),
    ('WI-IRA-MF-HOMES-Audit','SVC-ENERGY-AUDIT', NULL),
    ('WI-IRA-SF-HOMES-AUDIT','SVC-ENERGY-AUDIT', NULL)
  ) AS e(book_name, product_code, unit_price)
  JOIN price_books pb ON pb.price_book_name = e.book_name AND pb.price_book_is_deleted = false
  JOIN products p ON p.product_code = e.product_code AND p.product_is_deleted = false
  WHERE NOT EXISTS (
    SELECT 1 FROM price_book_entries x
    WHERE x.price_book_id = pb.id AND x.product_id = p.id
      AND x.price_book_entry_is_deleted = false
  );
END $$;

-- ---------------------------------------------------------------------------
-- 5a. Curate the opportunity line item layout: proper labels + scoped pickers.
-- ---------------------------------------------------------------------------

UPDATE page_layout_widgets plw
SET widget_config = jsonb_set(
  plw.widget_config,
  '{fields}',
  (
    SELECT jsonb_agg(
      CASE f->>'name'
        WHEN 'oli_record_number' THEN f || jsonb_build_object('label', 'Line Item Number')
        WHEN 'oli_name'          THEN f || jsonb_build_object('label', 'Line Item Name')
        WHEN 'opportunity_id'    THEN f || jsonb_build_object('label', 'Opportunity')
        -- The lookup_dependency keys that scope these three pickers live in
        -- 20260726240000 — they depend on frontend code and must not land
        -- before the matching bundle is deployed.
        WHEN 'product_id'        THEN f || jsonb_build_object('label', 'Product')
        WHEN 'price_book_entry_id' THEN f || jsonb_build_object('label', 'Price Book Entry')
        WHEN 'unit_id'           THEN f || jsonb_build_object('label', 'Unit')
        WHEN 'oli_quantity'      THEN f || jsonb_build_object('label', 'Quantity')
        WHEN 'oli_unit_price'    THEN f || jsonb_build_object('label', 'Sales Price')
        WHEN 'oli_list_price'    THEN f || jsonb_build_object('label', 'List Price')
        WHEN 'oli_total_price'   THEN f || jsonb_build_object('label', 'Total Price')
        WHEN 'oli_type'          THEN f || jsonb_build_object('label', 'Line Item Type')
        WHEN 'oli_existing_condition_and_location' THEN f || jsonb_build_object('label', 'Existing Condition and Location')
        WHEN 'oli_line_description' THEN f || jsonb_build_object('label', 'Line Description')
        WHEN 'oli_estimated_term_savings' THEN f || jsonb_build_object('label', 'Estimated Term Savings')
        WHEN 'oli_sort_order'    THEN f || jsonb_build_object('label', 'Sort Order')
        WHEN 'oli_notes'         THEN f || jsonb_build_object('label', 'Notes')
        ELSE f
      END
      ORDER BY ord
    )
    FROM jsonb_array_elements(plw.widget_config->'fields') WITH ORDINALITY AS t(f, ord)
  )
)
FROM page_layout_sections pls, page_layouts pl
WHERE plw.section_id = pls.id
  AND pls.page_layout_id = pl.id
  AND pl.page_layout_object = 'opportunity_line_items'
  AND pl.is_deleted IS NOT TRUE
  AND pls.is_deleted IS NOT TRUE
  AND plw.is_deleted IS NOT TRUE
  AND plw.widget_type = 'field_group'
  AND plw.widget_config ? 'fields';

-- ---------------------------------------------------------------------------
-- 5b. Expose the Price Book lookup on every opportunity layout (appended to
--     the field group that carries opportunity_name), where not already shown.
-- ---------------------------------------------------------------------------

WITH target_widgets AS (
  SELECT DISTINCT ON (pl.id) plw.id
  FROM page_layouts pl
  JOIN page_layout_sections pls ON pls.page_layout_id = pl.id AND pls.is_deleted IS NOT TRUE
  JOIN page_layout_widgets plw ON plw.section_id = pls.id AND plw.is_deleted IS NOT TRUE
    AND plw.widget_type = 'field_group'
  WHERE pl.page_layout_object = 'opportunities'
    AND pl.is_deleted IS NOT TRUE
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(plw.widget_config->'fields') f
      WHERE f->>'name' = 'opportunity_name'
    )
    AND NOT EXISTS (
      -- no field group anywhere on this layout already shows price_book_id
      SELECT 1
      FROM page_layout_sections pls2
      JOIN page_layout_widgets plw2 ON plw2.section_id = pls2.id
        AND plw2.is_deleted IS NOT TRUE AND plw2.widget_type = 'field_group'
      CROSS JOIN LATERAL jsonb_array_elements(plw2.widget_config->'fields') f2
      WHERE pls2.page_layout_id = pl.id AND pls2.is_deleted IS NOT TRUE
        AND f2->>'name' = 'price_book_id'
    )
  ORDER BY pl.id, plw.widget_position NULLS LAST, plw.id
)
UPDATE page_layout_widgets plw
SET widget_config = jsonb_set(
  plw.widget_config,
  '{fields}',
  (plw.widget_config->'fields') || jsonb_build_object(
    'name', 'price_book_id',
    'type', 'lookup',
    'label', 'Price Book',
    'lookup_table', 'price_books',
    'lookup_field', 'price_book_name'
  )
)
FROM target_widgets tw
WHERE plw.id = tw.id;

NOTIFY pgrst, 'reload schema';
