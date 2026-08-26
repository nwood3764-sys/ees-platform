-- ---------------------------------------------------------------------------
-- A building's record type decides which programs can run on it.
--
-- Nicholas, 2026-08-26, from the New Opportunity pop-up on BLD-00150, a 24-unit
-- Milwaukee multifamily building that was being offered every Wisconsin program
-- including the single-family ones: "the single-family record types can't
-- possibly be on a multi-family record building, right? This has to be correct."
--
-- They cannot. A program is written for a housing type -- IRA HOMES/HEAR run a
-- multifamily track and a single-family track, and the two are different
-- programs with different applications, different measures and different money.
-- Which one a building qualifies for is a fact the building already states: its
-- record type (Multifamily / Single Family / Single Family Attached / ...).
--
-- WHY record_type_eligibility AND NOT A NEW TABLE. This is precisely the rule
-- that table was built for -- "which record types may a child carry under this
-- parent record type" -- already governing opportunities -> assessments,
-- opportunities -> incentive applications and projects -> work orders, already
-- read by eligible_record_types_for_parent (the picker) and record_type_eligible
-- (the guarantee), and already editable in Object Manager. The parent here is
-- the BUILDING; nothing about the mechanism is new, only the pair.
--
-- THREE CLASSES, and the third is not a fudge:
--   multifamily      -- every *-IRA-MF-* program, plus the retired
--                       Multifamily Energy Assessment type.
--   single family    -- every *-IRA-SF-* program, plus the retired
--                       Single-Family Energy Assessment type.
--   either           -- Focus on Energy (one record type per program YEAR, not
--                       per housing type -- Focus on Energy runs both) and
--                       Field Operations (not a program at all: it is how field
--                       documentation work is carried, and it must remain
--                       available on every building or a technician cannot
--                       document what they did).
--
-- Retired/inactive record types ARE given edges on purpose. An edge is not an
-- offer -- the picker reads active values only -- but WITHOUT the edge, the
-- nine live opportunities still carrying Single-Family Energy Assessment would
-- become unsaveable. There is no grandfather clause in the enforcement (the
-- 2026-08-24 ruling); instead the configuration is complete enough not to need
-- one, and the migration proves it by re-counting violations at the end.
-- ---------------------------------------------------------------------------

-- ── 1. The edges ───────────────────────────────────────────────────────────

WITH parent AS (
  SELECT pv.id, pv.picklist_value, k.housing_class
    FROM public.picklist_values pv
    JOIN (VALUES
      ('MULTIFAMILY',                    'multifamily'),
      ('NEW-CONSTRUCTION-MULTIFAMILY',   'multifamily'),
      ('SINGLE-FAMILY',                  'single_family'),
      ('SINGLE-FAMILY-DETACHED',         'single_family'),
      ('SINGLE-FAMILY-ATTACHED',         'single_family'),
      ('NEW-CONSTRUCTION-SINGLE-FAMILY', 'single_family')
    ) AS k(value, housing_class) ON k.value = pv.picklist_value
   WHERE pv.picklist_object = 'buildings' AND pv.picklist_field = 'record_type'
),
child AS (
  SELECT pv.id, pv.picklist_value,
         CASE
           WHEN pv.picklist_value LIKE '%-MF-%'
             OR pv.picklist_value = 'MULTIFAMILY-ENERGY-ASSESSMENT'      THEN 'multifamily'
           WHEN pv.picklist_value LIKE '%-SF-%'
             OR pv.picklist_value = 'SINGLE-FAMILY-ENERGY-ASSESSMENT'    THEN 'single_family'
           ELSE 'either'
         END AS housing_class
    FROM public.picklist_values pv
   WHERE pv.picklist_object = 'opportunities' AND pv.picklist_field = 'record_type'
)
INSERT INTO public.record_type_eligibility (
  rte_record_number, rte_parent_object, rte_parent_record_type_id,
  rte_child_object, rte_child_record_type_id, rte_is_active, rte_is_deleted
)
SELECT '', 'buildings', parent.id, 'opportunities', child.id, true, false
  FROM parent
  JOIN child ON child.housing_class IN (parent.housing_class, 'either')
 WHERE NOT EXISTS (
   SELECT 1 FROM public.record_type_eligibility e
    WHERE e.rte_parent_object = 'buildings'
      AND e.rte_parent_record_type_id = parent.id
      AND e.rte_child_object = 'opportunities'
      AND e.rte_child_record_type_id = child.id
      AND NOT e.rte_is_deleted
 );

