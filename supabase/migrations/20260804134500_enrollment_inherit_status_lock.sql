-- STATUS-BASED LOCK on the enrollment inheritance automation.
--
-- The inheritance trigger (enrollment_inherit_from_parents) must only prepare
-- enrollments that are still in an editable prep stage. Once an enrollment has
-- been internally verified, submitted to the program, approved, etc., it is
-- LOCKED: the automation makes no changes to it whatsoever. This prevents a bulk
-- touch or a parent-record edit from ever mutating a record that has moved
-- downstream (e.g. an already-submitted assessment enrollment).
--
-- Unlocked (automation may fill-if-null):
--   * new records (NULL status)
--   * "Enrollment To Be Prepared"  (sort_order 10)
--   * "Enrollment To Be Verified"  (sort_order 20)
-- Locked (trigger returns the row unchanged):
--   * "Enrollment Verified" (30) and everything after — Submitted, Approved,
--     Corrections Needed, Denied, Withdrawn.
--
-- Only the lock guard at the top of the function is new; the rest of the body
-- is unchanged from 20260804005610 / 20260804005620.
CREATE OR REPLACE FUNCTION public.enrollment_inherit_from_parents()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_status_sort integer;
  v_bldg_rt text; v_is_mf boolean := false; v_unit_cnt integer; v_bnum text;
  v_lea text;
  v_pstreet text; v_pcity text; v_pstate text; v_pzip text;
  v_acct uuid; v_acct_contact uuid;
  v_bill_street text; v_bill_city text; v_bill_state text; v_bill_zip text;
  v_pt_value text;
