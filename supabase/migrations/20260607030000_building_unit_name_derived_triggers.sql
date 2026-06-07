-- building_name = "<property_name> - <building_number_or_name>"
-- unit_name     = "<building_name> - <unit_number>"
-- Both trigger-derived, never user-entered. Mirrors trg_contact_name /
-- trg_opportunity_name. Backfill order for these is buildings before units
-- (units read the derived building_name), and opportunities after buildings
-- (opportunity_name derives from building_name).
CREATE OR REPLACE FUNCTION public.derive_building_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_property_name text;
  v_number        text;
BEGIN
  SELECT p.property_name INTO v_property_name
    FROM properties p WHERE p.id = NEW.property_id;
  v_number := NULLIF(trim(coalesce(NEW.building_number_or_name, '')), '');
  NEW.building_name := NULLIF(
    trim(both ' -' FROM (
      coalesce(NULLIF(trim(coalesce(v_property_name,'')),''), '')
      || CASE WHEN v_number IS NOT NULL THEN ' - ' || v_number ELSE '' END
    )),
    ''
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.derive_unit_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_building_name text;
  v_number        text;
BEGIN
  SELECT b.building_name INTO v_building_name
    FROM buildings b WHERE b.id = NEW.building_id;
  v_number := NULLIF(trim(coalesce(NEW.unit_number, '')), '');
  NEW.unit_name := NULLIF(
    trim(both ' -' FROM (
      coalesce(NULLIF(trim(coalesce(v_building_name,'')),''), '')
      || CASE WHEN v_number IS NOT NULL THEN ' - ' || v_number ELSE '' END
    )),
    ''
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_building_name ON public.buildings;
CREATE TRIGGER trg_building_name
  BEFORE INSERT OR UPDATE ON public.buildings
  FOR EACH ROW EXECUTE FUNCTION public.derive_building_name();

DROP TRIGGER IF EXISTS trg_unit_name ON public.units;
CREATE TRIGGER trg_unit_name
  BEFORE INSERT OR UPDATE ON public.units
  FOR EACH ROW EXECUTE FUNCTION public.derive_unit_name();
