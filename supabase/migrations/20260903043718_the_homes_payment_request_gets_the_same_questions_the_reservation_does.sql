-- The HOMES payment request gets the same questions the reservation does.
--
-- Both branches are the same Jotform (250306438751960) and both ask the whole
-- Installation Building, Utility and Building Improvements blocks. The
-- reservation map was extended from the form's HTML earlier today; the payment
-- request map still named 50 of 144 questions and left the same holes.
--
-- Checked first, since the map predates having the form: all 50 parameters it
-- already used are STILL on the form. Nothing regressed; the blanks were never
-- mapped.
--
-- WHAT WAS COMPLETED COMES FROM THE LINE ITEMS TOO. `ia_work_completed` was
-- typed by hand, the same second opinion the enrollment carried, and it holds
-- exactly the form's own option strings ("Air Sealing", "High Efficiency WLHP
-- Replacement"). The incentive application hangs off the same opportunity as
-- the enrollment, so recompute_opportunity_financials now writes it from the
-- same derivation, under the same programme gate: an opportunity record type
-- with no product mapping is left alone, so nothing outside WI-IRA-MF-HOMES
-- moves.
--
-- The same three widgets are unreachable here as on the reservation -- the
-- support contractor list (q156), the unit/IQ configurable list (q411) and the
-- Date Picker widgets -- so the support contractor is handed over rather than
-- sent, and the completion date rides q403, the NATIVE three-part date control.
--
-- The measure array goes to all THREE checklists (q275, q306, q342). A checkbox
-- value that is not an option on a list is simply not ticked, so whichever
-- question this branch shows receives its own measures and the others receive
-- nothing. Guessing which of the three the payment branch reveals would be a
-- guess; sending to all three costs nothing and cannot be wrong.

INSERT INTO public.external_form_field_map
  (efm_record_number, efm_target_id, efm_leap_field, efm_external_param, efm_value_transform,
   efm_option_value_map, efm_field_label, efm_sort_order, efm_is_active, efm_is_required,
   efm_url_prefillable, efm_owner, efm_created_by, efm_updated_by, is_seed_data)
SELECT '', tgt.id, v.leap, v.param, v.xform, v.ovm, v.label, v.ord, true, v.req, v.fillable,
       tgt.eft_owner, tgt.eft_owner, tgt.eft_owner, true
FROM (SELECT id, eft_owner FROM public.external_form_targets
       WHERE eft_key='wi_ira_mf_homes_project_payment_request' AND eft_is_deleted IS NOT TRUE) tgt,
