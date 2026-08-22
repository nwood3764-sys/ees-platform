-- ---------------------------------------------------------------------------
-- A work order inherits its Account and its Contact from the property chain
--
-- Nicholas, 2026-08-22, from WO-00204: "why isn't the account auto-populating
-- and inheriting? And the contact should also be the opportunity or property
-- site contact that should be inherited."
--
-- Account is not a choice. The platform already rules that an opportunity's
-- account IS its property's account (trg_opportunity_account_follows_property,
-- 2026-07-09); a work order sits under that same property, so the same rule
-- holds. Every one of the 105 work orders that carried an account already
-- matched its property's — the rule was true in the data and simply had
-- nothing enforcing it, so the four created by paths that never looked it up
-- (WO-00204 among them) came out blank.
--
-- Contact IS a choice, so it is only ever a DEFAULT: filled at creation from
-- the most specific contact the chain knows, and never touched again. All 109
-- live work orders had it empty because nothing has ever filled it.
--
--   opportunity_property_site_contact   the person on site for this program
--   building_primary_contact_id         this building's contact
--   property_primary_contact_id         the property's contact
--   opportunity_account_contact         the owner-side contact on the deal
--
-- Also: opportunities.opportunity_account_contact and
-- opportunity_property_site_contact are uuid columns with NO foreign key, so
-- they render as raw uuid text boxes on a layout and nothing stops them
-- pointing at a deleted contact. Both are given real FKs here (data verified
-- clean first: 5 site contacts, 0 account contacts, 0 dangling).
-- ---------------------------------------------------------------------------

-- ── Real relationships for the opportunity's two contact columns ───────────
ALTER TABLE public.opportunities
  DROP CONSTRAINT IF EXISTS opportunities_opportunity_account_contact_fkey;
ALTER TABLE public.opportunities
  ADD CONSTRAINT opportunities_opportunity_account_contact_fkey
  FOREIGN KEY (opportunity_account_contact) REFERENCES public.contacts(id);

ALTER TABLE public.opportunities
  DROP CONSTRAINT IF EXISTS opportunities_opportunity_property_site_contact_fkey;
ALTER TABLE public.opportunities
  ADD CONSTRAINT opportunities_opportunity_property_site_contact_fkey
  FOREIGN KEY (opportunity_property_site_contact) REFERENCES public.contacts(id);

-- ── The inheritance itself ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.work_order_inherits_from_property_chain()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE
  v_account uuid;
  v_contact uuid;
BEGIN
  -- ACCOUNT — an invariant, enforced on every write. A work order belongs to
  -- whoever owns the property it is performed at; there is no case where those
  -- differ. (The subcontractor performing the work is a different column,
  -- work_order_service_provider_account_id.)
  IF NEW.property_id IS NOT NULL THEN
    SELECT p.property_account_id INTO v_account
      FROM public.properties p WHERE p.id = NEW.property_id;
    IF v_account IS NOT NULL THEN
      NEW.work_order_account_id := v_account;
    END IF;
  END IF;

  -- CONTACT — a default, filled only when the work order is created with none.
  -- Most specific first: the program's site contact, then the building's, then
  -- the property's, then the owner-side contact on the opportunity. Whoever
  -- edits it afterwards keeps their answer.
  IF TG_OP = 'INSERT' AND NEW.contact_id IS NULL THEN
    SELECT COALESCE(
             o.opportunity_property_site_contact,
             b.building_primary_contact_id,
             p.property_primary_contact_id,
             o.opportunity_account_contact
           )
      INTO v_contact
      FROM (SELECT 1) z
      LEFT JOIN public.opportunities o ON o.id = NEW.opportunity_id
      LEFT JOIN public.buildings     b ON b.id = NEW.building_id
      LEFT JOIN public.properties    p ON p.id = NEW.property_id;
    NEW.contact_id := v_contact;
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.work_order_inherits_from_property_chain() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_work_order_inherits_from_property_chain ON public.work_orders;
CREATE TRIGGER trg_work_order_inherits_from_property_chain
  BEFORE INSERT OR UPDATE OF property_id, opportunity_id, building_id, work_order_account_id
  ON public.work_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.work_order_inherits_from_property_chain();

-- Re-pointing a property at a different account carries its work orders with
-- it, exactly as it already carries its opportunities.
CREATE OR REPLACE FUNCTION public.work_order_account_follows_property_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $fn$
BEGIN
  IF NEW.property_account_id IS DISTINCT FROM OLD.property_account_id
     AND NEW.property_account_id IS NOT NULL THEN
    UPDATE public.work_orders
       SET work_order_account_id = NEW.property_account_id
     WHERE property_id = NEW.id
       AND work_order_account_id IS DISTINCT FROM NEW.property_account_id;
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.work_order_account_follows_property_change() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_work_order_account_follows_property ON public.properties;
CREATE TRIGGER trg_work_order_account_follows_property
  AFTER UPDATE OF property_account_id ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.work_order_account_follows_property_change();

-- ── Backfill what the platform already knew ────────────────────────────────
UPDATE public.work_orders wo
   SET work_order_account_id = p.property_account_id
  FROM public.properties p
 WHERE p.id = wo.property_id
   AND wo.work_order_account_id IS NULL
   AND p.property_account_id IS NOT NULL;

UPDATE public.work_orders wo
   SET contact_id = c.derived
  FROM (
    SELECT wo2.id,
           COALESCE(o.opportunity_property_site_contact,
                    b.building_primary_contact_id,
                    p.property_primary_contact_id,
                    o.opportunity_account_contact) AS derived
      FROM public.work_orders wo2
      LEFT JOIN public.opportunities o ON o.id = wo2.opportunity_id
      LEFT JOIN public.buildings     b ON b.id = wo2.building_id
      LEFT JOIN public.properties    p ON p.id = wo2.property_id
     WHERE wo2.contact_id IS NULL
  ) c
 WHERE c.id = wo.id
   AND c.derived IS NOT NULL;

NOTIFY pgrst, 'reload schema';
