-- A property's management company is inherited all the way down the line.
--
-- Nicholas, 2026-08-25: "if a property has a management company, it needs to be
-- inherited all the way down the line. The opportunity should look at the
-- property... There's no way possible to have a different property management
-- company on an opportunity than it is on the property record."
--
-- The same fact was stored in three places:
--
--   properties.property_management_company_id   1,490 rows, a real lookup to
--                                               accounts. THE SOURCE OF TRUTH.
--   opportunities.opportunity_property_management_company
--                                               8 rows, a bare uuid with no
--                                               foreign key, editable on all 10
--                                               opportunity layouts — so it
--                                               could and did disagree.
--   buildings.building_property_management_company
--                                               typed TEXT, blank on all 96
--                                               buildings, on no live layout,
--                                               read by nothing.
--
-- This is the same rule the platform already enforces twice: an opportunity's
-- ACCOUNT always equals its property's (2026-07-09) and an opportunity's STATE
-- always equals its property's (2026-08-23). Built to the same shape, so there
-- is one way this kind of rule works in LEAP rather than three.

-- ── 1. Rescue the one fact that lives ONLY on the leftover field ────────────
-- 6616 Appleton Avenue - Milwaukee has no management company on the property;
-- the only record that Lutheran Social Services manages it is the opportunity's
-- copy. Move it UP to the property before the rule turns on, or the rule would
-- erase the only place it exists. Left as an ordinary audited write: this is a
-- real correction to a real record, and it should read as one.
UPDATE public.properties p
SET    property_management_company_id = src.mgmt_id
FROM (
  SELECT DISTINCT ON (o.property_id)
         o.property_id, o.opportunity_property_management_company AS mgmt_id
  FROM   public.opportunities o
  WHERE  o.opportunity_property_management_company IS NOT NULL
    AND  o.opportunity_is_deleted IS NOT TRUE
  ORDER  BY o.property_id, o.opportunity_created_at
) src
WHERE p.id = src.property_id
  AND p.property_management_company_id IS NULL
  AND EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = src.mgmt_id);

-- ── 2. Make the opportunity's copy a real lookup ────────────────────────────
-- It was a bare uuid with no foreign key, which is why it rendered as a raw id
-- and why nothing could resolve it to a company name.
ALTER TABLE public.opportunities
  DROP CONSTRAINT IF EXISTS opportunities_property_management_company_fkey;
ALTER TABLE public.opportunities
  ADD CONSTRAINT opportunities_property_management_company_fkey
  FOREIGN KEY (opportunity_property_management_company)
  REFERENCES public.accounts(id);

COMMENT ON COLUMN public.opportunities.opportunity_property_management_company IS
  'DERIVED, never entered: always equals this opportunity''s property''s property_management_company_id, forced by trg_0_opportunity_management_company_follows_property. Stored rather than joined so the opportunity list can show and filter it, and because list_signer_contacts_for_opportunity, list_contacts_for_opportunity_roles and seed_opportunity_contact_roles read it directly.';

-- ── 3. The rule, on the child ───────────────────────────────────────────────
-- SECURITY DEFINER with EXECUTE revoked, matching the 2026-07-09 account rule:
-- a definer function here means RLS cannot silently skip the sync, and the
-- revoke keeps it off the advisor's executable-definer list.
CREATE OR REPLACE FUNCTION public.sync_opportunity_management_company_from_property()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.property_id IS NULL THEN
    NEW.opportunity_property_management_company := NULL;
    RETURN NEW;
  END IF;
  SELECT p.property_management_company_id
  INTO   NEW.opportunity_property_management_company
  FROM   public.properties p
  WHERE  p.id = NEW.property_id;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_opportunity_management_company_from_property() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_0_opportunity_management_company_follows_property ON public.opportunities;
CREATE TRIGGER trg_0_opportunity_management_company_follows_property
  BEFORE INSERT OR UPDATE OF property_id, opportunity_property_management_company
  ON public.opportunities
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_opportunity_management_company_from_property();

-- ── 4. The rule, cascading from the parent ──────────────────────────────────
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
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cascade_property_management_company_to_opportunities() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_property_management_company_cascades ON public.properties;
CREATE TRIGGER trg_property_management_company_cascades
  AFTER UPDATE OF property_management_company_id ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_property_management_company_to_opportunities();

-- ── 5. Backfill every existing opportunity from its property ────────────────
-- Under replica so the stamping trigger does not overwrite updated_at on ~99
-- rows and the audit logger does not record a migration as if a person had
-- edited each opportunity by hand (the 2026-08-22 lesson).
SET session_replication_role = replica;

UPDATE public.opportunities o
SET    opportunity_property_management_company = p.property_management_company_id
FROM   public.properties p
WHERE  p.id = o.property_id
  AND  o.opportunity_property_management_company IS DISTINCT FROM p.property_management_company_id;

SET session_replication_role = DEFAULT;

-- ── 6. Prove it, rather than assume it ──────────────────────────────────────
DO $$
DECLARE
  v_divergent integer;
BEGIN
  SELECT count(*) INTO v_divergent
  FROM   public.opportunities o
  JOIN   public.properties p ON p.id = o.property_id
  WHERE  o.opportunity_property_management_company IS DISTINCT FROM p.property_management_company_id;

  IF v_divergent > 0 THEN
    RAISE EXCEPTION
      'Management company still differs from the property on % opportunities — the inheritance rule would be a lie.',
      v_divergent;
  END IF;
END;
$$;

-- ── 7. Retire the free-text building field ──────────────────────────────────
-- A typed-text company name cannot be a controlled pick, cannot be matched to
-- an account, and this one was blank on all 96 buildings. Swept first: no live
-- page layout, no saved list view, no function, no view and no field_metadata
-- row references it. A building's management company is its property's.
ALTER TABLE public.buildings
  DROP COLUMN IF EXISTS building_property_management_company;
