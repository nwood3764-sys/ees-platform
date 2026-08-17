-- Derived names propagate down the chain, live.
--
-- Nicholas, 2026-08-17: "If I change the building name or address, everything
-- else downstream that concatenates that, like opportunities and work orders and
-- everything, gets changed… It needs to read from the related records and
-- inherit." Not a one-time capitalisation pass — the mechanism.
--
-- Where we were: every level already recomposes its OWN name from its parent
-- when the row is written…
--
--   properties            = <street> - <city>
--   buildings             = <property name> - <building number>
--   units                 = <building name> - <unit number>
--   opportunities         = <building name, else property name> - <record type>
--   projects              = <opportunity name> - <record type>
--   work_orders           = <project name> - <unit number> - <work type>
--   incentive_applications= <opportunity/property/building name> - <record type>
--
-- …but only ONE edge cascaded (properties → buildings). Rename a building and
-- its units, opportunities, projects and work orders kept the old text forever,
-- because nothing told them to recompose. That is why import-era capitals
-- survived at every level below the property.
--
-- Two changes:
--
--   1. work_orders and incentive_applications recompose their name on every
--      write instead of only when it is blank. Composition that runs once can
--      never propagate, and both names are trigger-derived and read-only in the
--      UI, so there is no hand-typed value to protect.
--
--   2. One generic cascade — cascade_derived_name() — wired to every edge. When
--      a parent's contributing column changes it performs a no-op write on each
--      live child (setting the child's FK to itself), which fires that child's
--      own BEFORE trigger, which recomposes its name, which cascades to ITS
--      children. Change a street and the whole tree follows in one statement.
--
-- Termination: each cascade fires only when the parent's own value actually
-- changed (IS DISTINCT FROM), and the graph only ever points downward
-- (property → building → unit/opportunity → project → work order), so there is
-- no cycle to loop on.

-- ---------------------------------------------------------------------------
-- The cascade
-- ---------------------------------------------------------------------------
-- TG_ARGV[0] the parent column whose change matters (its name, or the number a
--            child's name is built from)
-- TG_ARGV[1] child table          TG_ARGV[2] child FK back to this parent
-- TG_ARGV[3] child soft-delete column
-- TG_ARGV[4] optional extra WHERE fragment (e.g. only children with no building)
--
-- SECURITY DEFINER so a cascade is never silently skipped by the caller's RLS —
-- same reasoning as the opportunity-account cascade. Identifiers come from the
-- trigger definitions in this migration, never from user input.
CREATE OR REPLACE FUNCTION public.cascade_derived_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_col     text := TG_ARGV[0];
  v_child   text := TG_ARGV[1];
  v_fk      text := TG_ARGV[2];
  v_deleted text := TG_ARGV[3];
  v_extra   text := COALESCE(TG_ARGV[4], '');
  v_old     text;
  v_new     text;
BEGIN
  v_old := to_jsonb(OLD) ->> v_col;
  v_new := to_jsonb(NEW) ->> v_col;
  IF v_old IS NOT DISTINCT FROM v_new THEN
    RETURN NULL;
  END IF;

  EXECUTE format(
    'UPDATE public.%I SET %I = %I WHERE %I = $1 AND COALESCE(%I, false) = false %s',
    v_child, v_fk, v_fk, v_fk, v_deleted, v_extra
  ) USING NEW.id;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.cascade_derived_name() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cascade_derived_name() FROM anon;
REVOKE ALL ON FUNCTION public.cascade_derived_name() FROM authenticated;

-- ---------------------------------------------------------------------------
-- 1. Always recompose, so a name can propagate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.work_order_inherit_parent_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_project_name   text;
  v_proj_opp       uuid;
  v_proj_property  uuid;
  v_proj_building  uuid;
  v_unit_number    text;
  v_unit_name      text;
  v_work_type_name text;
  v_record_type_lbl text;
  v_property_name  text;
  v_building_name  text;
  v_name           text;
BEGIN
  SELECT p.project_name, p.opportunity_id, p.property_id, p.building_id
    INTO v_project_name, v_proj_opp, v_proj_property, v_proj_building
  FROM public.projects p
  WHERE p.id = NEW.project_id;

  IF NEW.opportunity_id IS NULL THEN NEW.opportunity_id := v_proj_opp; END IF;
  IF NEW.property_id   IS NULL THEN NEW.property_id   := v_proj_property; END IF;
  IF NEW.building_id   IS NULL THEN NEW.building_id   := v_proj_building; END IF;

  IF NEW.unit_id IS NOT NULL THEN
    SELECT u.unit_number, u.unit_name
      INTO v_unit_number, v_unit_name
    FROM public.units u WHERE u.id = NEW.unit_id;
  END IF;

  IF NEW.work_type_id IS NOT NULL THEN
    SELECT wt.work_type_name INTO v_work_type_name
    FROM public.work_types wt WHERE wt.id = NEW.work_type_id;
  END IF;

  IF NEW.work_order_record_type IS NOT NULL THEN
    SELECT pv.picklist_label INTO v_record_type_lbl
    FROM public.picklist_values pv WHERE pv.id = NEW.work_order_record_type;
  END IF;

  IF NEW.property_id IS NOT NULL THEN
    SELECT pr.property_name INTO v_property_name
    FROM public.properties pr WHERE pr.id = NEW.property_id;
  END IF;
  IF NEW.building_id IS NOT NULL THEN
    SELECT b.building_name INTO v_building_name
    FROM public.buildings b WHERE b.id = NEW.building_id;
  END IF;

  -- Always derived (was: only when blank). work_order_name is read-only in the
  -- UI, so there is no user-entered value to preserve — and a name composed
  -- once could never follow its project.
  v_name := NULLIF(btrim(coalesce(v_project_name, '')), '');
  v_name := public.append_name_segment(v_name, COALESCE(v_unit_number, v_unit_name));
  v_name := public.append_name_segment(v_name, COALESCE(v_work_type_name, v_record_type_lbl));
  IF v_name IS NOT NULL THEN
    NEW.work_order_name := v_name;
  END IF;

  IF NEW.work_order_project IS NULL THEN NEW.work_order_project := v_project_name; END IF;
  IF NEW.work_order_unit IS NULL THEN NEW.work_order_unit := COALESCE(v_unit_number, v_unit_name); END IF;
  IF NEW.work_order_property_name IS NULL THEN NEW.work_order_property_name := v_property_name; END IF;
  IF NEW.work_order_property IS NULL THEN NEW.work_order_property := v_property_name; END IF;
  IF NEW.work_order_building IS NULL THEN NEW.work_order_building := v_building_name; END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.incentive_application_autoname()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_base text;
  v_rt   text;
  v_prog text;
BEGIN
  SELECT pv.picklist_label INTO v_rt
  FROM public.picklist_values pv
  WHERE pv.id = NEW.ia_record_type;

  -- Always derived, so the name follows its opportunity / property / building.
  SELECT coalesce(o.opportunity_name, p.property_name, b.building_name)
    INTO v_base
  FROM (SELECT 1) z
  LEFT JOIN public.opportunities o ON o.id = NEW.opportunity_id
  LEFT JOIN public.properties    p ON p.id = NEW.property_id
  LEFT JOIN public.buildings     b ON b.id = NEW.building_id;
  NEW.ia_name := public.append_name_segment(nullif(btrim(coalesce(v_base, '')), ''),
                                            nullif(btrim(coalesce(v_rt, '')), ''));
  IF NEW.ia_name IS NULL THEN NEW.ia_name := 'Incentive Application'; END IF;

  IF nullif(btrim(coalesce(NEW.ia_program_name, '')), '') IS NULL THEN
    SELECT pr.name INTO v_prog FROM public.programs pr WHERE pr.id = NEW.program_id;
    NEW.ia_program_name := coalesce(nullif(btrim(coalesce(v_prog, '')), ''), v_rt);
  END IF;

  IF NEW.ia_signer_contact_id IS NULL AND NEW.opportunity_id IS NOT NULL THEN
    SELECT o.opportunity_authorized_signer_id INTO NEW.ia_signer_contact_id
    FROM public.opportunities o WHERE o.id = NEW.opportunity_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Wire every edge
-- ---------------------------------------------------------------------------
-- Replaces the one bespoke cascade (properties → buildings) so there is a single
-- mechanism rather than one per edge.
DROP TRIGGER IF EXISTS trg_cascade_property_name ON public.properties;

DROP TRIGGER IF EXISTS trg_cascade_name_to_buildings ON public.properties;
CREATE TRIGGER trg_cascade_name_to_buildings
  AFTER UPDATE ON public.properties FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'property_name', 'buildings', 'property_id', 'building_is_deleted');

-- An opportunity with no building takes its base from the property.
DROP TRIGGER IF EXISTS trg_cascade_name_to_opportunities ON public.properties;
CREATE TRIGGER trg_cascade_name_to_opportunities
  AFTER UPDATE ON public.properties FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'property_name', 'opportunities', 'property_id', 'opportunity_is_deleted',
    'AND building_id IS NULL');