LATERAL (VALUES
  ('total_units_in_building','totalNumber164',NULL::text,'{}'::jsonb,'Total Number of Units',510,true,true),
  ('occupied_units','totalNumber',NULL,'{}'::jsonb,'Total Number of Occupied Units',512,true,true),
  ('building_square_footage','totalBuilding',NULL,'{}'::jsonb,'Total Building Square Footage',514,true,true),
  ('total_floors','totalFloors',NULL,'{}'::jsonb,'Total Floors in Building',516,true,true),
  ('year_built','yearThe',NULL,'{}'::jsonb,'Year the Building was Built',518,true,true),
  ('income_level','whichIncome',NULL,'{"Low-Income":"Low- Income"}'::jsonb,'Which income level is your customer approved at?',520,true,true),
  ('electric_provider','electricProvider',NULL,'{}'::jsonb,'Electric Provider',522,true,true),
  ('electric_account_number','electricAccount',NULL,'{}'::jsonb,'Electric Account Number',524,true,true),
  ('heating_fuel_type','howIs',NULL,'{}'::jsonb,'How is this building heated?',526,true,true),
  ('gas_provider','naturalGas',NULL,'{}'::jsonb,'Natural Gas Provider',528,false,true),
  ('gas_account_number','naturalGas107',NULL,'{}'::jsonb,'Natural Gas Account Number',530,false,true),
  ('other_heating_provider','otherHeating',NULL,'{}'::jsonb,'Other Heating Fuel Provider',532,false,true),
  ('other_heating_account_number','otherAccount109',NULL,'{}'::jsonb,'Other Account Number',534,false,true),
  ('work_measures','whatWork[]',NULL,'{}'::jsonb,'What work was completed?',536,false,true),
  ('work_measures','whatWork306[]',NULL,'{}'::jsonb,'What work was completed? (payment branch)',538,false,true),
  ('work_measures','whatWork342[]',NULL,'{}'::jsonb,'What work was completed? (HVAC)',540,false,true),
  ('estimated_completion_date','estimatedCompletion[month]','date_month_2','{}'::jsonb,'Estimated Completion Date',542,true,true),
  ('estimated_completion_date','estimatedCompletion[day]','date_day_2','{}'::jsonb,'Estimated Completion Date',543,true,true),
  ('estimated_completion_date','estimatedCompletion[year]','date_year','{}'::jsonb,'Estimated Completion Date',544,true,true),
  ('submitted_by_first_name','whoIs[first]',NULL,'{}'::jsonb,'Who is submitting this form? (First)',546,true,true),
  ('submitted_by_last_name','whoIs[last]',NULL,'{}'::jsonb,'Who is submitting this form? (Last)',548,true,true),
  ('ssn_used_as_tax_id','isA',NULL,'{}'::jsonb,'Is a Social Security Number Used as Your Tax Identification Number?',550,false,true),
  ('email_for_tax_purposes','emailFor',NULL,'{}'::jsonb,'Email for Tax Purposes',552,false,true),
  ('support_contractor_business_name','typeA156',NULL,'{}'::jsonb,'Support Contractor Business Name',560,false,false),
  ('support_contractor_contact_name','typeA156',NULL,'{}'::jsonb,'Support Contractor Contact Name',561,false,false),
  ('support_contractor_full_address','typeA156',NULL,'{}'::jsonb,'Support Contractor Full Address',562,false,false),
  ('support_contractor_phone','typeA156',NULL,'{}'::jsonb,'Support Contractor Phone Number',563,false,false),
  ('support_contractor_email','typeA156',NULL,'{}'::jsonb,'Support Contractor Email',564,false,false)
) AS v(leap, param, xform, ovm, label, ord, req, fillable)
WHERE NOT EXISTS (
  SELECT 1 FROM public.external_form_field_map m
   WHERE m.efm_target_id = tgt.id AND m.efm_is_deleted IS NOT TRUE
     AND m.efm_external_param = v.param AND m.efm_leap_field = v.leap);

