-- A HEAR line item names the equipment it installs.
--
-- Nicholas: "maybe if we pick a HEAR line item, it prompts the user to select
-- the actual equipment product that's going to be used for that product line
-- item. It needs to be a little more interactive so the user does not forget to
-- select the correct equipment." Then, asked how hard LEAP should push:
-- "We will always know the reservation because we have to, so it's number two.
-- Always. So when it's on the opportunity, somebody adds the opportunity line
-- item, then they have to pick the product and the equipment that goes with
-- that product. Again, this is just for the HEAR equipment: ventilation, heat
-- pumps, et cetera."
--
-- ── Why the equipment lives on the LINE ITEM ──────────────────────────────
--
-- The first cut of this was heading for a separate opportunity_equipment
-- junction hanging off the opportunity. That would have put the same fact in
-- two places: the line item already says WHAT is being installed and HOW MANY,
-- and a parallel equipment list would say it again with nothing keeping the two
-- in step — two rows of "ENERGY STAR Ventilation x 8" and one Panasonic, and no
-- way to know which line the fan belongs to once a second measure appears. The
-- equipment is an attribute of the line, so it is a column on the line.
--
-- The separate Equipment SECTION Nicholas asked for is still there — it is a
-- second related list over these same rows, filtered to the equipment lines.
-- One fact, two views of it.
--
-- ── The requirement is enforced where it is decided ───────────────────────
--
-- On INSERT the equipment is required outright: adding the line is the moment
-- the decision is made, and that is the point Nicholas named.
--
-- On UPDATE it is enforced when the product or the equipment column is touched,
-- and a value already present can never be cleared. It is deliberately NOT
-- enforced on an unrelated edit to a row that predates this rule. Seven live
-- line items (5 ventilation, 2 heat pump) were created before the equipment
-- column existed, and there is no honest way to know which fan or heat pump
-- each of them installed — inventing one would put a fabricated model number in
-- front of a programme administrator. Enforcing on every update instead would
-- make all seven permanently unsaveable for ANY field, which is the exact trap
-- PROJ-00038 is stuck in today (see CLAUDE.md, 2026-09-02): a rule applied to
-- rows that cannot satisfy it does not fix the data, it freezes the record.
-- They are visible instead — the Equipment section shows "— not selected —"
-- until someone who knows fills it in.
--
-- ── Why the picker is scoped, and why the DB checks it too ────────────────
--
-- The UI offers only models linked to that measure through
-- product_qualifying_equipment. The trigger checks the same thing, because a
-- picker is a convenience and an API call is not obliged to use it. Without the
-- check, a Rheem water heater could be recorded as the fan installed in a
-- bathroom, and the supplemental data sheet would report it as fact.

BEGIN;

-- ── 1. The column ─────────────────────────────────────────────────────────
ALTER TABLE public.opportunity_line_items
  ADD COLUMN IF NOT EXISTS oli_equipment_product_id uuid REFERENCES public.products(id);

COMMENT ON COLUMN public.opportunity_line_items.oli_equipment_product_id IS
  'The specific, model-numbered equipment product being installed for this incentive measure line (e.g. the Panasonic FV-0511VF1 fan installed to claim the ENERGY STAR Ventilation measure). Required when the line''s product carries product_requires_equipment_selection, and constrained to models linked to that measure in product_qualifying_equipment. This is where the Quality Installation Supplemental Data Sheet reads its Model Number column.';

CREATE INDEX IF NOT EXISTS oli_equipment_product_idx
  ON public.opportunity_line_items (oli_equipment_product_id)
  WHERE oli_is_deleted IS NOT TRUE;

-- ── 2. The derived "this is an equipment line" flag ───────────────────────
--
-- Derived, never hand-kept: it mirrors the measure product's own
-- product_requires_equipment_selection at write time. It exists because the
-- related-list widget filters by constant equality on a column (config.match)
-- and cannot express "join to products and test a flag". Recording the answer
-- on the row is honest — the line genuinely IS or ISN'T an equipment line — and
-- it keeps the Equipment section a plain related list rather than a bespoke
-- query nobody else can reuse.
ALTER TABLE public.opportunity_line_items
  ADD COLUMN IF NOT EXISTS oli_is_equipment_line boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.opportunity_line_items.oli_is_equipment_line IS
  'Derived on write from the line product''s product_requires_equipment_selection. True when this line installs a discrete, model-numbered device, so the opportunity''s Equipment related list can show exactly those lines. Never set by hand.';

