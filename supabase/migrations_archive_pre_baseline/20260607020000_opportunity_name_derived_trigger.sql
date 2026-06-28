-- Derive opportunity_name = "<building_name> - <record_type_label>".
-- When no record type is set, fall back to just the building name (trailing
-- separator trimmed). When no building is linked, fall back to the property
-- name so the record is never left nameless. Mirrors the trg_contact_name
-- pattern: name is trigger-derived, never user-entered, and any value a user
-- (or the create form) tries to set is overwritten on write.
CREATE OR REPLACE FUNCTION public.derive_opportunity_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_building_name text;
  v_record_label  text;
  v_property_name text;
  v_base          text;
BEGIN
  SELECT b.building_name INTO v_building_name
    FROM buildings b WHERE b.id = NEW.building_id;

  SELECT pv.picklist_label INTO v_record_label
    FROM picklist_values pv WHERE pv.id = NEW.opportunity_record_type;

  v_base := NULLIF(trim(coalesce(v_building_name, '')), '');
  IF v_base IS NULL THEN
    SELECT p.property_name INTO v_property_name
      FROM properties p WHERE p.id = NEW.property_id;
    v_base := NULLIF(trim(coalesce(v_property_name, '')), '');
  END IF;

  NEW.opportunity_name := NULLIF(
    trim(both ' -' FROM (
      coalesce(v_base, '')
      || CASE WHEN v_record_label IS NOT NULL AND trim(v_record_label) <> ''
              THEN ' - ' || v_record_label ELSE '' END
    )),
    ''
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_opportunity_name ON public.opportunities;
CREATE TRIGGER trg_opportunity_name
  BEFORE INSERT OR UPDATE ON public.opportunities
  FOR EACH ROW
  EXECUTE FUNCTION public.derive_opportunity_name();
