-- Own, never-shared opportunity stage picklist for the NC single-family HOMES
-- audit opportunity record type (nc_ira_sf_homes_audit). The record type existed
-- but had no stages scoped to it, so an opportunity of this type had an empty
-- stage path. Assessment -> Enrollment lifecycle; each stage implies the next
-- action. Admin-editable. Scoped via picklist_value_record_type_assignments so
-- these stages belong to this record type alone.
INSERT INTO public.picklist_values
  (id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_at, picklist_created_by, picklist_state, picklist_show_in_path)
VALUES
  (gen_random_uuid(),'opportunities','opportunity_stage','Opportunity — NC SF HOMES Audit: Site Visit To Be Scheduled','Site Visit To Be Scheduled',true,1,now(),'c5a01ec8-960f-42ab-8a9e-a49822de89af','NC',true),
  (gen_random_uuid(),'opportunities','opportunity_stage','Opportunity — NC SF HOMES Audit: Site Visit Scheduled','Site Visit Scheduled',true,2,now(),'c5a01ec8-960f-42ab-8a9e-a49822de89af','NC',true),
  (gen_random_uuid(),'opportunities','opportunity_stage','Opportunity — NC SF HOMES Audit: Assessment Completed','Assessment Completed',true,3,now(),'c5a01ec8-960f-42ab-8a9e-a49822de89af','NC',true),
  (gen_random_uuid(),'opportunities','opportunity_stage','Opportunity — NC SF HOMES Audit: Scope & Pricing','Scope & Pricing',true,4,now(),'c5a01ec8-960f-42ab-8a9e-a49822de89af','NC',true),
  (gen_random_uuid(),'opportunities','opportunity_stage','Opportunity — NC SF HOMES Audit: Proposal Sent','Proposal Sent',true,5,now(),'c5a01ec8-960f-42ab-8a9e-a49822de89af','NC',true),
  (gen_random_uuid(),'opportunities','opportunity_stage','Opportunity — NC SF HOMES Audit: Enrolled','Enrolled',true,6,now(),'c5a01ec8-960f-42ab-8a9e-a49822de89af','NC',true),
  (gen_random_uuid(),'opportunities','opportunity_stage','Opportunity — NC SF HOMES Audit: Closed Lost','Closed Lost',true,7,now(),'c5a01ec8-960f-42ab-8a9e-a49822de89af','NC',true)
ON CONFLICT DO NOTHING;

INSERT INTO public.picklist_value_record_type_assignments
  (pvrta_record_number, pvrta_picklist_value_id, pvrta_record_type_id, pvrta_owner, pvrta_created_by, pvrta_created_at, pvrta_updated_by, pvrta_updated_at, pvrta_sort_order)
SELECT '', pv.id,
       (SELECT id FROM public.picklist_values WHERE picklist_object='opportunities' AND picklist_field='record_type' AND picklist_value='nc_ira_sf_homes_audit' LIMIT 1),
       'c5a01ec8-960f-42ab-8a9e-a49822de89af','c5a01ec8-960f-42ab-8a9e-a49822de89af', now(),
       'c5a01ec8-960f-42ab-8a9e-a49822de89af', now(), pv.picklist_sort_order
FROM public.picklist_values pv
WHERE pv.picklist_object='opportunities' AND pv.picklist_field='opportunity_stage'
  AND pv.picklist_state='NC'
  AND pv.picklist_value LIKE 'Opportunity — NC SF HOMES Audit:%'
  AND NOT EXISTS (
    SELECT 1 FROM public.picklist_value_record_type_assignments x
     WHERE x.pvrta_picklist_value_id = pv.id
       AND x.pvrta_record_type_id = (SELECT id FROM public.picklist_values WHERE picklist_object='opportunities' AND picklist_field='record_type' AND picklist_value='nc_ira_sf_homes_audit' LIMIT 1)
       AND x.pvrta_is_deleted IS NOT TRUE
  );