-- ── 2. Prove the configuration before anything starts enforcing it ─────────

DO $$
DECLARE
  v_parents integer; v_edges integer; v_unclassified text;
BEGIN
  SELECT count(DISTINCT rte_parent_record_type_id), count(*)
    INTO v_parents, v_edges
    FROM public.record_type_eligibility
   WHERE rte_parent_object = 'buildings' AND rte_child_object = 'opportunities'
     AND rte_is_active AND NOT rte_is_deleted;

  IF v_parents <> 6 THEN
    RAISE EXCEPTION 'Expected 6 building record types to be governed, found %.', v_parents;
  END IF;

  -- Every governed parent must offer Field Operations, or field documentation
  -- becomes impossible on that kind of building.
  SELECT string_agg(pv.picklist_value, ', ') INTO v_unclassified
    FROM public.picklist_values pv
   WHERE pv.picklist_object = 'buildings' AND pv.picklist_field = 'record_type'
     AND EXISTS (SELECT 1 FROM public.record_type_eligibility e
                  WHERE e.rte_parent_object='buildings' AND e.rte_parent_record_type_id=pv.id
                    AND e.rte_child_object='opportunities' AND e.rte_is_active AND NOT e.rte_is_deleted)
     AND NOT EXISTS (
       SELECT 1 FROM public.record_type_eligibility e
         JOIN public.picklist_values c ON c.id = e.rte_child_record_type_id
        WHERE e.rte_parent_object='buildings' AND e.rte_parent_record_type_id=pv.id
          AND e.rte_child_object='opportunities' AND e.rte_is_active AND NOT e.rte_is_deleted
          AND c.picklist_value = 'FIELD-OPERATIONS');
  IF v_unclassified IS NOT NULL THEN
    RAISE EXCEPTION 'Building record types missing the Field Operations edge: %', v_unclassified;
  END IF;

  RAISE NOTICE 'buildings -> opportunities: % edges across % building record types.', v_edges, v_parents;
END $$;

-- ── 3. The guarantee: an opportunity may not carry a program its building
--       does not run. No grandfather clause -- see the header.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_opportunity_record_type_building_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_building_rt    uuid;
  v_building_name  text;
  v_building_label text;
  v_opp_label      text;
  v_allowed        text;
BEGIN
  IF NEW.building_id IS NULL OR NEW.opportunity_record_type IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT building_record_type, building_name
    INTO v_building_rt, v_building_name
    FROM public.buildings WHERE id = NEW.building_id;

  -- A building that has not said what it is constrains nothing. That is a data
  -- gap, not a licence: fill in the building's record type and the rule applies.
  IF v_building_rt IS NULL THEN RETURN NEW; END IF;

  IF public.record_type_eligible('buildings', v_building_rt, 'opportunities', NEW.opportunity_record_type) THEN
    RETURN NEW;
  END IF;

  SELECT picklist_label INTO v_building_label FROM public.picklist_values WHERE id = v_building_rt;
  SELECT picklist_label INTO v_opp_label      FROM public.picklist_values WHERE id = NEW.opportunity_record_type;
  SELECT string_agg(pv.picklist_label, ', ' ORDER BY pv.picklist_label)
    INTO v_allowed
    FROM public.record_type_eligibility e
    JOIN public.picklist_values pv ON pv.id = e.rte_child_record_type_id
   WHERE e.rte_parent_object = 'buildings' AND e.rte_parent_record_type_id = v_building_rt
     AND e.rte_child_object = 'opportunities'
     AND e.rte_is_active AND NOT e.rte_is_deleted
     AND pv.picklist_is_active;

  RAISE EXCEPTION
    'Opportunity record type "%" does not run on a % building ("%"). Available on this building: %.',
    COALESCE(v_opp_label, '(unknown)'), COALESCE(v_building_label, '(untyped)'),
    COALESCE(v_building_name, '(unnamed)'), COALESCE(v_allowed, '(none configured)');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_opportunity_record_type_building_eligibility() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_opportunity_record_type_building_eligibility() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_opportunity_record_type_building_eligibility() FROM authenticated;

