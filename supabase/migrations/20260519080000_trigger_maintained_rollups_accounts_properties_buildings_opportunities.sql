-- Trigger-maintained rollups for accounts / properties / buildings / opportunities.
--
-- Replaces static seed values with live counts that update automatically when
-- child records are inserted, soft-deleted, restored, or have their parent
-- FK reassigned. Approach: recompute-from-scratch helper functions called
-- by AFTER triggers on every child table. Volumes are tiny (small-business
-- CRM) so the recompute cost is negligible and we avoid delta-math drift.
--
-- Rollups maintained:
--   accounts:
--     account_total_number_of_properties  (1-hop via properties)
--     account_total_number_of_buildings   (2-hop via properties→buildings)
--     account_total_number_of_units       (3-hop via properties→buildings→units)
--     account_number_of_opportunities
--     account_number_of_open_opportunities    (opp status = 'Open')
--     account_number_of_won_opportunities     (opp status = 'Won')
--     account_amount_of_open_opportunities    (sum of opportunity_amount for Open)
--   properties:
--     property_number_of_buildings
--     property_total_number_of_units      (via buildings)
--     property_total_units                (legacy duplicate, kept in sync)
--   buildings:
--     building_number_of_units
--     building_total_units                (legacy duplicate, kept in sync)
--   opportunities:
--     opportunity_number_of_projects
--     opportunity_amount_of_projects      (sum of project_contract_value)

