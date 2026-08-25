-- The WI-IRA-MF-HOMES-AUDIT incentive application gets the assessment
-- application's own page layout, section for section.
--
-- Nicholas, 2026-08-25: "I need to make sure the page layout matches the JOT
-- form. And we have all the correct fields. In the correct sections... It should
-- resemble a lot of the same functionality and layouts that we did for the
-- enrollment for the IRA multifamily audit."
--
-- What PL-00304 carried before this: a status path, a Conversations panel, one
-- generic Documents gallery, and an "Information" field group of 50 fields
-- generic-seeded from the HOMES family -- mini-split efficiency category, water
-- heater location, AHRI certification, ducted/non-ducted counts. Not one field
-- the Focus On Energy assessment application asks for. Every field on the live
-- IA-00021 was null.
--
-- The sections mirror PL-00378, the assessment pre-approval ENROLLMENT layout
-- (2026-08-04), whose field list came from the live Formstack form definition
-- and is wired to it by external_form_field_map. Same names, same order, same
-- reading: Application, Contractor Information, Property & Owner, Incentive
-- Request, then the documents.
--
-- Deliberately KEPT rather than swept away:
--   * Incentive Tracking -- the program's RESPONSE (pre-approved date and
--     amount, submitted date, paid date). That is the application's own
--     lifecycle and appears on no enrollment; removing it would lose function.
--   * Conversations -- the omni-channel card every object carries since
--     2026-08-25.
--
-- Contractor and owner details render as RELATED fields off the account and the
-- property, exactly as the enrollment layout does: the registered contractor's
-- name, email and primary address belong to the account record and a second
-- stored copy is a value that goes stale. What the application stores in its own
-- columns is only what the FORM asks it to state independently -- the payment
-- address, and the assessment's own figures.

DO $$
DECLARE
  v_layout    uuid := '0677a286-6784-4b6d-9895-52eecf9e075e';  -- PL-00304
  v_sec_info  uuid := 'fb59b243-bf5e-4f47-9506-1b87f8608c27';  -- "Information"
  v_sec_track uuid := '51e36ecd-f35a-461a-a646-aa1ab3c547c5';  -- "Incentive Tracking"
  v_sec_docs  uuid := 'd74ae3b1-7bd4-47f8-ba7c-3f380b67c374';  -- "Documents"
  v_sec_sys   uuid := '8bd9a7e2-a92a-4c39-877f-cb0c8b351b47';  -- "System Information"
  v_sec_contr uuid;
  v_sec_prop  uuid;
  v_sec_req   uuid;
  v_sec_rdoc  uuid;
  v_sec_sdoc  uuid;
  v_n         integer;
