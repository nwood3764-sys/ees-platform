-- The HEAR Project Reservation can be filed, and the record type that files it
-- gets its own resolver.
--
-- Nicholas, on the HEAR enrollment record type: "we need a button to actually
-- fill this out on the jot form, right, like open the submittal, just like we
-- do on the homes record types for enrollment."
--
-- The HOMES Project Reservation enrollment has had that button since
-- 20260803194426: an external_form_targets row + its field map, opened by
-- build_wi_ira_project_reservation_form_prefill. The HEAR Project Reservation
-- enrollment (6 live records on 2026-09-02) had NOTHING — no target, no
-- resolver, no button.
--
-- It is the SAME Focus On Energy form (Jotform 250306438751960): the submittal
-- covers the programme branches and the "I'm Applying for a(n)" radio selects
-- the stage. What differs is the RECORD it is filled from — and that is why
-- this is a second target with its own resolver rather than the HOMES target
-- pointed at another record type:
--
--   · build_wi_ira_project_reservation_form_prefill returns '{}' outright for
--     any record type other than WI-IRA-MF-HOMES-Project-Reservation, on
--     purpose. Widening that guard would let a HEAR enrollment be filed by the
--     HOMES resolver, which is exactly the confusion the guard exists to stop.
--   · The two filings can diverge later — a programme-specific value, a field
--     the other does not carry — and each then changes on its own row.
--
-- The field map is copied from the HOMES target rather than retyped, because
-- the parameters belong to the FORM and the form is the same one; a typo in a
-- re-keyed `q65_doesThe65` produces a control that silently fills nothing. The
-- two maps are separate rows from here on, so either can be edited alone.

BEGIN;

-- ── 1. The target ─────────────────────────────────────────────────────────
INSERT INTO public.external_form_targets (
  eft_record_number, eft_key, eft_name, eft_description, eft_kind,
  eft_base_url, eft_form_provider, eft_external_form_id, eft_object,
  eft_record_type, eft_is_active, eft_owner, eft_created_by
)
SELECT
  '',                                              -- trg_eft_rn fills the record number
  'wi_ira_mf_hear_project_reservation',
  'Focus On Energy - IRA Multifamily Project Submittal Form (HEAR Project Reservation)',
  'The Project Reservation branch of the IRA Multifamily Project Submittal Form, pre-filled from the HEAR Project Reservation enrollment.',
  'prefill_url',
  'https://focusonenergy.jotform.com/250306438751960',
  'jotform',
  '250306438751960',
  'enrollments',
  (SELECT id FROM public.picklist_values
    WHERE picklist_object = 'enrollments' AND picklist_field = 'record_type'
      AND picklist_value = 'WI-IRA-MF-HEAR-Project-Reservation'),
  true,
  -- Owner and author are carried from the sibling target: a migration has no
  -- signed-in user, so current_app_user_id() is NULL and the audit stamper
  -- cannot fill either column.
  (SELECT eft_owner FROM public.external_form_targets WHERE eft_key = 'wi_ira_mf_homes_project_reservation'),
  (SELECT eft_created_by FROM public.external_form_targets WHERE eft_key = 'wi_ira_mf_homes_project_reservation')
WHERE NOT EXISTS (
  SELECT 1 FROM public.external_form_targets WHERE eft_key = 'wi_ira_mf_hear_project_reservation'
);

-- ── 2. Its field map — the same form's parameters ────────────────────────
INSERT INTO public.external_form_field_map (
  efm_record_number, efm_target_id, efm_leap_field, efm_external_param,
  efm_value_transform, efm_option_value_map, efm_field_label, efm_sort_order,
  efm_is_required, efm_is_active, efm_owner, efm_created_by
)
SELECT
  '',
  (SELECT id FROM public.external_form_targets WHERE eft_key = 'wi_ira_mf_hear_project_reservation'),
  m.efm_leap_field, m.efm_external_param, m.efm_value_transform, m.efm_option_value_map,
  m.efm_field_label, m.efm_sort_order, m.efm_is_required, true, m.efm_owner, m.efm_created_by
FROM public.external_form_field_map m
JOIN public.external_form_targets t ON t.id = m.efm_target_id
WHERE t.eft_key = 'wi_ira_mf_homes_project_reservation'
  AND m.efm_is_deleted IS NOT TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.external_form_field_map x
    JOIN public.external_form_targets xt ON xt.id = x.efm_target_id
    WHERE xt.eft_key = 'wi_ira_mf_hear_project_reservation' AND x.efm_is_deleted IS NOT TRUE
  );

