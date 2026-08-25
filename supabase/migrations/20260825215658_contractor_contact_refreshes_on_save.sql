-- The account's main contact flows to the enrollment when the enrollment is
-- CREATED OR EDITED AND SAVED -- never as a push onto records nobody opened
-- (Nicholas, 2026-08-25: "it shouldn't go to an existing enrollment, it's only
-- when it's edited or created... just like Salesforce").
--
-- What shipped earlier today kept a stored contact as long as it was valid, so
-- an edit-and-save left it alone and the account's main contact only ever
-- seeded a NEW record. That is the half being corrected. There is deliberately
-- no trigger on accounts: changing an account's main contact updates nothing
-- by itself. Open the enrollment, save it, and it picks the change up.
--
-- On a save the contact resolves like this:
--
--   contractor account cleared      -> contact cleared; a contractor contact
--                                      with no contractor represents nobody
--   the contact was set in THIS save -> that is the user's pick and it wins,
--                                      validated against the account
--   anything else (create, or an edit
--   that did not touch the contact) -> the account's main contact
--   ...and if the account names no
--   main contact                    -> whatever is already there, provided it
--                                      is valid for that account
--
-- Consequence worth stating: a per-record override survives that save, and is
-- replaced by the account's main contact on the NEXT save that does not touch
-- the field. The account record is the master for who represents a contractor.

CREATE OR REPLACE FUNCTION public.sync_enrollment_contractor_contacts()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE v_set_here boolean;
BEGIN
  v_set_here := (TG_OP = 'INSERT' AND NEW.enrollment_contractor_contact_id IS NOT NULL)
             OR (TG_OP = 'UPDATE' AND NEW.enrollment_contractor_contact_id
                                      IS DISTINCT FROM OLD.enrollment_contractor_contact_id);
  IF NEW.enrollment_contractor_account_id IS NULL THEN
    NEW.enrollment_contractor_contact_id := NULL;
  ELSIF v_set_here THEN
    NEW.enrollment_contractor_contact_id := public.contractor_contact_for_account(
      NEW.enrollment_contractor_account_id, NEW.enrollment_contractor_contact_id);
  ELSE
    NEW.enrollment_contractor_contact_id := COALESCE(
      public.contractor_contact_for_account(NEW.enrollment_contractor_account_id, NULL),
      public.contractor_contact_for_account(NEW.enrollment_contractor_account_id,
                                            NEW.enrollment_contractor_contact_id));
  END IF;

  v_set_here := (TG_OP = 'INSERT' AND NEW.enrollment_support_contractor_contact_id IS NOT NULL)
             OR (TG_OP = 'UPDATE' AND NEW.enrollment_support_contractor_contact_id
                                      IS DISTINCT FROM OLD.enrollment_support_contractor_contact_id);
  IF NEW.enrollment_support_contractor_account_id IS NULL THEN
    NEW.enrollment_support_contractor_contact_id := NULL;
  ELSIF v_set_here THEN
    NEW.enrollment_support_contractor_contact_id := public.contractor_contact_for_account(
      NEW.enrollment_support_contractor_account_id, NEW.enrollment_support_contractor_contact_id);
  ELSE
    NEW.enrollment_support_contractor_contact_id := COALESCE(
      public.contractor_contact_for_account(NEW.enrollment_support_contractor_account_id, NULL),
      public.contractor_contact_for_account(NEW.enrollment_support_contractor_account_id,
                                            NEW.enrollment_support_contractor_contact_id));
  END IF;

  RETURN NEW;
END; $fn$;

CREATE OR REPLACE FUNCTION public.sync_incentive_application_contractor_contacts()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE v_set_here boolean;
BEGIN
  v_set_here := (TG_OP = 'INSERT' AND NEW.ia_contractor_contact_id IS NOT NULL)
             OR (TG_OP = 'UPDATE' AND NEW.ia_contractor_contact_id
                                      IS DISTINCT FROM OLD.ia_contractor_contact_id);
  IF NEW.ia_contractor_account_id IS NULL THEN
    NEW.ia_contractor_contact_id := NULL;
  ELSIF v_set_here THEN
    NEW.ia_contractor_contact_id := public.contractor_contact_for_account(
      NEW.ia_contractor_account_id, NEW.ia_contractor_contact_id);
  ELSE
    NEW.ia_contractor_contact_id := COALESCE(
      public.contractor_contact_for_account(NEW.ia_contractor_account_id, NULL),
      public.contractor_contact_for_account(NEW.ia_contractor_account_id, NEW.ia_contractor_contact_id));
  END IF;

  v_set_here := (TG_OP = 'INSERT' AND NEW.ia_support_contractor_contact_id IS NOT NULL)
             OR (TG_OP = 'UPDATE' AND NEW.ia_support_contractor_contact_id
                                      IS DISTINCT FROM OLD.ia_support_contractor_contact_id);
  IF NEW.ia_support_contractor_account_id IS NULL THEN
    NEW.ia_support_contractor_contact_id := NULL;
  ELSIF v_set_here THEN
    NEW.ia_support_contractor_contact_id := public.contractor_contact_for_account(
      NEW.ia_support_contractor_account_id, NEW.ia_support_contractor_contact_id);
  ELSE
    NEW.ia_support_contractor_contact_id := COALESCE(
      public.contractor_contact_for_account(NEW.ia_support_contractor_account_id, NULL),
      public.contractor_contact_for_account(NEW.ia_support_contractor_account_id,
                                            NEW.ia_support_contractor_contact_id));
  END IF;

  RETURN NEW;
END; $fn$;

-- Nothing is backfilled on purpose. Every existing enrollment keeps exactly the
-- contact it has until somebody opens it and saves it.

NOTIFY pgrst, 'reload schema';
