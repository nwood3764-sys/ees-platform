-- Payment Information filled itself in, instead of asking for what LEAP already
-- knows.
--
-- "Check if same as Primary Contractor Address" was blank and every mailing
-- line under it was blank, on records whose registered contractor carries a
-- full billing address. Nicholas: it should always be Yes, and the address
-- should still be written out so there is no confusion about where the cheque
-- goes.
--
-- So the flag defaults to Yes, and while it says Yes the mailing address MIRRORS
-- the contractor account's billing address rather than being copied once: "same
-- as" is a statement of fact, so if the contractor's address is corrected the
-- payment address has to follow it. Setting the flag to No stops the mirroring
-- and leaves whatever address was entered by hand alone -- that is the whole
-- point of the flag.
--
-- Its own trigger rather than an extension of the Health & Safety one: two
-- purposes, two artifacts, and this one has to re-run whenever the CONTRACTOR
-- changes, not only when the record is created.
--
-- ia_payment_mailing_line2 is deliberately left alone -- accounts hold a single
-- billing_street and there is no second line to copy from.
--
-- The FEIN is wired to accounts.account_fein, but BOTH contractor accounts hold
-- NULL today, so the field stays blank until someone fills it on the account.
-- Wiring it now means it appears the moment they do; it is not evidence that
-- the FEIN is available.

CREATE OR REPLACE FUNCTION public.apply_ia_payment_information_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_rt text;
  a    public.accounts%ROWTYPE;
BEGIN
  SELECT picklist_value INTO v_rt FROM public.picklist_values WHERE id = NEW.ia_record_type;
  IF v_rt IS DISTINCT FROM 'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST' THEN
    RETURN NEW;
  END IF;

  IF NEW.ia_mailing_same_as_primary_contractor IS NULL THEN
    NEW.ia_mailing_same_as_primary_contractor := true;
  END IF;

  IF NEW.ia_contractor_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT x.* INTO a FROM public.accounts x
   WHERE x.id = NEW.ia_contractor_account_id AND x.account_is_deleted IS NOT TRUE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.ia_mailing_same_as_primary_contractor THEN
    NEW.ia_payment_mailing_street := a.billing_street;
    NEW.ia_payment_mailing_city   := a.billing_city;
    NEW.ia_payment_mailing_state  := a.billing_state;
    NEW.ia_payment_mailing_zip    := a.billing_zip;
  END IF;

  NEW.ia_tax_identification_fein := COALESCE(NEW.ia_tax_identification_fein, a.account_fein);

  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.apply_ia_payment_information_defaults() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_4_ia_payment_information_defaults ON public.incentive_applications;
CREATE TRIGGER trg_4_ia_payment_information_defaults
  BEFORE INSERT OR UPDATE ON public.incentive_applications
  FOR EACH ROW EXECUTE FUNCTION public.apply_ia_payment_information_defaults();

UPDATE public.incentive_applications ia
SET ia_mailing_same_as_primary_contractor = COALESCE(ia_mailing_same_as_primary_contractor, true)
WHERE ia.ia_is_deleted IS NOT TRUE
  AND ia.ia_record_type = public.picklist_id_for_value('incentive_applications','record_type','WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST');

DO $$
DECLARE v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.incentive_applications ia
  JOIN public.accounts a ON a.id = ia.ia_contractor_account_id AND a.account_is_deleted IS NOT TRUE
  WHERE ia.ia_is_deleted IS NOT TRUE
    AND ia.ia_record_type = public.picklist_id_for_value('incentive_applications','record_type','WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST')
    AND ia.ia_mailing_same_as_primary_contractor
    AND (ia.ia_payment_mailing_street IS DISTINCT FROM a.billing_street
      OR ia.ia_payment_mailing_city   IS DISTINCT FROM a.billing_city
      OR ia.ia_payment_mailing_state  IS DISTINCT FROM a.billing_state
      OR ia.ia_payment_mailing_zip    IS DISTINCT FROM a.billing_zip);
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% payment request(s) say "same as primary contractor" but carry a different address', v_bad;
  END IF;
END $$;
