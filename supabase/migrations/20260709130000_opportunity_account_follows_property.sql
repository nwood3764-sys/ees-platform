-- =====================================================================
-- Rule: an opportunity on a property always belongs to that property's
-- account. The two can never diverge.
--
-- Motivating case: owner research approval repointed a property off its
-- placeholder "Unknown Owner" account onto the real owner, but the
-- opportunity created earlier stayed on the placeholder. Per Nicholas
-- (2026-07-09): "There's no way possible an opportunity can't be on the
-- same account as the property. They must be the same."
--
-- Enforced at the database level so it holds no matter what causes the
-- change — the research approval queue, a property import, or a manual
-- edit:
--   * BEFORE INSERT/UPDATE on opportunities — an opportunity with a
--     property takes that property's account, always.
--   * AFTER UPDATE on properties — repointing a property carries its
--     opportunities along.
-- Both functions are SECURITY DEFINER so the sync cannot be silently
-- skipped by the caller's per-object RLS permissions.
-- One-time backfill fixes the rows that had already diverged.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.sync_opportunity_account_from_property() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_property_account uuid;
BEGIN
  IF NEW.property_id IS NOT NULL THEN
    SELECT property_account_id INTO v_property_account
    FROM public.properties WHERE id = NEW.property_id;
    IF v_property_account IS NOT NULL
       AND NEW.opportunity_account_id IS DISTINCT FROM v_property_account THEN
      NEW.opportunity_account_id := v_property_account;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_opportunities_account_follows_property ON public.opportunities;
CREATE TRIGGER trg_opportunities_account_follows_property
  BEFORE INSERT OR UPDATE OF property_id, opportunity_account_id ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.sync_opportunity_account_from_property();

CREATE OR REPLACE FUNCTION public.cascade_property_account_to_opportunities() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.property_account_id IS DISTINCT FROM OLD.property_account_id
     AND NEW.property_account_id IS NOT NULL THEN
    UPDATE public.opportunities
    SET opportunity_account_id = NEW.property_account_id,
        opportunity_updated_by = COALESCE(NEW.property_updated_by, opportunity_updated_by),
        opportunity_updated_at = now()
    WHERE property_id = NEW.id
      AND opportunity_is_deleted IS NOT TRUE
      AND opportunity_account_id IS DISTINCT FROM NEW.property_account_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_properties_account_cascades_to_opportunities ON public.properties;
CREATE TRIGGER trg_properties_account_cascades_to_opportunities
  AFTER UPDATE OF property_account_id ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.cascade_property_account_to_opportunities();

REVOKE ALL ON FUNCTION public.sync_opportunity_account_from_property() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cascade_property_account_to_opportunities() FROM PUBLIC, anon, authenticated;

-- One-time backfill: opportunities that had already diverged from their
-- property's account (4 rows at authoring time, all opportunities left on
-- placeholder "Unknown Owner" accounts after their property was repointed
-- or imported with a real owner).
UPDATE public.opportunities o
SET opportunity_account_id = p.property_account_id,
    opportunity_updated_at = now()
FROM public.properties p
WHERE p.id = o.property_id
  AND o.opportunity_is_deleted IS NOT TRUE
  AND p.property_is_deleted IS NOT TRUE
  AND p.property_account_id IS NOT NULL
  AND o.opportunity_account_id IS DISTINCT FROM p.property_account_id;

NOTIFY pgrst, 'reload schema';