-- ── The measures on the incentive application follow the line items too ──
CREATE OR REPLACE FUNCTION public.recompute_opportunity_financials(p_opportunity_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_catalog'
AS $fn$
DECLARE
  v_cost       numeric;
  v_rebate     numeric;
  v_equipment  numeric;
  v_install    numeric;
  v_measures   jsonb;
  v_mapped     boolean;
BEGIN
  IF p_opportunity_id IS NULL THEN RETURN; END IF;

  v_cost   := public.opportunity_project_cost_total(p_opportunity_id);
  v_rebate := public.opportunity_program_incentive_total(p_opportunity_id);

  -- Equipment takes the rounded half; installation takes what is left, so the
  -- two always sum to the total exactly.
  IF v_cost IS NOT NULL THEN
    v_equipment := round(v_cost / 2, 2);
    v_install   := v_cost - v_equipment;
  END IF;

  -- Does this programme have a product -> measure mapping at all? Without one,
  -- the measures are still whatever a person entered, untouched.
  SELECT EXISTS (
    SELECT 1
      FROM public.opportunities o
      JOIN public.program_measure_products m
        ON m.pmp_opportunity_record_type = o.opportunity_record_type
       AND m.pmp_is_deleted IS NOT TRUE
     WHERE o.id = p_opportunity_id
  ) INTO v_mapped;

  IF v_mapped THEN
    v_measures := public.opportunity_form_measures(p_opportunity_id);
  END IF;

  UPDATE public.opportunities
     SET opportunity_amount = v_cost
   WHERE id = p_opportunity_id
     AND opportunity_amount IS DISTINCT FROM v_cost;

  UPDATE public.enrollments e
     SET enrollment_total_project_cost = v_cost,
         enrollment_requested_incentive_amount =
           COALESCE(v_rebate, e.enrollment_requested_incentive_amount),
         enrollment_total_ira_hear_cost           = COALESCE(v_cost, e.enrollment_total_ira_hear_cost),
         enrollment_equipment_and_materials_costs = COALESCE(v_equipment, e.enrollment_equipment_and_materials_costs),
         enrollment_installation_costs            = COALESCE(v_install, e.enrollment_installation_costs),
         enrollment_work_measures =
           CASE WHEN v_mapped THEN v_measures ELSE e.enrollment_work_measures END
   WHERE e.opportunity_id = p_opportunity_id
     AND e.enrollment_is_deleted IS NOT TRUE
     AND (e.enrollment_total_project_cost IS DISTINCT FROM v_cost
          OR (v_rebate IS NOT NULL
              AND e.enrollment_requested_incentive_amount IS DISTINCT FROM v_rebate)
          OR (v_mapped AND e.enrollment_work_measures IS DISTINCT FROM v_measures)
          OR (v_cost IS NOT NULL
              AND (e.enrollment_total_ira_hear_cost IS DISTINCT FROM v_cost
                OR e.enrollment_equipment_and_materials_costs IS DISTINCT FROM v_equipment
                OR e.enrollment_installation_costs IS DISTINCT FROM v_install)));

  UPDATE public.incentive_applications ia
     SET ia_total_project_cost = v_cost,
         ia_total_ira_homes_rebate_requested =
           COALESCE(v_rebate, ia.ia_total_ira_homes_rebate_requested),
         ia_work_completed =
           CASE WHEN v_mapped THEN v_measures ELSE ia.ia_work_completed END
   WHERE ia.opportunity_id = p_opportunity_id
     AND ia.ia_is_deleted IS NOT TRUE
     AND (ia.ia_total_project_cost IS DISTINCT FROM v_cost
          OR (v_rebate IS NOT NULL
              AND ia.ia_total_ira_homes_rebate_requested IS DISTINCT FROM v_rebate)
          OR (v_mapped AND ia.ia_work_completed IS DISTINCT FROM v_measures));
END $fn$;

REVOKE ALL ON FUNCTION public.recompute_opportunity_financials(uuid) FROM PUBLIC, anon, authenticated;

SET LOCAL session_replication_role = replica;

UPDATE public.incentive_applications ia
   SET ia_work_completed = public.opportunity_form_measures(ia.opportunity_id)
  FROM public.opportunities o
 WHERE o.id = ia.opportunity_id
   AND ia.ia_is_deleted IS NOT TRUE
   AND EXISTS (SELECT 1 FROM public.program_measure_products m
                WHERE m.pmp_opportunity_record_type = o.opportunity_record_type
                  AND m.pmp_is_deleted IS NOT TRUE)
   AND ia.ia_work_completed IS DISTINCT FROM public.opportunity_form_measures(ia.opportunity_id);

SET LOCAL session_replication_role = origin;

NOTIFY pgrst, 'reload schema';

DO $assert$
DECLARE v_target uuid; v_count int; v_hand int; v_src text; v_missing text;
BEGIN
  SELECT id INTO v_target FROM public.external_form_targets
   WHERE eft_key='wi_ira_mf_homes_project_payment_request' AND eft_is_deleted IS NOT TRUE;

  SELECT count(*) FILTER (WHERE efm_is_deleted IS NOT TRUE),
         count(*) FILTER (WHERE efm_is_deleted IS NOT TRUE AND efm_url_prefillable IS FALSE)
    INTO v_count, v_hand
    FROM public.external_form_field_map WHERE efm_target_id = v_target;
  IF v_count <> 78 THEN
    RAISE EXCEPTION 'The payment request map should carry 78 parameters, it carries %', v_count;
  END IF;
  IF v_hand <> 5 THEN
    RAISE EXCEPTION 'Expected 5 hand-over fields, found %', v_hand;
  END IF;

  -- Structural: every mapped key must be one the resolver actually writes. The
  -- resolver is extended in the next migration, so the new keys are exempt here
  -- and asserted there.
  SELECT prosrc INTO v_src FROM pg_proc
   WHERE proname = 'build_wi_ira_payment_request_form_prefill';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'The payment request resolver is missing.';
  END IF;
END $assert$;
