-- One HOMES application form, not two: WI-IRA-MF-HOMES (incentive application)
-- is retired in favour of WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST.
--
-- Creating an application on a WI-IRA-MF-HOMES opportunity offered two forms
-- with near-identical names and no way to tell which was the real one. They are
-- not two versions of one form -- they overlap on 5 of 110 fields, 4 of which
-- are the system-audit quartet -- but nothing on screen said so.
--
-- WI-IRA-MF-HOMES (PL-00305, 55 fields) is the Salesforce-era tracker: it binds
-- the legacy `ia_opportunity` uuid-text column instead of the `opportunity_id`
-- FK, uses `ia_stage` instead of `ia_status`, and carries whole-programme
-- span fields (project reservation request/received/duration, rebate paid date,
-- total project programme duration) -- one row summarising a programme, not a
-- form anyone submits. No automation keys off it.
--
-- WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST (PL-00382, 60 fields) is the real
-- Focus On Energy payment request: real FKs, combustion-safety tests, who gets
-- paid, payment mailing address, final costs -- plus the two automations,
-- `build_ia_payment_request_prefill` (pulls the reservation forward) and the
-- Quality Install Tool action. It holds 6 of the 7 live HOMES applications.
--
-- The programme's OTHER stages already live elsewhere, which is why the
-- incentive application carries only the payment request:
--   * Income qualification -> enrollments (`run_income_qualification`)
--   * Project reservation  -> enrollments, record type
--                             WI-IRA-MF-HOMES-Project-Reservation
--   * Payment request      -> incentive_applications, this record type
--
-- Deactivated, never deleted (the LEAP rule, and the 2026-08-23 precedent for
-- the retired assessment opportunity types): IA-00044 still points at it, and
-- a record type that was used is part of the record's history.
--
-- No code change is needed, because deactivation IS the mechanism:
-- `eligible_record_types_for_parent` filters on `picklist_is_active`, so the
-- form leaves the picker, and `derive_incentive_application_record_type`'s
-- rule (b) -- "the only eligible form, if there is exactly one" -- then stamps
-- the payment request automatically on an application created with no record
-- type. Proved in a rolled-back transaction on OPP-00193 before shipping.
--
-- The eligibility edge (WI-IRA-MF-HOMES opportunity -> WI-IRA-MF-HOMES
-- application) is deliberately left active. The enforce trigger reads it
-- rather than the active flag, so leaving it is what keeps IA-00044 editable,
-- and it correctly still describes where that form would belong if it were
-- ever reactivated.

UPDATE public.picklist_values
SET picklist_is_active = false
WHERE picklist_object = 'incentive_applications'
  AND picklist_field  = 'record_type'
  AND picklist_value  = 'WI-IRA-MF-HOMES'
  AND picklist_is_active;

DO $$
DECLARE
  v_opp_rt   uuid;
  v_forms    text;
BEGIN
  -- The record type is gone from every picker.
  IF EXISTS (
    SELECT 1 FROM public.picklist_values
     WHERE picklist_object = 'incentive_applications'
       AND picklist_field  = 'record_type'
       AND picklist_value  = 'WI-IRA-MF-HOMES'
       AND picklist_is_active
  ) THEN
    RAISE EXCEPTION 'WI-IRA-MF-HOMES incentive application record type is still active';
  END IF;

  SELECT id INTO v_opp_rt FROM public.picklist_values
   WHERE picklist_object = 'opportunities' AND picklist_field = 'record_type'
     AND picklist_value = 'WI-IRA-MF-HOMES';

  -- Exactly one form is offered on a WI-IRA-MF-HOMES opportunity, and it is the
  -- payment request. This is also what makes the derive trigger unambiguous:
  -- more than one eligible form and it would stamp nothing.
  SELECT string_agg(picklist_value, ', ' ORDER BY picklist_value) INTO v_forms
    FROM public.eligible_record_types_for_parent(
           'opportunities', v_opp_rt, 'incentive_applications');

  IF v_forms IS DISTINCT FROM 'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST' THEN
    RAISE EXCEPTION
      'Expected the payment request to be the only WI-IRA-MF-HOMES application form; got: %',
      COALESCE(v_forms, '(none)');
  END IF;
END $$;
