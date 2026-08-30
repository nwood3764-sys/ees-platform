-- HEAR line descriptions are the Wisconsin rebate table's own wording
--
-- Nicholas, looking at the Products card on a live HEAR opportunity: "your line
-- descriptions need to match exactly what the Wisconsin rebate table has."
--
-- He is right, and the mistake is worth naming: product_description is not a
-- place for notes. set_opportunity_line_item_defaults() copies it into
-- opportunity_line_items.oli_line_description on every add, so it IS the Line
-- Description a user reads on the opportunity and the text that flows onto the
-- proposal. It had been filled with an explanation of how the pricing works --
-- true, but internal, and three paragraphs wide in a table column.
--
-- The description is now the measure name exactly as EES's own HEAR
-- Proposal-Contract worksheet writes it (public/paperwork/invoice_workbook.xlsx,
-- rebate table Q32:Q38), character for character including the registered mark,
-- the sentence casing and the footnote asterisk on the cooking line. The only
-- edit is trimming a trailing non-breaking space the spreadsheet carries in Q32.
--
-- The pricing explanation moves to product_help_text, which is what that column
-- is for -- it stays available to whoever maintains the price book without
-- printing itself onto every line item.

WITH measure(code, descr, help) AS (
  VALUES
    ('HEAR-HPWH',
     'ENERGY STAR® electric heat pump water heater',
     'HEAR rebate cap $1,750 per dwelling unit. Quantity = dwelling units receiving the measure; list price is the cap and sales price is what the project actually claims (HEAR pays the lesser of cost and cap).'),
    ('HEAR-HP-SPACE-HEAT-COOL',
     'ENERGY STAR electric heat pump for space heating and cooling',
     'HEAR rebate cap $8,000 per dwelling unit. Quantity = dwelling units receiving the measure; list price is the cap and sales price is what the project actually claims (HEAR pays the lesser of cost and cap).'),
    ('HEAR-PANEL',
     'Electrical load service center (electrical panel)',
     'HEAR rebate cap $4,000 per dwelling unit. Quantity = dwelling units receiving the measure; list price is the cap and sales price is what the project actually claims (HEAR pays the lesser of cost and cap).'),
    ('HEAR-WIRING',
     'Electrical Wiring',
     'HEAR rebate cap $2,500 per dwelling unit. Quantity = dwelling units receiving the measure; list price is the cap and sales price is what the project actually claims (HEAR pays the lesser of cost and cap).'),
    ('HEAR-VENT',
     'ENERGY STAR ventilation',
     'HEAR rebate cap $1,600 per dwelling unit. Quantity = dwelling units receiving the measure; list price is the cap and sales price is what the project actually claims (HEAR pays the lesser of cost and cap).'),
    ('HEAR-DRYER',
     'ENERGY STAR electric heat pump clothes dryer',
     'HEAR rebate cap $840 per dwelling unit. Quantity = dwelling units receiving the measure; list price is the cap and sales price is what the project actually claims (HEAR pays the lesser of cost and cap).'),
    ('HEAR-STOVE',
     'ENERGY STAR electric stove, ENERGY STAR cooktop, ENERGY STAR range*',
     'HEAR rebate cap $840 per dwelling unit. Quantity = dwelling units receiving the measure; list price is the cap and sales price is what the project actually claims (HEAR pays the lesser of cost and cap).')
)
UPDATE products p
   SET product_description = m.descr,
       product_help_text   = m.help
  FROM measure m
 WHERE p.product_code = m.code
   AND p.product_is_deleted IS NOT TRUE;

-- Line items already created carry a COPY of the old description, so correcting
-- the product alone would leave the live rows reading the old text. Only rows
-- still holding that exact copy are touched -- a description someone has since
-- edited by hand is their own and is left alone.
WITH measure(code, old_prefix, descr) AS (
  VALUES
    ('HEAR-HPWH',               'HEAR measure line:', 'ENERGY STAR® electric heat pump water heater'),
    ('HEAR-HP-SPACE-HEAT-COOL', 'HEAR measure line:', 'ENERGY STAR electric heat pump for space heating and cooling'),
    ('HEAR-PANEL',              'HEAR measure line:', 'Electrical load service center (electrical panel)'),
    ('HEAR-WIRING',             'HEAR measure line:', 'Electrical Wiring'),
    ('HEAR-VENT',               'HEAR measure line:', 'ENERGY STAR ventilation'),
    ('HEAR-DRYER',              'HEAR measure line:', 'ENERGY STAR electric heat pump clothes dryer'),
    ('HEAR-STOVE',              'HEAR measure line:', 'ENERGY STAR electric stove, ENERGY STAR cooktop, ENERGY STAR range*')
)
UPDATE opportunity_line_items oli
   SET oli_line_description = m.descr
  FROM products p, measure m
 WHERE oli.product_id = p.id
   AND p.product_code = m.code
   AND oli.oli_is_deleted IS NOT TRUE
   AND oli.oli_line_description LIKE m.old_prefix || '%';

DO $$
DECLARE
  v_bad integer;
BEGIN
  -- Every HEAR product now reads as the rebate table, not as a note.
  SELECT count(*) INTO v_bad FROM products
   WHERE product_code LIKE 'HEAR-%' AND product_is_deleted IS NOT TRUE
     AND (product_description LIKE '%dwelling units receiving%'
          OR product_description LIKE 'HEAR measure line:%');
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% HEAR products still carry the explanatory description', v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM opportunity_line_items oli
    JOIN products p ON p.id = oli.product_id
   WHERE p.product_code LIKE 'HEAR-%' AND oli.oli_is_deleted IS NOT TRUE
     AND oli.oli_line_description LIKE 'HEAR measure line:%';
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% live HEAR line items still carry the explanatory description', v_bad;
  END IF;

  -- Pin the exact wording of the two lines most likely to be "tidied" later.
  IF NOT EXISTS (
    SELECT 1 FROM products
    WHERE product_code = 'HEAR-HPWH'
      AND product_description = 'ENERGY STAR® electric heat pump water heater'
  ) THEN
    RAISE EXCEPTION 'HEAR-HPWH description does not match the rebate table exactly';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM products
    WHERE product_code = 'HEAR-STOVE'
      AND product_description = 'ENERGY STAR electric stove, ENERGY STAR cooktop, ENERGY STAR range*'
  ) THEN
    RAISE EXCEPTION 'HEAR-STOVE description does not match the rebate table exactly';
  END IF;
END $$;
