-- Contractor email and phone are facts about a PERSON, so they have to follow
-- the contact selected on the record -- and that contact has to belong to the
-- contractor account selected beside it. Neither was true.
--
-- 1. The reservation defaults resolved the contractor contacts by LITERAL NAME
--    ('Tyler Wallace', 'Nicholas Wood'), in the trigger and again in the create
--    form. Updating the Energy Efficiency Services of Wisconsin account's
--    primary contact therefore changed nothing: the name lookup kept returning
--    the same person. That is why ENR-00037 still reads "Nicholas Wood".
--
-- 2. Nothing re-derived the contact when the contractor ACCOUNT changed, so a
--    contact outlived the company it belongs to: ENR-00012 carries Tyler
--    Wallace of Sealed Inc as the contact under Energy Efficiency Services of
--    Wisconsin as primary contractor.
--
-- The rule, in one purpose-named place: a contractor account's representative
-- on a program form is the contact selected for it WHEN THAT CONTACT BELONGS TO
-- THE ACCOUNT, otherwise the account's own primary contact
-- (accounts.account_contact_id), otherwise nobody. A contact from another
-- company is never carried, and the person a contractor is represented by is
-- read from the account record rather than named in code.

CREATE OR REPLACE FUNCTION public.contractor_contact_for_account(
  p_account_id uuid,
  p_current_contact_id uuid
) RETURNS uuid
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_catalog'
AS $fn$
  SELECT CASE
    WHEN p_account_id IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM public.contacts c
       WHERE c.id = p_current_contact_id
         AND c.contact_account_id = p_account_id
         AND c.contact_is_deleted IS NOT TRUE
    ) THEN p_current_contact_id
    ELSE (
      SELECT a.account_contact_id
        FROM public.accounts a
        JOIN public.contacts c ON c.id = a.account_contact_id
       WHERE a.id = p_account_id
         AND a.account_is_deleted IS NOT TRUE
         AND c.contact_account_id = a.id
         AND c.contact_is_deleted IS NOT TRUE
    )
  END;
$fn$;

COMMENT ON FUNCTION public.contractor_contact_for_account(uuid, uuid) IS
  'The contact that represents a contractor account on a program form: the selected contact when it belongs to that account, else the account''s own primary contact, else NULL. Never a contact from another company.';

-- Enforcement, one trigger per object. The invariant is checked on every write
-- (not only when the contractor columns are listed) so an account change made
-- by any path -- form, import, another trigger -- cannot leave a stale contact.
-- A contact the user deliberately CLEARED stays cleared: the account's primary
-- contact only fills a blank on insert or when the account itself just changed.

CREATE OR REPLACE FUNCTION public.sync_enrollment_contractor_contacts()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE v_insert boolean := (TG_OP = 'INSERT');
BEGIN
  IF NEW.enrollment_contractor_account_id IS NULL THEN
    NEW.enrollment_contractor_contact_id := NULL;
  ELSIF NEW.enrollment_contractor_contact_id IS NOT NULL
     OR v_insert
     OR NEW.enrollment_contractor_account_id IS DISTINCT FROM OLD.enrollment_contractor_account_id THEN
    NEW.enrollment_contractor_contact_id := public.contractor_contact_for_account(
      NEW.enrollment_contractor_account_id, NEW.enrollment_contractor_contact_id);
  END IF;

  IF NEW.enrollment_support_contractor_account_id IS NULL THEN
    NEW.enrollment_support_contractor_contact_id := NULL;
  ELSIF NEW.enrollment_support_contractor_contact_id IS NOT NULL
     OR v_insert
     OR NEW.enrollment_support_contractor_account_id IS DISTINCT FROM OLD.enrollment_support_contractor_account_id THEN
    NEW.enrollment_support_contractor_contact_id := public.contractor_contact_for_account(
      NEW.enrollment_support_contractor_account_id, NEW.enrollment_support_contractor_contact_id);
  END IF;

  RETURN NEW;
END; $fn$;

CREATE OR REPLACE FUNCTION public.sync_incentive_application_contractor_contacts()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE v_insert boolean := (TG_OP = 'INSERT');
BEGIN
  IF NEW.ia_contractor_account_id IS NULL THEN
    NEW.ia_contractor_contact_id := NULL;
  ELSIF NEW.ia_contractor_contact_id IS NOT NULL
     OR v_insert
     OR NEW.ia_contractor_account_id IS DISTINCT FROM OLD.ia_contractor_account_id THEN
    NEW.ia_contractor_contact_id := public.contractor_contact_for_account(
      NEW.ia_contractor_account_id, NEW.ia_contractor_contact_id);
  END IF;

  IF NEW.ia_support_contractor_account_id IS NULL THEN
    NEW.ia_support_contractor_contact_id := NULL;
  ELSIF NEW.ia_support_contractor_contact_id IS NOT NULL
     OR v_insert
     OR NEW.ia_support_contractor_account_id IS DISTINCT FROM OLD.ia_support_contractor_account_id THEN
    NEW.ia_support_contractor_contact_id := public.contractor_contact_for_account(
      NEW.ia_support_contractor_account_id, NEW.ia_support_contractor_contact_id);
  END IF;

  RETURN NEW;
