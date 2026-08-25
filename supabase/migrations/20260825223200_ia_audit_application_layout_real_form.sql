-- PL-00304 rebuilt to the live Focus On Energy assessment application, section
-- by section and label by label:
--   Application (LEAP record context) · Application Information · Assessment
--   Details - Individual Multifamily Building · Assessor Information ·
--   Additional Information · Terms and Conditions and Signature · Incentive
--   Tracking · System Information, then the three required uploads.
--
-- The three sections built hours earlier against form 6324680 (Contractor
-- Information / Property & Owner / Incentive Request) are soft-deleted with the
-- reason recorded, not silently overwritten.
--
-- What is READ rather than stored, per Nicholas's rule that a create never asks
-- for what the platform can derive: Property Owner Name (the property's HUD
-- owner organisation), Building Name and the Assessment Address (the building),
-- and the assessor's business name, office address, phone and email (the
-- contractor account). Only the form's second address line is the application's
-- own column -- buildings carry no line 2.
--
-- The PAYMENT address is stored on the application, because this form states it
-- outright as a required block and it is the address the incentive is paid to on
-- this application, not a standing fact about the account.
DO $$
DECLARE
  v_layout    uuid := '0677a286-6784-4b6d-9895-52eecf9e075e';
  v_sec_app   uuid := 'fb59b243-bf5e-4f47-9506-1b87f8608c27';
  v_sec_track uuid := '51e36ecd-f35a-461a-a646-aa1ab3c547c5';
  v_sec_docs  uuid := 'd74ae3b1-7bd4-47f8-ba7c-3f380b67c374';
  v_sec_sys   uuid := '8bd9a7e2-a92a-4c39-877f-cb0c8b351b47';
  v_sec_appinfo uuid;
  v_sec_detail  uuid;
  v_sec_assessor uuid;
  v_sec_addl    uuid;
  v_sec_terms   uuid;
  v_n         integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.page_layouts pl
     JOIN public.picklist_values rt ON rt.id = pl.record_type_id
    WHERE pl.id = v_layout AND pl.page_layout_object = 'incentive_applications'
      AND rt.picklist_value = 'WI-IRA-MF-HOMES-AUDIT') THEN
    RAISE EXCEPTION 'PL-00304 is not the WI-IRA-MF-HOMES-AUDIT layout';
  END IF;

  UPDATE public.page_layout_sections
     SET is_deleted = true, updated_at = now(),
         deletion_reason = 'Built against Formstack form 6324680; superseded by the live /forms/ira_assessment_app'
   WHERE page_layout_id = v_layout AND is_deleted IS NOT TRUE
     AND section_label IN ('Contractor Information','Property & Owner','Incentive Request');
  UPDATE public.page_layout_widgets w
     SET is_deleted = true, updated_at = now()
   WHERE w.page_layout_id = v_layout AND w.is_deleted IS NOT TRUE
     AND w.section_id IN (SELECT id FROM public.page_layout_sections
                           WHERE page_layout_id = v_layout AND is_deleted = true);

  UPDATE public.page_layout_sections SET section_order = 1, updated_at = now() WHERE id = v_sec_app;

  v_sec_appinfo := gen_random_uuid();
  INSERT INTO public.page_layout_sections
    (id, page_layout_id, section_order, section_label, section_columns,
     section_is_collapsible, section_is_collapsed_by_default, section_tab, section_placement)
  VALUES (v_sec_appinfo, v_layout, 2, 'Application Information', 2, true, false, 'Details', 'main');
  INSERT INTO public.page_layout_widgets
    (id, page_layout_id, section_id, widget_type, widget_title, widget_column,
     widget_position, widget_config, page_layout_widget_record_number)
  VALUES (gen_random_uuid(), v_layout, v_sec_appinfo, 'field_group', 'Application Information', 1, 1,
  jsonb_build_object('fields', jsonb_build_array(
    jsonb_build_object('name','ia_building_modeled_as','type','picklist',
      'label','How was the building modeled?','column',1,'required',true),
    jsonb_build_object('name','ia_multiple_properties_same_owner','type','boolean',
      'label','Requesting incentives for more than one property or unit owned by the same person or entity?',
      'column',2,'required',true)
  )), '');

  v_sec_detail := gen_random_uuid();
  INSERT INTO public.page_layout_sections
    (id, page_layout_id, section_order, section_label, section_columns,
     section_is_collapsible, section_is_collapsed_by_default, section_tab, section_placement)
  VALUES (v_sec_detail, v_layout, 3, 'Assessment Details - Individual Multifamily Building', 2, true, false, 'Details', 'main');
  INSERT INTO public.page_layout_widgets
    (id, page_layout_id, section_id, widget_type, widget_title, widget_column,
     widget_position, widget_config, page_layout_widget_record_number)
  VALUES (gen_random_uuid(), v_layout, v_sec_detail, 'field_group',
          'Assessment Details - Individual Multifamily Building', 1, 1,
  jsonb_build_object('fields', jsonb_build_array(
    jsonb_build_object('name','property_id.property_hud_owner_org','type','related_field',
      'label','Property Owner Name','column',1,
      'related', jsonb_build_object('table','properties','column','property_hud_owner_org',
                                    'fk_column','property_id','column_type','text')),
    jsonb_build_object('name','building_id.building_name','type','related_field',
      'label','Building Name','column',2,
      'related', jsonb_build_object('table','buildings','column','building_name',
                                    'fk_column','building_id','column_type','text')),
    jsonb_build_object('name','building_id.building_address','type','related_field',
      'label','Assessment Address','column',1,
      'related', jsonb_build_object('table','buildings','column','building_address',
                                    'fk_column','building_id','column_type','text')),
    jsonb_build_object('name','ia_assessment_address_line2','type','text',
      'label','Assessment Address Line 2','column',2),
    jsonb_build_object('name','building_id.building_city','type','related_field',
      'label','City','column',1,
      'related', jsonb_build_object('table','buildings','column','building_city',
                                    'fk_column','building_id','column_type','text')),
    jsonb_build_object('name','building_id.building_state','type','related_field',
      'label','State','column',2,
      'related', jsonb_build_object('table','buildings','column','building_state',
                                    'fk_column','building_id','column_type','text')),
    jsonb_build_object('name','building_id.building_zip','type','related_field',
      'label','ZIP Code','column',1,
      'related', jsonb_build_object('table','buildings','column','building_zip',
                                    'fk_column','building_id','column_type','text')),
    jsonb_build_object('name','ia_units_per_building','type','integer',
      'label','How many units are in the building?','column',2,'required',true),
    jsonb_build_object('name','ia_modeling_software_used','type','picklist',
      'label','What modeling software was used?','column',1,'required',true),
    jsonb_build_object('name','ia_ira_income_code','type','text',
      'label','IRA Income Code','column',2,'required',true),
    jsonb_build_object('name','ia_assessment_date','type','date',
      'label','Assessment Date','column',1,'required',true,'format','MM/DD/YY'),
    jsonb_build_object('name','ia_assessment_cost','type','currency',
      'label','Assessment Cost','column',2,'required',true),
    jsonb_build_object('name','ia_requested_incentive_amount','type','currency',
      'label','Requested Incentive Amount','column',1,'required',true),
    jsonb_build_object('name','ia_building_improvements','type','textarea',
      'label','Building Improvements','column',1,'required',true)
  )), '');

  v_sec_assessor := gen_random_uuid();
  INSERT INTO public.page_layout_sections
    (id, page_layout_id, section_order, section_label, section_columns,
     section_is_collapsible, section_is_collapsed_by_default, section_tab, section_placement)
  VALUES (v_sec_assessor, v_layout, 4, 'Assessor Information', 2, true, false, 'Details', 'main');
  INSERT INTO public.page_layout_widgets
    (id, page_layout_id, section_id, widget_type, widget_title, widget_column,
     widget_position, widget_config, page_layout_widget_record_number)
  VALUES (gen_random_uuid(), v_layout, v_sec_assessor, 'field_group', 'Assessor Information', 1, 1,
  jsonb_build_object('fields', jsonb_build_array(
    jsonb_build_object('name','ia_contractor_account_id','type','lookup',
      'label','Registered Contractor - Business Name','column',1,'required',true,
      'lookup_table','accounts','lookup_field','account_name'),
    jsonb_build_object('name','ia_contractor_account_id.billing_street','type','related_field',
      'label','Office Address','column',1,
      'related', jsonb_build_object('table','accounts','column','billing_street',
                                    'fk_column','ia_contractor_account_id','column_type','text')),
    jsonb_build_object('name','ia_contractor_account_id.billing_city','type','related_field',
      'label','Office City','column',1,
      'related', jsonb_build_object('table','accounts','column','billing_city',
                                    'fk_column','ia_contractor_account_id','column_type','text')),
    jsonb_build_object('name','ia_contractor_account_id.billing_state','type','related_field',
      'label','Office State','column',2,
      'related', jsonb_build_object('table','accounts','column','billing_state',
                                    'fk_column','ia_contractor_account_id','column_type','text')),
    jsonb_build_object('name','ia_contractor_account_id.billing_zip','type','related_field',
      'label','Office ZIP Code','column',2,
      'related', jsonb_build_object('table','accounts','column','billing_zip',
                                    'fk_column','ia_contractor_account_id','column_type','text')),
    jsonb_build_object('name','ia_payment_mailing_street','type','text','label','Payment Address','column',1,'required',true),
    jsonb_build_object('name','ia_payment_mailing_line2','type','text','label','Payment Address Line 2','column',2),
    jsonb_build_object('name','ia_payment_mailing_city','type','text','label','Payment City','column',1,'required',true),
    jsonb_build_object('name','ia_payment_mailing_state','type','text','label','Payment State','column',2,'required',true),
    jsonb_build_object('name','ia_payment_mailing_zip','type','text','label','Payment ZIP Code','column',1,'required',true),
    jsonb_build_object('name','ia_contractor_account_id.account_phone','type','related_field',
      'label','Phone','column',2,
      'related', jsonb_build_object('table','accounts','column','account_phone',
                                    'fk_column','ia_contractor_account_id','column_type','text')),
    jsonb_build_object('name','ia_contractor_account_id.account_email','type','related_field',
      'label','Email','column',1,
      'related', jsonb_build_object('table','accounts','column','account_email',
                                    'fk_column','ia_contractor_account_id','column_type','text'))
  )), '');

  v_sec_addl := gen_random_uuid();
  INSERT INTO public.page_layout_sections
    (id, page_layout_id, section_order, section_label, section_columns,
     section_is_collapsible, section_is_collapsed_by_default, section_tab, section_placement)
  VALUES (v_sec_addl, v_layout, 5, 'Additional Information', 2, true, false, 'Details', 'main');
  INSERT INTO public.page_layout_widgets
    (id, page_layout_id, section_id, widget_type, widget_title, widget_column,
     widget_position, widget_config, page_layout_widget_record_number)
  VALUES (gen_random_uuid(), v_layout, v_sec_addl, 'field_group', 'Additional Information', 1, 1,
  jsonb_build_object('fields', jsonb_build_array(
    jsonb_build_object('name','ia_moving_forward_with_homes','type','picklist',
      'label','Will the customer be moving forward with a HOMES project?','column',1),
    jsonb_build_object('name','ia_additional_comments','type','textarea',
      'label','Additional Comments','column',1)
  )), '');

  v_sec_terms := gen_random_uuid();
  INSERT INTO public.page_layout_sections
    (id, page_layout_id, section_order, section_label, section_columns,
     section_is_collapsible, section_is_collapsed_by_default, section_tab, section_placement)
  VALUES (v_sec_terms, v_layout, 6, 'Terms and Conditions and Signature', 1, true, false, 'Details', 'main');
  INSERT INTO public.page_layout_widgets
    (id, page_layout_id, section_id, widget_type, widget_title, widget_column,
     widget_position, widget_config, page_layout_widget_record_number)
  VALUES (gen_random_uuid(), v_layout, v_sec_terms, 'field_group', 'Terms and Conditions and Signature', 1, 1,
  jsonb_build_object('fields', jsonb_build_array(
    jsonb_build_object('name','ia_terms_and_conditions_agreed','type','boolean',
      'label','Read and agree to Focus on Energy and IRA Rebate Programs Terms and Conditions','column',1,'required',true),
    jsonb_build_object('name','ia_participation_agreement_agreed','type','boolean',
      'label','Read and agree to the IRA Registered Contractor Participation Agreement','column',1,'required',true),
    jsonb_build_object('name','ia_alternative_funding_attested','type','boolean',
      'label','No other funding sources were available to help offset the cost of this assessment','column',1,'required',true),
    jsonb_build_object('name','ia_model_update_agreed','type','boolean',
      'label','Agree to update the HPXML/BuildingSync file on request of the customer, Program, or Primary contractor','column',1,'required',true),
    jsonb_build_object('name','ia_application_confirmed','type','boolean',
      'label','Certify all information and answers herein are complete, true and correct','column',1,'required',true),
    jsonb_build_object('name','ia_signature_first_name','type','text',
      'label','Digital Signature - First Name','column',1,'required',true),
    jsonb_build_object('name','ia_signature_last_name','type','text',
      'label','Digital Signature - Last Name','column',1,'required',true)
  )), '');

  UPDATE public.page_layout_sections SET section_order = 7, updated_at = now() WHERE id = v_sec_track;
  UPDATE public.page_layout_sections SET section_order = 8, updated_at = now() WHERE id = v_sec_sys;

  UPDATE public.page_layout_widgets
     SET is_deleted = true, updated_at = now()
   WHERE section_id = v_sec_docs AND widget_type = 'file_gallery' AND is_deleted IS NOT TRUE;

  INSERT INTO public.page_layout_widgets
    (id, page_layout_id, section_id, widget_type, widget_title, widget_column,
     widget_position, widget_config, page_layout_widget_record_number)
  VALUES
    (gen_random_uuid(), v_layout, v_sec_docs, 'file_gallery', 'Asset Score', 1, 1,
     jsonb_build_object('target','documents','document_type','assessment_asset_score','required',true,
       'help_text','Upload a PDF of the asset score. An audit template is NOT required.'), ''),
    (gen_random_uuid(), v_layout, v_sec_docs, 'file_gallery', 'BuildingSync File', 1, 2,
     jsonb_build_object('target','documents','document_type','assessment_buildingsync_file','required',true,
       'help_text','Upload an .xml or .html file.'), ''),
    (gen_random_uuid(), v_layout, v_sec_docs, 'file_gallery', 'Invoice', 1, 3,
     jsonb_build_object('target','documents','document_type','assessment_invoice','required',true,
       'help_text','Invoices must follow IRA Home Energy Rebate invoicing requirements. PDF or image file types only.'), '');

  SELECT count(*) INTO v_n FROM public.page_layout_widgets w
   WHERE w.page_layout_id = v_layout AND w.is_deleted IS NOT TRUE AND w.widget_type = 'field_group';
  IF v_n <> 8 THEN
    RAISE EXCEPTION 'Expected 8 field groups on PL-00304, found %', v_n;
  END IF;
END $$;
