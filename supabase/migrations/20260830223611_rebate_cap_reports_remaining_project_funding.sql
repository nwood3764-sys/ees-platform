-- The rebate cap row also reports the project's remaining HEAR funding
--
-- Nicholas: "on the HEAR opportunity, you need to just have the total, but in
-- that same row you can say total per unit, or per unit total, and then
-- remaining available HEAR funding so you'd have 14,000 times the units minus
-- the grand total, right? So that you can show the user how much remaining
-- budget is left so if they could add more measures, they know."
--
-- Two different questions, and the card now answers both in one row:
--   PER UNIT  -- is any single dwelling unit over its $14,000 cap? (the rule)
--   PROJECT   -- cap x units - grand total = money still available to spend.
-- The second is the one you estimate against; the first is the one that makes a
-- submission bounce. They are not redundant: a project can sit under its total
-- budget while one unit is over its cap, because the caps are per unit.
--
-- Unit count comes from the BUILDING when there is one, because a multifamily
-- HEAR reservation is building-specific, falling back to the opportunity's own
-- rollup. When neither is known the project figures come back NULL rather than
-- zero -- a zero budget would read as "no money left" when the truth is "nobody
-- has said how many units this is."

DROP FUNCTION IF EXISTS opportunity_rebate_cap_status(uuid);

CREATE FUNCTION opportunity_rebate_cap_status(p_opportunity_id uuid)
RETURNS TABLE (
  program_label      text,
  cap_per_unit       numeric,
  amount_per_unit    numeric,
  headroom_per_unit  numeric,
  is_over_cap        boolean,
  building_wide      numeric,
  worst_unit_extra   numeric,
  unit_count         integer,
  total_available    numeric,
  grand_total        numeric,
  remaining_budget   numeric
)
LANGUAGE sql STABLE
SET search_path TO 'public','pg_catalog'
AS $fn$
  WITH opp AS (
    SELECT o.id, o.opportunity_record_type, o.building_id, o.opportunity_total_units
    FROM opportunities o
    WHERE o.id = p_opportunity_id AND o.opportunity_is_deleted IS NOT TRUE
  ),
  cap AS (
    SELECT rt.picklist_value AS label, c.prc_cap_per_dwelling_unit AS cap
    FROM opp
    JOIN picklist_values rt ON rt.id = opp.opportunity_record_type
    JOIN program_rebate_caps c
      ON c.prc_opportunity_record_type_id = rt.id
     AND c.prc_is_deleted IS NOT TRUE
     AND COALESCE(c.prc_is_active, true)
  ),
  units AS (
    SELECT NULLIF(COALESCE(
             (SELECT b.building_total_units FROM buildings b
               WHERE b.id = opp.building_id AND b.building_is_deleted IS NOT TRUE),
             opp.opportunity_total_units
           ), 0) AS n
    FROM opp
  ),
  lines AS (
    SELECT oli.unit_id,
           COALESCE(oli.oli_unit_price, 0)  AS unit_amt,
           COALESCE(oli.oli_total_price, 0) AS line_amt
    FROM opportunity_line_items oli
    WHERE oli.opportunity_id = p_opportunity_id
      AND oli.oli_is_deleted IS NOT TRUE
  ),
  wide AS (
    SELECT COALESCE(sum(unit_amt), 0) AS amt FROM lines WHERE unit_id IS NULL
  ),
  per_unit AS (
    SELECT COALESCE(max(t.amt), 0) AS amt
    FROM (SELECT unit_id, sum(unit_amt) AS amt FROM lines
           WHERE unit_id IS NOT NULL GROUP BY unit_id) t
  ),
  grand AS (
    SELECT COALESCE(sum(line_amt), 0) AS amt FROM lines
  )
  SELECT cap.label,
         cap.cap,
         wide.amt + per_unit.amt,
         cap.cap - (wide.amt + per_unit.amt),
         (wide.amt + per_unit.amt) > cap.cap,
         wide.amt,
         per_unit.amt,
         units.n,
         cap.cap * units.n,
         grand.amt,
         (cap.cap * units.n) - grand.amt
  FROM cap, wide, per_unit, grand, units;
$fn$;

REVOKE ALL ON FUNCTION opportunity_rebate_cap_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opportunity_rebate_cap_status(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_opp uuid;
  v_rec record;
BEGIN
  -- The opportunity from the screenshot: 11 units, three building-wide measures
  -- at 2500 + 8000 + 1600 = 12100 per unit, grand total 133100.
  -- Available 14000 x 11 = 154000; remaining 154000 - 133100 = 20900.
  SELECT o.id INTO v_opp
  FROM opportunities o
  JOIN picklist_values rt ON rt.id = o.opportunity_record_type
  WHERE rt.picklist_value = 'WI-IRA-MF-HEAR' AND o.opportunity_is_deleted IS NOT TRUE
    AND (SELECT COALESCE(sum(oli.oli_total_price), 0) FROM opportunity_line_items oli
          WHERE oli.opportunity_id = o.id AND oli.oli_is_deleted IS NOT TRUE) = 133100.00
  LIMIT 1;

  IF v_opp IS NOT NULL THEN
    SELECT * INTO v_rec FROM opportunity_rebate_cap_status(v_opp);
    IF v_rec.unit_count <> 11 THEN
      RAISE EXCEPTION 'Unit count resolved to %, expected 11', v_rec.unit_count;
    END IF;
    IF v_rec.amount_per_unit <> 12100.00 THEN
      RAISE EXCEPTION 'Per-unit resolved to %, expected 12100', v_rec.amount_per_unit;
    END IF;
    IF v_rec.total_available <> 154000.00 THEN
      RAISE EXCEPTION 'Total available resolved to %, expected 154000', v_rec.total_available;
    END IF;
    IF v_rec.grand_total <> 133100.00 THEN
      RAISE EXCEPTION 'Grand total resolved to %, expected 133100', v_rec.grand_total;
    END IF;
    IF v_rec.remaining_budget <> 20900.00 THEN
      RAISE EXCEPTION 'Remaining budget resolved to %, expected 20900', v_rec.remaining_budget;
    END IF;
    IF v_rec.is_over_cap THEN
      RAISE EXCEPTION 'Must not report over cap at 12100 of 14000';
    END IF;
  END IF;

  -- An opportunity whose unit count nobody has filled in reports NULL project
  -- figures, never a zero budget.
  SELECT o.id INTO v_opp
  FROM opportunities o
  JOIN picklist_values rt ON rt.id = o.opportunity_record_type
  WHERE rt.picklist_value = 'WI-IRA-MF-HEAR' AND o.opportunity_is_deleted IS NOT TRUE
    AND COALESCE(o.opportunity_total_units, 0) = 0 AND o.building_id IS NULL
  LIMIT 1;
  IF v_opp IS NOT NULL THEN
    SELECT * INTO v_rec FROM opportunity_rebate_cap_status(v_opp);
    IF v_rec.total_available IS NOT NULL OR v_rec.remaining_budget IS NOT NULL THEN
      RAISE EXCEPTION 'Unknown unit count must yield NULL project figures, got % / %',
        v_rec.total_available, v_rec.remaining_budget;
    END IF;
  END IF;
END $$;
