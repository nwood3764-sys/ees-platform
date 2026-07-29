-- "Contractor Primary Contact" opportunity contact role, and the Project
-- Reservation form's Primary Contractor Contact pulls from it.
--
-- Per Nicholas: the reservation's "Primary Contractor Contact Name" should be a
-- contact assigned to the opportunity under a new "Contractor Primary Contact"
-- role (a contact from the primary contractor account), not an ad-hoc pick.
-- Add the role value; default enrollment_contractor_contact_id from the
-- opportunity's contact-role of that type via the reservation-defaults trigger.

INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_sort_order)
VALUES ('opportunity_contact_roles','role','Contractor Primary Contact','Contractor Primary Contact',100)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_enrollment_reservation_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE
  v_rt   text;
  v_code text;
BEGIN
  SELECT picklist_value INTO v_rt FROM picklist_values WHERE id = NEW.enrollment_record_type;
  IF v_rt IS NULL OR v_rt NOT ILIKE '%Project-Reservation%' THEN
    RETURN NEW;
  END IF;

  IF NEW.enrollment_application_for IS NULL THEN
    NEW.enrollment_application_for := (SELECT id FROM picklist_values
      WHERE picklist_object='enrollments' AND picklist_field='application_for'
        AND picklist_value='Project Reservation' AND picklist_is_active LIMIT 1);
  END IF;
  IF NEW.enrollment_building_type IS NULL THEN
    NEW.enrollment_building_type := (SELECT id FROM picklist_values
      WHERE picklist_object='enrollments' AND picklist_field='building_type'
        AND picklist_value='Existing' AND picklist_is_active LIMIT 1);
  END IF;
  IF NEW.enrollment_building_project_type IS NULL THEN
    NEW.enrollment_building_project_type := (SELECT id FROM picklist_values
      WHERE picklist_object='enrollments' AND picklist_field='building_project_type'
        AND picklist_value='Multifamily - Central 5 Units' AND picklist_is_active LIMIT 1);
  END IF;
  IF NEW.enrollment_contractor_account_id IS NULL THEN
    NEW.enrollment_contractor_account_id := (SELECT id FROM accounts
      WHERE account_is_deleted IS NOT TRUE
        AND account_name='Energy Efficiency Services of Wisconsin' LIMIT 1);
  END IF;
  IF NEW.enrollment_has_support_contractor IS NULL THEN
    NEW.enrollment_has_support_contractor := false;
  END IF;

  -- Installation contact = the opportunity's authorized signer.
  IF NEW.enrollment_signer_contact_id IS NULL AND NEW.opportunity_id IS NOT NULL THEN
    NEW.enrollment_signer_contact_id :=
      (SELECT opportunity_authorized_signer_id FROM opportunities WHERE id = NEW.opportunity_id);
  END IF;

  -- Primary Contractor Contact = the opportunity's "Contractor Primary Contact" role.
  IF NEW.enrollment_contractor_contact_id IS NULL AND NEW.opportunity_id IS NOT NULL THEN
    NEW.enrollment_contractor_contact_id := (
      SELECT ocr.contact_id
        FROM opportunity_contact_roles ocr
        JOIN picklist_values pv ON pv.id = ocr.ocr_role
       WHERE ocr.opportunity_id = NEW.opportunity_id
         AND ocr.ocr_is_deleted IS NOT TRUE
         AND pv.picklist_value = 'Contractor Primary Contact'
       ORDER BY ocr.ocr_is_primary DESC NULLS LAST, ocr.ocr_created_at ASC
       LIMIT 1);
  END IF;

  IF NEW.building_id IS NOT NULL THEN
    SELECT ira_confirmation_code_lea INTO v_code FROM buildings WHERE id = NEW.building_id;
    IF NEW.enrollment_income_level IS NULL AND v_code IS NOT NULL THEN
      IF v_code ILIKE 'LEA%' THEN
        NEW.enrollment_income_level := (SELECT id FROM picklist_values
          WHERE picklist_object='enrollments' AND picklist_field='income_level'
            AND picklist_value='Low-Income' AND picklist_is_active LIMIT 1);
      ELSIF v_code ILIKE 'MEA%' THEN
        NEW.enrollment_income_level := (SELECT id FROM picklist_values
          WHERE picklist_object='enrollments' AND picklist_field='income_level'
            AND picklist_value='Moderate' AND picklist_is_active LIMIT 1);
      END IF;
    END IF;
    IF NEW.enrollment_occupied_units IS NULL THEN
      NEW.enrollment_occupied_units := (SELECT building_total_units FROM buildings WHERE id = NEW.building_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

-- Backfill existing Project-Reservation enrollments (fires the trigger; fills
-- the contractor contact for any opportunity that already has the new role).
UPDATE public.enrollments
   SET enrollment_record_type = enrollment_record_type
 WHERE enrollment_is_deleted IS NOT TRUE
   AND enrollment_record_type IN (
     SELECT id FROM picklist_values
      WHERE picklist_object='enrollments' AND picklist_field='record_type'
        AND picklist_value ILIKE '%Project-Reservation%');

NOTIFY pgrst, 'reload schema';
