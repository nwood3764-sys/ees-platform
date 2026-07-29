-- Project-Reservation enrollment layout: two-column sections matching the
-- JotForm's column structure (paired fields left/right), Submission single
-- column. Full rebuild that also preserves the corrected inherited sources
-- (Installation Contact = the opportunity signer; owner email/phone) and the
-- radio/multiselect input types.

DO $$
DECLARE
  v_layout uuid := '94af9c5b-bd66-43e4-b348-f4781efce547';
  s_enroll  uuid := gen_random_uuid();
  s_appl    uuid := gen_random_uuid();
  s_contr   uuid := gen_random_uuid();
  s_install uuid := gen_random_uuid();
  s_utility uuid := gen_random_uuid();
  s_improve uuid := gen_random_uuid();
  s_payment uuid := gen_random_uuid();
  s_docs    uuid := gen_random_uuid();
  s_submit  uuid := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM page_layouts WHERE id=v_layout AND NOT is_deleted) THEN
    RAISE EXCEPTION 'layout % not found', v_layout;
  END IF;

  UPDATE page_layout_widgets SET is_deleted=true, updated_at=now()
   WHERE page_layout_id=v_layout AND is_deleted IS NOT TRUE;
  UPDATE page_layout_sections SET is_deleted=true,
         deletion_reason='Two-column layout matching the JotForm', updated_at=now()
   WHERE page_layout_id=v_layout AND is_deleted IS NOT TRUE;

  INSERT INTO page_layout_sections (id, page_layout_id, section_order, section_label, section_columns, section_tab, section_placement, is_deleted) VALUES
    (s_enroll,  v_layout, 1, 'Enrollment',                        2, 'Details', 'main', false),
    (s_appl,    v_layout, 2, 'Application',                       2, 'Details', 'main', false),
    (s_contr,   v_layout, 3, 'Primary Contractor Information',    2, 'Details', 'main', false),
    (s_install, v_layout, 4, 'Installation Building Information', 2, 'Details', 'main', false),
    (s_utility, v_layout, 5, 'Utility Information',               2, 'Details', 'main', false),
    (s_improve, v_layout, 6, 'Building Improvements',             2, 'Details', 'main', false),
    (s_payment, v_layout, 7, 'Payment Information',               2, 'Details', 'main', false),
    (s_docs,    v_layout, 8, 'Supporting Documentation',          2, 'Details', 'main', false),
    (s_submit,  v_layout, 9, 'Submission',                        1, 'Details', 'main', false);

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

  ('', v_layout, s_appl, 'field_group', 'Application', 1, 1,
   '{"fields":[
      {"name":"enrollment_application_for","type":"picklist","display":"radio","label":"I''m Applying for a(n)","column":1},
      {"name":"enrollment_building_type","type":"picklist","display":"radio","label":"Building Type","column":2},
      {"name":"enrollment_building_project_type","type":"picklist","display":"radio","label":"Building Project Type","column":1,"help_text":"Central Multifamily must be used when the reservation is for shared building upgrades that benefit more than one unit in a multifamily building."}
   ]}'::jsonb),

  ('', v_layout, s_contr, 'field_group', 'Primary Contractor Information', 1, 1,
   '{"fields":[
      {"name":"enrollment_contractor_account_id","type":"lookup","label":"Primary Contractor","column":1,"lookup_table":"accounts","lookup_field":"account_name"},
      {"name":"enrollment_contractor_account_id.account_name","type":"related_field","label":"Primary Contractor Business Name","column":1,"related":{"table":"accounts","column":"account_name","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_contractor_contact_id","type":"lookup","label":"Primary Contractor Contact Name","column":2,"lookup_table":"contacts","lookup_field":"contact_name"},
      {"name":"enrollment_contractor_account_id.account_email","type":"related_field","label":"Primary Contractor Email","column":1,"related":{"table":"accounts","column":"account_email","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_contractor_account_id.account_phone","type":"related_field","label":"Primary Contractor Phone Number","column":2,"related":{"table":"accounts","column":"account_phone","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_contractor_account_id.billing_street","type":"related_field","label":"Primary Contractor Address","column":1,"related":{"table":"accounts","column":"billing_street","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_contractor_account_id.billing_city","type":"related_field","label":"City","column":1,"related":{"table":"accounts","column":"billing_city","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_contractor_account_id.billing_state","type":"related_field","label":"State / Province","column":2,"related":{"table":"accounts","column":"billing_state","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_contractor_account_id.billing_zip","type":"related_field","label":"Postal / Zip Code","column":2,"related":{"table":"accounts","column":"billing_zip","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_has_support_contractor","type":"boolean","label":"Will a Support Contractor also be completing work on this project? Only IRA-registered contractors may perform work on IRA HOMES projects.","column":1},
      {"name":"enrollment_support_contractor_account_id","type":"lookup","label":"Support Contractor","column":2,"lookup_table":"accounts","lookup_field":"account_name"}
   ]}'::jsonb),

  ('', v_layout, s_install, 'field_group', 'Installation Building Information', 1, 1,
   '{"fields":[
      {"name":"property_id.property_hud_owner_org","type":"related_field","label":"Business Entity Name","column":1,"related":{"table":"properties","column":"property_hud_owner_org","fk_column":"property_id","column_type":"text"}},
      {"name":"enrollment_signer_contact_id","type":"lookup","label":"Contact Name","column":2,"lookup_table":"contacts","lookup_field":"contact_name"},
      {"name":"enrollment_signer_contact_id.contact_email","type":"related_field","label":"Email","column":1,"related":{"table":"contacts","column":"contact_email","fk_column":"enrollment_signer_contact_id","column_type":"text"}},
      {"name":"enrollment_signer_contact_id.contact_phone","type":"related_field","label":"Phone Number","column":2,"related":{"table":"contacts","column":"contact_phone","fk_column":"enrollment_signer_contact_id","column_type":"text"}},
      {"name":"property_id.property_hud_owner_org","type":"related_field","label":"Building Owner Name","column":1,"related":{"table":"properties","column":"property_hud_owner_org","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_street","type":"related_field","label":"Installation Address","column":1,"related":{"table":"properties","column":"property_street","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_city","type":"related_field","label":"City","column":1,"related":{"table":"properties","column":"property_city","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_state","type":"related_field","label":"State / Province","column":2,"related":{"table":"properties","column":"property_state","fk_column":"property_id","column_type":"text"}},
      {"name":"property_id.property_zip","type":"related_field","label":"Postal / Zip Code","column":2,"related":{"table":"properties","column":"property_zip","fk_column":"property_id","column_type":"text"}},
      {"name":"building_id.building_total_units","type":"related_field","label":"Total Number of Units","column":1,"related":{"table":"buildings","column":"building_total_units","fk_column":"building_id","column_type":"number"}},
      {"name":"enrollment_occupied_units","type":"integer","label":"Total Number of Occupied Units","column":2},
      {"name":"building_id.building_square_footage","type":"related_field","label":"Total Building Square Footage","column":1,"related":{"table":"buildings","column":"building_square_footage","fk_column":"building_id","column_type":"number"}},
      {"name":"building_id.building_stories","type":"related_field","label":"Total Floors in Building","column":2,"related":{"table":"buildings","column":"building_stories","fk_column":"building_id","column_type":"number"}},
      {"name":"building_id.building_year_built","type":"related_field","label":"Year the Building was Built","column":1,"related":{"table":"buildings","column":"building_year_built","fk_column":"building_id","column_type":"number"}},
      {"name":"enrollment_income_level","type":"picklist","display":"radio","label":"Which income level is your customer approved at?","column":2},
      {"name":"building_id.ira_confirmation_code_lea","type":"related_field","label":"Income-Qualified Confirmation Code","column":1,"help_text":"Confirmation Code must match installation address approved.","related":{"table":"buildings","column":"ira_confirmation_code_lea","fk_column":"building_id","column_type":"text"}},
      {"name":"enrollment_total_project_cost","type":"currency","label":"Total Project Cost","column":2}
   ]}'::jsonb),

  ('', v_layout, s_utility, 'field_group', 'Utility Information', 1, 1,
   '{"fields":[
      {"name":"property_id.property_electric_utility","type":"related_field","label":"Electric Provider","column":1,"related":{"table":"properties","column":"property_electric_utility","fk_column":"property_id","column_type":"text"}},
      {"name":"building_id.building_electric_account_number","type":"related_field","label":"Electric Account Number","column":2,"related":{"table":"buildings","column":"building_electric_account_number","fk_column":"building_id","column_type":"text"}},
      {"name":"enrollment_heating_type","type":"picklist","display":"radio","label":"How is this building heated?","column":1}
   ]}'::jsonb),

  ('', v_layout, s_improve, 'field_group', 'Building Improvements', 1, 1,
   '{"fields":[
      {"name":"enrollment_work_measures","type":"multiselect","label":"What work will be completed?","column":1,"help_text":"Improvements must be shown on the model provided to be included.","options":[
        {"value":"Air Sealing","label":"Air Sealing"},
        {"value":"Ceiling Insulation","label":"Ceiling Insulation"},
        {"value":"Duct Insulation","label":"Duct Insulation"},
        {"value":"Duct Sealing","label":"Duct Sealing"},
        {"value":"Floor Insulation","label":"Floor Insulation"},
        {"value":"Foundation Insulation","label":"Foundation Insulation"},
        {"value":"Wall Insulation","label":"Wall Insulation"},
        {"value":"Ventilation System","label":"Ventilation System"},
        {"value":"ENERGY STAR Window, Door, Skylight Replacement","label":"ENERGY STAR Window, Door, Skylight Replacement"},
        {"value":"ENERGY STAR Water Heater","label":"ENERGY STAR Water Heater"},
        {"value":"ENERGY STAR Cooling Equipment","label":"ENERGY STAR Cooling Equipment"},
        {"value":"ENERGY STAR Heating Equipment","label":"ENERGY STAR Heating Equipment"},
        {"value":"ENERGY STAR Appliance Replacement","label":"ENERGY STAR Appliance Replacement"},
        {"value":"Replace HVAC PSZ HP + DOAS","label":"Replace HVAC PSZ HP + DOAS"},
        {"value":"Upgrade to High-Efficiency Chiller","label":"Upgrade to High-Efficiency Chiller"},
        {"value":"High Efficiency Rooftop Heat Pump Replacement","label":"High Efficiency Rooftop Heat Pump Replacement"},
        {"value":"Replace HVAC with VRF + DOAS","label":"Replace HVAC with VRF + DOAS"},
        {"value":"High Efficiency PTAC Replacement","label":"High Efficiency PTAC Replacement"},
        {"value":"High Efficiency WLHP Replacement","label":"High Efficiency WLHP Replacement"},
        {"value":"Replace HVAC with WLHP + DOAS","label":"Replace HVAC with WLHP + DOAS"},
        {"value":"High Efficiency PTHP Replacement","label":"High Efficiency PTHP Replacement"},
        {"value":"High Efficiency Rooftop AC Replacement","label":"High Efficiency Rooftop AC Replacement"},
        {"value":"Upgrade to High-Efficiency Boiler","label":"Upgrade to High-Efficiency Boiler"},
        {"value":"Water Saving Measures","label":"Water Saving Measures"}
      ]},
      {"name":"enrollment_requested_incentive_amount","type":"currency","label":"Total IRA HOMES Rebate Requested","column":1},
      {"name":"enrollment_total_ira_homes_cost","type":"currency","label":"Total IRA HOMES Cost","column":2},
      {"name":"enrollment_modeled_savings","type":"currency","label":"Modeled Savings Predicted","column":1},
      {"name":"enrollment_estimated_completion_date","type":"date","label":"Estimated Completion Date","column":2}
   ]}'::jsonb),

  ('', v_layout, s_payment, 'field_group', 'Payment Information', 1, 1,
   '{"fields":[
      {"name":"enrollment_payee","type":"picklist","display":"radio","label":"Who gets paid?","column":1,"help_text":"Please provide the tax information for who is receiving the rebate."},
      {"name":"enrollment_tax_classification","type":"picklist","display":"radio","label":"Tax Classification","column":1},
      {"name":"property_id.fein","type":"related_field","label":"Tax Identification FEIN","column":2,"related":{"table":"properties","column":"fein","fk_column":"property_id","column_type":"text"}},
      {"name":"enrollment_payment_address_different","type":"boolean","label":"Mailing address different from Primary Contractor address?","column":1},
      {"name":"enrollment_payment_address_line1","type":"text","label":"Mailing Address","column":1},
      {"name":"enrollment_payment_city","type":"text","label":"City","column":1},
      {"name":"enrollment_payment_state","type":"text","label":"State / Province","column":2},
      {"name":"enrollment_payment_zip","type":"text","label":"Postal / Zip Code","column":2}
   ]}'::jsonb),

  ('', v_layout, s_docs, 'file_gallery', 'Reservation HPXMLv4 / BuildingSync File', 1, 1,
   '{"target":"documents","document_type":"reservation_hpxml","help_text":"Building Sync File REQUIRED for 5+ Unit buildings."}'::jsonb),
  ('', v_layout, s_docs, 'file_gallery', 'Audit Template Report', 2, 2,
   '{"target":"documents","document_type":"audit_template_report","help_text":"An ASHRAE Level II Energy Audit is REQUIRED for buildings with 5 or more units."}'::jsonb),
  ('', v_layout, s_docs, 'file_gallery', 'Reservation Customer Report (PDF) — e.g. SnuggPro / Building Assessment Tool Report', 1, 3,
   '{"target":"documents","document_type":"reservation_customer_report"}'::jsonb),
  ('', v_layout, s_docs, 'file_gallery', 'Customer Contract Scope of Work', 2, 4,
   '{"target":"documents","document_type":"customer_contract_sow"}'::jsonb),
  ('', v_layout, s_docs, 'file_gallery', 'Low-Income Building Owner Acknowledgment Form', 1, 5,
   '{"target":"documents","document_type":"li_owner_acknowledgment","help_text":"Required for all Low-Income Multifamily projects."}'::jsonb),

  ('', v_layout, s_submit, 'field_group', 'Submission', 1, 1,
   '{"fields":[
      {"name":"enrollment_submitted_by","type":"lookup","label":"Who is submitting this form?","column":1,"lookup_table":"users","lookup_field":"user_name"},
      {"name":"enrollment_modeling_software","type":"picklist","label":"Modeling Software Used","column":1,"help_text":"DOE required field if modeled."}
   ]}'::jsonb);
END $$;

NOTIFY pgrst, 'reload schema';
