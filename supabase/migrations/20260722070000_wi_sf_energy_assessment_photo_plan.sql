-- Wisconsin single-family energy assessment: a lightweight, photo-only work
-- plan for a SnuggPro-style assessment. The auditor visits the home and
-- captures the essential documentation photos — no measurements, kept
-- deliberately lean. Work type is technician-creatable so the auditor can
-- create the work order on-site in LEAP Pad; the default work plan template
-- auto-instantiates the photo steps.
--
-- Roles follow the field pattern (there is no "Energy Auditor" role):
--   owner   = Lead Technician       (4a93279e-f88e-4f12-9db8-6bd4e0e80262)
--   verifier= Project Site Lead     (7495dd05-ec12-4dc0-ad07-db53daf78487)
-- Evidence = Photo                  (16130b3e-e416-4d92-bf23-ec0f8aeee3e1)
--
-- NOTE: work_plan_templates / work_step_templates / work_plan_template_entries /
-- work_types all carry auto-number triggers on their *_record_number columns —
-- pass '' and the trigger assigns the next number. Steps are linked to the plan
-- by the captured template id + step name (unique within this batch), never by a
-- passed record number, since those are trigger-assigned.

DO $$
DECLARE
  v_admin uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_owner uuid := '4a93279e-f88e-4f12-9db8-6bd4e0e80262';   -- Lead Technician
  v_ver   uuid := '7495dd05-ec12-4dc0-ad07-db53daf78487';   -- Project Site Lead
  v_photo uuid := '16130b3e-e416-4d92-bf23-ec0f8aeee3e1';   -- Photo evidence
  v_wpt   uuid;