BEGIN
  -- Guard: this migration edits ONE layout by id. If it is not the layout we
  -- think it is, stop rather than rewrite somebody else's page.
  IF NOT EXISTS (
    SELECT 1 FROM public.page_layouts pl
     JOIN public.picklist_values rt ON rt.id = pl.record_type_id
    WHERE pl.id = v_layout
      AND pl.page_layout_object = 'incentive_applications'
      AND rt.picklist_value = 'WI-IRA-MF-HOMES-AUDIT')
  THEN
    RAISE EXCEPTION 'PL-00304 is not the WI-IRA-MF-HOMES-AUDIT incentive application layout';
  END IF;

  -- 1) The generic 50-field group goes. The section stays and becomes the
  --    application's own header, so the status path keeps its place.
  UPDATE public.page_layout_widgets
     SET is_deleted = true, updated_at = now()
   WHERE page_layout_id = v_layout
     AND widget_type = 'field_group'
     AND widget_title = 'Information'
     AND is_deleted IS NOT TRUE;

  UPDATE public.page_layout_sections
     SET section_label = 'Application', section_columns = 2, section_order = 1,
         updated_at = now()
   WHERE id = v_sec_info;

  INSERT INTO public.page_layout_widgets
    (id, page_layout_id, section_id, widget_type, widget_title, widget_column,
     widget_position, widget_config, page_layout_widget_record_number)
  VALUES (gen_random_uuid(), v_layout, v_sec_info, 'field_group', 'Application', 1, 1,
  jsonb_build_object('fields', jsonb_build_array(
    jsonb_build_object('name','opportunity_id','type','lookup','label','Opportunity','column',1,
      'required',true,'lookup_table','opportunities','lookup_field','opportunity_name',
      'lookup_dependency', jsonb_build_object('kind','opportunities_for_property',
                                              'depends_on', jsonb_build_array('property_id'))),
    jsonb_build_object('name','building_id','type','lookup','label','Building','column',2,
      'lookup_table','buildings','lookup_field','building_name',
      'lookup_dependency', jsonb_build_object('kind','buildings_for_opportunity',
                                              'depends_on', jsonb_build_array('opportunity_id'))),
    jsonb_build_object('name','property_id','type','lookup','label','Property','column',1,
      'lookup_table','properties','lookup_field','property_name'),
    jsonb_build_object('name','ia_record_type','type','picklist','label','Record Type','column',2),
    jsonb_build_object('name','ia_status','type','picklist','label','Status','column',2)
  )), '');

  -- 2) Contractor Information -----------------------------------------------
  v_sec_contr := gen_random_uuid();
  INSERT INTO public.page_layout_sections
    (id, page_layout_id, section_order, section_label, section_columns,
     section_is_collapsible, section_is_collapsed_by_default, section_tab, section_placement)
  VALUES (v_sec_contr, v_layout, 2, 'Contractor Information', 2, true, false, 'Details', 'main');

  INSERT INTO public.page_layout_widgets
    (id, page_layout_id, section_id, widget_type, widget_title, widget_column,
     widget_position, widget_config, page_layout_widget_record_number)
  VALUES (gen_random_uuid(), v_layout, v_sec_contr, 'field_group', 'Contractor Information', 1, 1,
  jsonb_build_object('fields', jsonb_build_array(
    jsonb_build_object('name','ia_contractor_account_id','type','lookup','label','Registered Contractor',
      'column',1,'lookup_table','accounts','lookup_field','account_name'),
    jsonb_build_object('name','ia_contractor_account_id.account_name','type','related_field',
      'label','Contractor Name','column',1,
      'related', jsonb_build_object('table','accounts','column','account_name',
                                    'fk_column','ia_contractor_account_id','column_type','text')),
    jsonb_build_object('name','ia_contractor_account_id.account_email','type','related_field',
      'label','Contractor Email','column',2,
      'related', jsonb_build_object('table','accounts','column','account_email',
                                    'fk_column','ia_contractor_account_id','column_type','text')),
    jsonb_build_object('name','ia_contractor_account_id.billing_street','type','related_field',
      'label','Primary Address','column',1,
      'related', jsonb_build_object('table','accounts','column','billing_street',
                                    'fk_column','ia_contractor_account_id','column_type','text')),
    jsonb_build_object('name','ia_contractor_account_id.billing_city','type','related_field',
      'label','City','column',1,
      'related', jsonb_build_object('table','accounts','column','billing_city',
                                    'fk_column','ia_contractor_account_id','column_type','text')),
    jsonb_build_object('name','ia_contractor_account_id.billing_state','type','related_field',
      'label','State','column',2,
      'related', jsonb_build_object('table','accounts','column','billing_state',
                                    'fk_column','ia_contractor_account_id','column_type','text')),
    jsonb_build_object('name','ia_contractor_account_id.billing_zip','type','related_field',
      'label','ZIP','column',2,
      'related', jsonb_build_object('table','accounts','column','billing_zip',
                                    'fk_column','ia_contractor_account_id','column_type','text')),
    jsonb_build_object('name','ia_payment_address_different','type','boolean',
      'label','Payment address different from primary?','column',1),
    jsonb_build_object('name','ia_payment_mailing_street','type','text','label','Payment Address','column',1),
    jsonb_build_object('name','ia_payment_mailing_city','type','text','label','Payment City','column',1),
    jsonb_build_object('name','ia_payment_mailing_state','type','text','label','Payment State','column',2),
    jsonb_build_object('name','ia_payment_mailing_zip','type','text','label','Payment ZIP','column',2)
  )), '');

  -- 3) Property & Owner ------------------------------------------------------
  v_sec_prop := gen_random_uuid();
  INSERT INTO public.page_layout_sections
    (id, page_layout_id, section_order, section_label, section_columns,
     section_is_collapsible, section_is_collapsed_by_default, section_tab, section_placement)
  VALUES (v_sec_prop, v_layout, 3, 'Property & Owner', 2, true, false, 'Details', 'main');

  INSERT INTO public.page_layout_widgets
    (id, page_layout_id, section_id, widget_type, widget_title, widget_column,
     widget_position, widget_config, page_layout_widget_record_number)
  VALUES (gen_random_uuid(), v_layout, v_sec_prop, 'field_group', 'Property & Owner', 1, 1,
  jsonb_build_object('fields', jsonb_build_array(
    jsonb_build_object('name','property_id.property_hud_owner_org','type','related_field',
      'label','Property Owner Name','column',1,
      'related', jsonb_build_object('table','properties','column','property_hud_owner_org',
                                    'fk_column','property_id','column_type','text')),
    jsonb_build_object('name','ia_property_addresses','type','textarea',
      'label','Property Address(es)','column',1,'required',true),
    jsonb_build_object('name','ia_modeling_approach','type','picklist',
      'label','How Will the Property Be Modeled?','column',1,'required',true),
    jsonb_build_object('name','ia_property_type','type','picklist',
      'label','Property Type','column',2,'required',true),
    jsonb_build_object('name','ia_number_of_buildings','type','integer',
      'label','Number of Buildings','column',1),
    jsonb_build_object('name','ia_units_per_building','type','integer',
      'label','Number of Units per Building (if MF or SF attached)','column',2)
  )), '');

  -- 4) Incentive Request -----------------------------------------------------
  v_sec_req := gen_random_uuid();
  INSERT INTO public.page_layout_sections
    (id, page_layout_id, section_order, section_label, section_columns,
     section_is_collapsible, section_is_collapsed_by_default, section_tab, section_placement)
  VALUES (v_sec_req, v_layout, 4, 'Incentive Request', 2, true, false, 'Details', 'main');

  INSERT INTO public.page_layout_widgets
    (id, page_layout_id, section_id, widget_type, widget_title, widget_column,
     widget_position, widget_config, page_layout_widget_record_number)
  VALUES (gen_random_uuid(), v_layout, v_sec_req, 'field_group', 'Incentive Request', 1, 1,
  jsonb_build_object('fields', jsonb_build_array(
    jsonb_build_object('name','ia_requested_incentive_amount','type','currency',
      'label','Requested Incentive Amount','column',1,'required',true),
    jsonb_build_object('name','ia_property_lea_numbers','type','text','label','Property LEA#s','column',1),
    jsonb_build_object('name','ia_building_details','type','textarea',
      'label','Building Details','column',1,'required',true),
    jsonb_build_object('name','ia_estimated_assessment_date','type','date',
      'label','Estimated Assessment Date','column',2,'format','MM/DD/YY')
  )), '');

  -- 5) The program's response, and the audit trail, keep their places.
  UPDATE public.page_layout_sections SET section_order = 5, updated_at = now() WHERE id = v_sec_track;
  UPDATE public.page_layout_sections SET section_order = 6, updated_at = now() WHERE id = v_sec_sys;

  -- 6) Required Documents ----------------------------------------------------
  -- The uploads the assessment application asks for. Each is its own SLOT: the
  -- card shows only its own kind of file and says plainly when it is missing.
  -- Before 2026-08-25 a document_type on a gallery was write-only -- every
  -- gallery listed every document -- which is why the seven slots on the
  -- payment-request layout all looked identical. See src/lib/documentSlots.js.
  UPDATE public.page_layout_widgets
     SET is_deleted = true, updated_at = now()
   WHERE section_id = v_sec_docs AND widget_type = 'file_gallery' AND is_deleted IS NOT TRUE;

  UPDATE public.page_layout_sections
     SET section_label = 'Required Documents', section_order = 100, updated_at = now()
   WHERE id = v_sec_docs;
  v_sec_rdoc := v_sec_docs;

  INSERT INTO public.page_layout_widgets
    (id, page_layout_id, section_id, widget_type, widget_title, widget_column,
     widget_position, widget_config, page_layout_widget_record_number)
  VALUES
    (gen_random_uuid(), v_layout, v_sec_rdoc, 'file_gallery', 'Energy Report (PDF)', 1, 1,
     jsonb_build_object('target','documents','document_type','assessment_energy_report',
       'required',true,
       'help_text','The modeling report for the assessed building — e.g. the SnuggPro or Building Assessment Tool export.'), ''),
    (gen_random_uuid(), v_layout, v_sec_rdoc, 'file_gallery', 'HPXMLv4 / BuildingSync File', 1, 2,
     jsonb_build_object('target','documents','document_type','assessment_hpxml_buildingsync',
       'required',true,
       'help_text','The machine-readable model file the program ingests alongside the report.'), ''),
    (gen_random_uuid(), v_layout, v_sec_rdoc, 'file_gallery', 'Signed Assessment Invoice', 1, 3,
     jsonb_build_object('target','documents','document_type','assessment_signed_invoice',
       'required',true,
       'help_text','The Energy Audit Invoice for this assessment, signed. Generate it from the project''s Final Project Payment Request submittal.'), '');

  -- 7) Supporting Documents — the catch-all. Anything filed on the application
  --    that none of the slots above claims lands here, so a file is never shown
  --    twice on one page and nothing is invisible.
  v_sec_sdoc := gen_random_uuid();
  INSERT INTO public.page_layout_sections
    (id, page_layout_id, section_order, section_label, section_columns,
     section_is_collapsible, section_is_collapsed_by_default, section_tab, section_placement)
  VALUES (v_sec_sdoc, v_layout, 101, 'Supporting Documents', 1, true, false, 'Related', 'main');

  INSERT INTO public.page_layout_widgets
    (id, page_layout_id, section_id, widget_type, widget_title, widget_column,
     widget_position, widget_config, page_layout_widget_record_number)
  VALUES (gen_random_uuid(), v_layout, v_sec_sdoc, 'file_gallery', 'Supporting Documents', 1, 1,
     jsonb_build_object('target','documents','document_type','attachment'), '');

  -- Assert the shape we just built, rather than trusting it.
  SELECT count(*) INTO v_n
    FROM public.page_layout_widgets w
   WHERE w.page_layout_id = v_layout AND w.is_deleted IS NOT TRUE
     AND w.widget_type = 'field_group';
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'Expected 6 field groups on PL-00304 (Application, Contractor, Property & Owner, Incentive Request, Incentive Tracking, System Information), found %', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM public.page_layout_widgets w
   WHERE w.page_layout_id = v_layout AND w.is_deleted IS NOT TRUE
     AND w.widget_type = 'file_gallery'
     AND w.widget_config ->> 'required' = 'true';
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'Expected 3 required document slots on PL-00304, found %', v_n;
  END IF;
END $$;
