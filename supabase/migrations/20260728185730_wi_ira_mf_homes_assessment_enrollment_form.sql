-- WI-IRA-MF-HOMES-ASSESSMENT enrollment — pre-approval form fields, picklists, and rebuilt page layout.
--
-- Models Wisconsin's Multifamily Low Income Energy Assessment Incentive
-- pre-approval application on the enrollments object. Adds the form's fields as
-- purpose-named enrollment_* columns, seeds two supporting picklists
-- (property_type, modeling_approach), and rebuilds the EXISTING default page
-- layout for the WI-IRA-MF-HOMES-ASSESSMENT record type so it mirrors the form.
--
-- The record type (picklist_values.id 78d21eea-68e7-4a3d-9151-ec0df5966536) and
-- its default record_detail layout (page_layouts.id
-- 68d28e30-2369-42e6-9baf-a2bad552cae3) already exist; this migration does NOT
-- create a second record type or a second default layout — it replaces the
-- placeholder sections/widgets on the existing layout in place.
--
-- Two form fields reuse existing columns (they are the same concept):
--   Property Owner Name   -> enrollment_owner_organization
--   Number of buildings   -> enrollment_number_of_buildings
--
-- Column additions come FIRST: validate_page_layout_widget_config rejects any
-- field_group field whose name is not a real enrollments column.

-- 1) Pre-approval form columns -------------------------------------------------
ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_contractor_name text;
COMMENT ON COLUMN public.enrollments.enrollment_contractor_name IS 'Registered Contractor Name (pre-approval application).';

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_contractor_email text;
COMMENT ON COLUMN public.enrollments.enrollment_contractor_email IS 'Registered Contractor Email (pre-approval application).';

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_contractor_primary_address_line1 text;
COMMENT ON COLUMN public.enrollments.enrollment_contractor_primary_address_line1 IS 'Contractor primary address - street line 1.';

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_contractor_primary_city text;
COMMENT ON COLUMN public.enrollments.enrollment_contractor_primary_city IS 'Contractor primary address - city.';

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_contractor_primary_state text;
COMMENT ON COLUMN public.enrollments.enrollment_contractor_primary_state IS 'Contractor primary address - state (2-letter). Pre-filled from the property on create.';

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_contractor_primary_zip text;
COMMENT ON COLUMN public.enrollments.enrollment_contractor_primary_zip IS 'Contractor primary address - ZIP.';

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_payment_address_different boolean;
COMMENT ON COLUMN public.enrollments.enrollment_payment_address_different IS 'Is the payment address different from the contractor primary address?';

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_payment_address_line1 text;
COMMENT ON COLUMN public.enrollments.enrollment_payment_address_line1 IS 'Payment address - street line 1 (used when payment address differs from primary).';

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_payment_city text;
COMMENT ON COLUMN public.enrollments.enrollment_payment_city IS 'Payment address - city.';

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_payment_state text;
COMMENT ON COLUMN public.enrollments.enrollment_payment_state IS 'Payment address - state (2-letter). Pre-filled from the property on create.';

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_payment_zip text;
COMMENT ON COLUMN public.enrollments.enrollment_payment_zip IS 'Payment address - ZIP.';

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_property_addresses text;
COMMENT ON COLUMN public.enrollments.enrollment_property_addresses IS 'Property address(es) covered by the application - free-text list (one per line).';

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_property_type uuid;
COMMENT ON COLUMN public.enrollments.enrollment_property_type IS 'Property Type - FK to picklist_values.id (picklist_field=property_type).';

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_units_per_building integer;
COMMENT ON COLUMN public.enrollments.enrollment_units_per_building IS 'Number of units per building (multifamily / single-family attached).';

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_modeling_approach uuid;
COMMENT ON COLUMN public.enrollments.enrollment_modeling_approach IS 'How the property will be modeled - FK to picklist_values.id (picklist_field=modeling_approach).';

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_requested_incentive_amount numeric;
COMMENT ON COLUMN public.enrollments.enrollment_requested_incentive_amount IS 'Requested Incentive Amount (USD).';

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_estimated_assessment_date date;
COMMENT ON COLUMN public.enrollments.enrollment_estimated_assessment_date IS 'Estimated assessment date.';

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_property_lea_numbers text;
COMMENT ON COLUMN public.enrollments.enrollment_property_lea_numbers IS 'Property LEA#(s) - Local Energy Assessment numbers.';

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_building_details text;
COMMENT ON COLUMN public.enrollments.enrollment_building_details IS 'Building details narrative (pre-approval application).';

