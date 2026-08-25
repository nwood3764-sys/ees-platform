-- The WI-IRA-MF-HOMES-AUDIT incentive application gets the fields the Focus On
-- Energy assessment application actually asks for.
--
-- Context. The assessment (audit) application has been mirrored in LEAP since
-- 2026-08-03 -- but on ENROLLMENTS, as record type
-- WI-IRA-MF-HOMES-Assessment-Preapproval, together with the external-form
-- prefill (EFT-00001 -> Formstack form 6324680, 21 field mappings read off the
-- live form). The matching INCENTIVE APPLICATION record type was seeded on
-- 2026-08-23 with the state/program scoping work and never given a form of its
-- own: its layout PL-00304 carries a 50-field "Information" group inherited
-- from the HOMES family (mini-split efficiency category, water-heater location,
-- AHRI certification) and not one field the assessment application asks for.
--
-- This migration adds the columns. Two rules governed which fields are NEW and
-- which reuse what the object already had:
--
--   * A fact the object already records under a purpose-named column is reused:
--     the registered contractor (ia_contractor_account_id / _contact_id), the
--     payment mailing address (ia_payment_mailing_*), and the requested amount
--     (ia_requested_incentive_amount).
--   * A fact with no column gets a NEW purpose-named one, spelled to match its
--     opposite number on enrollments so the inheritance map reads as the
--     one-to-one it is.
--
-- ia_payment_address_different is deliberately NOT the existing
-- ia_mailing_same_as_primary_contractor. That column is the Final Project
-- Payment Request form's question ("is your mailing address the same as the
-- primary contractor's?") -- the inverse polarity of this form's question, on a
-- different form, and two columns holding the same fact in opposite senses on
-- one record is a contradiction waiting to be saved. The two never appear on
-- the same layout.

ALTER TABLE public.incentive_applications
  ADD COLUMN IF NOT EXISTS ia_property_addresses         text,
  ADD COLUMN IF NOT EXISTS ia_property_type              uuid REFERENCES public.picklist_values(id),
  ADD COLUMN IF NOT EXISTS ia_units_per_building         integer,
  ADD COLUMN IF NOT EXISTS ia_modeling_approach          uuid REFERENCES public.picklist_values(id),
  ADD COLUMN IF NOT EXISTS ia_number_of_buildings        integer,
  ADD COLUMN IF NOT EXISTS ia_property_lea_numbers       text,
  ADD COLUMN IF NOT EXISTS ia_building_details           text,
  ADD COLUMN IF NOT EXISTS ia_estimated_assessment_date  date,
  ADD COLUMN IF NOT EXISTS ia_payment_address_different  boolean;

COMMENT ON COLUMN public.incentive_applications.ia_property_addresses IS
  'Focus On Energy assessment application: "Property Address(es)". Composed from the building number + property city/state/zip on the source enrollment.';
COMMENT ON COLUMN public.incentive_applications.ia_property_type IS
  'Focus On Energy assessment application: "Property Type". Picklist on incentive_applications.property_type; labels match the form''s option text exactly.';
COMMENT ON COLUMN public.incentive_applications.ia_modeling_approach IS
  'Focus On Energy assessment application: "How will the property be modeled?". Picklist on incentive_applications.modeling_approach.';
COMMENT ON COLUMN public.incentive_applications.ia_payment_address_different IS
  'Focus On Energy assessment application: "Is the payment address different from the primary address?". NOT the inverse of ia_mailing_same_as_primary_contractor, which belongs to the Final Project Payment Request form.';

-- Picklists -------------------------------------------------------------------
-- Seeded from the enrollment picklists of the same name, which were themselves
-- taken from the form's option strings. Values AND labels match exactly, so the
-- inheritance map can translate by value and the external-form option map keeps
-- working unchanged.
DO $$
DECLARE
  v_owner uuid;
  r RECORD;
BEGIN
  SELECT id INTO v_owner FROM public.users WHERE user_is_deleted IS NOT TRUE
   ORDER BY user_created_at LIMIT 1;

  FOR r IN
    SELECT picklist_field, picklist_value, picklist_label, picklist_sort_order
      FROM public.picklist_values
     WHERE picklist_object = 'enrollments'
       AND picklist_field IN ('property_type', 'modeling_approach')
       AND picklist_is_active
     ORDER BY picklist_field, picklist_sort_order
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.picklist_values
       WHERE picklist_object = 'incentive_applications'
         AND picklist_field = r.picklist_field
         AND picklist_value = r.picklist_value
    ) THEN
      INSERT INTO public.picklist_values
        (id, picklist_object, picklist_field, picklist_value, picklist_label,
         picklist_sort_order, picklist_is_active, picklist_created_by)
      VALUES
        (gen_random_uuid(), 'incentive_applications', r.picklist_field,
         r.picklist_value, r.picklist_label, r.picklist_sort_order, true, v_owner);
    END IF;
  END LOOP;
END $$;

-- Assert the translation the inheritance map depends on: every active
-- enrollment value has an incentive-application counterpart of the same value.
-- A silent gap here would land a NULL Property Type on a submitted application.
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(e.picklist_field || '=' || e.picklist_value, ', ')
    INTO v_missing
  FROM public.picklist_values e
  WHERE e.picklist_object = 'enrollments'
    AND e.picklist_field IN ('property_type', 'modeling_approach')
    AND e.picklist_is_active
    AND NOT EXISTS (
      SELECT 1 FROM public.picklist_values i
       WHERE i.picklist_object = 'incentive_applications'
         AND i.picklist_field = e.picklist_field
         AND i.picklist_value = e.picklist_value
         AND i.picklist_is_active);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Assessment application picklists incomplete: %', v_missing;
  END IF;
END $$;