END; $fn$;

DROP TRIGGER IF EXISTS trg_zz_enrollment_contractor_contacts ON public.enrollments;
CREATE TRIGGER trg_zz_enrollment_contractor_contacts
  BEFORE INSERT OR UPDATE ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.sync_enrollment_contractor_contacts();

DROP TRIGGER IF EXISTS trg_zz_ia_contractor_contacts ON public.incentive_applications;
CREATE TRIGGER trg_zz_ia_contractor_contacts
  BEFORE INSERT OR UPDATE ON public.incentive_applications
  FOR EACH ROW EXECUTE FUNCTION public.sync_incentive_application_contractor_contacts();

-- The reservation defaults stop naming people. Primary contractor contact is
-- still the opportunity's "Contractor Primary Contact" role when one is
-- assigned; otherwise both contacts come from their own account record.
CREATE OR REPLACE FUNCTION public.set_enrollment_reservation_defaults()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE v_rt text; v_code text; v_measures jsonb;
BEGIN
  SELECT picklist_value INTO v_rt FROM picklist_values WHERE id = NEW.enrollment_record_type;
  IF v_rt IS NULL OR v_rt NOT ILIKE '%Project-Reservation%' THEN RETURN NEW; END IF;

  IF NEW.enrollment_application_for IS NULL THEN
    NEW.enrollment_application_for := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='application_for' AND picklist_value='Project Reservation' AND picklist_is_active LIMIT 1);
  END IF;
  IF NEW.enrollment_building_type IS NULL THEN
    NEW.enrollment_building_type := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='building_type' AND picklist_value='Existing' AND picklist_is_active LIMIT 1);
  END IF;
  IF NEW.enrollment_building_project_type IS NULL THEN
    NEW.enrollment_building_project_type := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='building_project_type' AND picklist_value='Multifamily - Central 5 Units' AND picklist_is_active LIMIT 1);
  END IF;

  -- Primary contractor = Sealed Inc; support contractor = Energy Efficiency
  -- Services of Wisconsin. Which COMPANY runs the program is program config;
  -- which PERSON represents it is read off that company's account record.
  IF NEW.enrollment_contractor_account_id IS NULL THEN
    NEW.enrollment_contractor_account_id := (SELECT id FROM accounts WHERE account_is_deleted IS NOT TRUE AND account_name='Sealed Inc' LIMIT 1);
  END IF;

  IF NEW.enrollment_has_support_contractor IS NULL THEN NEW.enrollment_has_support_contractor := true; END IF;
  IF NEW.enrollment_support_contractor_account_id IS NULL THEN
    NEW.enrollment_support_contractor_account_id := (SELECT id FROM accounts WHERE account_is_deleted IS NOT TRUE AND account_name='Energy Efficiency Services of Wisconsin' LIMIT 1);
  END IF;
  IF NEW.enrollment_support_contractor_contact_id IS NULL THEN
    NEW.enrollment_support_contractor_contact_id := public.contractor_contact_for_account(
      NEW.enrollment_support_contractor_account_id, NULL);
  END IF;

  IF NEW.enrollment_payee IS NULL THEN
    NEW.enrollment_payee := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='payee' AND picklist_value='Registered Contractor' AND picklist_is_active LIMIT 1);
  END IF;
  IF NEW.enrollment_tax_classification IS NULL THEN
    NEW.enrollment_tax_classification := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='tax_classification' AND picklist_value='S Corporation' AND picklist_is_active LIMIT 1);
  END IF;

  IF NEW.enrollment_signer_contact_id IS NULL AND NEW.opportunity_id IS NOT NULL THEN
    NEW.enrollment_signer_contact_id := (SELECT opportunity_authorized_signer_id FROM opportunities WHERE id = NEW.opportunity_id);
  END IF;
  IF NEW.enrollment_contractor_contact_id IS NULL AND NEW.opportunity_id IS NOT NULL THEN
    NEW.enrollment_contractor_contact_id := (
      SELECT ocr.contact_id FROM opportunity_contact_roles ocr
      JOIN picklist_values pv ON pv.id = ocr.ocr_role
      WHERE ocr.opportunity_id = NEW.opportunity_id AND ocr.ocr_is_deleted IS NOT TRUE
        AND pv.picklist_value = 'Contractor Primary Contact'
      ORDER BY ocr.ocr_is_primary DESC NULLS LAST, ocr.ocr_created_at ASC LIMIT 1);
  END IF;
  IF NEW.enrollment_contractor_contact_id IS NULL THEN
    NEW.enrollment_contractor_contact_id := public.contractor_contact_for_account(
      NEW.enrollment_contractor_account_id, NULL);
  END IF;

  IF (NEW.enrollment_work_measures IS NULL OR NEW.enrollment_work_measures = '[]'::jsonb)
     AND NEW.opportunity_id IS NOT NULL THEN
    SELECT jsonb_agg(DISTINCT m.pwmm_work_measure ORDER BY m.pwmm_work_measure)
      INTO v_measures
      FROM opportunity_line_items oli
      JOIN product_work_measure_map m
        ON m.pwmm_product_id = oli.product_id AND m.pwmm_is_deleted IS NOT TRUE
     WHERE oli.opportunity_id = NEW.opportunity_id AND oli.oli_is_deleted IS NOT TRUE;
    IF v_measures IS NOT NULL AND jsonb_array_length(v_measures) > 0 THEN
      NEW.enrollment_work_measures := v_measures;
    END IF;
  END IF;

  IF NEW.building_id IS NOT NULL THEN
    SELECT ira_confirmation_code_lea INTO v_code FROM buildings WHERE id = NEW.building_id;
    IF NEW.enrollment_income_level IS NULL AND v_code IS NOT NULL THEN
      IF v_code ILIKE 'LEA%' THEN
        NEW.enrollment_income_level := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='income_level' AND picklist_value='Low-Income' AND picklist_is_active LIMIT 1);
      ELSIF v_code ILIKE 'MEA%' THEN
        NEW.enrollment_income_level := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='income_level' AND picklist_value='Moderate' AND picklist_is_active LIMIT 1);
      END IF;
    END IF;
    IF NEW.enrollment_occupied_units IS NULL THEN
      NEW.enrollment_occupied_units := (SELECT building_total_units FROM buildings WHERE id = NEW.building_id);
    END IF;
  END IF;
  RETURN NEW;
