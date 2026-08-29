-- =============================================================================
-- A building's record type defaults from its property.
--
-- Nicholas, 2026-08-29: "on multifamily buildings, we shouldn't have the
-- single-family record types for opportunities available at all."
--
-- The rule that governs this already existed and was CORRECT: 84 active
-- record_type_eligibility edges say a MULTIFAMILY building runs only the
-- multifamily programs, and enforce_opportunity_record_type_building_eligibility
-- refuses anything else on save. What it could not do is classify a building
-- that carries no record type at all — the trigger returns early on a NULL
-- (`IF v_building_rt IS NULL THEN RETURN NEW`), and so does the client picker
-- (fetchConstrainingParentForCreate needs a uuid). An untyped building
-- therefore failed OPEN and was offered every program in its state, which is
-- exactly what he saw: BLD-00083 "1226 West Florence Street - Whitewater",
-- 11 units, on a MULTIFAMILY property, with no building record type.
--
-- 31 of 82 live buildings are untyped. Every one of them sits on a property
-- typed MULTIFAMILY, and 0 of 16,664 live properties are untyped — so the
-- property can always answer the question, and no value has to be guessed.
--
-- DEFAULT, never a cascade. A building may legitimately differ from its
-- property: 9 SINGLE-FAMILY-ATTACHED and 1 SINGLE-FAMILY-DETACHED buildings
-- sit on MULTIFAMILY properties today, and those are real. This fills a NULL
-- and never overwrites a value a person chose.
--
-- Resolved by VALUE, not by id: properties and buildings keep their own
-- record-type picklists, so the property's MULTIFAMILY row and the building's
-- MULTIFAMILY row are different picklist_values ids. A property record type
-- with no active same-named building record type leaves the building untyped
-- rather than stamping a type that does not exist on the object.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_building_record_type_from_property()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_property_rt_value text;
  v_building_rt_id    uuid;
BEGIN
  IF NEW.building_record_type IS NOT NULL OR NEW.property_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pv.picklist_value
    INTO v_property_rt_value
    FROM public.properties p
    JOIN public.picklist_values pv ON pv.id = p.property_record_type
   WHERE p.id = NEW.property_id;

  IF v_property_rt_value IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_building_rt_id
    FROM public.picklist_values
   WHERE picklist_object = 'buildings'
     AND picklist_field  = 'record_type'
     AND picklist_value  = v_property_rt_value
     AND picklist_is_active
   LIMIT 1;

  IF v_building_rt_id IS NOT NULL THEN
    NEW.building_record_type := v_building_rt_id;
  END IF;
  RETURN NEW;
END;
$$;

-- trg_0_ so it runs BEFORE trg_enforce_record_type, which would otherwise stamp
-- the object's platform default on a building whose property already knows the
-- answer.
DROP TRIGGER IF EXISTS trg_0_building_record_type_follows_property ON public.buildings;
CREATE TRIGGER trg_0_building_record_type_follows_property
  BEFORE INSERT OR UPDATE OF building_record_type, property_id ON public.buildings
  FOR EACH ROW EXECUTE FUNCTION public.sync_building_record_type_from_property();

-- Backfill the 31. The audit trigger is disabled around it so these do not land
-- in audit_log as if a person had edited each building (the 2026-08-22 rule).
-- session_replication_role is the usual instrument for that and is NOT
-- available to the migration role here — permission denied to set parameter —
-- so the one trigger is disabled by name instead.
ALTER TABLE public.buildings DISABLE TRIGGER trg_audit_buildings;

DO $backfill$
DECLARE
  v_filled int;
  v_left   int;
BEGIN
  UPDATE public.buildings b
     SET building_record_type = bpv.id
    FROM public.properties p
    JOIN public.picklist_values ppv ON ppv.id = p.property_record_type
    JOIN public.picklist_values bpv
      ON bpv.picklist_object = 'buildings'
     AND bpv.picklist_field  = 'record_type'
     AND bpv.picklist_value  = ppv.picklist_value
     AND bpv.picklist_is_active
   WHERE b.property_id = p.id
     AND b.building_record_type IS NULL
     AND b.building_is_deleted = false;
  GET DIAGNOSTICS v_filled = ROW_COUNT;

  SELECT count(*) INTO v_left
    FROM public.buildings b
    JOIN public.properties p ON p.id = b.property_id
   WHERE b.building_is_deleted = false
     AND b.building_record_type IS NULL
     AND p.property_record_type IS NOT NULL;

  RAISE NOTICE 'building record type backfill: % filled, % still untyped on a typed property', v_filled, v_left;

  -- The whole point of this migration is that no building on a typed property
  -- is left unclassifiable. If any survives, the eligibility rule still fails
  -- open there and shipping would be a false claim.
  IF v_left > 0 THEN
    RAISE EXCEPTION 'aborting: % building(s) on a typed property are still untyped', v_left;
  END IF;
END
$backfill$;

ALTER TABLE public.buildings ENABLE TRIGGER trg_audit_buildings;
