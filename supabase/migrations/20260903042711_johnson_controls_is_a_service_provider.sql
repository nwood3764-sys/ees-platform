-- Johnson Controls is a Service Provider.
--
-- Nicholas: "Change Johnson Controls account record type to service provider."
--
-- Scoping the contractor pickers to SERVICE-PROVIDER dropped ACC-07587 out of
-- them: it was record type CONTRACTOR, the only account in the database with
-- that type, while every other company that actually performs work -- Sealed,
-- the three EES entities, the three trade contractors -- is SERVICE-PROVIDER.
-- It is the odd one out, not the rule, and it is the contractor on live
-- enrollments.
--
-- Run with triggers ENABLED, deliberately. This is a real change a person asked
-- for, not a backfill of something the platform should have filled in, so the
-- audit log and field history should carry it -- the same call made when five
-- opportunities were moved off a retired programme on 2026-08-24. A `replica`
-- run would hide a change to which company a filing names as the installer.
--
-- CONTRACTOR is left in place as a picklist value rather than retired: whether
-- the distinction between a contractor and a service provider means anything to
-- EES is a question about the account model, not something a migration
-- correcting one row should answer by deleting the option.

UPDATE public.accounts a
   SET account_record_type = (
         SELECT id FROM public.picklist_values
          WHERE picklist_object = 'accounts' AND picklist_field = 'record_type'
            AND picklist_value = 'SERVICE-PROVIDER' LIMIT 1)
 WHERE a.account_record_number = 'ACC-07587'
   AND a.account_is_deleted IS NOT TRUE;

DO $assert$
DECLARE v_type text; v_offered int; v_contractors int;
BEGIN
  SELECT rt.picklist_value INTO v_type
    FROM public.accounts a
    JOIN public.picklist_values rt ON rt.id = a.account_record_type
   WHERE a.account_record_number = 'ACC-07587';
  IF v_type IS DISTINCT FROM 'SERVICE-PROVIDER' THEN
    RAISE EXCEPTION 'ACC-07587 is still %', COALESCE(v_type, '(no record type)');
  END IF;

  -- The point of the change: it is selectable again, on its own merits rather
  -- than through the saved-value escape hatch.
  SELECT count(*) INTO v_offered FROM public.list_service_provider_accounts(NULL)
   WHERE account_name = 'Johnson Controls, Inc.';
  IF v_offered <> 1 THEN
    RAISE EXCEPTION 'Johnson Controls is still not offered by the contractor picker.';
  END IF;

  -- And nothing else was swept along: no account should be left on CONTRACTOR.
  SELECT count(*) INTO v_contractors
    FROM public.accounts a
    JOIN public.picklist_values rt ON rt.id = a.account_record_type
   WHERE a.account_is_deleted IS NOT TRUE AND rt.picklist_value = 'CONTRACTOR';
  IF v_contractors <> 0 THEN
    RAISE EXCEPTION '% accounts are still record type CONTRACTOR', v_contractors;
  END IF;
END $assert$;
