-- Project Payment Request (WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST) — schema + picklists
--
-- Part 1 of 2. Mirrors the "IRA HOMES Multifamily Project Submittal Form" JotForm
-- (Final Installation Payment Request path) onto the incentive_applications object,
-- the same way the Project Reservation JotForm was mirrored onto enrollments
-- (migrations 20260729174350 / 181816 / 194216 / 202258 / 230017).
--
-- Convention (matches this object's parent-reference migration 20260729153704):
--   * Values that live on a parent (building / property / opportunity / contractor
--     account) are shown read-only via related_field in the LAYOUT (part 2) — NOT
--     copied here.
--   * Only no-parent form values become real ia_* columns (added below).
--   * Every fixed-option radio/dropdown becomes a picklist carrying the form's EXACT
--     option strings (a Chrome extension maps each to a specific form choice).
--     picklist_field is the column name with the ia_ prefix stripped.
--   * The one multi-select ("What work was completed?") is jsonb; its options live
--     inline in the layout widget (part 2), not in picklist_values.
--
-- Legacy text columns ia_tax_classification / ia_how_is_this_building_heated /
-- ia_who_is_the_recipient_of_the_rebate are left untouched (shared, other record
-- types); this form uses NEW uuid picklist columns instead.

-- 1) Lookup / FK columns (contractor + support contractor + submitter) ----------
ALTER TABLE public.incentive_applications
  ADD COLUMN IF NOT EXISTS ia_contractor_account_id          uuid,
  ADD COLUMN IF NOT EXISTS ia_contractor_contact_id          uuid,
  ADD COLUMN IF NOT EXISTS ia_has_support_contractor         boolean,
  ADD COLUMN IF NOT EXISTS ia_support_contractor_account_id  uuid,
  ADD COLUMN IF NOT EXISTS ia_support_contractor_contact_id  uuid,
  ADD COLUMN IF NOT EXISTS ia_submitted_by                   uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='incentive_applications_contractor_account_id_fkey') THEN
    ALTER TABLE public.incentive_applications ADD CONSTRAINT incentive_applications_contractor_account_id_fkey
      FOREIGN KEY (ia_contractor_account_id) REFERENCES public.accounts(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='incentive_applications_contractor_contact_id_fkey') THEN
    ALTER TABLE public.incentive_applications ADD CONSTRAINT incentive_applications_contractor_contact_id_fkey
      FOREIGN KEY (ia_contractor_contact_id) REFERENCES public.contacts(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='incentive_applications_support_contractor_account_id_fkey') THEN
    ALTER TABLE public.incentive_applications ADD CONSTRAINT incentive_applications_support_contractor_account_id_fkey
      FOREIGN KEY (ia_support_contractor_account_id) REFERENCES public.accounts(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='incentive_applications_support_contractor_contact_id_fkey') THEN
    ALTER TABLE public.incentive_applications ADD CONSTRAINT incentive_applications_support_contractor_contact_id_fkey
      FOREIGN KEY (ia_support_contractor_contact_id) REFERENCES public.contacts(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='incentive_applications_submitted_by_fkey') THEN
    ALTER TABLE public.incentive_applications ADD CONSTRAINT incentive_applications_submitted_by_fkey
      FOREIGN KEY (ia_submitted_by) REFERENCES public.users(id);
  END IF;
END $$;

-- 2) Fixed-option picklist columns (uuid → picklist_values.id) ------------------
ALTER TABLE public.incentive_applications
  ADD COLUMN IF NOT EXISTS ia_application_for            uuid,
  ADD COLUMN IF NOT EXISTS ia_building_type              uuid,
  ADD COLUMN IF NOT EXISTS ia_building_project_type      uuid,
  ADD COLUMN IF NOT EXISTS ia_income_level               uuid,
  ADD COLUMN IF NOT EXISTS ia_heating_type               uuid,
  ADD COLUMN IF NOT EXISTS ia_who_gets_paid              uuid,
  ADD COLUMN IF NOT EXISTS ia_tax_classification_type    uuid,
  ADD COLUMN IF NOT EXISTS ia_ssn_used                   uuid,
  ADD COLUMN IF NOT EXISTS ia_has_combustion_appliances  uuid,
  ADD COLUMN IF NOT EXISTS ia_venting_test               uuid,
  ADD COLUMN IF NOT EXISTS ia_spilling_test              uuid,
  ADD COLUMN IF NOT EXISTS ia_gas_leak_test              uuid,
  ADD COLUMN IF NOT EXISTS ia_undiluted_co_test          uuid,
  ADD COLUMN IF NOT EXISTS ia_ambient_co_test            uuid,
  ADD COLUMN IF NOT EXISTS ia_mold_moisture              uuid,
  ADD COLUMN IF NOT EXISTS ia_roof_condition             uuid,
  ADD COLUMN IF NOT EXISTS ia_ashrae_62_2                uuid,
  ADD COLUMN IF NOT EXISTS ia_drainage_condition         uuid,
  ADD COLUMN IF NOT EXISTS ia_disclosed_to_homeowner     uuid,
  ADD COLUMN IF NOT EXISTS ia_modeling_software          uuid;

