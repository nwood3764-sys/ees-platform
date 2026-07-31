-- New reservation creation defaults (fill-if-blank; user can change):
--   Primary Contractor  = Sealed Inc (contact Tyler Wallace)
--   Support Contractor  = Yes -> Energy Efficiency Services of Wisconsin
--                          (contact Nicholas Wood)
-- Contacts are disambiguated by account (there are multiple "Nicholas Wood").
-- The opportunity's Contractor Primary Contact role still wins for the primary
-- contact when present; Tyler Wallace is the fallback default.
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

  -- Primary contractor = Sealed Inc.
  IF NEW.enrollment_contractor_account_id IS NULL THEN
    NEW.enrollment_contractor_account_id := (SELECT id FROM accounts WHERE account_is_deleted IS NOT TRUE AND account_name='Sealed Inc' LIMIT 1);
  END IF;

  -- Support contractor defaults to Yes = Energy Efficiency Services of Wisconsin.
  IF NEW.enrollment_has_support_contractor IS NULL THEN NEW.enrollment_has_support_contractor := true; END IF;
  IF NEW.enrollment_support_contractor_account_id IS NULL THEN
    NEW.enrollment_support_contractor_account_id := (SELECT id FROM accounts WHERE account_is_deleted IS NOT TRUE AND account_name='Energy Efficiency Services of Wisconsin' LIMIT 1);
  END IF;
  IF NEW.enrollment_support_contractor_contact_id IS NULL THEN
    NEW.enrollment_support_contractor_contact_id := (
      SELECT c.id FROM contacts c JOIN accounts a ON a.id=c.contact_account_id
      WHERE c.contact_is_deleted IS NOT TRUE AND c.contact_name='Nicholas Wood'
        AND a.account_name='Energy Efficiency Services of Wisconsin' LIMIT 1);
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
  -- Primary contractor contact: opportunity role first, else Tyler Wallace (Sealed Inc).
  IF NEW.enrollment_contractor_contact_id IS NULL AND NEW.opportunity_id IS NOT NULL THEN
    NEW.enrollment_contractor_contact_id := (
      SELECT ocr.contact_id FROM opportunity_contact_roles ocr
      JOIN picklist_values pv ON pv.id = ocr.ocr_role
      WHERE ocr.opportunity_id = NEW.opportunity_id AND ocr.ocr_is_deleted IS NOT TRUE
        AND pv.picklist_value = 'Contractor Primary Contact'
      ORDER BY ocr.ocr_is_primary DESC NULLS LAST, ocr.ocr_created_at ASC LIMIT 1);
  END IF;
  IF NEW.enrollment_contractor_contact_id IS NULL THEN
    NEW.enrollment_contractor_contact_id := (
      SELECT c.id FROM contacts c JOIN accounts a ON a.id=c.contact_account_id
      WHERE c.contact_is_deleted IS NOT TRUE AND c.contact_name='Tyler Wallace'
        AND a.account_name='Sealed Inc' LIMIT 1);
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

NOTIFY pgrst, 'reload schema';
