-- Enrollment WI-IRA-MF-HOMES-Project-Reservation: full submittal-form layout.
--
-- Mirrors the "IRA HOMES Multifamily Project Submittal" JotForm so internal
-- users complete + verify the reservation inside LEAP (a Chrome extension will
-- later push it to the program's JotForm). Follows the inherited-field pattern
-- established for enrollments/incentive_applications (migrations 20260729031631
-- / 20260729153704): fields that live on the building / property / opportunity
-- are shown as read-only related_fields (never copied onto the child); only the
-- values with no parent home become real enrollment columns.
--
-- Order matters: add the building_id FK FIRST (related_field validation resolves
-- FKs via pg_constraint), THEN rebuild the layout that references building_id.<col>.

-- 1) Building lookup so building.* fields inherit onto the enrollment ----------
ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS building_id uuid;
COMMENT ON COLUMN public.enrollments.building_id IS 'Building this reservation is for. Drives building.* inherited fields (units, sq ft, floors, year built, electric account). Auto-set from the opportunity''s building on create.';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='enrollments_building_id_fkey') THEN
    ALTER TABLE public.enrollments
      ADD CONSTRAINT enrollments_building_id_fkey
      FOREIGN KEY (building_id) REFERENCES public.buildings(id);
  END IF;
END $$;

-- 2) New enrollment columns (no parent source) --------------------------------
ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS enrollment_building_project_type       uuid,
  ADD COLUMN IF NOT EXISTS enrollment_contractor_contact_id       uuid,
  ADD COLUMN IF NOT EXISTS enrollment_has_support_contractor      boolean,
  ADD COLUMN IF NOT EXISTS enrollment_support_contractor_account_id uuid,
  ADD COLUMN IF NOT EXISTS enrollment_estimated_completion_date   date,
  ADD COLUMN IF NOT EXISTS enrollment_payee                       uuid,
  ADD COLUMN IF NOT EXISTS enrollment_tax_classification          uuid,
  ADD COLUMN IF NOT EXISTS enrollment_modeling_software           uuid,
  ADD COLUMN IF NOT EXISTS enrollment_total_project_cost          numeric,
  ADD COLUMN IF NOT EXISTS enrollment_total_ira_homes_cost        numeric,
  ADD COLUMN IF NOT EXISTS enrollment_modeled_savings             numeric;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='enrollments_contractor_contact_id_fkey') THEN
    ALTER TABLE public.enrollments ADD CONSTRAINT enrollments_contractor_contact_id_fkey
      FOREIGN KEY (enrollment_contractor_contact_id) REFERENCES public.contacts(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='enrollments_support_contractor_account_id_fkey') THEN
    ALTER TABLE public.enrollments ADD CONSTRAINT enrollments_support_contractor_account_id_fkey
      FOREIGN KEY (enrollment_support_contractor_account_id) REFERENCES public.accounts(id);
  END IF;
END $$;

-- 3) Picklist values for the new picklist columns -----------------------------
--    Prefix-stripped picklist_field spelling (matches enrollment_property_type
--    -> 'property_type', enrollment_modeling_approach -> 'modeling_approach').
INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_sort_order)
VALUES
  ('enrollments','building_project_type','Central Multifamily','Central Multifamily',1),
  ('enrollments','building_project_type','In-Unit','In-Unit',2),
  ('enrollments','payee','Primary Contractor','Primary Contractor',1),
  ('enrollments','payee','Building Owner','Building Owner',2),
  ('enrollments','payee','Property Owner','Property Owner',3),
  ('enrollments','tax_classification','Individual / Sole Proprietor','Individual / Sole Proprietor',1),
  ('enrollments','tax_classification','C Corporation','C Corporation',2),
  ('enrollments','tax_classification','S Corporation','S Corporation',3),
  ('enrollments','tax_classification','Partnership','Partnership',4),
  ('enrollments','tax_classification','Trust / Estate','Trust / Estate',5),
  ('enrollments','tax_classification','Limited Liability Company','Limited Liability Company',6),
  ('enrollments','tax_classification','Non-Profit / Tax-Exempt','Non-Profit / Tax-Exempt',7),
  ('enrollments','modeling_software','Snugg Pro','Snugg Pro',1),
  ('enrollments','modeling_software','Optimizer','Optimizer',2),
  ('enrollments','modeling_software','eQuest','eQuest',3),
  ('enrollments','modeling_software','EnergyPlus','EnergyPlus',4),
  ('enrollments','modeling_software','TREAT','TREAT',5),
  ('enrollments','modeling_software','DOE','DOE',6)
