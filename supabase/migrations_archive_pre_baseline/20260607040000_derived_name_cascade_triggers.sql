-- Cascade derived-name recomputation down the hierarchy when a parent's name
-- changes. Property rename -> re-derive its buildings; building name change ->
-- re-derive its units and opportunities. The BEFORE triggers
-- (trg_building_name/unit/opportunity) do the string composition; these AFTER
-- triggers "touch" the children (no-op writes) so those BEFORE triggers re-fire.
-- Recursion is bounded by the WHEN clauses (only fires when the name changed)
-- and by the fact units/opportunities have no name-deriving children.
CREATE OR REPLACE FUNCTION public.cascade_property_name_to_children()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_catalog'
AS $$
BEGIN
  IF NEW.property_name IS DISTINCT FROM OLD.property_name THEN
    UPDATE buildings SET property_id = property_id
      WHERE property_id = NEW.id AND building_is_deleted = false;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cascade_building_name_to_children()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_catalog'
AS $$
BEGIN
  IF NEW.building_name IS DISTINCT FROM OLD.building_name THEN
    UPDATE units SET building_id = building_id
      WHERE building_id = NEW.id AND unit_is_deleted = false;
    UPDATE opportunities SET building_id = building_id
      WHERE building_id = NEW.id AND opportunity_is_deleted = false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_property_name ON public.properties;
CREATE TRIGGER trg_cascade_property_name
  AFTER UPDATE ON public.properties
  FOR EACH ROW
  WHEN (OLD.property_name IS DISTINCT FROM NEW.property_name)
  EXECUTE FUNCTION public.cascade_property_name_to_children();

DROP TRIGGER IF EXISTS trg_cascade_building_name ON public.buildings;
CREATE TRIGGER trg_cascade_building_name
  AFTER UPDATE ON public.buildings
  FOR EACH ROW
  WHEN (OLD.building_name IS DISTINCT FROM NEW.building_name)
  EXECUTE FUNCTION public.cascade_building_name_to_children();
