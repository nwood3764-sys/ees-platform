-- IRA HEAR price books for every state we run, all six of them
--
-- Nicholas: "every state has a $14,000 limit on here. Every state has the exact
-- same line items with the exact same amounts. But I need separate price books
-- for sure. Just go ahead and build it all out so we know that it's correct."
-- (and, on scope: "when I say 'every state', I just mean the states we're
-- working with.")
--
-- The states with a HEAR opportunity record type are WI, NC and MI, each in a
-- multifamily and a single-family flavour -- six programs. Before this, only
-- WI-IRA-MF-HEAR had a populated book; WI-IRA-SF-HEAR had an empty one and the
-- four NC/MI programs had no book at all, so their product picker was empty for
-- the same reason multifamily Wisconsin's was.
--
-- SEPARATE BOOKS, SHARED PRODUCTS -- this is the distinction that matters and it
-- is exactly what a price book is for. A PRODUCT is the catalogue item ("ENERGY
-- STAR electric heat pump water heater"); a PRICE BOOK ENTRY is that product's
-- price within one program. price_book_entries is UNIQUE (price_book_id,
-- product_id), so one product can be priced into many books and each book stays
-- its own artifact -- which is what lets Michigan's amounts diverge later
-- without touching Wisconsin. Cloning the seven products six times would have
-- been the workaround: 42 catalogue rows all meaning the same measure, and six
-- places to fix when a measure is renamed. The platform already does it this
-- way -- PRD-00013 Attic Insulation is priced into three different books.
--
-- The amounts are identical across all six today because the HEAR caps are
-- federal. That is a fact about the programs, not an excuse to share one book.

-- 1. The four missing books --------------------------------------------------
WITH owner_user AS (
  SELECT COALESCE(
    (SELECT id FROM users WHERE user_email = 'nicholas.wood@ees-wi.org' LIMIT 1),
    (SELECT id FROM users WHERE user_is_active IS TRUE LIMIT 1)
  ) AS id
),
book(name, descr) AS (
  VALUES
    ('North Carolina IRA Multifamily HEAR',  'IRA Home Electrification and Appliance Rebates — North Carolina, multifamily.'),
    ('North Carolina IRA Single-Family HEAR','IRA Home Electrification and Appliance Rebates — North Carolina, single-family.'),
    ('Michigan IRA Multifamily HEAR',        'IRA Home Electrification and Appliance Rebates — Michigan, multifamily.'),
    ('Michigan IRA Single-Family HEAR',      'IRA Home Electrification and Appliance Rebates — Michigan, single-family.')
)
INSERT INTO price_books (
  price_book_record_number, price_book_name, price_book_description,
  price_book_is_active, price_book_is_standard,
  price_book_owner, price_book_created_by
)
SELECT '', b.name, b.descr, true, false,
       (SELECT id FROM owner_user), (SELECT id FROM owner_user)
FROM book b
WHERE NOT EXISTS (
  SELECT 1 FROM price_books pb
  WHERE pb.price_book_name = b.name AND pb.price_book_is_deleted IS NOT TRUE
);

-- 2. Each program points at its own book ------------------------------------
-- Inserting here fires cascade_price_book_to_opportunities, which stamps
-- price_book_id onto any existing opportunity of that record type. That is the
-- intended behaviour: the record type dictates the book.
WITH owner_user AS (
  SELECT COALESCE(
    (SELECT id FROM users WHERE user_email = 'nicholas.wood@ees-wi.org' LIMIT 1),
    (SELECT id FROM users WHERE user_is_active IS TRUE LIMIT 1)
  ) AS id
),
pairing(rt_value, book_name) AS (
  VALUES
    ('WI-IRA-MF-HEAR', 'Wisconsin IRA Multifamily HEAR'),
    ('WI-IRA-SF-HEAR', 'Wisconsin IRA Single-Family HEAR'),
    ('NC-IRA-MF-HEAR', 'North Carolina IRA Multifamily HEAR'),
    ('NC-IRA-SF-HEAR', 'North Carolina IRA Single-Family HEAR'),
    ('MI-IRA-MF-HEAR', 'Michigan IRA Multifamily HEAR'),
    ('MI-IRA-SF-HEAR', 'Michigan IRA Single-Family HEAR')
)
INSERT INTO opportunity_record_type_price_books (
  ortpb_record_number, ortpb_record_type_id, price_book_id,
  ortpb_owner, ortpb_created_by
)
SELECT '', rt.id, pb.id,
       (SELECT id FROM owner_user), (SELECT id FROM owner_user)
FROM pairing p
JOIN picklist_values rt
  ON rt.picklist_object = 'opportunities' AND rt.picklist_field = 'record_type'
 AND rt.picklist_value = p.rt_value
JOIN price_books pb
  ON pb.price_book_name = p.book_name AND pb.price_book_is_deleted IS NOT TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM opportunity_record_type_price_books m
  WHERE m.ortpb_record_type_id = rt.id AND m.ortpb_is_deleted IS NOT TRUE
);

-- 3. The same seven measures, at the same caps, in every HEAR book -----------
WITH owner_user AS (
  SELECT COALESCE(
    (SELECT id FROM users WHERE user_email = 'nicholas.wood@ees-wi.org' LIMIT 1),
    (SELECT id FROM users WHERE user_is_active IS TRUE LIMIT 1)
  ) AS id
),
hear_book AS (
  SELECT pb.id
  FROM price_books pb
  WHERE pb.price_book_is_deleted IS NOT TRUE
    AND pb.price_book_name IN (
      'Wisconsin IRA Multifamily HEAR','Wisconsin IRA Single-Family HEAR',
      'North Carolina IRA Multifamily HEAR','North Carolina IRA Single-Family HEAR',
      'Michigan IRA Multifamily HEAR','Michigan IRA Single-Family HEAR')
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
SELECT '', '', hb.id, p.id, c.code, c.amount, true, false,
       (SELECT id FROM owner_user), (SELECT id FROM owner_user)
FROM hear_book hb
CROSS JOIN cap c
JOIN products p ON p.product_code = c.code AND p.product_is_deleted IS NOT TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM price_book_entries e
  WHERE e.price_book_id = hb.id AND e.product_id = p.id
);

-- 4. The $14,000 cap on every HEAR program, Michigan included ---------------
INSERT INTO program_rebate_caps (
  prc_record_number, prc_name, prc_opportunity_record_type_id,
  prc_cap_per_dwelling_unit, prc_is_active, prc_notes, prc_owner
)
SELECT '',
       rt.picklist_value || ' — Rebate Cap per Dwelling Unit',
       rt.id, 14000.00, true,
       'Federal IRA HEAR aggregate cap: $14,000 per dwelling unit across all measures.',
       (SELECT id FROM users WHERE user_email = 'nicholas.wood@ees-wi.org' LIMIT 1)
FROM picklist_values rt
WHERE rt.picklist_object = 'opportunities' AND rt.picklist_field = 'record_type'
  AND rt.picklist_value LIKE '%-IRA-%-HEAR'
  AND NOT EXISTS (
    SELECT 1 FROM program_rebate_caps c
    WHERE c.prc_opportunity_record_type_id = rt.id AND c.prc_is_deleted IS NOT TRUE
  );

-- 5. Prove all six, not just the one that started this ----------------------
DO $$
DECLARE
  v_rt      record;
  v_count   integer;
  v_total   numeric;
  v_books   integer;
  v_opp     uuid;
BEGIN
  SELECT count(*) INTO v_books
  FROM price_books
  WHERE price_book_is_deleted IS NOT TRUE AND price_book_name LIKE '%HEAR%';
  IF v_books <> 6 THEN
    RAISE EXCEPTION 'Expected 6 HEAR price books, found %', v_books;
  END IF;

  FOR v_rt IN
    SELECT rt.id, rt.picklist_value
    FROM picklist_values rt
    WHERE rt.picklist_object = 'opportunities' AND rt.picklist_field = 'record_type'
      AND rt.picklist_value LIKE '%-IRA-%-HEAR'
    ORDER BY rt.picklist_value
  LOOP
    -- exactly one book, carrying exactly the seven measures at the right prices
    SELECT count(*), COALESCE(sum(e.price_book_entry_unit_price), 0)
      INTO v_count, v_total
    FROM opportunity_record_type_price_books m
    JOIN price_book_entries e ON e.price_book_id = m.price_book_id
     AND e.price_book_entry_is_deleted IS NOT TRUE
     AND COALESCE(e.price_book_entry_is_active, true)
    WHERE m.ortpb_record_type_id = v_rt.id AND m.ortpb_is_deleted IS NOT TRUE;

    IF v_count <> 7 THEN
      RAISE EXCEPTION '% has % price book entries, expected 7', v_rt.picklist_value, v_count;
    END IF;
    IF v_total <> 19530.00 THEN
      RAISE EXCEPTION '% caps sum to %, expected 19530.00', v_rt.picklist_value, v_total;
    END IF;

    -- and a $14,000 per-unit cap
    SELECT count(*) INTO v_count FROM program_rebate_caps
     WHERE prc_opportunity_record_type_id = v_rt.id AND prc_is_deleted IS NOT TRUE
       AND prc_cap_per_dwelling_unit = 14000.00;
    IF v_count <> 1 THEN
      RAISE EXCEPTION '% does not carry exactly one $14,000 per-unit cap', v_rt.picklist_value;
    END IF;
  END LOOP;

  -- No book is shared between two programs: six programs, six distinct books.
  SELECT count(DISTINCT m.price_book_id) INTO v_count
  FROM opportunity_record_type_price_books m
  JOIN picklist_values rt ON rt.id = m.ortpb_record_type_id
  WHERE m.ortpb_is_deleted IS NOT TRUE AND rt.picklist_value LIKE '%-IRA-%-HEAR';
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'HEAR programs share books: % distinct books across 6 programs', v_count;
  END IF;

  -- The picker actually returns them on a live opportunity.
  SELECT o.id INTO v_opp
  FROM opportunities o
  JOIN picklist_values rt ON rt.id = o.opportunity_record_type
  WHERE rt.picklist_value LIKE '%-IRA-%-HEAR' AND o.opportunity_is_deleted IS NOT TRUE
  LIMIT 1;
  IF v_opp IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM list_products_for_opportunity(ARRAY[v_opp]::uuid[], NULL);
    IF v_count <> 7 THEN
      RAISE EXCEPTION 'Product picker returned % products on a HEAR opportunity, expected 7', v_count;
    END IF;
  END IF;
END $$;