-- 2) Supporting picklists ------------------------------------------------------
-- Short picklist_field names (property_type / modeling_approach): fetchPicklistOptions
-- strips the enrollment_ prefix and matches on the short name. Guarded so a
-- replay is a no-op. created_by resolves to the earliest active Admin.
INSERT INTO picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
SELECT 'enrollments','property_type', v.val, v.lbl, true, v.ord,
       (SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
        WHERE r.role_name='Admin' AND u.user_is_active AND u.user_is_deleted IS NOT TRUE
        ORDER BY u.user_created_at LIMIT 1)
FROM (VALUES
  ('single_family_attached','Single Family Attached',1),
  ('single_family_detached','Single Family Detached',2),
  ('multifamily_2_3_units','Multifamily 2-3 units',3),
  ('multifamily_4_plus_units','Multifamily 4+ units',4)
) AS v(val,lbl,ord)
WHERE NOT EXISTS (
  SELECT 1 FROM picklist_values p
  WHERE p.picklist_object='enrollments' AND p.picklist_field='property_type' AND p.picklist_value=v.val);

INSERT INTO picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
SELECT 'enrollments','modeling_approach', v.val, v.lbl, true, v.ord,
       (SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
        WHERE r.role_name='Admin' AND u.user_is_active AND u.user_is_deleted IS NOT TRUE
        ORDER BY u.user_created_at LIMIT 1)
FROM (VALUES
  ('individual_units_bpi_2400','Individual Units - BPI 2400',1),
  ('whole_building_bpi_2400','Whole Building - BPI 2400',2),
  ('whole_building_doe2','Whole Building - DOE-2-based software',3)
) AS v(val,lbl,ord)
WHERE NOT EXISTS (
  SELECT 1 FROM picklist_values p
  WHERE p.picklist_object='enrollments' AND p.picklist_field='modeling_approach' AND p.picklist_value=v.val);

