-- The FOE assessment pre-approval prefill RPC previously read "Number of
-- Buildings" from the parent property's total building count. The enrollment is
-- building-specific (one building each), so the form must receive the
-- enrollment's own building-specific value (1). Source it from
-- enrollment_number_of_buildings; owner organization stays property-level.
CREATE OR REPLACE FUNCTION public.build_wi_ira_assessment_prefill(p_enrollment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  e         public.enrollments%ROWTYPE;
  ca        public.accounts%ROWTYPE;
  rt        text;
  pt        text;
  ma        text;
  po        text;
  pay_diff  boolean;
  pay_l1    text;
  pay_city  text;
  pay_state text;
  pay_zip   text;
BEGIN
  IF p_enrollment_id IS NULL THEN RETURN '{}'::jsonb; END IF;

  SELECT en.* INTO e
  FROM public.enrollments en
  WHERE en.id = p_enrollment_id
    AND en.enrollment_is_deleted IS NOT TRUE;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;

  SELECT picklist_value INTO rt FROM public.picklist_values WHERE id = e.enrollment_record_type;
  IF rt IS DISTINCT FROM 'WI-IRA-MF-HOMES-Assessment-Preapproval' THEN RETURN '{}'::jsonb; END IF;

  SELECT picklist_label INTO pt FROM public.picklist_values WHERE id = e.enrollment_property_type;
  SELECT picklist_label INTO ma FROM public.picklist_values WHERE id = e.enrollment_modeling_approach;

  IF e.enrollment_contractor_account_id IS NOT NULL THEN
    SELECT a.* INTO ca FROM public.accounts a WHERE a.id = e.enrollment_contractor_account_id;
  END IF;

  -- Owner organization is property-level; number of buildings is NOT (it is the
  -- enrollment's own building-specific count).
  IF e.property_id IS NOT NULL THEN
    SELECT p.property_hud_owner_org INTO po
    FROM public.properties p WHERE p.id = e.property_id;
  END IF;

  pay_diff := COALESCE(e.enrollment_payment_address_different, false);
  IF pay_diff THEN
    pay_l1 := e.enrollment_payment_address_line1; pay_city := e.enrollment_payment_city;
    pay_state := e.enrollment_payment_state;      pay_zip := e.enrollment_payment_zip;
  ELSE
    pay_l1 := ca.billing_street; pay_city := ca.billing_city;
    pay_state := ca.billing_state; pay_zip := ca.billing_zip;
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'enrollment_contractor_name',                  ca.account_name,
    'enrollment_contractor_email',                 ca.account_email,
    'enrollment_contractor_primary_address_line1', ca.billing_street,
    'enrollment_contractor_primary_city',          ca.billing_city,
    'enrollment_contractor_primary_state',         ca.billing_state,
    'enrollment_contractor_primary_zip',           ca.billing_zip,
    'enrollment_payment_address_different',        pay_diff,
    'enrollment_payment_address_line1',            pay_l1,
    'enrollment_payment_city',                     pay_city,
    'enrollment_payment_state',                    pay_state,
    'enrollment_payment_zip',                      pay_zip,
    'enrollment_owner_organization',               po,
    'enrollment_property_addresses',               e.enrollment_property_addresses,
    'enrollment_property_type',                    pt,
    'enrollment_units_per_building',               e.enrollment_units_per_building::text,
    'enrollment_modeling_approach',                ma,
    'enrollment_number_of_buildings',              e.enrollment_number_of_buildings::text,
    'enrollment_requested_incentive_amount',       e.enrollment_requested_incentive_amount::text,
    'enrollment_property_lea_numbers',             e.enrollment_property_lea_numbers,
    'enrollment_building_details',                 e.enrollment_building_details,
    'enrollment_estimated_assessment_date',        to_char(e.enrollment_estimated_assessment_date, 'YYYY-MM-DD')
  ));
END $function$;

NOTIFY pgrst, 'reload schema';