BEGIN
  -- LOCK: past the prep/verify stage, the automation is hands-off. Return the
  -- row exactly as the caller supplied it (explicit user edits still apply).
  IF NEW.enrollment_status IS NOT NULL THEN
    SELECT picklist_sort_order INTO v_status_sort FROM public.picklist_values
      WHERE id = NEW.enrollment_status;
    IF COALESCE(v_status_sort, 0) >= 30 THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Building comes from the opportunity when the enrollment doesn't have one
  -- (the enrollment is created under an audit/homes opportunity that already
  -- points at the specific building). Fill-if-null so a hand-set building wins.
  IF NEW.building_id IS NULL AND NEW.opportunity_id IS NOT NULL THEN
    SELECT building_id INTO NEW.building_id
      FROM public.opportunities WHERE id = NEW.opportunity_id;
  END IF;

  -- Building context
  IF NEW.building_id IS NOT NULL THEN
    SELECT rt.picklist_value, b.building_number_or_name, b.ira_confirmation_code_lea
      INTO v_bldg_rt, v_bnum, v_lea
    FROM public.buildings b
    LEFT JOIN public.picklist_values rt ON rt.id = b.building_record_type
    WHERE b.id = NEW.building_id;
    v_is_mf := (v_bldg_rt ILIKE '%MULTIFAMILY%');
    SELECT count(*) INTO v_unit_cnt FROM public.units u
      WHERE u.building_id = NEW.building_id AND u.unit_is_deleted IS NOT TRUE;
  END IF;

  -- Property context
  IF NEW.property_id IS NOT NULL THEN
    SELECT property_street, property_city, property_state, property_zip
      INTO v_pstreet, v_pcity, v_pstate, v_pzip
    FROM public.properties WHERE id = NEW.property_id;
  END IF;

  -- Contractor account context
  v_acct := NEW.enrollment_contractor_account_id;
  IF v_acct IS NOT NULL THEN
    SELECT account_contact_id, billing_street, billing_city, billing_state, billing_zip
      INTO v_acct_contact, v_bill_street, v_bill_city, v_bill_state, v_bill_zip
    FROM public.accounts WHERE id = v_acct;
  END IF;

  -- Status is never blank: default to "Enrollment To Be Prepared"
  IF NEW.enrollment_status IS NULL THEN
    SELECT id INTO NEW.enrollment_status FROM public.picklist_values
      WHERE picklist_object='enrollments' AND picklist_field='enrollment_status'
        AND picklist_value='Enrollment To Be Prepared' AND picklist_is_active LIMIT 1;
  END IF;

  -- Property type translated from the building's record type (fill-if-null)
  IF NEW.enrollment_property_type IS NULL AND v_bldg_rt IS NOT NULL THEN
    v_pt_value := CASE
      WHEN v_is_mf THEN 'multifamily_4_plus_units'
      WHEN v_bldg_rt ILIKE '%SINGLE-FAMILY-ATTACHED%' THEN 'single_family_attached'
      WHEN v_bldg_rt ILIKE '%SINGLE-FAMILY%' THEN 'single_family_detached'
      ELSE NULL END;
    IF v_pt_value IS NOT NULL THEN
      SELECT id INTO NEW.enrollment_property_type FROM public.picklist_values
        WHERE picklist_object='enrollments' AND picklist_field='property_type'
          AND picklist_value=v_pt_value AND picklist_is_active LIMIT 1;
    END IF;
  END IF;

  -- Multifamily defaults (fill-if-null)
  IF v_is_mf THEN
    IF NEW.enrollment_modeling_approach IS NULL THEN
      SELECT id INTO NEW.enrollment_modeling_approach FROM public.picklist_values
        WHERE picklist_object='enrollments' AND picklist_field='modeling_approach'
          AND picklist_value='whole_building_doe2' AND picklist_is_active LIMIT 1;
    END IF;
    IF NEW.enrollment_requested_incentive_amount IS NULL THEN
      NEW.enrollment_requested_incentive_amount := 2000;
    END IF;
    -- Building Details standard text for multifamily central-equipment work
    IF NEW.enrollment_building_details IS NULL OR NEW.enrollment_building_details = '' THEN
      NEW.enrollment_building_details := 'Multi-Family Building Central Equipment Common Area';
    END IF;
  END IF;

  -- Property LEA#(s) translated from the building's IRA LEA confirmation code
  IF (NEW.enrollment_property_lea_numbers IS NULL OR NEW.enrollment_property_lea_numbers = '')
     AND v_lea IS NOT NULL AND v_lea <> '' THEN
    NEW.enrollment_property_lea_numbers := v_lea;
  END IF;

  -- Units per building from the building's active unit count (fill-if-null)
  IF NEW.enrollment_units_per_building IS NULL AND COALESCE(v_unit_cnt,0) > 0 THEN
    NEW.enrollment_units_per_building := v_unit_cnt;
  END IF;

  -- Property address(es) composed from building + property (fill-if-null)
  IF NEW.enrollment_property_addresses IS NULL OR NEW.enrollment_property_addresses = '' THEN
    IF v_bnum IS NOT NULL AND v_pcity IS NOT NULL THEN
      NEW.enrollment_property_addresses := v_bnum || ', ' || v_pcity || ', ' || COALESCE(v_pstate,'') || ' ' || COALESCE(v_pzip,'');
    ELSIF v_pstreet IS NOT NULL THEN
      NEW.enrollment_property_addresses := v_pstreet || ', ' || COALESCE(v_pcity,'') || ', ' || COALESCE(v_pstate,'') || ' ' || COALESCE(v_pzip,'');
    END IF;
  END IF;

  -- Contractor contact from the account's primary contact (fill-if-null)
  IF NEW.enrollment_contractor_contact_id IS NULL AND v_acct_contact IS NOT NULL THEN
    NEW.enrollment_contractor_contact_id := v_acct_contact;
  END IF;

  -- Payment address from the account's billing address, unless marked different
  IF COALESCE(NEW.enrollment_payment_address_different,false) = false AND v_acct IS NOT NULL THEN
    IF NEW.enrollment_payment_address_line1 IS NULL THEN NEW.enrollment_payment_address_line1 := v_bill_street; END IF;
    IF NEW.enrollment_payment_city    IS NULL THEN NEW.enrollment_payment_city    := v_bill_city;   END IF;
    IF NEW.enrollment_payment_state   IS NULL THEN NEW.enrollment_payment_state   := v_bill_state;  END IF;
    IF NEW.enrollment_payment_zip     IS NULL THEN NEW.enrollment_payment_zip     := v_bill_zip;    END IF;
  END IF;

  RETURN NEW;
END $function$;
