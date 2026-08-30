-- Per-dwelling-unit rebate cap, shown on the opportunity
--
-- Nicholas: "we definitely need some kind of warning or letting the user know on
-- the opportunity the total HEAR rebate per unit, because we cannot go over the
-- $14,000 per unit. We need some kind of boundary, and that goes for Wisconsin
-- and North Carolina as well."
--
-- Built as a WARNING, not a save-blocker. He asked to be told, and a hard block
-- would refuse saves on live opportunities mid-estimate -- you would not be able
-- to enter the fourth measure in order to see that it puts you over. The number
-- is on screen the whole time instead, and turns into a warning when it is
-- exceeded. Making it refuse the save is a one-line change once he wants it.
--
-- The cap is DATA, not a constant in code: program_rebate_caps is keyed by
-- opportunity record type, so each state's HEAR program carries its own row and
-- an admin can change the figure without a deploy. $14,000 is the federal HEAR
-- aggregate per dwelling unit; it is seeded for the Wisconsin and North Carolina
-- HEAR programs he named.
--
-- HOW "PER UNIT" IS COMPUTED, because the naive version is wrong: a line item's
-- oli_unit_price is already the per-dwelling-unit figure and oli_quantity is how
-- many units get it, so dividing a grand total by unit count would understate a
-- measure applied to only some units. opportunity_line_items also carries an
-- optional unit_id. So: lines with no unit_id are building-wide and land on
-- EVERY unit; lines with a unit_id land on that unit alone. The reported figure
-- is the worst-off unit -- building-wide total plus the largest single unit's
-- own lines -- which is exact when every measure covers every unit and a correct
-- upper bound otherwise. A cap is about the worst unit, not the average.

CREATE SEQUENCE IF NOT EXISTS seq_program_rebate_caps;