DROP TRIGGER IF EXISTS trg_cascade_name_to_ia ON public.properties;
CREATE TRIGGER trg_cascade_name_to_ia
  AFTER UPDATE ON public.properties FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'property_name', 'incentive_applications', 'property_id', 'ia_is_deleted');

DROP TRIGGER IF EXISTS trg_cascade_building_name_to_units ON public.buildings;
CREATE TRIGGER trg_cascade_building_name_to_units
  AFTER UPDATE ON public.buildings FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'building_name', 'units', 'building_id', 'unit_is_deleted');

DROP TRIGGER IF EXISTS trg_cascade_building_name_to_opportunities ON public.buildings;
CREATE TRIGGER trg_cascade_building_name_to_opportunities
  AFTER UPDATE ON public.buildings FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'building_name', 'opportunities', 'building_id', 'opportunity_is_deleted');

DROP TRIGGER IF EXISTS trg_cascade_building_name_to_ia ON public.buildings;
CREATE TRIGGER trg_cascade_building_name_to_ia
  AFTER UPDATE ON public.buildings FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'building_name', 'incentive_applications', 'building_id', 'ia_is_deleted');

-- A work order's name carries the unit NUMBER, not the unit's composed name.
DROP TRIGGER IF EXISTS trg_cascade_unit_number_to_work_orders ON public.units;
CREATE TRIGGER trg_cascade_unit_number_to_work_orders
  AFTER UPDATE ON public.units FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'unit_number', 'work_orders', 'unit_id', 'work_order_is_deleted');

DROP TRIGGER IF EXISTS trg_cascade_opportunity_name_to_projects ON public.opportunities;
CREATE TRIGGER trg_cascade_opportunity_name_to_projects
  AFTER UPDATE ON public.opportunities FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'opportunity_name', 'projects', 'opportunity_id', 'project_is_deleted');

DROP TRIGGER IF EXISTS trg_cascade_opportunity_name_to_ia ON public.opportunities;
CREATE TRIGGER trg_cascade_opportunity_name_to_ia
  AFTER UPDATE ON public.opportunities FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'opportunity_name', 'incentive_applications', 'opportunity_id', 'ia_is_deleted');

DROP TRIGGER IF EXISTS trg_cascade_project_name_to_work_orders ON public.projects;
CREATE TRIGGER trg_cascade_project_name_to_work_orders
  AFTER UPDATE ON public.projects FOR EACH ROW
  EXECUTE FUNCTION public.cascade_derived_name(
    'project_name', 'work_orders', 'project_id', 'work_order_is_deleted');

NOTIFY pgrst, 'reload schema';
