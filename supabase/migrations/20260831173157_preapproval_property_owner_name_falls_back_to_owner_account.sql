-- Pre-approval "Property Owner Name" resolves from the property's OWNER ACCOUNT
-- when the HUD owner-organization column is blank.
--
-- Reported: a WI-IRA-MF-HOMES-Assessment-Preapproval enrollment refused to open
-- (and refused to submit) with "Property Owner Name" listed as missing, on a
-- property that plainly shows a Property Owner.
--
-- Cause: build_wi_ira_assessment_prefill resolved that one form field from
-- properties.property_hud_owner_org ALONE. That column is populated by the HUD
-- import; a property created in LEAP by hand carries the owner as an ACCOUNT on
-- properties.property_account_id and leaves the HUD text column null. The owner
-- was on the property the whole time -- in the field that is authoritative for
-- it -- and the prefill was reading the other one.
--
-- That made a hard dead end, not just a wrong answer: there is no
-- enrollment_owner_organization COLUMN on enrollments, so the submit gate's
-- "fields being set in this save count as populated" escape hatch can never
-- clear it. The user is told to complete a field that exists on no form.
--
-- Fix: one COALESCE chain, in the order that keeps every already-correct form
-- byte-identical. The HUD owner organization still wins wherever it is present
-- (it is the owning entity as registered for that specific property, and can be
-- narrower than the account -- e.g. PROP-23587 is HUD-owned by "LSS HOUSING,
-- INC." while its account is the parent "Lutheran Social Services of Wisconsin
-- and Upper Michigan, Inc."). The owner account name is used only where the HUD
-- column has nothing to say. Purely additive: no populated value changes.
--
-- Only the owner-organization resolution changed; the rest of the function is
-- verbatim.

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
  --
  -- The property states its owner in two places and either one may be the only
  -- one filled in: the HUD owner-organization text (set by the HUD import) and
  -- the Property Owner ACCOUNT (how an owner is recorded when the property is
  -- created in LEAP). Take the HUD value when it has one -- it names the entity
  -- that owns THIS property, which can be narrower than the account -- and the
  -- owner account's name otherwise. A soft-deleted account names nobody.
  IF e.property_id IS NOT NULL THEN
    SELECT COALESCE(
             NULLIF(BTRIM(p.property_hud_owner_org), ''),
             NULLIF(BTRIM(a.account_name), '')
           )
      INTO po
    FROM public.properties p
    LEFT JOIN public.accounts a
      ON a.id = p.property_account_id
     AND a.account_is_deleted IS NOT TRUE
    WHERE p.id = e.property_id;
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

-- The grants the function already carried (it is SECURITY INVOKER; RLS on
-- enrollments/properties/accounts still governs every row it reads).
REVOKE ALL ON FUNCTION public.build_wi_ira_assessment_prefill(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_wi_ira_assessment_prefill(uuid) TO authenticated, service_role;

-- Prove it against the live pre-approval enrollments rather than predicting it.
DO $$
DECLARE
  v_changed  integer;   -- forms whose owner name is not what it was
  v_blocked  integer;   -- forms still missing an owner name they could resolve
BEGIN
  -- 1. Nothing that already resolved an owner name resolves a different one.
  SELECT count(*) INTO v_changed
  FROM public.enrollments e
  JOIN public.properties p ON p.id = e.property_id
  WHERE e.enrollment_is_deleted IS NOT TRUE
    AND e.enrollment_record_type = (
      SELECT id FROM public.picklist_values
      WHERE picklist_object = 'enrollments' AND picklist_field = 'record_type'
        AND picklist_value = 'WI-IRA-MF-HOMES-Assessment-Preapproval')
    AND NULLIF(BTRIM(p.property_hud_owner_org), '') IS NOT NULL
    AND public.build_wi_ira_assessment_prefill(e.id) ->> 'enrollment_owner_organization'
        IS DISTINCT FROM BTRIM(p.property_hud_owner_org);
  IF v_changed > 0 THEN
    RAISE EXCEPTION 'build_wi_ira_assessment_prefill changed the owner name on % enrollment(s) that already had one', v_changed;
  END IF;

  -- 2. No pre-approval enrollment whose property names an owner -- either way --
  --    is still reported as missing Property Owner Name.
  SELECT count(*) INTO v_blocked
  FROM public.enrollments e
  JOIN public.properties p ON p.id = e.property_id
  LEFT JOIN public.accounts a
    ON a.id = p.property_account_id AND a.account_is_deleted IS NOT TRUE
  WHERE e.enrollment_is_deleted IS NOT TRUE
    AND e.enrollment_record_type = (
      SELECT id FROM public.picklist_values
      WHERE picklist_object = 'enrollments' AND picklist_field = 'record_type'
        AND picklist_value = 'WI-IRA-MF-HOMES-Assessment-Preapproval')
    AND COALESCE(NULLIF(BTRIM(p.property_hud_owner_org), ''), NULLIF(BTRIM(a.account_name), '')) IS NOT NULL
    AND public.build_wi_ira_assessment_prefill(e.id) ->> 'enrollment_owner_organization' IS NULL;
  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'Property Owner Name still unresolved on % pre-approval enrollment(s) whose property names an owner', v_blocked;
  END IF;
END $$;