CREATE TABLE IF NOT EXISTS program_rebate_caps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prc_record_number text NOT NULL,
  prc_name text NOT NULL,
  prc_opportunity_record_type_id uuid NOT NULL REFERENCES picklist_values(id),
  prc_cap_per_dwelling_unit numeric NOT NULL,
  prc_is_active boolean DEFAULT true,
  prc_notes text,
  prc_owner uuid REFERENCES users(id),
  prc_is_deleted boolean NOT NULL DEFAULT false,
  prc_deleted_at timestamptz,
  prc_deleted_by uuid REFERENCES users(id),
  prc_deletion_reason text,
  CONSTRAINT program_rebate_caps_cap_positive CHECK (prc_cap_per_dwelling_unit > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS program_rebate_caps_one_per_program
  ON program_rebate_caps (prc_opportunity_record_type_id)
  WHERE prc_is_deleted IS NOT TRUE;

-- Record number + the platform's own audit-stamping rule (20260822225224),
-- rather than hand-rolled created/updated columns.
CREATE OR REPLACE FUNCTION set_prc_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public','pg_catalog' AS $fn$
BEGIN
  NEW.prc_record_number := generate_record_number('PRC-', 'seq_program_rebate_caps');
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_prc_rn ON program_rebate_caps;
CREATE TRIGGER trg_prc_rn BEFORE INSERT ON program_rebate_caps
  FOR EACH ROW EXECUTE FUNCTION set_prc_record_number();

DROP TRIGGER IF EXISTS trg_program_rebate_caps_no_hard_delete ON program_rebate_caps;
CREATE TRIGGER trg_program_rebate_caps_no_hard_delete BEFORE DELETE ON program_rebate_caps
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();

SELECT install_record_audit_stamping('program_rebate_caps');

ALTER TABLE program_rebate_caps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_select_program_rebate_caps ON program_rebate_caps;
CREATE POLICY app_select_program_rebate_caps ON program_rebate_caps FOR SELECT
  USING ((SELECT app_user_can('program_rebate_caps','read')));
DROP POLICY IF EXISTS app_insert_program_rebate_caps ON program_rebate_caps;
CREATE POLICY app_insert_program_rebate_caps ON program_rebate_caps FOR INSERT
  WITH CHECK ((SELECT app_user_can('program_rebate_caps','create')));
DROP POLICY IF EXISTS app_update_program_rebate_caps ON program_rebate_caps;
CREATE POLICY app_update_program_rebate_caps ON program_rebate_caps FOR UPDATE
  USING ((SELECT app_user_can('program_rebate_caps','update')));
DROP POLICY IF EXISTS app_delete_program_rebate_caps ON program_rebate_caps;
CREATE POLICY app_delete_program_rebate_caps ON program_rebate_caps FOR DELETE
  USING ((SELECT app_user_can('program_rebate_caps','delete')));

-- Every public base table must be classified for state scoping
-- (record_state_scope_status() reports zero unregistered, and a new table would
-- break that). A cap table is program configuration, not somebody's record.
INSERT INTO record_state_scope_sources (
  rsss_record_number, rsss_object_name, rsss_resolution_kind, rsss_is_active, rsss_notes
)
SELECT '', 'program_rebate_caps', 'platform_configuration', true,
       'Program configuration: the per-dwelling-unit rebate cap for an opportunity record type. Carries no state-owned records.'
WHERE NOT EXISTS (
  SELECT 1 FROM record_state_scope_sources
  WHERE rsss_object_name = 'program_rebate_caps' AND rsss_is_deleted IS NOT TRUE
);

-- The caps themselves --------------------------------------------------------
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
  AND rt.picklist_value IN
      ('WI-IRA-MF-HEAR','WI-IRA-SF-HEAR','NC-IRA-MF-HEAR','NC-IRA-SF-HEAR')
  AND NOT EXISTS (
    SELECT 1 FROM program_rebate_caps c
    WHERE c.prc_opportunity_record_type_id = rt.id AND c.prc_is_deleted IS NOT TRUE
  );

-- What the opportunity screen asks ------------------------------------------
-- SECURITY INVOKER deliberately: this reads line-item money, so it must answer
-- as the caller and not hand a restricted user figures their policies withhold.
-- That also means it adds no advisor lint.
CREATE OR REPLACE FUNCTION opportunity_rebate_cap_status(p_opportunity_id uuid)
RETURNS TABLE (
  program_label      text,
  cap_per_unit       numeric,
  amount_per_unit    numeric,
  headroom_per_unit  numeric,
  is_over_cap        boolean,
  building_wide      numeric,
  worst_unit_extra   numeric
)
LANGUAGE sql STABLE
SET search_path TO 'public','pg_catalog'
AS $fn$
  WITH opp AS (
    SELECT o.id, o.opportunity_record_type
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
  lines AS (
    SELECT oli.unit_id, COALESCE(oli.oli_unit_price, 0) AS amt
    FROM opportunity_line_items oli
    WHERE oli.opportunity_id = p_opportunity_id
      AND oli.oli_is_deleted IS NOT TRUE
  ),
  wide AS (
    SELECT COALESCE(sum(amt), 0) AS amt FROM lines WHERE unit_id IS NULL
  ),
  per_unit AS (
    SELECT COALESCE(max(t.amt), 0) AS amt
    FROM (SELECT unit_id, sum(amt) AS amt FROM lines
           WHERE unit_id IS NOT NULL GROUP BY unit_id) t
  )
  SELECT cap.label,
         cap.cap,
         wide.amt + per_unit.amt,
         cap.cap - (wide.amt + per_unit.amt),
         (wide.amt + per_unit.amt) > cap.cap,
         wide.amt,
         per_unit.amt
  FROM cap, wide, per_unit;
$fn$;

REVOKE ALL ON FUNCTION opportunity_rebate_cap_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opportunity_rebate_cap_status(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Prove it against the real opportunity that prompted this ------------------
DO $$
DECLARE
  v_opp   uuid;
  v_rec   record;
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM program_rebate_caps WHERE prc_is_deleted IS NOT TRUE;
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'Expected 4 seeded rebate caps (WI/NC x MF/SF HEAR), found %', v_count;
  END IF;

  -- OPP with the three HEAR lines: 2500 + 8000 + 1600 = 12100 per unit,
  -- all building-wide, so headroom is 1900 and it is NOT over.
  SELECT o.id INTO v_opp
  FROM opportunities o
  JOIN picklist_values rt ON rt.id = o.opportunity_record_type
  JOIN opportunity_line_items oli ON oli.opportunity_id = o.id AND oli.oli_is_deleted IS NOT TRUE
  WHERE rt.picklist_value = 'WI-IRA-MF-HEAR' AND o.opportunity_is_deleted IS NOT TRUE
  GROUP BY o.id HAVING count(*) = 3
  LIMIT 1;

  IF v_opp IS NOT NULL THEN
    SELECT * INTO v_rec FROM opportunity_rebate_cap_status(v_opp);
    IF v_rec.cap_per_unit <> 14000.00 THEN
      RAISE EXCEPTION 'Cap resolved to %, expected 14000', v_rec.cap_per_unit;
    END IF;
    IF v_rec.amount_per_unit <> 12100.00 THEN
      RAISE EXCEPTION 'Per-unit amount resolved to %, expected 12100', v_rec.amount_per_unit;
    END IF;
    IF v_rec.is_over_cap THEN
      RAISE EXCEPTION 'Opportunity at 12100 of 14000 must not report over cap';
    END IF;
    IF v_rec.headroom_per_unit <> 1900.00 THEN
      RAISE EXCEPTION 'Headroom resolved to %, expected 1900', v_rec.headroom_per_unit;
    END IF;
  END IF;

  -- A non-HEAR opportunity has no cap configured and must return NO row, so the
  -- screen shows nothing rather than inventing a limit.
  SELECT o.id INTO v_opp
  FROM opportunities o
  JOIN picklist_values rt ON rt.id = o.opportunity_record_type
  WHERE rt.picklist_value = 'WI-IRA-MF-HOMES' AND o.opportunity_is_deleted IS NOT TRUE
  LIMIT 1;
  IF v_opp IS NOT NULL THEN
    PERFORM 1 FROM opportunity_rebate_cap_status(v_opp);
    IF FOUND THEN
      RAISE EXCEPTION 'A HOMES opportunity must not report a HEAR rebate cap';
    END IF;
  END IF;
END $$;