-- 3) Plain columns (no parent home) --------------------------------------------
ALTER TABLE public.incentive_applications
  ADD COLUMN IF NOT EXISTS ia_in_unit_owner_name                    text,
  ADD COLUMN IF NOT EXISTS ia_email_for_tax_purposes                text,
  ADD COLUMN IF NOT EXISTS ia_payment_mailing_street                text,
  ADD COLUMN IF NOT EXISTS ia_payment_mailing_line2                 text,
  ADD COLUMN IF NOT EXISTS ia_payment_mailing_city                  text,
  ADD COLUMN IF NOT EXISTS ia_payment_mailing_state                 text,
  ADD COLUMN IF NOT EXISTS ia_payment_mailing_zip                   text,
  ADD COLUMN IF NOT EXISTS ia_final_modeled_savings                 numeric,
  ADD COLUMN IF NOT EXISTS ia_final_total_ira_homes_rebate_requested numeric,
  ADD COLUMN IF NOT EXISTS ia_final_total_ira_homes_cost            numeric,
  ADD COLUMN IF NOT EXISTS ia_project_completion_date               date,
  ADD COLUMN IF NOT EXISTS ia_work_completed                        jsonb;

-- 4) Seed picklists — EXACT JotForm option strings, ia_ prefix stripped ---------
INSERT INTO public.picklist_values
  (id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
SELECT gen_random_uuid(), 'incentive_applications', v.field, v.val, v.val, true, v.ord,
       'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM (VALUES
  -- I'm Applying for a(n)
  ('application_for','Project Reservation',1),
  ('application_for','Final Installation Payment Request',2),
  -- Building Type
  ('building_type','Existing',1),
  ('building_type','New Construction does not qualify for HOMES rebates',2),
  -- Building Project Type
  ('building_project_type','Single Family/Townhouse/Rowhouse',1),
  ('building_project_type','Multifamily - In Unit',2),
  ('building_project_type','Multifamily - Central 2-4 Units',3),
  ('building_project_type','Multifamily - Central 5 Units',4),
  -- Which income level is your customer approved at?
  ('income_level','Low-Income',1),
  ('income_level','Moderate',2),
  -- How is this building heated?
  ('heating_type','Electric',1),
  ('heating_type','Natural Gas',2),
  ('heating_type','Propane',3),
  ('heating_type','Fuel Oil',4),
  ('heating_type','Wood',5),
  -- Who gets paid?
  ('who_gets_paid','Registered Contractor',1),
  ('who_gets_paid','Multifamily Building Owner',2),
  ('who_gets_paid','In-Unit Owner',3),
  -- Tax Classification
  ('tax_classification_type','Individual',1),
  ('tax_classification_type','Sole Proprietorship',2),
  ('tax_classification_type','Partnership',3),
  ('tax_classification_type','C Corporation',4),
  ('tax_classification_type','S Corporation',5),
  ('tax_classification_type','Limited Liability Company (LLC)',6),
  ('tax_classification_type','Nonprofit',7),
  -- Is a SSN used as your Tax Identification Number?
  ('ssn_used','Yes',1),
  ('ssn_used','No',2),
  -- Does the home have one or more combustion appliances at test-out?
  ('has_combustion_appliances','Yes',1),
  ('has_combustion_appliances','No',2),
  -- Health & Safety test dropdowns (shared option set, exact strings)
  ('venting_test','Passed',1),('venting_test','Warning',2),('venting_test','Failed',3),('venting_test','N/A',4),
  ('spilling_test','Passed',1),('spilling_test','Warning',2),('spilling_test','Failed',3),('spilling_test','N/A',4),
  ('gas_leak_test','Passed',1),('gas_leak_test','Warning',2),('gas_leak_test','Failed',3),('gas_leak_test','N/A',4),
  ('undiluted_co_test','Passed',1),('undiluted_co_test','Warning',2),('undiluted_co_test','Failed',3),('undiluted_co_test','N/A',4),
  ('ambient_co_test','Passed',1),('ambient_co_test','Warning',2),('ambient_co_test','Failed',3),('ambient_co_test','N/A',4),
  -- Signs of mold or moisture?
  ('mold_moisture','Yes',1),('mold_moisture','No',2),
  -- Roof condition
  ('roof_condition','Good',1),('roof_condition','Potential Problems',2),
  -- ASHRAE 62.2 performed? (form uses lowercase yes/no)
  ('ashrae_62_2','yes',1),('ashrae_62_2','no',2),
  -- Drainage system condition
  ('drainage_condition','Good',1),('drainage_condition','Potential Problems',2),
  -- Disclosed to homeowner?
  ('disclosed_to_homeowner','Yes',1),('disclosed_to_homeowner','No',2),
  -- Modeling Software Used
  ('modeling_software','Snugg Pro',1),
  ('modeling_software','Optimizer',2),
  ('modeling_software','eQuest',3),
  ('modeling_software','Energy Plus',4),
  ('modeling_software','TREAT',5)
) AS v(field, val, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
  WHERE p.picklist_object='incentive_applications' AND p.picklist_field=v.field
    AND p.picklist_value=v.val
);