-- 3) Rebuild the existing WI-IRA-MF-HOMES-ASSESSMENT layout in place -----------
DO $$
DECLARE
  v_layout uuid := '68d28e30-2369-42e6-9baf-a2bad552cae3';  -- existing default layout for the record type
  v_sec1 uuid := gen_random_uuid();  -- Enrollment (status + identity)
  v_sec2 uuid := gen_random_uuid();  -- Contractor Information
  v_sec3 uuid := gen_random_uuid();  -- Property & Owner
  v_sec4 uuid := gen_random_uuid();  -- Incentive Request
  v_sec5 uuid := gen_random_uuid();  -- Supporting Documents (Related)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM page_layouts WHERE id=v_layout AND NOT is_deleted) THEN
    RAISE EXCEPTION 'WI-IRA-MF-HOMES-ASSESSMENT layout % not found', v_layout;
  END IF;

  -- Retire the placeholder sections/widgets (soft-delete only; block_hard_delete).
  UPDATE page_layout_widgets
     SET is_deleted=true, updated_at=now()
   WHERE page_layout_id=v_layout AND is_deleted IS NOT TRUE;
  UPDATE page_layout_sections
     SET is_deleted=true, deletion_reason='Replaced by WI-IRA-MF-HOMES-ASSESSMENT pre-approval form layout', updated_at=now()
   WHERE page_layout_id=v_layout AND is_deleted IS NOT TRUE;

  -- Sections (all main-flow; Details except Supporting Documents on Related).
  INSERT INTO page_layout_sections (id, page_layout_id, section_order, section_label, section_columns, section_tab, section_placement, is_deleted) VALUES
    (v_sec1, v_layout, 1, 'Enrollment',              2, 'Details', 'main', false),
    (v_sec2, v_layout, 2, 'Contractor Information',  2, 'Details', 'main', false),
    (v_sec3, v_layout, 3, 'Property & Owner',        2, 'Details', 'main', false),
    (v_sec4, v_layout, 4, 'Incentive Request',       2, 'Details', 'main', false),
    (v_sec5, v_layout, 5, 'Supporting Documents',    1, 'Related', 'main', false);

  -- Widgets. page_layout_widget_record_number is auto-stamped by
  -- trg_page_layout_widget_record_number when passed ''.
  INSERT INTO page_layout_widgets (page_layout_widget_record_number, page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_config) VALUES
  -- Section 1: status path + identity chrome
  ('', v_layout, v_sec1, 'status_path', 'Status Path', 1, 1,
   '{"status_field":"enrollment_status","show_guidance":true,"show_completed_count":true}'::jsonb),
  ('', v_layout, v_sec1, 'field_group', 'Enrollment', 1, 2,
   '{"fields":[
      {"name":"enrollment_name","type":"text","label":"Enrollment Name","required":true,"column":1},
      {"name":"property_id","type":"lookup","label":"Property","required":true,"column":1,"lookup_table":"properties","lookup_field":"property_name"},
      {"name":"opportunity_id","type":"lookup","label":"Opportunity","column":1,"lookup_table":"opportunities","lookup_field":"opportunity_name","lookup_dependency":{"kind":"opportunities_for_property","depends_on":["property_id"]}},
      {"name":"enrollment_record_type","type":"picklist","label":"Record Type","column":2},
      {"name":"enrollment_status","type":"picklist","label":"Status","column":2},
      {"name":"enrollment_owner","type":"lookup","label":"Owner","column":2,"lookup_table":"users","lookup_field":"user_name"}
   ]}'::jsonb),
  -- Section 2: Contractor Information (registered contractor + primary/payment addresses)
  ('', v_layout, v_sec2, 'field_group', 'Contractor Information', 1, 1,
   '{"fields":[
      {"name":"enrollment_contractor_name","type":"text","label":"Registered Contractor Name","required":true,"column":1},
      {"name":"enrollment_contractor_email","type":"email","label":"Registered Contractor Email","required":true,"column":2},
      {"name":"enrollment_contractor_primary_address_line1","type":"text","label":"Primary Address","required":true,"column":1},
      {"name":"enrollment_contractor_primary_city","type":"text","label":"City","required":true,"column":1},
      {"name":"enrollment_contractor_primary_state","type":"text","label":"State","required":true,"column":2},
      {"name":"enrollment_contractor_primary_zip","type":"text","label":"ZIP","required":true,"column":2},
      {"name":"enrollment_payment_address_different","type":"boolean","label":"Payment address different from primary?","column":1},
      {"name":"enrollment_payment_address_line1","type":"text","label":"Payment Address","column":1},
      {"name":"enrollment_payment_city","type":"text","label":"Payment City","column":1},
      {"name":"enrollment_payment_state","type":"text","label":"Payment State","column":2},
      {"name":"enrollment_payment_zip","type":"text","label":"Payment ZIP","column":2}
   ]}'::jsonb),
  -- Section 3: Property & Owner
  ('', v_layout, v_sec3, 'field_group', 'Property & Owner', 1, 1,
   '{"fields":[
      {"name":"enrollment_owner_organization","type":"text","label":"Property Owner Name","required":true,"column":1},
      {"name":"enrollment_property_addresses","type":"textarea","label":"Property Address(es)","required":true,"column":1},
      {"name":"enrollment_modeling_approach","type":"picklist","label":"How Will the Property Be Modeled?","required":true,"column":1},
      {"name":"enrollment_property_type","type":"picklist","label":"Property Type","required":true,"column":2},
      {"name":"enrollment_number_of_buildings","type":"integer","label":"Number of Buildings","required":true,"column":2},
      {"name":"enrollment_units_per_building","type":"integer","label":"Number of Units per Building (if MF or SF attached)","column":2}
   ]}'::jsonb),
  -- Section 4: Incentive Request
  ('', v_layout, v_sec4, 'field_group', 'Incentive Request', 1, 1,
   '{"fields":[
      {"name":"enrollment_requested_incentive_amount","type":"currency","label":"Requested Incentive Amount","required":true,"column":1},
      {"name":"enrollment_property_lea_numbers","type":"text","label":"Property LEA#s","column":1},
      {"name":"enrollment_building_details","type":"textarea","label":"Building Details","required":true,"column":1},
      {"name":"enrollment_estimated_assessment_date","type":"date","label":"Estimated Assessment Date","column":2}
   ]}'::jsonb),
  -- Section 5: Supporting Documents (Related tab)
  ('', v_layout, v_sec5, 'file_gallery', 'Supporting Documents', 1, 1,
   '{"target":"documents","document_type":"attachment"}'::jsonb);
END $$;

NOTIFY pgrst, 'reload schema';