END; $fn$;

-- Sealed Inc's representative was named in the trigger and nowhere else; it
-- belongs on the account, which is where the rule now reads it from. Fills a
-- blank only -- an account that already names a primary contact is untouched.
UPDATE public.accounts a
   SET account_contact_id = (
         SELECT c.id FROM public.contacts c
          WHERE c.contact_account_id = a.id
            AND c.contact_is_deleted IS NOT TRUE
            AND c.contact_name = 'Tyler Wallace' LIMIT 1)
 WHERE a.account_name = 'Sealed Inc'
   AND a.account_is_deleted IS NOT TRUE
   AND a.account_contact_id IS NULL;

-- Repair the records that already carry a contact from another company. Only
-- mismatched rows are touched, and the trigger above does the deriving.
UPDATE public.enrollments e
   SET enrollment_contractor_account_id = e.enrollment_contractor_account_id
 WHERE e.enrollment_is_deleted IS NOT TRUE
   AND (
     (e.enrollment_contractor_contact_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.contacts c WHERE c.id = e.enrollment_contractor_contact_id
          AND c.contact_account_id = e.enrollment_contractor_account_id
          AND c.contact_is_deleted IS NOT TRUE))
     OR
     (e.enrollment_support_contractor_contact_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.contacts c WHERE c.id = e.enrollment_support_contractor_contact_id
          AND c.contact_account_id = e.enrollment_support_contractor_account_id
          AND c.contact_is_deleted IS NOT TRUE)));

UPDATE public.incentive_applications ia
   SET ia_contractor_account_id = ia.ia_contractor_account_id
 WHERE ia.ia_is_deleted IS NOT TRUE
   AND (
     (ia.ia_contractor_contact_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.contacts c WHERE c.id = ia.ia_contractor_contact_id
          AND c.contact_account_id = ia.ia_contractor_account_id
          AND c.contact_is_deleted IS NOT TRUE))
     OR
     (ia.ia_support_contractor_contact_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.contacts c WHERE c.id = ia.ia_support_contractor_contact_id
          AND c.contact_account_id = ia.ia_support_contractor_account_id
          AND c.contact_is_deleted IS NOT TRUE)));

-- Assert the invariant rather than assume it.
DO $verify$
DECLARE v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad FROM public.enrollments e
   WHERE e.enrollment_is_deleted IS NOT TRUE
     AND ((e.enrollment_contractor_contact_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.contacts c WHERE c.id = e.enrollment_contractor_contact_id
               AND c.contact_account_id = e.enrollment_contractor_account_id))
       OR (e.enrollment_support_contractor_contact_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.contacts c WHERE c.id = e.enrollment_support_contractor_contact_id
               AND c.contact_account_id = e.enrollment_support_contractor_account_id)));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'contractor contact repair left % enrollment row(s) pointing at a contact outside their contractor account', v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM public.incentive_applications ia
   WHERE ia.ia_is_deleted IS NOT TRUE
     AND ((ia.ia_contractor_contact_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.contacts c WHERE c.id = ia.ia_contractor_contact_id
               AND c.contact_account_id = ia.ia_contractor_account_id))
       OR (ia.ia_support_contractor_contact_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.contacts c WHERE c.id = ia.ia_support_contractor_contact_id
               AND c.contact_account_id = ia.ia_support_contractor_account_id)));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'contractor contact repair left % incentive application row(s) pointing at a contact outside their contractor account', v_bad;
  END IF;
END $verify$;

NOTIFY pgrst, 'reload schema';