-- ── 3. The rule ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_line_item_equipment_selection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_requires        boolean := false;
  v_measure_name    text;
  v_equipment_ok    boolean;
  v_equipment_name  text;
  v_choices         text;
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    SELECT COALESCE(p.product_requires_equipment_selection, false), p.product_name
      INTO v_requires, v_measure_name
      FROM public.products p WHERE p.id = NEW.product_id;
  END IF;

  -- Always record what kind of line this is, whatever else happens below.
  NEW.oli_is_equipment_line := COALESCE(v_requires, false);

  -- A line whose measure needs no equipment must not carry one. Otherwise an
  -- attic-insulation line could name a fan and the Equipment section would
  -- report insulation as ventilation.
  IF NOT COALESCE(v_requires, false) THEN
    IF NEW.oli_equipment_product_id IS NOT NULL THEN
      SELECT p.product_name INTO v_equipment_name
        FROM public.products p WHERE p.id = NEW.oli_equipment_product_id;
      RAISE EXCEPTION
        'Equipment cannot be recorded on this line. "%" does not install a model-numbered device, so it has no equipment to name (you selected "%").',
        COALESCE(v_measure_name, 'This product'), COALESCE(v_equipment_name, 'that product');
    END IF;
    RETURN NEW;
  END IF;

  -- From here the measure DOES require equipment.
  --
  -- Enforce on insert; on update, enforce when the decision is being touched
  -- (product changed, or equipment changed — including being cleared). An
  -- unrelated edit to a pre-existing row is left alone, deliberately; see the
  -- header. A row that already names equipment can never be emptied.
  IF TG_OP = 'INSERT'
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.oli_equipment_product_id IS DISTINCT FROM OLD.oli_equipment_product_id
  THEN
    IF NEW.oli_equipment_product_id IS NULL THEN
      SELECT string_agg(ep.product_name, ', ' ORDER BY ep.product_name) INTO v_choices
        FROM public.product_qualifying_equipment q
        JOIN public.products ep ON ep.id = q.pqe_equipment_product_id
       WHERE q.pqe_measure_product_id = NEW.product_id
         AND q.pqe_is_active AND q.pqe_is_deleted IS NOT TRUE
         AND ep.product_is_active AND ep.product_is_deleted IS NOT TRUE;
      RAISE EXCEPTION
        '"%" needs the specific equipment being installed. Select the model, then save.%',
        COALESCE(v_measure_name, 'This measure'),
        CASE WHEN v_choices IS NULL
             THEN ' No approved models are set up for it yet — add one in Object Manager under Products.'
             ELSE ' Approved models: ' || v_choices || '.' END;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.product_qualifying_equipment q
       WHERE q.pqe_measure_product_id = NEW.product_id
         AND q.pqe_equipment_product_id = NEW.oli_equipment_product_id
         AND q.pqe_is_active AND q.pqe_is_deleted IS NOT TRUE
    ) INTO v_equipment_ok;

    IF NOT v_equipment_ok THEN
      SELECT p.product_name INTO v_equipment_name
        FROM public.products p WHERE p.id = NEW.oli_equipment_product_id;
      RAISE EXCEPTION
        '"%" is not an approved model for "%". Pick a model linked to that measure, or add the link in Object Manager under Products.',
        COALESCE(v_equipment_name, 'That product'), COALESCE(v_measure_name, 'this measure');
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- SECURITY DEFINER because it reads products and product_qualifying_equipment
-- from inside a trigger. EXECUTE is revoked in the same statement batch — a
-- plain CREATE FUNCTION leaves the default PUBLIC grant, which would turn this
-- into a callable definer function and a new advisor finding. PostgreSQL does
-- not check EXECUTE when it FIRES a trigger, so revoking costs nothing.
-- (CLAUDE.md, 2026-08-31: promoting a trigger function to SECURITY DEFINER must
-- revoke EXECUTE in the same migration.)
REVOKE ALL ON FUNCTION public.enforce_line_item_equipment_selection()
  FROM public, anon, authenticated;

-- trg_zz_ so it sorts after the defaults and name-derivation triggers already
-- on this table (trg_oli_defaults, trg_oli_name) — the product must be settled
-- before the rule judges it.
DROP TRIGGER IF EXISTS trg_zz_line_item_equipment ON public.opportunity_line_items;
CREATE TRIGGER trg_zz_line_item_equipment
  BEFORE INSERT OR UPDATE ON public.opportunity_line_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_line_item_equipment_selection();

COMMIT;

-- ── 4. Backfill the derived flag on rows that predate the trigger ─────────
--
-- session_replication_role = replica so the backfill does not fire the audit
-- logger (this is a migration filling a new derived column, not a person
-- editing seven records) and does not trip the rule it is about to be governed
-- by. Only the derived flag is written; the equipment column is deliberately
-- left NULL because its true value is unknown.
BEGIN;
SET LOCAL session_replication_role = replica;

UPDATE public.opportunity_line_items oli
   SET oli_is_equipment_line = true
  FROM public.products p
 WHERE p.id = oli.product_id
   AND p.product_requires_equipment_selection
   AND oli.oli_is_equipment_line IS DISTINCT FROM true;

COMMIT;

-- ── 5. Assertions ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_flagged   int;
  v_unflagged int;
BEGIN
  SELECT count(*) INTO v_flagged
    FROM public.opportunity_line_items oli
   WHERE oli.oli_is_equipment_line AND oli.oli_is_deleted IS NOT TRUE;
  IF v_flagged < 1 THEN
    RAISE EXCEPTION 'No live line item was flagged as an equipment line; the backfill did not run';
  END IF;

  -- Every flagged line must sit on a measure that genuinely requires equipment,
  -- and every such line must be flagged. A drift either way means the Equipment
  -- section is showing the wrong rows.
  SELECT count(*) INTO v_unflagged
    FROM public.opportunity_line_items oli
    JOIN public.products p ON p.id = oli.product_id
   WHERE oli.oli_is_deleted IS NOT TRUE
     AND COALESCE(p.product_requires_equipment_selection, false)
         IS DISTINCT FROM oli.oli_is_equipment_line;
  IF v_unflagged > 0 THEN
    RAISE EXCEPTION 'oli_is_equipment_line disagrees with the product flag on % live rows', v_unflagged;
  END IF;

  -- The recurrence guard from 2026-08-31: a SECURITY INVOKER trigger function
  -- calling a SECURITY DEFINER one that `authenticated` cannot execute fails at
  -- runtime with "permission denied for function". Must stay empty.
  IF EXISTS (SELECT 1 FROM public.find_trigger_function_privilege_gaps()) THEN
    RAISE EXCEPTION 'A trigger function now depends on an EXECUTE grant that is revoked';
  END IF;
END $$;
