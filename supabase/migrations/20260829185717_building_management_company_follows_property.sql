-- A building's management company is the property's.
--
-- Nicholas, 2026-08-29: "the building management company should be inherited
-- from the property. It's the only place it's selectable."
--
-- He is right, and this corrects my own mistake. His rule on 2026-08-25 was
-- that a property's management company is "inherited all the way down the
-- line". I applied that to opportunities and then DELETED the building's
-- column outright, because the one that existed was free text and blank on
-- every row. Dropping the useless column was correct; leaving buildings with no
-- management company at all was not.
--
-- So the building gets the field back, built the way the rule says: a real
-- lookup to accounts, derived from the property, never typed. Same shape as
-- trg_0_opportunity_management_company_follows_property (2026-08-25), which is
-- itself the same shape as the account rule (2026-07-09) and the state rule
-- (2026-08-23) — one way this kind of rule works in LEAP, not four.

ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS building_management_company_id uuid;

ALTER TABLE public.buildings
  DROP CONSTRAINT IF EXISTS buildings_management_company_id_fkey;
ALTER TABLE public.buildings
  ADD CONSTRAINT buildings_management_company_id_fkey
  FOREIGN KEY (building_management_company_id)
  REFERENCES public.accounts(id);

COMMENT ON COLUMN public.buildings.building_management_company_id IS
  'DERIVED, never entered: always equals this building''s property''s property_management_company_id, forced by trg_0_building_management_company_follows_property. The property is the only place a management company is selected.';

-- ── The rule, on the child ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_building_management_company_from_property()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.property_id IS NULL THEN
    NEW.building_management_company_id := NULL;
    RETURN NEW;
  END IF;
  SELECT p.property_management_company_id
  INTO   NEW.building_management_company_id
  FROM   public.properties p
  WHERE  p.id = NEW.property_id;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_building_management_company_from_property() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_0_building_management_company_follows_property ON public.buildings;
CREATE TRIGGER trg_0_building_management_company_follows_property
  BEFORE INSERT OR UPDATE OF property_id, building_management_company_id
  ON public.buildings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_building_management_company_from_property();

-- ── The rule, cascading from the parent ────────────────────────────────────
-- The property already cascades to its opportunities; it now carries the same
-- change down to its buildings in the same trigger, so the two can never drift
-- apart by being maintained separately.
CREATE OR REPLACE FUNCTION public.cascade_property_management_company_to_opportunities()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.property_management_company_id IS DISTINCT FROM OLD.property_management_company_id THEN
    UPDATE public.opportunities
    SET    opportunity_property_management_company = NEW.property_management_company_id
    WHERE  property_id = NEW.id
      AND  opportunity_property_management_company IS DISTINCT FROM NEW.property_management_company_id;

    UPDATE public.buildings
    SET    building_management_company_id = NEW.property_management_company_id
    WHERE  property_id = NEW.id
      AND  building_management_company_id IS DISTINCT FROM NEW.property_management_company_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cascade_property_management_company_to_opportunities() FROM PUBLIC, anon, authenticated;

-- ── Backfill ───────────────────────────────────────────────────────────────
-- Under replica so the stamping trigger does not rewrite updated_at on every
-- building and the audit logger does not record a migration as if a person had
-- edited each one by hand (the 2026-08-22 lesson).
SET session_replication_role = replica;

UPDATE public.buildings b
SET    building_management_company_id = p.property_management_company_id
FROM   public.properties p
WHERE  p.id = b.property_id
  AND  b.building_management_company_id IS DISTINCT FROM p.property_management_company_id;

SET session_replication_role = DEFAULT;

-- ── Prove it ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_divergent integer;
BEGIN
  SELECT count(*) INTO v_divergent
  FROM   public.buildings b
  JOIN   public.properties p ON p.id = b.property_id
  WHERE  b.building_management_company_id IS DISTINCT FROM p.property_management_company_id;

  IF v_divergent > 0 THEN
    RAISE EXCEPTION
      'A building''s management company still differs from its property''s on % rows — the inheritance rule would be a lie.',
      v_divergent;
  END IF;
END;
$$;
