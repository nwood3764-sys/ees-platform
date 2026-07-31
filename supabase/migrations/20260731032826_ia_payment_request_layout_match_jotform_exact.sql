-- Project Payment Request layout — match the "IRA HOMES Multifamily Project
-- Submittal Form" JotForm (Final Installation Payment Request path) field-for-
-- field, place-for-place. Authoritative source: the re-uploaded PDF.
--
-- Changes in this pass:
--   * REMOVE the Utility Information section entirely — there is no utility
--     section on the payment JotForm. Trailing sections renumber to close the
--     gap (Building Improvements 6, Payment 7, Health & Safety 8, Supporting 9).
--   * Every field_group switches to the renderer's row-major layout (layout:
--     'rows'): fields flow in reading order across a 2-column grid, `column: 2`
--     pins the right slot, and `full_width: true` spans the whole width. This
--     lets address blocks stack (Street / City / State / Zip each full width)
--     exactly like the JotForm's multi-line address widgets, and radio/checkbox
--     questions span the row — replacing the old column-fill + spacer hack that
--     mis-paired fields.
--   * Payment Information: drop the SSN-used and Email-for-Tax fields (not on
--     the payment JotForm); order the widgets Who-gets-paid/Tax → Upload W9 →
--     Check-if-same + Mailing Address; add the "same as Primary Contractor
--     Address" checkbox that appears above the mailing address on the form.
--   * Supporting Documentation: drop the three uploads not on the JotForm (IRA
--     Notification of Combustion Safety Form, Low-Income Building Owner
--     Acknowledgment Form, Customer Contract Scope of Work) and the
--     "Who is submitting this form?" field; keep the eight JotForm uploads plus
--     Modeling Software, ordered to match the form.
--   * Value inheritance is unchanged — the same parent sources as the enrollment
--     reservation (property / building / signer contact / contractor account).

ALTER TABLE public.incentive_applications
  ADD COLUMN IF NOT EXISTS ia_mailing_same_as_primary_contractor boolean;

DO $$
DECLARE
  v_layout uuid;
  v_util   uuid;