ON CONFLICT DO NOTHING;

-- 4) Backfill building_id from each enrollment's opportunity ------------------
UPDATE public.enrollments e
SET building_id = o.building_id
FROM public.opportunities o
WHERE e.opportunity_id = o.id
  AND o.building_id IS NOT NULL
  AND e.building_id IS NULL
  AND e.enrollment_is_deleted IS NOT TRUE;

-- 5) Seed the overridable roll-ups from the opportunity's line items ----------
--    Editable columns (not hard roll-ups) — users adjust when needed. Seeded
--    from the current line-item totals so they open populated.
UPDATE public.enrollments e
SET enrollment_total_project_cost = COALESCE(e.enrollment_total_project_cost, s.total_cost),
    enrollment_total_ira_homes_cost = COALESCE(e.enrollment_total_ira_homes_cost, s.total_cost),
    enrollment_modeled_savings = COALESCE(e.enrollment_modeled_savings, s.total_savings)
FROM (
  SELECT oli.opportunity_id,
         SUM(oli.oli_total_price)         AS total_cost,
         SUM(oli.oli_estimated_term_savings) AS total_savings
  FROM public.opportunity_line_items oli
  WHERE oli.oli_is_deleted IS NOT TRUE
  GROUP BY oli.opportunity_id
) s
WHERE e.opportunity_id = s.opportunity_id
  AND e.enrollment_is_deleted IS NOT TRUE;

-- 6) Re-derive stale names to "<property> - <enrollment record type>" ---------
--    The derive trigger already uses the enrollment's OWN record type; older
--    rows just carry a pre-trigger name (e.g. ENR-00003 showed
--    "...WI-IRA-MF-HOMES-PROJECT" instead of "...WI-IRA-MF-HOMES-Project-Reservation").
UPDATE public.enrollments e
SET enrollment_name = NULLIF(trim(both ' -' FROM (
      coalesce((SELECT property_name FROM properties WHERE id = e.property_id), '')
      || CASE WHEN (SELECT picklist_label FROM picklist_values WHERE id = e.enrollment_record_type) IS NOT NULL
              THEN ' - ' || (SELECT picklist_label FROM picklist_values WHERE id = e.enrollment_record_type)
              ELSE '' END)), '')
WHERE e.enrollment_is_deleted IS NOT TRUE
  AND coalesce((SELECT property_name FROM properties WHERE id = e.property_id), '') <> '';

