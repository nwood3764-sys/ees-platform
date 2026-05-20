-- Trigger-maintained rollups for hub objects. Replaces the static seed-data
-- counts with values that always reflect reality.
--
-- Cascade direction (bottom-up). Each level recomputes its own rollups and
-- then explicitly calls the next level up, because we don't fire triggers on
-- the rollup columns themselves (UPDATE OF lists are narrow):
--
--   units.building_id      → recompute_building_rollups
--                              └── chains to recompute_property_rollups
--                                    └── chains to recompute_account_rollups
--   buildings.property_id  → recompute_property_rollups (FK / soft-delete change)
--   properties.property_account_id → recompute_account_rollups
--   opportunities.opportunity_account_id / amount / status / soft-delete
--                          → recompute_account_rollups
--   projects.opportunity_id → recompute_opportunity_rollups → account
--
-- Columns maintained (canonical first, dupe in parens):
--   accounts:    account_total_number_of_properties (int),
--                account_total_number_of_buildings  (int),
--                account_total_number_of_units      (int),
--                account_number_of_opportunities    (int),
--                account_number_of_open_opportunities (int),
--                account_number_of_won_opportunities  (int),
--                account_amount_of_open_opportunities (numeric)
--   properties:  property_number_of_buildings (numeric)   + property_total_buildings (int dupe),
--                property_total_number_of_units (numeric) + property_total_units (int dupe)
--   buildings:   building_number_of_units (numeric)       + building_total_units (int dupe)
--   opportunities: opportunity_number_of_projects (int)

CREATE OR REPLACE FUNCTION public.recompute_account_rollups(p_account_id uuid)
RETURNS void AS $$
DECLARE
  v_open_id uuid;
  v_won_id  uuid;
BEGIN
  IF p_account_id IS NULL THEN RETURN; END IF;

  SELECT id INTO v_open_id FROM picklist_values
   WHERE picklist_object='opportunities' AND picklist_field='opportunity_status'
     AND picklist_value='Open' LIMIT 1;
  SELECT id INTO v_won_id FROM picklist_values
   WHERE picklist_object='opportunities' AND picklist_field='opportunity_status'
     AND picklist_value='Won' LIMIT 1;

  UPDATE accounts a
     SET account_total_number_of_properties = COALESCE((
           SELECT count(*)::int FROM properties p
            WHERE p.property_account_id = p_account_id AND NOT p.property_is_deleted), 0),
         account_total_number_of_buildings = COALESCE((
           SELECT count(*)::int FROM buildings b
             JOIN properties p ON p.id = b.property_id AND NOT p.property_is_deleted
            WHERE p.property_account_id = p_account_id AND NOT b.building_is_deleted), 0),
         account_total_number_of_units = COALESCE((
           SELECT count(*)::int FROM units u
             JOIN buildings b  ON b.id = u.building_id        AND NOT b.building_is_deleted
             JOIN properties p ON p.id = b.property_id        AND NOT p.property_is_deleted
            WHERE p.property_account_id = p_account_id AND NOT u.unit_is_deleted), 0),
         account_number_of_opportunities = COALESCE((
           SELECT count(*)::int FROM opportunities o
            WHERE o.opportunity_account_id = p_account_id AND NOT o.opportunity_is_deleted), 0),
         account_number_of_open_opportunities = COALESCE((
           SELECT count(*)::int FROM opportunities o
            WHERE o.opportunity_account_id = p_account_id AND NOT o.opportunity_is_deleted
              AND o.opportunity_status = v_open_id), 0),
         account_number_of_won_opportunities = COALESCE((
           SELECT count(*)::int FROM opportunities o
            WHERE o.opportunity_account_id = p_account_id AND NOT o.opportunity_is_deleted
              AND o.opportunity_status = v_won_id), 0),
         account_amount_of_open_opportunities = COALESCE((
           SELECT sum(o.opportunity_amount) FROM opportunities o
            WHERE o.opportunity_account_id = p_account_id AND NOT o.opportunity_is_deleted
              AND o.opportunity_status = v_open_id), 0)
   WHERE a.id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.recompute_property_rollups(p_property_id uuid)
RETURNS void AS $$
DECLARE
  v_account_id uuid;
  v_buildings  int;
  v_units      int;
