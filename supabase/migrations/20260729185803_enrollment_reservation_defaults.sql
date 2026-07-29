-- Project-Reservation enrollment: sensible auto-defaults + fixed inherited sources.
--
-- Per Nicholas while testing the reservation form:
--  * I'm Applying for a(n)      -> Project Reservation (from the record type)
--  * Building Type              -> Existing (all our buildings are existing)
--  * Building Project Type      -> Multifamily - Central 5 Units
--  * Primary Contractor         -> Energy Efficiency Services of Wisconsin (its
--                                  business name / email / phone / address then
--                                  inherit through the existing related fields)
--  * Support contractor?        -> No
--  * Income level               -> from the building's confirmation code prefix:
--                                  LEA... = Low-Income, MEA... = Moderate
--  * Occupied units             -> the building's total units
-- All defaults fill ONLY when the field is blank, so a manual choice is never
-- overwritten. Scoped to Project-Reservation record types (the only ones whose
-- layout shows these fields). Picklist/account ids are resolved by value/name,
-- never hardcoded.
--
-- Also fixes four Installation-Building sources that pointed at empty columns:
-- Contact Name -> the property's primary contact; Email/Phone -> the owner
-- email/phone; Building Owner Name -> the owner org (shown in both name halves
-- on the external form).

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
  -- Only the Project-Reservation family carries this form.
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

DROP TRIGGER IF EXISTS trg_enrollment_reservation_defaults ON public.enrollments;
CREATE TRIGGER trg_enrollment_reservation_defaults
  BEFORE INSERT OR UPDATE OF enrollment_record_type, building_id
  ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_enrollment_reservation_defaults();

-- Backfill existing Project-Reservation enrollments (a no-op record_type touch
-- fires the trigger, filling the blanks above).
UPDATE public.enrollments
   SET enrollment_record_type = enrollment_record_type
 WHERE enrollment_is_deleted IS NOT TRUE
   AND enrollment_record_type IN (
     SELECT id FROM picklist_values
      WHERE picklist_object='enrollments' AND picklist_field='record_type'
        AND picklist_value ILIKE '%Project-Reservation%');

-- Fix the four Installation-Building inherited sources on the layout.
UPDATE public.page_layout_widgets
   SET widget_config = '{"fields":[
      {"name":"property_id.property_hud_owner_org","type":"related_field","label":"Business Entity Name","column":1,"related":{"table":"properties","column":"property_hud_owner_org","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_primary_contact_id","type":"related_field","label":"Contact Name","column":1,"related":{"table":"properties","column":"property_primary_contact_id","fk_column":"property_id","column_type":"lookup","lookup_table":"contacts","lookup_field":"contact_name"}},
      {"name":"property_id.property_hud_owner_email","type":"related_field","label":"Email","column":1,"related":{"table":"properties","column":"property_hud_owner_email","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_hud_owner_phone","type":"related_field","label":"Phone Number","column":1,"related":{"table":"properties","column":"property_hud_owner_phone","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_hud_owner_org","type":"related_field","label":"Building Owner Name","column":1,"related":{"table":"properties","column":"property_hud_owner_org","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_street","type":"related_field","label":"Installation Address","column":1,"related":{"table":"properties","column":"property_street","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_city","type":"related_field","label":"City","column":1,"related":{"table":"properties","column":"property_city","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_state","type":"related_field","label":"State / Province","column":1,"related":{"table":"properties","column":"property_state","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_zip","type":"related_field","label":"Postal / Zip Code","column":1,"related":{"table":"properties","column":"property_zip","fk_column":"property_id","column_type":"text"}},
      {"name":"building_id.building_total_units","type":"related_field","label":"Total Number of Units","column":1,"related":{"table":"buildings","column":"building_total_units","fk_column":"building_id","column_type":"number"}},
      {"name":"enrollment_occupied_units","type":"integer","label":"Total Number of Occupied Units","column":1},
      {"name":"building_id.building_square_footage","type":"related_field","label":"Total Building Square Footage","column":1,"related":{"table":"buildings","column":"building_square_footage","fk_column":"building_id","column_type":"number"}},
      {"name":"building_id.building_stories","type":"related_field","label":"Total Floors in Building","column":1,"related":{"table":"buildings","column":"building_stories","fk_column":"building_id","column_type":"number"}},
      {"name":"building_id.building_year_built","type":"related_field","label":"Year the Building was Built","column":1,"related":{"table":"buildings","column":"building_year_built","fk_column":"building_id","column_type":"number"}},
      {"name":"enrollment_income_level","type":"picklist","display":"radio","label":"Which income level is your customer approved at?","column":1},
      {"name":"building_id.ira_confirmation_code_lea","type":"related_field","label":"Income-Qualified Confirmation Code","column":1,"help_text":"Confirmation Code must match installation address approved.","related":{"table":"buildings","column":"ira_confirmation_code_lea","fk_column":"building_id","column_type":"text"}},
      {"name":"enrollment_total_project_cost","type":"currency","label":"Total Project Cost","column":1}
   ]}'::jsonb,
       updated_at = now()
 WHERE page_layout_id='94af9c5b-bd66-43e4-b348-f4781efce547'
   AND widget_title='Installation Building Information'
   AND is_deleted IS NOT TRUE;

NOTIFY pgrst, 'reload schema';