BEGIN
  -- 1. Work plan template.
  INSERT INTO public.work_plan_templates
    (id, wpt_record_number, wpt_name, wpt_description, wpt_is_active, wpt_owner, wpt_created_by, wpt_created_at, wpt_updated_by, wpt_updated_at)
  VALUES
    (gen_random_uuid(), '', 'Wisconsin Single-Family Energy Assessment - Photo Documentation',
     'Essential photo documentation for a single-family energy assessment (SnuggPro-style). Lean set of required photos; no measurements.',
     true, v_admin, v_admin, now(), v_admin, now())
  RETURNING id INTO v_wpt;

  -- 2. Work step templates (photo steps).
  INSERT INTO public.work_step_templates
    (id, wst_record_number, wst_name, wst_description, wst_action_definition, wst_is_active,
     wst_owner, wst_created_by, wst_created_at, wst_updated_by, wst_updated_at,
     wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id,
     wst_photos_required_count, wst_completion_notifies_project_coordinator)
  VALUES
    (gen_random_uuid(),'','Front of Home Photo','Front of the home showing the front door and house number.','Take one photo of the front of the home (front door + house number visible).',true,v_admin,v_admin,now(),v_admin,now(),v_owner,v_ver,v_photo,1,false),
    (gen_random_uuid(),'','Mechanical Area - Wide Shot','Wide photo of the mechanical / utility area with all equipment in view.','Take one wide photo showing the heating, cooling, and water heating equipment together in the mechanical area.',true,v_admin,v_admin,now(),v_admin,now(),v_owner,v_ver,v_photo,1,false),
    (gen_random_uuid(),'','Heating System Photo','The furnace or boiler.','Take one photo of the heating equipment (furnace or boiler).',true,v_admin,v_admin,now(),v_admin,now(),v_owner,v_ver,v_photo,1,false),
    (gen_random_uuid(),'','Air Conditioning System Photo','The AC condenser / cooling equipment.','Take one photo of the cooling equipment (condenser or room AC). Mark Not Applicable if the home has none.',true,v_admin,v_admin,now(),v_admin,now(),v_owner,v_ver,v_photo,1,false),
    (gen_random_uuid(),'','Water Heating System Photo','The water heater.','Take one photo of the water heater.',true,v_admin,v_admin,now(),v_admin,now(),v_owner,v_ver,v_photo,1,false),
    (gen_random_uuid(),'','Equipment Nameplates','Nameplate photos for heating, cooling, and water heating equipment.','Take clear, legible nameplate photos (model + serial) for the heating, cooling, and water heating equipment.',true,v_admin,v_admin,now(),v_admin,now(),v_owner,v_ver,v_photo,3,false),
    (gen_random_uuid(),'','Attic Insulation Photo','Attic insulation depth / coverage.','Take one photo of the attic insulation. Mark Not Applicable if there is no attic access.',true,v_admin,v_admin,now(),v_admin,now(),v_owner,v_ver,v_photo,1,false),
    (gen_random_uuid(),'','Kitchen Exhaust Fan Photo','The kitchen exhaust fan / range hood.','Take one photo of the kitchen exhaust fan or range hood.',true,v_admin,v_admin,now(),v_admin,now(),v_owner,v_ver,v_photo,1,false),
    (gen_random_uuid(),'','Bath Exhaust Fan Photo','The bathroom exhaust fan.','Take one photo of the bathroom exhaust fan. Capture each bath fan if there is more than one.',true,v_admin,v_admin,now(),v_admin,now(),v_owner,v_ver,v_photo,1,false),
    (gen_random_uuid(),'','Thermostat Photo','The thermostat.','Take one photo of the thermostat.',true,v_admin,v_admin,now(),v_admin,now(),v_owner,v_ver,v_photo,1,false),
    (gen_random_uuid(),'','Electrical Panel Photo','The main electrical panel.','Take one photo of the main electrical panel.',true,v_admin,v_admin,now(),v_admin,now(),v_owner,v_ver,v_photo,1,false);

  -- 3. Plan entries (ordered) — link each step to the template by name + order.
  INSERT INTO public.work_plan_template_entries
    (id, wpte_record_number, wpte_name, work_plan_template_id, work_step_template_id, wpte_execution_order,
     wpte_created_by, wpte_created_at, wpte_updated_by, wpte_updated_at)
  SELECT gen_random_uuid(), '', wst.wst_name, v_wpt, wst.id, s.ord, v_admin, now(), v_admin, now()
  FROM (VALUES
    ('Front of Home Photo',1),('Mechanical Area - Wide Shot',2),('Heating System Photo',3),
    ('Air Conditioning System Photo',4),('Water Heating System Photo',5),('Equipment Nameplates',6),
    ('Attic Insulation Photo',7),('Kitchen Exhaust Fan Photo',8),('Bath Exhaust Fan Photo',9),
    ('Thermostat Photo',10),('Electrical Panel Photo',11)
  ) AS s(step_name, ord)
  JOIN public.work_step_templates wst ON wst.wst_name = s.step_name AND wst.wst_owner = v_admin
   AND wst.wst_created_at >= now() - interval '1 minute';

  -- 4. Work type (technician-creatable; default plan + Assessment WO record type
  --    + single-family energy assessment project record type).
  INSERT INTO public.work_types
    (id, work_type_record_number, work_type_name, work_type_description, work_type_is_active,
     work_type_is_technician_creatable, work_type_default_work_order_record_type,
     work_type_default_work_plan_template_id, work_type_default_project_record_type,
     work_type_duration_minutes, work_type_owner, work_type_created_by, work_type_created_at,
     work_type_updated_by, work_type_updated_at)
  VALUES
    (gen_random_uuid(), '', 'Wisconsin Single-Family Energy Assessment',
     'On-site single-family energy assessment. Captures the essential documentation photos for a SnuggPro-style assessment.',
     true, true,
     'ecc1a946-3943-4d64-9f33-adfc3573a6c1',
     v_wpt,
     'e5e3a581-45e0-4b34-a80d-b9dbea8382e8',
     90, v_admin, v_admin, now(), v_admin, now());
END $$;