BEGIN
  IF p_property_id IS NULL THEN RETURN; END IF;

  SELECT count(*)::int INTO v_buildings FROM buildings b
   WHERE b.property_id = p_property_id AND NOT b.building_is_deleted;

  SELECT count(*)::int INTO v_units FROM units u
    JOIN buildings b ON b.id = u.building_id AND NOT b.building_is_deleted
   WHERE b.property_id = p_property_id AND NOT u.unit_is_deleted;

  UPDATE properties p
     SET property_number_of_buildings   = v_buildings::numeric,
         property_total_buildings       = v_buildings,
         property_total_number_of_units = v_units::numeric,
         property_total_units           = v_units
   WHERE p.id = p_property_id
   RETURNING p.property_account_id INTO v_account_id;

  PERFORM recompute_account_rollups(v_account_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.recompute_building_rollups(p_building_id uuid)
RETURNS void AS $$
DECLARE
  v_property_id uuid;
  v_units       int;
BEGIN
  IF p_building_id IS NULL THEN RETURN; END IF;

  SELECT count(*)::int INTO v_units FROM units u
   WHERE u.building_id = p_building_id AND NOT u.unit_is_deleted;

  UPDATE buildings b
     SET building_number_of_units = v_units::numeric,
         building_total_units     = v_units
   WHERE b.id = p_building_id
   RETURNING b.property_id INTO v_property_id;

  PERFORM recompute_property_rollups(v_property_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.recompute_opportunity_rollups(p_opportunity_id uuid)
RETURNS void AS $$
DECLARE
  v_account_id uuid;
  v_projects   int;
BEGIN
  IF p_opportunity_id IS NULL THEN RETURN; END IF;

  SELECT count(*)::int INTO v_projects FROM projects pr
   WHERE pr.opportunity_id = p_opportunity_id AND NOT pr.project_is_deleted;

  UPDATE opportunities o
     SET opportunity_number_of_projects = v_projects
   WHERE o.id = p_opportunity_id
   RETURNING o.opportunity_account_id INTO v_account_id;

  PERFORM recompute_account_rollups(v_account_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.trg_units_rollup() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM recompute_building_rollups(NEW.building_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM recompute_building_rollups(OLD.building_id);
  ELSE
    PERFORM recompute_building_rollups(NEW.building_id);
    IF OLD.building_id IS DISTINCT FROM NEW.building_id THEN
      PERFORM recompute_building_rollups(OLD.building_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.trg_buildings_rollup() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM recompute_property_rollups(NEW.property_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM recompute_property_rollups(OLD.property_id);
  ELSE
    PERFORM recompute_property_rollups(NEW.property_id);
    IF OLD.property_id IS DISTINCT FROM NEW.property_id THEN
      PERFORM recompute_property_rollups(OLD.property_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.trg_properties_rollup() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM recompute_account_rollups(NEW.property_account_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM recompute_account_rollups(OLD.property_account_id);
  ELSE
    PERFORM recompute_account_rollups(NEW.property_account_id);
    IF OLD.property_account_id IS DISTINCT FROM NEW.property_account_id THEN
      PERFORM recompute_account_rollups(OLD.property_account_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.trg_opportunities_rollup() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM recompute_account_rollups(NEW.opportunity_account_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM recompute_account_rollups(OLD.opportunity_account_id);
  ELSE
    PERFORM recompute_account_rollups(NEW.opportunity_account_id);
    IF OLD.opportunity_account_id IS DISTINCT FROM NEW.opportunity_account_id THEN
      PERFORM recompute_account_rollups(OLD.opportunity_account_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.trg_projects_rollup() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM recompute_opportunity_rollups(NEW.opportunity_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM recompute_opportunity_rollups(OLD.opportunity_id);
  ELSE
    PERFORM recompute_opportunity_rollups(NEW.opportunity_id);
    IF OLD.opportunity_id IS DISTINCT FROM NEW.opportunity_id THEN
      PERFORM recompute_opportunity_rollups(OLD.opportunity_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS units_rollup_iud      ON public.units;
DROP TRIGGER IF EXISTS buildings_rollup_iud  ON public.buildings;
DROP TRIGGER IF EXISTS properties_rollup_iud ON public.properties;
DROP TRIGGER IF EXISTS opportunities_rollup_iud ON public.opportunities;
DROP TRIGGER IF EXISTS projects_rollup_iud   ON public.projects;

CREATE TRIGGER units_rollup_iud
  AFTER INSERT OR DELETE OR UPDATE OF building_id, unit_is_deleted ON public.units
  FOR EACH ROW EXECUTE FUNCTION public.trg_units_rollup();

CREATE TRIGGER buildings_rollup_iud
  AFTER INSERT OR DELETE OR UPDATE OF property_id, building_is_deleted ON public.buildings
  FOR EACH ROW EXECUTE FUNCTION public.trg_buildings_rollup();

CREATE TRIGGER properties_rollup_iud
  AFTER INSERT OR DELETE OR UPDATE OF property_account_id, property_is_deleted ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.trg_properties_rollup();

CREATE TRIGGER opportunities_rollup_iud
  AFTER INSERT OR DELETE OR UPDATE OF opportunity_account_id, opportunity_amount, opportunity_status, opportunity_is_deleted
  ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.trg_opportunities_rollup();

CREATE TRIGGER projects_rollup_iud
  AFTER INSERT OR DELETE OR UPDATE OF opportunity_id, project_is_deleted ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.trg_projects_rollup();

-- Inline backfill (bottom-up)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM buildings WHERE NOT building_is_deleted LOOP
    PERFORM recompute_building_rollups(r.id);
  END LOOP;
  FOR r IN SELECT id FROM properties WHERE NOT property_is_deleted
            AND id NOT IN (SELECT DISTINCT property_id FROM buildings
                            WHERE NOT building_is_deleted AND property_id IS NOT NULL) LOOP
    PERFORM recompute_property_rollups(r.id);
  END LOOP;
  FOR r IN SELECT id FROM opportunities WHERE NOT opportunity_is_deleted LOOP
    PERFORM recompute_opportunity_rollups(r.id);
  END LOOP;
  FOR r IN SELECT id FROM accounts WHERE NOT account_is_deleted
            AND id NOT IN (SELECT DISTINCT property_account_id FROM properties
                            WHERE NOT property_is_deleted AND property_account_id IS NOT NULL)
            AND id NOT IN (SELECT DISTINCT opportunity_account_id FROM opportunities
                            WHERE NOT opportunity_is_deleted AND opportunity_account_id IS NOT NULL) LOOP
    PERFORM recompute_account_rollups(r.id);
  END LOOP;
END $$;