CREATE OR REPLACE FUNCTION public.recompute_account_rollups(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_account_id IS NULL THEN RETURN; END IF;

  UPDATE public.accounts a SET
    account_total_number_of_properties = (
      SELECT count(*) FROM public.properties
       WHERE property_account_id = p_account_id
         AND NOT property_is_deleted
    ),
    account_total_number_of_buildings = (
      SELECT count(*) FROM public.buildings b
        JOIN public.properties p ON p.id = b.property_id
       WHERE p.property_account_id = p_account_id
         AND NOT p.property_is_deleted
         AND NOT b.building_is_deleted
    ),
    account_total_number_of_units = (
      SELECT count(*) FROM public.units u
        JOIN public.buildings b ON b.id = u.building_id
        JOIN public.properties p ON p.id = b.property_id
       WHERE p.property_account_id = p_account_id
         AND NOT p.property_is_deleted
         AND NOT b.building_is_deleted
         AND NOT u.unit_is_deleted
    ),
    account_number_of_opportunities = (
      SELECT count(*) FROM public.opportunities
       WHERE opportunity_account_id = p_account_id
         AND NOT opportunity_is_deleted
    ),
    account_number_of_open_opportunities = (
      SELECT count(*) FROM public.opportunities o
        LEFT JOIN public.picklist_values pv ON pv.id = o.opportunity_status
       WHERE o.opportunity_account_id = p_account_id
         AND NOT o.opportunity_is_deleted
         AND pv.picklist_value = 'Open'
    ),
    account_number_of_won_opportunities = (
      SELECT count(*) FROM public.opportunities o
        LEFT JOIN public.picklist_values pv ON pv.id = o.opportunity_status
       WHERE o.opportunity_account_id = p_account_id
         AND NOT o.opportunity_is_deleted
         AND pv.picklist_value = 'Won'
    ),
    account_amount_of_open_opportunities = COALESCE((
      SELECT sum(o.opportunity_amount) FROM public.opportunities o
        LEFT JOIN public.picklist_values pv ON pv.id = o.opportunity_status
       WHERE o.opportunity_account_id = p_account_id
         AND NOT o.opportunity_is_deleted
         AND pv.picklist_value = 'Open'
    ), 0),
    account_updated_at = now()
  WHERE a.id = p_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_property_rollups(p_property_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unit_count integer;
  v_building_count integer;
BEGIN
  IF p_property_id IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO v_building_count FROM public.buildings
   WHERE property_id = p_property_id AND NOT building_is_deleted;
  SELECT count(*) INTO v_unit_count FROM public.units u
    JOIN public.buildings b ON b.id = u.building_id
   WHERE b.property_id = p_property_id
     AND NOT b.building_is_deleted AND NOT u.unit_is_deleted;
  UPDATE public.properties SET
    property_number_of_buildings    = v_building_count,
    property_total_number_of_units  = v_unit_count,
    property_total_units            = v_unit_count,
    property_updated_at             = now()
  WHERE id = p_property_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_building_rollups(p_building_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_unit_count integer;
BEGIN
  IF p_building_id IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO v_unit_count FROM public.units
   WHERE building_id = p_building_id AND NOT unit_is_deleted;
  UPDATE public.buildings SET
    building_number_of_units = v_unit_count,
    building_total_units     = v_unit_count,
    building_updated_at      = now()
  WHERE id = p_building_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_opportunity_rollups(p_opportunity_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_opportunity_id IS NULL THEN RETURN; END IF;
  UPDATE public.opportunities SET
    opportunity_number_of_projects = (
      SELECT count(*) FROM public.projects
       WHERE opportunity_id = p_opportunity_id AND NOT project_is_deleted
    ),
    opportunity_amount_of_projects = COALESCE((
      SELECT sum(project_contract_value) FROM public.projects
       WHERE opportunity_id = p_opportunity_id AND NOT project_is_deleted
    ), 0),
    opportunity_updated_at = now()
  WHERE id = p_opportunity_id;
END;
$$;

-- Trigger functions walk the chain so a unit change updates building,
-- property, AND account in the same firing — no cascading needed.

CREATE OR REPLACE FUNCTION public.trg_units_recompute_rollups()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_building_ids uuid[] := ARRAY[]::uuid[];
  v_property_ids uuid[] := ARRAY[]::uuid[];
  v_account_ids uuid[] := ARRAY[]::uuid[];
  v_bid uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN v_building_ids := ARRAY[NEW.building_id];
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.building_id IS DISTINCT FROM OLD.building_id
      THEN v_building_ids := ARRAY[OLD.building_id, NEW.building_id];
      ELSE v_building_ids := ARRAY[NEW.building_id];
    END IF;
  ELSIF TG_OP = 'DELETE' THEN v_building_ids := ARRAY[OLD.building_id];
  END IF;
  FOREACH v_bid IN ARRAY v_building_ids LOOP
    IF v_bid IS NOT NULL THEN
      PERFORM recompute_building_rollups(v_bid);
      v_property_ids := v_property_ids || (SELECT property_id FROM buildings WHERE id = v_bid);
    END IF;
  END LOOP;
  FOREACH v_bid IN ARRAY v_property_ids LOOP
    IF v_bid IS NOT NULL THEN
      PERFORM recompute_property_rollups(v_bid);
      v_account_ids := v_account_ids || (SELECT property_account_id FROM properties WHERE id = v_bid);
    END IF;
  END LOOP;
  FOREACH v_bid IN ARRAY v_account_ids LOOP
    IF v_bid IS NOT NULL THEN PERFORM recompute_account_rollups(v_bid); END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE OR REPLACE FUNCTION public.trg_buildings_recompute_rollups()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_property_ids uuid[] := ARRAY[]::uuid[];
  v_account_ids uuid[] := ARRAY[]::uuid[];
  v_pid uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN v_property_ids := ARRAY[NEW.property_id];
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.property_id IS DISTINCT FROM OLD.property_id
      THEN v_property_ids := ARRAY[OLD.property_id, NEW.property_id];
      ELSE v_property_ids := ARRAY[NEW.property_id];
    END IF;
  ELSIF TG_OP = 'DELETE' THEN v_property_ids := ARRAY[OLD.property_id];
  END IF;
  FOREACH v_pid IN ARRAY v_property_ids LOOP
    IF v_pid IS NOT NULL THEN
      PERFORM recompute_property_rollups(v_pid);
      v_account_ids := v_account_ids || (SELECT property_account_id FROM properties WHERE id = v_pid);
    END IF;
  END LOOP;
  FOREACH v_pid IN ARRAY v_account_ids LOOP
    IF v_pid IS NOT NULL THEN PERFORM recompute_account_rollups(v_pid); END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE OR REPLACE FUNCTION public.trg_properties_recompute_rollups()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account_ids uuid[] := ARRAY[]::uuid[];
  v_aid uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN v_account_ids := ARRAY[NEW.property_account_id];
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.property_account_id IS DISTINCT FROM OLD.property_account_id
      THEN v_account_ids := ARRAY[OLD.property_account_id, NEW.property_account_id];
      ELSE v_account_ids := ARRAY[NEW.property_account_id];
    END IF;
  ELSIF TG_OP = 'DELETE' THEN v_account_ids := ARRAY[OLD.property_account_id];
  END IF;
  FOREACH v_aid IN ARRAY v_account_ids LOOP
    IF v_aid IS NOT NULL THEN PERFORM recompute_account_rollups(v_aid); END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE OR REPLACE FUNCTION public.trg_opportunities_recompute_rollups()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account_ids uuid[] := ARRAY[]::uuid[];
  v_aid uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN v_account_ids := ARRAY[NEW.opportunity_account_id];
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.opportunity_account_id IS DISTINCT FROM OLD.opportunity_account_id
      THEN v_account_ids := ARRAY[OLD.opportunity_account_id, NEW.opportunity_account_id];
      ELSE v_account_ids := ARRAY[NEW.opportunity_account_id];
    END IF;
  ELSIF TG_OP = 'DELETE' THEN v_account_ids := ARRAY[OLD.opportunity_account_id];
  END IF;
  FOREACH v_aid IN ARRAY v_account_ids LOOP
    IF v_aid IS NOT NULL THEN PERFORM recompute_account_rollups(v_aid); END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE OR REPLACE FUNCTION public.trg_projects_recompute_rollups()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_opp_ids uuid[] := ARRAY[]::uuid[];
  v_oid uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN v_opp_ids := ARRAY[NEW.opportunity_id];
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
      THEN v_opp_ids := ARRAY[OLD.opportunity_id, NEW.opportunity_id];
      ELSE v_opp_ids := ARRAY[NEW.opportunity_id];
    END IF;
  ELSIF TG_OP = 'DELETE' THEN v_opp_ids := ARRAY[OLD.opportunity_id];
  END IF;
  FOREACH v_oid IN ARRAY v_opp_ids LOOP
    IF v_oid IS NOT NULL THEN PERFORM recompute_opportunity_rollups(v_oid); END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS units_recompute_rollups ON public.units;
CREATE TRIGGER units_recompute_rollups
AFTER INSERT OR UPDATE OR DELETE ON public.units
FOR EACH ROW EXECUTE FUNCTION public.trg_units_recompute_rollups();

DROP TRIGGER IF EXISTS buildings_recompute_rollups ON public.buildings;
CREATE TRIGGER buildings_recompute_rollups
AFTER INSERT OR UPDATE OR DELETE ON public.buildings
FOR EACH ROW EXECUTE FUNCTION public.trg_buildings_recompute_rollups();

DROP TRIGGER IF EXISTS properties_recompute_rollups ON public.properties;
CREATE TRIGGER properties_recompute_rollups
AFTER INSERT OR UPDATE OR DELETE ON public.properties
FOR EACH ROW EXECUTE FUNCTION public.trg_properties_recompute_rollups();

DROP TRIGGER IF EXISTS opportunities_recompute_rollups ON public.opportunities;
CREATE TRIGGER opportunities_recompute_rollups
AFTER INSERT OR UPDATE OR DELETE ON public.opportunities
FOR EACH ROW EXECUTE FUNCTION public.trg_opportunities_recompute_rollups();

DROP TRIGGER IF EXISTS projects_recompute_rollups ON public.projects;
CREATE TRIGGER projects_recompute_rollups
AFTER INSERT OR UPDATE OR DELETE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.trg_projects_recompute_rollups();

-- One-time backfill from current data. Bottom-up so each level reads
-- already-computed values from below.
DO $$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM buildings WHERE NOT building_is_deleted LOOP
    PERFORM recompute_building_rollups(v_id);
  END LOOP;
  FOR v_id IN SELECT id FROM properties WHERE NOT property_is_deleted LOOP
    PERFORM recompute_property_rollups(v_id);
  END LOOP;
  FOR v_id IN SELECT id FROM opportunities WHERE NOT opportunity_is_deleted LOOP
    PERFORM recompute_opportunity_rollups(v_id);
  END LOOP;
  FOR v_id IN SELECT id FROM accounts WHERE NOT account_is_deleted LOOP
    PERFORM recompute_account_rollups(v_id);
  END LOOP;
END;
$$;