-- ── 3. The resolver ──────────────────────────────────────────────────────
-- Body identical to the HOMES resolver apart from the record type it accepts.
-- SECURITY INVOKER, like every resolver on this route: the prefill must show
-- the caller only what the caller may read.
CREATE OR REPLACE FUNCTION public.build_wi_ira_hear_project_reservation_form_prefill(p_enrollment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  en public.enrollments%ROWTYPE;
  ca public.accounts%ROWTYPE;
  cc public.contacts%ROWTYPE;
  pr public.properties%ROWTYPE;
  bl public.buildings%ROWTYPE;
  rt text;
BEGIN
  IF p_enrollment_id IS NULL THEN RETURN '{}'::jsonb; END IF;
  SELECT e.* INTO en FROM public.enrollments e WHERE e.id = p_enrollment_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
  SELECT picklist_value INTO rt FROM public.picklist_values WHERE id = en.enrollment_record_type;
  IF rt IS DISTINCT FROM 'WI-IRA-MF-HEAR-Project-Reservation' THEN RETURN '{}'::jsonb; END IF;

  IF en.enrollment_contractor_account_id IS NOT NULL THEN
    SELECT x.* INTO ca FROM public.accounts x WHERE x.id = en.enrollment_contractor_account_id;
  END IF;
  IF en.enrollment_contractor_contact_id IS NOT NULL THEN
    SELECT x.* INTO cc FROM public.contacts x WHERE x.id = en.enrollment_contractor_contact_id;
  END IF;
  IF en.property_id IS NOT NULL THEN SELECT x.* INTO pr FROM public.properties x WHERE x.id = en.property_id; END IF;
  IF en.building_id IS NOT NULL THEN SELECT x.* INTO bl FROM public.buildings x WHERE x.id = en.building_id; END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'ia_application_for',            'Project Reservation',
    'ia_building_type',              (SELECT picklist_value FROM public.picklist_values WHERE id = en.enrollment_building_type),
    'ia_building_project_type',      (SELECT picklist_value FROM public.picklist_values WHERE id = en.enrollment_building_project_type),
    'has_support_contractor',        CASE WHEN en.enrollment_has_support_contractor IS TRUE THEN 'Yes'
                                          WHEN en.enrollment_has_support_contractor IS FALSE THEN 'No' END,
    'contractor_business_name',      ca.account_name,
    'contractor_contact_first_name', cc.contact_first_name,
    'contractor_contact_last_name',  cc.contact_last_name,
    'contractor_email',              cc.contact_email,
    'contractor_phone',              cc.contact_phone,
    'contractor_street',             ca.billing_street,
    'contractor_city',               ca.billing_city,
    'contractor_state',              ca.billing_state,
    'contractor_zip',                ca.billing_zip,
    'business_entity_name',          public.resolve_property_owner_name(en.property_id),
    'signer_contact_name',           NULLIF(BTRIM(COALESCE(en.enrollment_contact_name,'')), ''),
    'signer_contact_email',          en.enrollment_contact_email,
    'signer_contact_phone',          en.enrollment_contact_phone,
    'building_owner_name',           public.resolve_property_owner_name(en.property_id),
    'installation_street',           pr.property_street,
    'installation_city',             pr.property_city,
    'installation_state',            pr.property_state,
    'installation_zip',              pr.property_zip,
    'iq_code',                       bl.ira_confirmation_code_lea
  ));
END $function$;

