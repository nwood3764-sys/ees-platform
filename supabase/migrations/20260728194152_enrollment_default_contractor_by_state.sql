-- Default the enrollment's registered contractor to the EES entity for its state.
--
-- On INSERT, when no contractor account is set, resolve the EES account named
-- "Energy Efficiency Services of <state>" for the enrollment's state and use it.
-- State is taken from the record type's picklist_state first (the record type
-- is the authoritative program/state axis), then the enrollment's own state.
-- This makes "Energy Efficiency Services of Wisconsin" the automatic contractor
-- for Wisconsin enrollments, and extends to other EES states by naming
-- convention (no hardcoded account id). If no matching account exists, the
-- field is simply left blank.

CREATE OR REPLACE FUNCTION public.default_enrollment_contractor_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE
  v_state_code text;
  v_state_name text;
  v_acct       uuid;
BEGIN
  IF NEW.enrollment_contractor_account_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT pv.picklist_state INTO v_state_code
    FROM picklist_values pv WHERE pv.id = NEW.enrollment_record_type;
  v_state_code := COALESCE(NULLIF(trim(coalesce(v_state_code,'')),''),
                           NULLIF(trim(coalesce(NEW.enrollment_state,'')),''));
  IF v_state_code IS NULL THEN
    RETURN NEW;
  END IF;

  v_state_name := CASE upper(v_state_code)
    WHEN 'WI' THEN 'Wisconsin'
    WHEN 'NC' THEN 'North Carolina'
    WHEN 'CO' THEN 'Colorado'
    WHEN 'MI' THEN 'Michigan'
    WHEN 'IN' THEN 'Indiana'
    ELSE NULL
  END;
  IF v_state_name IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT a.id INTO v_acct
    FROM accounts a
   WHERE a.account_is_deleted IS NOT TRUE
     AND lower(a.account_name) = lower('Energy Efficiency Services of ' || v_state_name)
   ORDER BY a.account_record_number
   LIMIT 1;

  IF v_acct IS NOT NULL THEN
    NEW.enrollment_contractor_account_id := v_acct;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_enrollment_contractor_default ON public.enrollments;
CREATE TRIGGER trg_enrollment_contractor_default
  BEFORE INSERT ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.default_enrollment_contractor_account();

NOTIFY pgrst, 'reload schema';