-- 7) Rebuild the WI-IRA-MF-HOMES-Project-Reservation layout -------------------
DO $$
DECLARE
  v_layout uuid := '94af9c5b-bd66-43e4-b348-f4781efce547';
  s_enroll   uuid := gen_random_uuid();
  s_apptype  uuid := gen_random_uuid();
  s_contr    uuid := gen_random_uuid();
  s_install  uuid := gen_random_uuid();
  s_utility  uuid := gen_random_uuid();
  s_improve  uuid := gen_random_uuid();
  s_payment  uuid := gen_random_uuid();
  s_submit   uuid := gen_random_uuid();
  s_docs     uuid := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM page_layouts WHERE id=v_layout AND NOT is_deleted) THEN
    RAISE EXCEPTION 'WI-IRA-MF-HOMES-Project-Reservation layout % not found', v_layout;
  END IF;

  UPDATE page_layout_widgets SET is_deleted=true, updated_at=now()
   WHERE page_layout_id=v_layout AND is_deleted IS NOT TRUE;
  UPDATE page_layout_sections SET is_deleted=true,
         deletion_reason='Rebuilt to mirror the IRA HOMES Project Submittal form', updated_at=now()
   WHERE page_layout_id=v_layout AND is_deleted IS NOT TRUE;

  INSERT INTO page_layout_sections (id, page_layout_id, section_order, section_label, section_columns, section_tab, section_placement, is_deleted) VALUES
    (s_enroll,  v_layout, 1, 'Enrollment',                       2, 'Details', 'main', false),
    (s_apptype, v_layout, 2, 'Application Type',                 2, 'Details', 'main', false),
    (s_contr,   v_layout, 3, 'Primary Contractor Information',   2, 'Details', 'main', false),
    (s_install, v_layout, 4, 'Installation Building Information',2, 'Details', 'main', false),
    (s_utility, v_layout, 5, 'Utility Information',              2, 'Details', 'main', false),
    (s_improve, v_layout, 6, 'Building Improvements',            2, 'Details', 'main', false),
    (s_payment, v_layout, 7, 'Payment Information',              2, 'Details', 'main', false),
    (s_submit,  v_layout, 8, 'Submission',                       2, 'Details', 'main', false),
    (s_docs,    v_layout, 9, 'Supporting Documentation',         1, 'Related', 'main', false);

  -- Section 1: Enrollment identity (Name is auto-derived; no typed field)
  INSERT INTO page_layout_widgets (page_layout_widget_record_number, page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_config) VALUES
  ('', v_layout, s_enroll, 'status_path', 'Status Path', 1, 1,
   '{"status_field":"enrollment_status","show_guidance":true,"show_completed_count":true}'::jsonb),
  ('', v_layout, s_enroll, 'field_group', 'Enrollment', 1, 2,
   '{"fields":[
      {"name":"property_id","type":"lookup","label":"Property","required":true,"column":1,"lookup_table":"properties","lookup_field":"property_name"},
      {"name":"opportunity_id","type":"lookup","label":"Opportunity","column":1,"lookup_table":"opportunities","lookup_field":"opportunity_name","lookup_dependency":{"kind":"opportunities_for_property","depends_on":["property_id"]}},
      {"name":"building_id","type":"lookup","label":"Building","column":1,"lookup_table":"buildings","lookup_field":"building_name"},
      {"name":"enrollment_record_type","type":"picklist","label":"Record Type","column":2},
      {"name":"enrollment_status","type":"picklist","label":"Status","column":2},
      {"name":"enrollment_owner","type":"lookup","label":"Owner","column":2,"lookup_table":"users","lookup_field":"user_name"}
   ]}'::jsonb),

  -- Section 2: Application Type
  ('', v_layout, s_apptype, 'field_group', 'Application Type', 1, 1,
   '{"fields":[
      {"name":"enrollment_building_project_type","type":"picklist","label":"Building Project Type","column":1,"help_text":"Central Multifamily = shared building upgrades that benefit more than one unit."},
      {"name":"building_id.building_type","type":"related_field","label":"Building Type","column":2,"related":{"table":"buildings","column":"building_type","fk_column":"building_id","column_type":"picklist"}}
   ]}'::jsonb),

  -- Section 3: Primary Contractor Information (account + read-only related fields)
  ('', v_layout, s_contr, 'field_group', 'Primary Contractor Information', 1, 1,
   '{"fields":[
      {"name":"enrollment_contractor_account_id","type":"lookup","label":"Primary Contractor","column":1,"lookup_table":"accounts","lookup_field":"account_name"},
      {"name":"enrollment_contractor_account_id.account_name","type":"related_field","label":"Business Name","column":1,"related":{"table":"accounts","column":"account_name","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_contractor_contact_id","type":"lookup","label":"Contractor Contact","column":2,"lookup_table":"contacts","lookup_field":"contact_name"},
      {"name":"enrollment_contractor_account_id.account_email","type":"related_field","label":"Email","column":1,"related":{"table":"accounts","column":"account_email","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_contractor_account_id.account_phone","type":"related_field","label":"Phone","column":2,"related":{"table":"accounts","column":"account_phone","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_contractor_account_id.billing_street","type":"related_field","label":"Address","column":1,"related":{"table":"accounts","column":"billing_street","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_contractor_account_id.billing_city","type":"related_field","label":"City","column":1,"related":{"table":"accounts","column":"billing_city","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_contractor_account_id.billing_state","type":"related_field","label":"State","column":2,"related":{"table":"accounts","column":"billing_state","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_contractor_account_id.billing_zip","type":"related_field","label":"ZIP","column":2,"related":{"table":"accounts","column":"billing_zip","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_has_support_contractor","type":"boolean","label":"Will a support contractor also complete work?","column":1},
      {"name":"enrollment_support_contractor_account_id","type":"lookup","label":"Support Contractor","column":2,"lookup_table":"accounts","lookup_field":"account_name"}
   ]}'::jsonb),

  -- Section 4: Installation Building Information (owner from property, building metrics from building)
  ('', v_layout, s_install, 'field_group', 'Installation Building Information', 1, 1,
   '{"fields":[
      {"name":"property_id.property_hud_owner_org","type":"related_field","label":"Business Entity Name","column":1,"related":{"table":"properties","column":"property_hud_owner_org","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_mfown_raw_owner_individual_full_name","type":"related_field","label":"Building Owner Name","column":2,"related":{"table":"properties","column":"property_mfown_raw_owner_individual_full_name","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_hud_owner_email","type":"related_field","label":"Owner Email","column":1,"related":{"table":"properties","column":"property_hud_owner_email","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_hud_owner_phone","type":"related_field","label":"Owner Phone","column":2,"related":{"table":"properties","column":"property_hud_owner_phone","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_street","type":"related_field","label":"Installation Address","column":1,"related":{"table":"properties","column":"property_street","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_city","type":"related_field","label":"City","column":1,"related":{"table":"properties","column":"property_city","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_state","type":"related_field","label":"State","column":2,"related":{"table":"properties","column":"property_state","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_zip","type":"related_field","label":"ZIP","column":2,"related":{"table":"properties","column":"property_zip","fk_column":"property_id","column_type":"text"}},
      {"name":"building_id.building_total_units","type":"related_field","label":"Total Number of Units","column":1,"related":{"table":"buildings","column":"building_total_units","fk_column":"building_id","column_type":"number"}},
      {"name":"enrollment_occupied_units","type":"integer","label":"Total Number of Occupied Units","column":2},
      {"name":"building_id.building_square_footage","type":"related_field","label":"Total Building Square Footage","column":1,"related":{"table":"buildings","column":"building_square_footage","fk_column":"building_id","column_type":"number"}},
      {"name":"building_id.building_stories","type":"related_field","label":"Total Floors in Building","column":2,"related":{"table":"buildings","column":"building_stories","fk_column":"building_id","column_type":"number"}},
      {"name":"building_id.building_year_built","type":"related_field","label":"Year the Building was Built","column":1,"related":{"table":"buildings","column":"building_year_built","fk_column":"building_id","column_type":"number"}},
      {"name":"opportunity_id.opportunity_ami_tier","type":"related_field","label":"Income Level Approved","column":2,"related":{"table":"opportunities","column":"opportunity_ami_tier","fk_column":"opportunity_id","column_type":"picklist"}},
      {"name":"opportunity_id.opportunity_income_qualified_confirmation_code","type":"related_field","label":"Income-Qualified Confirmation Code","column":1,"related":{"table":"opportunities","column":"opportunity_income_qualified_confirmation_code","fk_column":"opportunity_id","column_type":"text"}}
   ]}'::jsonb),

  -- Section 5: Utility Information
  ('', v_layout, s_utility, 'field_group', 'Utility Information', 1, 1,
   '{"fields":[
      {"name":"property_id.property_electric_utility","type":"related_field","label":"Electric Provider","column":1,"related":{"table":"properties","column":"property_electric_utility","fk_column":"property_id","column_type":"text"}},
      {"name":"building_id.building_electric_account_number","type":"related_field","label":"Electric Account Number","column":2,"related":{"table":"buildings","column":"building_electric_account_number","fk_column":"building_id","column_type":"text"}},
      {"name":"property_id.property_heating_fuel_type","type":"related_field","label":"How is this building heated?","column":1,"related":{"table":"properties","column":"property_heating_fuel_type","fk_column":"property_id","column_type":"text"}}
   ]}'::jsonb),

  -- Section 6: Building Improvements (overridable roll-ups seeded from line items)
  ('', v_layout, s_improve, 'field_group', 'Building Improvements', 1, 1,
   '{"fields":[
      {"name":"enrollment_building_details","type":"textarea","label":"What work will be completed?","column":1},
      {"name":"enrollment_requested_incentive_amount","type":"currency","label":"Total IRA HOMES Rebate Requested","column":2},
      {"name":"enrollment_total_ira_homes_cost","type":"currency","label":"Total IRA HOMES Cost","column":2},
      {"name":"enrollment_total_project_cost","type":"currency","label":"Total Project Cost","column":1},
      {"name":"enrollment_modeled_savings","type":"currency","label":"Modeled Savings Predicted","column":1},
      {"name":"enrollment_estimated_completion_date","type":"date","label":"Estimated Completion Date","column":2}
   ]}'::jsonb),

  -- Section 7: Payment Information
  ('', v_layout, s_payment, 'field_group', 'Payment Information', 1, 1,
   '{"fields":[
      {"name":"enrollment_payee","type":"picklist","label":"Who gets paid?","column":1},
      {"name":"enrollment_tax_classification","type":"picklist","label":"Tax Classification","column":2},
      {"name":"property_id.fein","type":"related_field","label":"Tax Identification FEIN","column":1,"related":{"table":"properties","column":"fein","fk_column":"property_id","column_type":"text"}},
      {"name":"enrollment_payment_address_different","type":"boolean","label":"Mailing address different from primary?","column":1},
      {"name":"enrollment_payment_address_line1","type":"text","label":"Mailing Address","column":1},
      {"name":"enrollment_payment_city","type":"text","label":"City","column":1},
      {"name":"enrollment_payment_state","type":"text","label":"State","column":2},
      {"name":"enrollment_payment_zip","type":"text","label":"ZIP","column":2}
   ]}'::jsonb),

  -- Section 8: Submission
  ('', v_layout, s_submit, 'field_group', 'Submission', 1, 1,
   '{"fields":[
      {"name":"enrollment_modeling_software","type":"picklist","label":"Modeling Software Used","column":1},
      {"name":"enrollment_notes","type":"textarea","label":"Notes","column":2}
   ]}'::jsonb),

  -- Section 9: Supporting Documentation (Related tab) — one typed slot per required upload
  ('', v_layout, s_docs, 'file_gallery', 'Reservation HPXMLv4 / BuildingSync File', 1, 1,
   '{"target":"documents","document_type":"reservation_hpxml"}'::jsonb),
  ('', v_layout, s_docs, 'file_gallery', 'Audit Template Report', 1, 2,
   '{"target":"documents","document_type":"audit_template_report"}'::jsonb),
  ('', v_layout, s_docs, 'file_gallery', 'Reservation Customer Report (PDF)', 1, 3,
   '{"target":"documents","document_type":"reservation_customer_report"}'::jsonb),
  ('', v_layout, s_docs, 'file_gallery', 'Customer Contract Scope of Work', 1, 4,
   '{"target":"documents","document_type":"customer_contract_sow"}'::jsonb),
  ('', v_layout, s_docs, 'file_gallery', 'Low-Income Building Owner Acknowledgment Form', 1, 5,
   '{"target":"documents","document_type":"li_owner_acknowledgment"}'::jsonb);
END $$;

NOTIFY pgrst, 'reload schema';