-- A DROP/CREATE of a function drops its grants, and a plain CREATE leaves the
-- default PUBLIC EXECUTE; both are re-stated explicitly. anon is deliberately
-- NOT granted (the route is only ever called by a signed-in user), which is
-- tighter than the HOMES resolver and changes nothing that works today.
REVOKE ALL ON FUNCTION public.build_wi_ira_hear_project_reservation_form_prefill(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_wi_ira_hear_project_reservation_form_prefill(uuid) TO authenticated, service_role;

-- ── 4. The dispatcher learns the new key ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.build_external_form_prefill(p_key text, p_record_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF p_key IS NULL OR p_record_id IS NULL THEN RETURN '{}'::jsonb; END IF;
  CASE p_key
    WHEN 'wi_ira_mf_homes_assessment_preapproval' THEN RETURN public.build_wi_ira_assessment_prefill(p_record_id);
    WHEN 'wi_ira_mf_homes_assessment_application' THEN RETURN public.build_wi_ira_assessment_application_prefill(p_record_id);
    WHEN 'wi_ira_mf_homes_project_payment_request' THEN RETURN public.build_wi_ira_payment_request_form_prefill(p_record_id);
    WHEN 'wi_ira_mf_homes_project_reservation' THEN RETURN public.build_wi_ira_project_reservation_form_prefill(p_record_id);
    WHEN 'wi_ira_mf_hear_project_reservation' THEN RETURN public.build_wi_ira_hear_project_reservation_form_prefill(p_record_id);
    ELSE RETURN '{}'::jsonb;
  END CASE;
END $function$;

REVOKE ALL ON FUNCTION public.build_external_form_prefill(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_external_form_prefill(text, uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ── 5. Assert it, rather than assume it ──────────────────────────────────
DO $$
DECLARE
  v_target uuid;
  v_fields int;
  v_homes_fields int;
  v_rt uuid;
BEGIN
  SELECT id, eft_record_type INTO v_target, v_rt
    FROM public.external_form_targets WHERE eft_key = 'wi_ira_mf_hear_project_reservation';
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'The HEAR project reservation form target was not created.';
  END IF;
  IF v_rt IS NULL THEN
    RAISE EXCEPTION 'The HEAR form target is not scoped to a record type — the enrollments record_type picklist value WI-IRA-MF-HEAR-Project-Reservation was not found.';
  END IF;

  SELECT count(*) INTO v_fields FROM public.external_form_field_map
    WHERE efm_target_id = v_target AND efm_is_deleted IS NOT TRUE;
  SELECT count(*) INTO v_homes_fields FROM public.external_form_field_map m
    JOIN public.external_form_targets t ON t.id = m.efm_target_id
    WHERE t.eft_key = 'wi_ira_mf_homes_project_reservation' AND m.efm_is_deleted IS NOT TRUE;
  IF v_fields <> v_homes_fields THEN
    RAISE EXCEPTION 'The HEAR field map has % fields, the HOMES form has % — a partially copied map fills a form with holes in it.',
      v_fields, v_homes_fields;
  END IF;

  -- The resolver answers for a HEAR enrollment. Called for real rather than
  -- inspected: a resolver that returns '{}' is a button that opens an empty
  -- form, and it looks perfectly correct from the source.
  PERFORM 1 FROM public.enrollments e
   WHERE e.enrollment_record_type = v_rt LIMIT 1;
  IF FOUND THEN
    IF (SELECT public.build_wi_ira_hear_project_reservation_form_prefill(e.id)
          FROM public.enrollments e WHERE e.enrollment_record_type = v_rt
          ORDER BY e.enrollment_record_number LIMIT 1) = '{}'::jsonb THEN
      RAISE EXCEPTION 'The HEAR resolver returned nothing for a live HEAR enrollment.';
    END IF;
  END IF;

  -- ...and REFUSES a HOMES one. This is the guard that keeps one programme's
  -- filing from being built by the other's resolver, so it is asserted in
  -- both directions.
  IF EXISTS (SELECT 1 FROM public.enrollments e
      JOIN public.picklist_values v ON v.id = e.enrollment_record_type
      WHERE v.picklist_value = 'WI-IRA-MF-HOMES-Project-Reservation') THEN
    IF (SELECT public.build_wi_ira_hear_project_reservation_form_prefill(e.id)
          FROM public.enrollments e
          JOIN public.picklist_values v ON v.id = e.enrollment_record_type
          WHERE v.picklist_value = 'WI-IRA-MF-HOMES-Project-Reservation'
          ORDER BY e.enrollment_record_number LIMIT 1) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'The HEAR resolver filled a HOMES enrollment — the record-type guard is not holding.';
    END IF;
  END IF;

  -- And the dispatcher actually routes the new key.
  IF (SELECT public.build_external_form_prefill('wi_ira_mf_hear_project_reservation', e.id)
        FROM public.enrollments e WHERE e.enrollment_record_type = v_rt
        ORDER BY e.enrollment_record_number LIMIT 1) = '{}'::jsonb THEN
    RAISE EXCEPTION 'build_external_form_prefill does not route the HEAR key.';
  END IF;
END $$;

COMMIT;