BEGIN
  SELECT pl.id INTO v_layout FROM public.page_layouts pl
  JOIN public.picklist_values rt ON rt.id = pl.record_type_id
  WHERE pl.page_layout_object='incentive_applications'
    AND rt.picklist_value='WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST'
    AND pl.is_deleted IS NOT TRUE;
  IF v_layout IS NULL THEN RETURN; END IF;

  ---------------------------------------------------------------------------
  -- 1) Remove the Utility Information section (not on the payment JotForm).
  ---------------------------------------------------------------------------
  SELECT id INTO v_util FROM public.page_layout_sections
   WHERE page_layout_id=v_layout AND section_label='Utility Information' AND is_deleted IS NOT TRUE;
  IF v_util IS NOT NULL THEN
    UPDATE public.page_layout_widgets SET is_deleted=true, updated_at=now()
      WHERE section_id=v_util AND is_deleted IS NOT TRUE;
    UPDATE public.page_layout_sections SET is_deleted=true, updated_at=now()
      WHERE id=v_util;
  END IF;

  ---------------------------------------------------------------------------
  -- 2) Renumber the trailing sections so the order has no gap.
  ---------------------------------------------------------------------------
  UPDATE public.page_layout_sections SET section_order=6, updated_at=now()
    WHERE page_layout_id=v_layout AND section_label='Building Improvements' AND is_deleted IS NOT TRUE;
  UPDATE public.page_layout_sections SET section_order=7, updated_at=now()
    WHERE page_layout_id=v_layout AND section_label='Payment Information' AND is_deleted IS NOT TRUE;
  UPDATE public.page_layout_sections SET section_order=8, updated_at=now()
    WHERE page_layout_id=v_layout AND section_label='Health & Safety Testing' AND is_deleted IS NOT TRUE;
  UPDATE public.page_layout_sections SET section_order=9, updated_at=now()
    WHERE page_layout_id=v_layout AND section_label='Supporting Documentation' AND is_deleted IS NOT TRUE;

  ---------------------------------------------------------------------------
  -- 3) Rebuild each field_group to match the JotForm (row-major + full width).
  ---------------------------------------------------------------------------
  UPDATE public.page_layout_widgets w SET widget_config=
    '{"layout": "rows", "fields": [{"name": "ia_application_for", "type": "picklist", "label": "I''m Applying for a(n)", "display": "radio", "column": 1}, {"name": "ia_building_type", "type": "picklist", "label": "Building Type?", "display": "radio", "column": 2}, {"name": "ia_building_project_type", "type": "picklist", "label": "Building Project Type?", "display": "radio", "full_width": true}]}'::jsonb,
    updated_at=now()
    FROM public.page_layout_sections s
    WHERE w.section_id=s.id AND s.page_layout_id=v_layout AND s.section_label='Application'
      AND w.widget_type='field_group' AND w.is_deleted IS NOT TRUE;

  UPDATE public.page_layout_widgets w SET widget_config=
    '{"layout": "rows", "fields": [{"name": "ia_contractor_account_id", "type": "lookup", "label": "Primary Contractor Business Name", "lookup_table": "accounts", "lookup_field": "account_name", "column": 1}, {"name": "ia_contractor_contact_id", "type": "lookup", "label": "Primary Contractor Contact Name", "lookup_table": "contacts", "lookup_field": "contact_name", "column": 2, "lookup_dependency": {"kind": "contacts_for_accounts", "depends_on": ["ia_contractor_account_id"]}}, {"name": "ia_contractor_account_id.account_email", "type": "related_field", "label": "Primary Contractor Email", "related": {"table": "accounts", "column": "account_email", "fk_column": "ia_contractor_account_id", "column_type": "email"}, "column": 1}, {"name": "ia_contractor_contact_id.contact_phone", "type": "related_field", "label": "Primary Contractor Phone Number", "related": {"table": "contacts", "column": "contact_phone", "fk_column": "ia_contractor_contact_id", "column_type": "phone"}, "column": 2}, {"name": "ia_contractor_account_id.billing_street", "type": "related_field", "label": "Primary Contractor Address", "related": {"table": "accounts", "column": "billing_street", "fk_column": "ia_contractor_account_id", "column_type": "text"}, "full_width": true}, {"name": "ia_contractor_account_id.billing_city", "type": "related_field", "label": "City", "related": {"table": "accounts", "column": "billing_city", "fk_column": "ia_contractor_account_id", "column_type": "text"}, "full_width": true}, {"name": "ia_contractor_account_id.billing_state", "type": "related_field", "label": "State / Province", "related": {"table": "accounts", "column": "billing_state", "fk_column": "ia_contractor_account_id", "column_type": "text"}, "full_width": true, "format": "us_state_abbrev"}, {"name": "ia_contractor_account_id.billing_zip", "type": "related_field", "label": "Postal / Zip Code", "related": {"table": "accounts", "column": "billing_zip", "fk_column": "ia_contractor_account_id", "column_type": "text"}, "full_width": true}, {"name": "ia_has_support_contractor", "type": "boolean", "label": "Will a Support Contractor also be completing work on this project? Only IRA-registered contractors may perform work on IRA HOMES projects.", "full_width": true}]}'::jsonb,
    updated_at=now()
    FROM public.page_layout_sections s
    WHERE w.section_id=s.id AND s.page_layout_id=v_layout AND s.section_label='Primary Contractor Information'
      AND w.widget_type='field_group' AND w.is_deleted IS NOT TRUE;

  UPDATE public.page_layout_widgets w SET widget_config=
    '{"layout": "rows", "visible_when": {"field": "ia_has_support_contractor", "equals": true}, "fields": [{"name": "ia_support_contractor_account_id", "type": "lookup", "label": "Support Contractor Business Name", "lookup_table": "accounts", "lookup_field": "account_name", "column": 1}, {"name": "ia_support_contractor_contact_id", "type": "lookup", "label": "Support Contractor Contact Name", "lookup_table": "contacts", "lookup_field": "contact_name", "column": 2, "lookup_dependency": {"kind": "contacts_for_accounts", "depends_on": ["ia_support_contractor_account_id"]}}, {"name": "ia_support_contractor_account_id.billing_street", "type": "related_field", "label": "Support Contractor Full Address", "related": {"table": "accounts", "column": "billing_street", "fk_column": "ia_support_contractor_account_id", "column_type": "text"}, "column": 1}, {"name": "ia_support_contractor_contact_id.contact_phone", "type": "related_field", "label": "Support Contractor Phone Number", "related": {"table": "contacts", "column": "contact_phone", "fk_column": "ia_support_contractor_contact_id", "column_type": "phone"}, "column": 1}, {"name": "ia_support_contractor_account_id.account_email", "type": "related_field", "label": "Support Contractor Email", "related": {"table": "accounts", "column": "account_email", "fk_column": "ia_support_contractor_account_id", "column_type": "email"}, "column": 2}]}'::jsonb,
    updated_at=now()
    FROM public.page_layout_sections s
    WHERE w.section_id=s.id AND s.page_layout_id=v_layout AND s.section_label='Support Contractor Information'
      AND w.widget_type='field_group' AND w.is_deleted IS NOT TRUE;

  UPDATE public.page_layout_widgets w SET widget_config=
    '{"layout": "rows", "fields": [{"name": "property_id.property_hud_owner_org", "type": "related_field", "label": "Business Entity Name", "related": {"table": "properties", "column": "property_hud_owner_org", "fk_column": "property_id", "column_type": "text"}, "column": 1}, {"name": "ia_signer_contact_id", "type": "lookup", "label": "Contact Name", "lookup_table": "contacts", "lookup_field": "contact_name", "column": 2}, {"name": "ia_signer_contact_id.contact_email", "type": "related_field", "label": "Email", "related": {"table": "contacts", "column": "contact_email", "fk_column": "ia_signer_contact_id", "column_type": "email"}, "column": 1}, {"name": "ia_signer_contact_id.contact_phone", "type": "related_field", "label": "Phone Number", "related": {"table": "contacts", "column": "contact_phone", "fk_column": "ia_signer_contact_id", "column_type": "phone"}, "column": 2}, {"name": "property_id.property_hud_owner_org", "type": "related_field", "label": "Building Owner Name", "related": {"table": "properties", "column": "property_hud_owner_org", "fk_column": "property_id", "column_type": "text"}, "full_width": true}, {"name": "property_id.property_street", "type": "related_field", "label": "Installation Address", "related": {"table": "properties", "column": "property_street", "fk_column": "property_id", "column_type": "text"}, "full_width": true}, {"name": "property_id.property_city", "type": "related_field", "label": "City", "related": {"table": "properties", "column": "property_city", "fk_column": "property_id", "column_type": "text"}, "full_width": true}, {"name": "property_id.property_state", "type": "related_field", "label": "State / Province", "related": {"table": "properties", "column": "property_state", "fk_column": "property_id", "column_type": "text"}, "full_width": true, "format": "us_state_abbrev"}, {"name": "property_id.property_zip", "type": "related_field", "label": "Postal / Zip Code", "related": {"table": "properties", "column": "property_zip", "fk_column": "property_id", "column_type": "text"}, "full_width": true}]}'::jsonb,
    updated_at=now()
    FROM public.page_layout_sections s
    WHERE w.section_id=s.id AND s.page_layout_id=v_layout AND s.section_label='Installation Building Information'
      AND w.widget_type='field_group' AND w.is_deleted IS NOT TRUE;

  UPDATE public.page_layout_widgets w SET widget_config=
    '{"layout": "rows", "fields": [{"name": "ia_work_completed", "type": "multiselect", "label": "What work was completed?", "full_width": true, "options": [{"label": "Air Sealing", "value": "Air Sealing"}, {"label": "Ceiling Insulation", "value": "Ceiling Insulation"}, {"label": "Duct Insulation", "value": "Duct Insulation"}, {"label": "Duct Sealing", "value": "Duct Sealing"}, {"label": "Floor Insulation", "value": "Floor Insulation"}, {"label": "Wall Insulation", "value": "Wall Insulation"}, {"label": "Ventilation System", "value": "Ventilation System"}, {"label": "ENERGY STAR Window, Door, Skylight Replacement", "value": "ENERGY STAR Window, Door, Skylight Replacement"}, {"label": "ENERGY STAR Water Heater", "value": "ENERGY STAR Water Heater"}, {"label": "ENERGY STAR Cooling Equipment", "value": "ENERGY STAR Cooling Equipment"}, {"label": "ENERGY STAR Heating Equipment", "value": "ENERGY STAR Heating Equipment"}, {"label": "ENERGY STAR Appliance Replacement", "value": "ENERGY STAR Appliance Replacement"}, {"label": "Replace HVAC PSZ HP + DOAS", "value": "Replace HVAC PSZ HP + DOAS"}, {"label": "Upgrade to High-Efficiency Chiller", "value": "Upgrade to High-Efficiency Chiller"}, {"label": "High Efficiency Rooftop Heat Pump Replacement", "value": "High Efficiency Rooftop Heat Pump Replacement"}, {"label": "Replace HVAC with VRF + DOAS", "value": "Replace HVAC with VRF + DOAS"}, {"label": "High Efficiency PTAC Replacement", "value": "High Efficiency PTAC Replacement"}, {"label": "High Efficiency WLHP Replacement", "value": "High Efficiency WLHP Replacement"}, {"label": "Replace HVAC with WLHP + DOAS", "value": "Replace HVAC with WLHP + DOAS"}, {"label": "High Efficiency PTHP Replacement", "value": "High Efficiency PTHP Replacement"}, {"label": "High Efficiency Rooftop AC Replacement", "value": "High Efficiency Rooftop AC Replacement"}, {"label": "Upgrade to High-Efficiency Boiler", "value": "Upgrade to High-Efficiency Boiler"}, {"label": "Water Saving Measures", "value": "Water Saving Measures"}]}, {"name": "ia_final_modeled_savings", "type": "number", "label": "Final Modeled Savings", "column": 1, "help_text": "e.g. 21%"}, {"name": "ia_final_total_ira_homes_rebate_requested", "type": "currency", "label": "Final Total IRA HOMES Rebate Requested", "column": 2}, {"name": "ia_final_total_ira_homes_cost", "type": "currency", "label": "Final Total IRA HOMES Cost", "column": 1}, {"name": "ia_project_completion_date", "type": "date", "label": "Project Completion Date", "column": 2}]}'::jsonb,
    updated_at=now()
    FROM public.page_layout_sections s
    WHERE w.section_id=s.id AND s.page_layout_id=v_layout AND s.section_label='Building Improvements'
      AND w.widget_type='field_group' AND w.is_deleted IS NOT TRUE;

  -- Payment Information: tax field_group (identified by ia_who_gets_paid).
  UPDATE public.page_layout_widgets w SET widget_config=
    '{"layout": "rows", "help_text": "Please provide the tax information for who is receiving the rebate.", "fields": [{"name": "ia_who_gets_paid", "type": "picklist", "label": "Who gets paid?", "display": "radio", "full_width": true}, {"name": "ia_tax_classification_type", "type": "picklist", "label": "Tax Classification", "display": "radio", "column": 1}, {"name": "ia_tax_identification_fein", "type": "text", "label": "Tax Identification FEIN", "column": 2}]}'::jsonb,
    widget_position=1, updated_at=now()
    FROM public.page_layout_sections s
    WHERE w.section_id=s.id AND s.page_layout_id=v_layout AND s.section_label='Payment Information'
      AND w.widget_type='field_group'
      AND w.widget_config->'fields' @> '[{"name":"ia_who_gets_paid"}]'::jsonb
      AND w.is_deleted IS NOT TRUE;

  -- Payment Information: Upload W9 (file_gallery) sits between the two groups.
  UPDATE public.page_layout_widgets w SET widget_position=2, updated_at=now()
    FROM public.page_layout_sections s
    WHERE w.section_id=s.id AND s.page_layout_id=v_layout AND s.section_label='Payment Information'
      AND w.widget_type='file_gallery' AND w.is_deleted IS NOT TRUE;

  -- Payment Information: mailing field_group (identified by ia_payment_mailing_street).
  UPDATE public.page_layout_widgets w SET widget_config=
    '{"layout": "rows", "fields": [{"name": "ia_mailing_same_as_primary_contractor", "type": "boolean", "label": "Check if same as Primary Contractor Address", "full_width": true}, {"name": "ia_payment_mailing_street", "type": "text", "label": "Mailing Address", "full_width": true}, {"name": "ia_payment_mailing_line2", "type": "text", "label": "Street Address Line 2", "full_width": true}, {"name": "ia_payment_mailing_city", "type": "text", "label": "City", "full_width": true}, {"name": "ia_payment_mailing_state", "type": "text", "label": "State / Province", "full_width": true}, {"name": "ia_payment_mailing_zip", "type": "text", "label": "Postal / Zip Code", "full_width": true}]}'::jsonb,
    widget_position=3, updated_at=now()
    FROM public.page_layout_sections s
    WHERE w.section_id=s.id AND s.page_layout_id=v_layout AND s.section_label='Payment Information'
      AND w.widget_type='field_group'
      AND w.widget_config->'fields' @> '[{"name":"ia_payment_mailing_street"}]'::jsonb
      AND w.is_deleted IS NOT TRUE;

  UPDATE public.page_layout_widgets w SET widget_config=
    '{"layout": "rows", "fields": [{"name": "ia_has_combustion_appliances", "type": "picklist", "label": "Does the home have one or more combustion appliances at test-out?", "display": "radio", "full_width": true}, {"name": "ia_venting_test", "type": "picklist", "label": "Does the venting test pass?", "column": 1, "help_text": "Condition of combustion appliance vent(s)."}, {"name": "ia_spilling_test", "type": "picklist", "label": "Does the spilling test(s) pass?", "column": 2}, {"name": "ia_gas_leak_test", "type": "picklist", "label": "Does the gas leak detection test pass?", "column": 1}, {"name": "ia_undiluted_co_test", "type": "picklist", "label": "Does the undiluted CO test pass?", "column": 2}, {"name": "ia_ambient_co_test", "type": "picklist", "label": "Does the ambient CO test pass?", "column": 1}, {"name": "ia_mold_moisture", "type": "picklist", "label": "Are there signs of mold or moisture in or outside the building?", "display": "radio", "full_width": true}, {"name": "ia_roof_condition", "type": "picklist", "label": "What is the roof condition?", "display": "radio", "full_width": true}, {"name": "ia_ashrae_62_2", "type": "picklist", "label": "Has an ASHRAE 62.2 calculation been performed pre-and post-retrofit to ensure proper indoor air quality?", "display": "radio", "full_width": true}, {"name": "ia_drainage_condition", "type": "picklist", "label": "What is the drainage system condition?", "display": "radio", "full_width": true}, {"name": "ia_disclosed_to_homeowner", "type": "picklist", "label": "Have the answers to these questions been disclosed to the homeowner?", "display": "radio", "full_width": true}]}'::jsonb,
    updated_at=now()
    FROM public.page_layout_sections s
    WHERE w.section_id=s.id AND s.page_layout_id=v_layout AND s.section_label='Health & Safety Testing'
      AND w.widget_type='field_group' AND w.is_deleted IS NOT TRUE;

  ---------------------------------------------------------------------------
  -- 4) Supporting Documentation: drop the three non-JotForm uploads, remove
  --    "Who is submitting this form?", and order to match the form.
  ---------------------------------------------------------------------------
  UPDATE public.page_layout_widgets w SET is_deleted=true, updated_at=now()
    FROM public.page_layout_sections s
    WHERE w.section_id=s.id AND s.page_layout_id=v_layout AND s.section_label='Supporting Documentation'
      AND w.widget_type='file_gallery'
      AND w.widget_title IN ('IRA Notification of Combustion Safety Form',
                             'Low-Income Building Owner Acknowledgment Form',
                             'Customer Contract Scope of Work')
      AND w.is_deleted IS NOT TRUE;

  UPDATE public.page_layout_widgets w SET widget_config=
    '{"layout": "rows", "fields": [{"name": "ia_modeling_software", "type": "picklist", "label": "Modeling Software Used", "column": 1, "help_text": "DOE Required Field if MoF"}]}'::jsonb,
    widget_position=8, updated_at=now()
    FROM public.page_layout_sections s
    WHERE w.section_id=s.id AND s.page_layout_id=v_layout AND s.section_label='Supporting Documentation'
      AND w.widget_type='field_group' AND w.is_deleted IS NOT TRUE;

  UPDATE public.page_layout_widgets w SET widget_position=(CASE w.widget_title
      WHEN 'HPXMLv4/Building Sync File' THEN 1
      WHEN 'Audit Template Report' THEN 2
      WHEN 'Customer Report (PDF) e.g. SnuggPro Report/Building Assessment Tool Report' THEN 3
      WHEN 'HOMES Final Invoice' THEN 4
      WHEN 'Project Summary/Offer Letter (with signatures)' THEN 5
      WHEN 'IRA MF 5+ Units Notification of Combustion Safety Form' THEN 6
      WHEN 'QI Tool pdf' THEN 7
      ELSE w.widget_position END), updated_at=now()
    FROM public.page_layout_sections s
    WHERE w.section_id=s.id AND s.page_layout_id=v_layout AND s.section_label='Supporting Documentation'
      AND w.widget_type='file_gallery' AND w.is_deleted IS NOT TRUE;
END $$;

NOTIFY pgrst, 'reload schema';
