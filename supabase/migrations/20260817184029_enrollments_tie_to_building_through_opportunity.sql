-- An enrollment is tied to a building through its opportunity, not to a property.
--
-- Nicholas, 2026-08-17: "I'm doing enrollments, and it looks like they're tied
-- to a property. Enrollments need to be tied to a building through the
-- opportunity, not property."
--
-- Before: property_id was NOT NULL and required:true on all 8 enrollment
-- layouts, and it came FIRST; the Opportunity picker was optional and scoped BY
-- the property (opportunities_for_property); Building appeared on only 2 of the
-- 8 layouts, unscoped on one of them. So the property was the anchor and the
-- building was an afterthought — backwards.
--
-- After: the OPPORTUNITY is the anchor. The building comes from the opportunity,
-- and the property comes from the building/opportunity — both derived, never
-- typed. Same rule the platform already applies elsewhere ("no way possible an
-- incentive application can be on an opportunity that's not on this property").
--
-- property_id stays NOT NULL in the schema. It is still true and still useful;
-- it is simply no longer the thing a user picks, because the trigger below
-- always fills it from the opportunity.

-- ── 1. Building picker scoped to the opportunity ──────────────────────────
-- SECURITY INVOKER (the default) so RLS still applies to the caller.
CREATE OR REPLACE FUNCTION public.list_buildings_for_opportunity(
  p_opportunity_ids uuid[],
  p_include_building_id uuid DEFAULT NULL::uuid
)
 RETURNS TABLE(id uuid, building_name text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT b.id, b.building_name
  FROM buildings b
  WHERE b.building_is_deleted = false
    AND (
      -- the opportunity's own building, plus every building on its property so a
      -- multi-building property still offers the right siblings
      b.id IN (SELECT o.building_id FROM opportunities o WHERE o.id = ANY(p_opportunity_ids))
      OR b.property_id IN (SELECT o.property_id FROM opportunities o WHERE o.id = ANY(p_opportunity_ids))
      OR (p_include_building_id IS NOT NULL AND b.id = p_include_building_id)
    )
  ORDER BY b.building_name ASC, b.id ASC;
$function$;

REVOKE ALL ON FUNCTION public.list_buildings_for_opportunity(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_buildings_for_opportunity(uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_buildings_for_opportunity(uuid[], uuid) TO service_role;

-- ── 2. The opportunity drives the building and the property ───────────────
CREATE OR REPLACE FUNCTION public.enrollment_inherit_from_opportunity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_opp_building  uuid;
  v_opp_property  uuid;
  v_bld_property  uuid;
BEGIN
  IF NEW.opportunity_id IS NOT NULL THEN
    SELECT o.building_id, o.property_id
      INTO v_opp_building, v_opp_property
      FROM public.opportunities o WHERE o.id = NEW.opportunity_id;

    -- The building comes from the opportunity. A building may be chosen
    -- explicitly (a multi-building property), but it must belong to the
    -- opportunity's property — otherwise the opportunity's own building wins.
    IF NEW.building_id IS NULL THEN
      NEW.building_id := v_opp_building;
    ELSE
      SELECT b.property_id INTO v_bld_property
        FROM public.buildings b WHERE b.id = NEW.building_id;
      IF v_bld_property IS DISTINCT FROM v_opp_property THEN
        NEW.building_id := v_opp_building;
      END IF;
    END IF;

    -- The property is derived, never picked.
    IF v_opp_property IS NOT NULL THEN
      NEW.property_id := v_opp_property;
    END IF;
  ELSIF NEW.building_id IS NOT NULL THEN
    -- No opportunity yet: still never let the property disagree with the building.
    SELECT b.property_id INTO v_bld_property
      FROM public.buildings b WHERE b.id = NEW.building_id;
    IF v_bld_property IS NOT NULL THEN
      NEW.property_id := v_bld_property;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enrollment_inherit_from_opportunity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enrollment_inherit_from_opportunity() FROM anon;
REVOKE ALL ON FUNCTION public.enrollment_inherit_from_opportunity() FROM authenticated;

DROP TRIGGER IF EXISTS trg_enrollment_inherit_from_opportunity ON public.enrollments;
CREATE TRIGGER trg_enrollment_inherit_from_opportunity
  BEFORE INSERT OR UPDATE ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.enrollment_inherit_from_opportunity();

-- ── 3. Enrollment names are derived too ───────────────────────────────────
-- Missed by 20260817171500 (all object names derived). Same shape as
-- assessments: richest parent available, then the record type.
CREATE OR REPLACE FUNCTION public.derive_enrollment_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_base text;
  v_rt   text;
  v_name text;
BEGIN
  SELECT pv.picklist_label INTO v_rt
    FROM public.picklist_values pv WHERE pv.id = NEW.enrollment_record_type;

  SELECT coalesce(b.building_name, o.opportunity_name, p.property_name)
    INTO v_base
    FROM (SELECT 1) z
    LEFT JOIN public.buildings     b ON b.id = NEW.building_id
    LEFT JOIN public.opportunities o ON o.id = NEW.opportunity_id
    LEFT JOIN public.properties    p ON p.id = NEW.property_id;

  v_name := public.append_name_segment(
              NULLIF(btrim(coalesce(v_base, '')), ''),
              NULLIF(btrim(coalesce(v_rt, '')), ''));

  NEW.enrollment_name := COALESCE(
    v_name, NULLIF(btrim(coalesce(NEW.enrollment_name, '')), ''), NEW.enrollment_name);
  RETURN NEW;
END;
$function$;

-- Runs AFTER the inherit trigger (alphabetical: ..._inherit_... < ..._name),
-- so the name is composed from the building the opportunity just supplied.
DROP TRIGGER IF EXISTS trg_enrollment_name ON public.enrollments;
CREATE TRIGGER trg_enrollment_name
  BEFORE INSERT OR UPDATE ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.derive_enrollment_name();

-- Cascade a rename down into enrollments, same as every other edge.
DROP TRIGGER IF EXISTS trg_cascade_building_name_to_enrollments ON public.buildings;
CREATE TRIGGER trg_cascade_building_name_to_enrollments
  AFTER UPDATE ON public.buildings
  FOR EACH ROW EXECUTE FUNCTION public.cascade_derived_name(
    'building_name', 'enrollments', 'building_id', 'enrollment_is_deleted');

DROP TRIGGER IF EXISTS trg_cascade_opportunity_name_to_enrollments ON public.opportunities;
CREATE TRIGGER trg_cascade_opportunity_name_to_enrollments
  AFTER UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.cascade_derived_name(
    'opportunity_name', 'enrollments', 'opportunity_id', 'enrollment_is_deleted');

DROP TRIGGER IF EXISTS trg_cascade_property_name_to_enrollments ON public.properties;
CREATE TRIGGER trg_cascade_property_name_to_enrollments
  AFTER UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.cascade_derived_name(
    'property_name', 'enrollments', 'property_id', 'enrollment_is_deleted');

NOTIFY pgrst, 'reload schema';