DROP TRIGGER IF EXISTS trg_zz_opportunity_record_type_building ON public.opportunities;
CREATE TRIGGER trg_zz_opportunity_record_type_building
  BEFORE INSERT OR UPDATE OF opportunity_record_type, building_id
  ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.enforce_opportunity_record_type_building_eligibility();

-- ── 4. The other way in: the BUILDING changes what it is ───────────────────
--
-- Every rule above fires on the opportunity. Retyping a single-family building
-- as multifamily would otherwise strand its single-family programs, which is
-- the same hole the property-state guard closed on 2026-08-24. There is no
-- automatic conversion -- a multifamily HOMES opportunity is not the same
-- record as a single-family one -- so this is a decision, not a cascade.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_building_record_type_change_against_opportunities()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_blocked   text;
  v_new_label text;
BEGIN
  IF NEW.building_record_type IS NOT DISTINCT FROM OLD.building_record_type
     OR NEW.building_record_type IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(o.opportunity_record_number || ' (' || pv.picklist_label || ')', ', '
                    ORDER BY o.opportunity_record_number)
    INTO v_blocked
    FROM public.opportunities o
    JOIN public.picklist_values pv ON pv.id = o.opportunity_record_type
   WHERE o.building_id = NEW.id
     AND o.opportunity_is_deleted IS NOT TRUE
     AND NOT public.record_type_eligible('buildings', NEW.building_record_type,
                                         'opportunities', o.opportunity_record_type);

  IF v_blocked IS NULL THEN RETURN NEW; END IF;

  SELECT picklist_label INTO v_new_label FROM public.picklist_values WHERE id = NEW.building_record_type;

  RAISE EXCEPTION
    'Cannot change this building to % -- these opportunities run programs that do not: %. Move or close them first.',
    COALESCE(v_new_label, '(unknown)'), v_blocked;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_building_record_type_change_against_opportunities() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_building_record_type_change_against_opportunities() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_building_record_type_change_against_opportunities() FROM authenticated;

DROP TRIGGER IF EXISTS trg_zz_building_record_type_against_opportunities ON public.buildings;
CREATE TRIGGER trg_zz_building_record_type_against_opportunities
  BEFORE UPDATE OF building_record_type ON public.buildings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_building_record_type_change_against_opportunities();

-- ── 5. Re-count violations rather than assuming there are none ─────────────

DO $$
DECLARE v_bad integer; v_list text;
BEGIN
  SELECT count(*), string_agg(o.opportunity_record_number, ', ' ORDER BY o.opportunity_record_number)
    INTO v_bad, v_list
    FROM public.opportunities o
    JOIN public.buildings b ON b.id = o.building_id AND b.building_is_deleted IS NOT TRUE
   WHERE o.opportunity_is_deleted IS NOT TRUE
     AND o.opportunity_record_type IS NOT NULL
     AND b.building_record_type IS NOT NULL
     AND NOT public.record_type_eligible('buildings', b.building_record_type,
                                         'opportunities', o.opportunity_record_type);

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'Refusing to ship: % live opportunities would become uneditable under this rule: %',
      v_bad, v_list;
  END IF;
  RAISE NOTICE 'Zero live opportunities conflict with their building record type.';
END $$;

NOTIFY pgrst, 'reload schema';
