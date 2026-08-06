-- =====================================================================
-- Multifamily BUILDING Energy Assessment — Phase 1 foundation (Nicholas,
-- 2026-08-06). The building-level parallel of the shipped Single-Family
-- Energy Assessment: ONE scheduled work order per multifamily building
-- (unit_id = NULL) whose guided, photo-first screen-flow sections capture
-- every DOE Building Energy Asset Score (Full Input Mode) and ASHRAE/ACCA
-- 211 Level 2 data point at the BUILDING level — whole-building geometry,
-- envelope, central/common-area systems, the system TYPE serving the
-- units, common-area lighting, building diagnostics, and back-office
-- utility/energy + occupancy data.
--
-- Scope: this is the building-level audit tool. Granular per-apartment
-- (unit-level) data collection is a SEPARATE tool and is intentionally
-- not built here — no unit sampling, no per-unit work orders.
-- Spec: docs/leap-multifamily-energy-assessment.md.
--
-- Reuses the generic capture engine exactly as the SF assessment does
-- (work_step_templates.wst_is_screen_flow, work_plan_templates.
-- wpt_allow_any_order, the photo/field/complete RPCs + evidence gate).
-- All field names are mf_-prefixed so the work_step_fields option lists
-- are independent of the single-family flow (no cross-purpose reuse).
--
-- Adopts the pre-existing stub work type WT-00074 "Multifamily Energy
-- Assessment" (find-or-create by name; never duplicated) and the existing
-- project record type MULTIFAMILY-ENERGY-ASSESSMENT + MULTIFAMILY building
-- record type. Creates the work_orders + opportunities record types (the
-- opportunity type gets its own never-shared stage picklist via pvrta).
-- =====================================================================

-- ── 1. Record types ──────────────────────────────────────────────────────────
-- work_orders record type
INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
SELECT 'work_orders','record_type','MULTIFAMILY-ENERGY-ASSESSMENT','Multifamily Energy Assessment', true,
       (SELECT COALESCE(max(picklist_sort_order),0)+1 FROM public.picklist_values WHERE picklist_object='work_orders' AND picklist_field='record_type'),
       'c5a01ec8-960f-42ab-8a9e-a49822de89af'
WHERE NOT EXISTS (SELECT 1 FROM public.picklist_values WHERE picklist_object='work_orders' AND picklist_field='record_type' AND picklist_value='MULTIFAMILY-ENERGY-ASSESSMENT');

-- opportunities record type + its OWN never-shared stage picklist (absolute rule), scoped via pvrta.
DO $$
DECLARE
  v_nick uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_rt   uuid;
  v_open uuid;
  v_done uuid;
BEGIN
  SELECT id INTO v_rt FROM public.picklist_values
   WHERE picklist_object='opportunities' AND picklist_field='record_type' AND picklist_value='MULTIFAMILY-ENERGY-ASSESSMENT';
  IF v_rt IS NULL THEN
    INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
    VALUES ('opportunities','record_type','MULTIFAMILY-ENERGY-ASSESSMENT','Multifamily Energy Assessment', true,
            (SELECT COALESCE(max(picklist_sort_order),0)+1 FROM public.picklist_values WHERE picklist_object='opportunities' AND picklist_field='record_type'),
            v_nick)
    RETURNING id INTO v_rt;
  END IF;

  SELECT id INTO v_open FROM public.picklist_values
   WHERE picklist_object='opportunities' AND picklist_field='opportunity_stage' AND picklist_value='Opportunity — Multifamily Assessment Open';
  IF v_open IS NULL THEN
    INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
    VALUES ('opportunities','opportunity_stage','Opportunity — Multifamily Assessment Open','Opportunity — Multifamily Assessment Open', true, 10, v_nick)
    RETURNING id INTO v_open;
  END IF;

  SELECT id INTO v_done FROM public.picklist_values
   WHERE picklist_object='opportunities' AND picklist_field='opportunity_stage' AND picklist_value='Opportunity — Multifamily Assessment Completed';
  IF v_done IS NULL THEN
    INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
    VALUES ('opportunities','opportunity_stage','Opportunity — Multifamily Assessment Completed','Opportunity — Multifamily Assessment Completed', true, 20, v_nick)
    RETURNING id INTO v_done;
  END IF;

  INSERT INTO public.picklist_value_record_type_assignments (pvrta_record_number, pvrta_picklist_value_id, pvrta_record_type_id, pvrta_owner, pvrta_created_by, pvrta_sort_order)
  SELECT '', s.id, v_rt, v_nick, v_nick, s.picklist_sort_order
  FROM public.picklist_values s
  WHERE s.id IN (v_open, v_done)
    AND NOT EXISTS (SELECT 1 FROM public.picklist_value_record_type_assignments a
                    WHERE a.pvrta_picklist_value_id = s.id AND a.pvrta_record_type_id = v_rt AND a.pvrta_is_deleted IS NOT TRUE);
END $$;

-- ── 2. Option lists for every mf_ select field (idempotent) ───────────────────
INSERT INTO public.picklist_values (id,picklist_object,picklist_field,picklist_value,picklist_label,picklist_is_active,picklist_sort_order,picklist_created_by)
SELECT gen_random_uuid(),'work_step_fields',d.field,d.val,d.val,true,d.ord,'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM (VALUES
  -- Geometry & Use
  ('mf_use_type','Multifamily (4 stories +)',10),('mf_use_type','Multifamily (less than 4 stories)',20),('mf_use_type','Mixed-Use (residential + commercial)',30),('mf_use_type','Assisted Living',40),('mf_use_type','Senior Housing',50),
  ('mf_orientation','Front faces North',10),('mf_orientation','Front faces Northeast',20),('mf_orientation','Front faces East',30),('mf_orientation','Front faces Southeast',40),('mf_orientation','Front faces South',50),('mf_orientation','Front faces Southwest',60),('mf_orientation','Front faces West',70),('mf_orientation','Front faces Northwest',80),
  -- Roof
  ('mf_roof_type','Built-up w/ Concrete Deck',10),('mf_roof_type','Built-up w/ Metal Deck',20),('mf_roof_type','Built-up w/ Wood Deck',30),('mf_roof_type','Metal Surfacing',40),('mf_roof_type','Shingles/Shakes',50),('mf_roof_type','Flat Membrane (EPDM/TPO)',60),('mf_roof_type','Pitched w/ Attic',70),
  ('mf_roof_insulation_thickness','None',10),('mf_roof_insulation_thickness','1–3 in',20),('mf_roof_insulation_thickness','4–6 in',30),('mf_roof_insulation_thickness','7–9 in',40),('mf_roof_insulation_thickness','10–12 in',50),('mf_roof_insulation_thickness','13+ in',60),('mf_roof_insulation_thickness','Unknown',70),
  ('mf_roof_insulation_type','Fiberglass Batt',10),('mf_roof_insulation_type','Blown Cellulose',20),('mf_roof_insulation_type','Blown Fiberglass',30),('mf_roof_insulation_type','Rigid Foam',40),('mf_roof_insulation_type','Spray Foam',50),('mf_roof_insulation_type','None',60),('mf_roof_insulation_type','Unknown',70),
  -- Walls
  ('mf_wall_type','Brick/Stone on Masonry',10),('mf_wall_type','Brick/Stone on Steel Frame',20),('mf_wall_type','Brick/Stone on Wood Frame',30),('mf_wall_type','Metal Panel/Curtain Wall',40),('mf_wall_type','Siding on Steel Frame',50),('mf_wall_type','Siding on Wood Frame',60),('mf_wall_type','Concrete Block (CMU)',70),
  ('mf_wall_insulation','None',10),('mf_wall_insulation','Cavity',20),('mf_wall_insulation','Continuous',30),('mf_wall_insulation','Cavity + Continuous',40),('mf_wall_insulation','Unknown',50),
  ('mf_wall_insulation_thickness','None',10),('mf_wall_insulation_thickness','1–2 in',20),('mf_wall_insulation_thickness','3–4 in',30),('mf_wall_insulation_thickness','5–6 in',40),('mf_wall_insulation_thickness','7+ in',50),('mf_wall_insulation_thickness','Unknown',60),
  -- Foundation / Floor
  ('mf_foundation_type','Slab on Grade',10),('mf_foundation_type','Conditioned Basement',20),('mf_foundation_type','Unconditioned Basement',30),('mf_foundation_type','Vented Crawlspace',40),('mf_foundation_type','Unvented Crawlspace',50),('mf_foundation_type','Pier & Beam',60),
  ('mf_floor_type','Concrete Slab',10),('mf_floor_type','Slab on Grade',20),('mf_floor_type','Steel Joist',30),('mf_floor_type','Wood Frame',40),
  ('mf_foundation_insulation','None',10),('mf_foundation_insulation','Foundation Wall',20),('mf_foundation_insulation','Under Slab',30),('mf_foundation_insulation','Floor / Rim Joist',40),('mf_foundation_insulation','Unknown',50),
  -- Windows & Doors
  ('mf_window_frame_type','Metal',10),('mf_window_frame_type','Metal w/ Thermal Break',20),('mf_window_frame_type','Wood/Vinyl/Fiberglass',30),
  ('mf_window_glass_type','Single-pane',10),('mf_window_glass_type','Double-pane',20),('mf_window_glass_type','Double-pane w/ Low-E',30),('mf_window_glass_type','Triple-pane',40),('mf_window_glass_type','Triple-pane w/ Low-E',50),
  ('mf_door_type','Insulated Metal',10),('mf_door_type','Fiberglass',20),('mf_door_type','Wood',30),('mf_door_type','Sliding Glass',40),('mf_door_type','Storefront/Glass',50),
  -- Heating
  ('mf_heating_serves','Central plant — whole building',10),('mf_heating_serves','One system per unit',20),('mf_heating_serves','Common areas only',30),('mf_heating_serves','District / Campus',40),
  ('mf_heating_system_type','Central Boiler (Hot Water)',10),('mf_heating_system_type','Central Boiler (Steam)',20),('mf_heating_system_type','Central Furnace',30),('mf_heating_system_type','Packaged Terminal Heat Pump (PTHP)',40),('mf_heating_system_type','Air-Source Heat Pump',50),('mf_heating_system_type','Ground-Source Heat Pump',60),('mf_heating_system_type','Water-Loop Heat Pump',70),('mf_heating_system_type','Variable Refrigerant Flow (VRF)',80),('mf_heating_system_type','Electric Resistance Baseboard',90),('mf_heating_system_type','Hydronic Baseboard',100),('mf_heating_system_type','Warm Air Furnace',110),('mf_heating_system_type','District Hot Water',120),
  ('mf_heating_fuel','Natural Gas',10),('mf_heating_fuel','Electric',20),('mf_heating_fuel','Fuel Oil',30),('mf_heating_fuel','Propane',40),('mf_heating_fuel','District',50),
  ('mf_heating_condition','Good',10),('mf_heating_condition','Fair',20),('mf_heating_condition','Poor',30),
  -- Cooling
  ('mf_cooling_serves','Central plant — whole building',10),('mf_cooling_serves','One system per unit',20),('mf_cooling_serves','Common areas only',30),('mf_cooling_serves','District / Campus',40),('mf_cooling_serves','No cooling',50),
  ('mf_cooling_system_type','No Cooling',10),('mf_cooling_system_type','DX Split System',20),('mf_cooling_system_type','Packaged Rooftop AC',30),('mf_cooling_system_type','Packaged Terminal AC (PTAC)',40),('mf_cooling_system_type','Chiller (Plant Loop)',50),('mf_cooling_system_type','District Chilled Water',60),('mf_cooling_system_type','Variable Refrigerant Flow (VRF)',70),('mf_cooling_system_type','Window AC',80),('mf_cooling_system_type','Evaporative Cooler',90),
  ('mf_cooling_compressor_type','Scroll/Screw',10),('mf_cooling_compressor_type','Reciprocating',20),('mf_cooling_compressor_type','Centrifugal',30),
  ('mf_cooling_condenser_type','Air-Cooled',10),('mf_cooling_condenser_type','Water-Cooled',20),('mf_cooling_condenser_type','Cooling Tower',30),('mf_cooling_condenser_type','Ground Heat Exchanger',40),
  ('mf_cooling_condition','Good',10),('mf_cooling_condition','Fair',20),('mf_cooling_condition','Poor',30),
  -- Distribution & Ventilation
  ('mf_distribution_type','Air Handler Unit (AHU)',10),('mf_distribution_type','Zone Equipment',20),('mf_distribution_type','Hydronic (Piped)',30),('mf_distribution_type','Ducted Forced Air',40),('mf_distribution_type','None',50),
  ('mf_duct_location','Conditioned Space',10),('mf_duct_location','Unconditioned Attic',20),('mf_duct_location','Unconditioned Basement',30),('mf_duct_location','Crawlspace',40),('mf_duct_location','Wall/Chase',50),('mf_duct_location','N/A',60),
  ('mf_duct_insulation','None',10),('mf_duct_insulation','R-4',20),('mf_duct_insulation','R-6',30),('mf_duct_insulation','R-8',40),('mf_duct_insulation','Unknown',50),('mf_duct_insulation','N/A',60),
  ('mf_ventilation_type','Natural',10),('mf_ventilation_type','Exhaust-Only',20),('mf_ventilation_type','Supply-Only',30),('mf_ventilation_type','Balanced (HRV)',40),('mf_ventilation_type','Balanced (ERV)',50),('mf_ventilation_type','Dedicated Outdoor Air System (DOAS)',60),
  -- Service Hot Water
  ('mf_dhw_serves','Central — whole building',10),('mf_dhw_serves','One per unit',20),('mf_dhw_serves','Common areas only',30),
  ('mf_dhw_system_type','Storage Tank',10),('mf_dhw_system_type','Tankless / Instantaneous',20),('mf_dhw_system_type','Heat Pump Water Heater',30),('mf_dhw_system_type','Central Boiler (Indirect)',40),('mf_dhw_system_type','Solar w/ Backup',50),('mf_dhw_system_type','District Hot Water',60),
  ('mf_dhw_fuel','Natural Gas',10),('mf_dhw_fuel','Electric',20),('mf_dhw_fuel','Propane',30),('mf_dhw_fuel','Fuel Oil',40),('mf_dhw_fuel','District',50),
  ('mf_dhw_recirc','Yes',10),('mf_dhw_recirc','No',20),
  -- Common-Area Lighting
  ('mf_lighting_type','LED',10),('mf_lighting_type','CFL',20),('mf_lighting_type','Fluorescent T5 / High-Output T5',30),('mf_lighting_type','Fluorescent T8 / Super T8',40),('mf_lighting_type','Fluorescent T12 / High-Output T12',50),('mf_lighting_type','Incandescent / Halogen',60),('mf_lighting_type','High-Pressure Sodium',70),('mf_lighting_type','Metal Halide',80),('mf_lighting_type','Mercury Vapor',90),
  ('mf_lighting_mounting','Recessed',10),('mf_lighting_mounting','Surface',20),('mf_lighting_mounting','Pendant',30),('mf_lighting_mounting','Wall',40),
  ('mf_lighting_controls','None',10),('mf_lighting_controls','Occupancy Sensor',20),('mf_lighting_controls','Timer',30),('mf_lighting_controls','Daylight / Photocell',40),('mf_lighting_controls','Manual',50),
  ('mf_inunit_lighting_pct','0–25%',10),('mf_inunit_lighting_pct','26–50%',20),('mf_inunit_lighting_pct','51–75%',30),('mf_inunit_lighting_pct','76–100%',40),('mf_inunit_lighting_pct','Unknown',50),
  -- Building Diagnostics
  ('mf_combustion_present','Yes',10),('mf_combustion_present','No',20),
  ('mf_combustion_draft','Pass',10),('mf_combustion_draft','Fail',20),('mf_combustion_draft','N/A',30),
  ('mf_gas_leak_found','None Found',10),('mf_gas_leak_found','Found — Minor',20),('mf_gas_leak_found','Found — Major',30),('mf_gas_leak_found','N/A',40),
  -- Utility & Energy Data
  ('mf_other_fuel_type','None',10),('mf_other_fuel_type','Fuel Oil',20),('mf_other_fuel_type','Propane',30),('mf_other_fuel_type','District Steam',40),('mf_other_fuel_type','District Hot Water',50),('mf_other_fuel_type','District Chilled Water',60)
) AS d(field,val,ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values pv
  WHERE pv.picklist_object='work_step_fields' AND pv.picklist_field=d.field AND pv.picklist_value=d.val
);

-- ── 3. Work plan + all building-level sections + wire the work type ───────────
DO $$
DECLARE
  v_nick  uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_lead  uuid := '4a93279e-f88e-4f12-9db8-6bd4e0e80262'; -- Lead Technician (owner)
  v_psl   uuid := '7495dd05-ec12-4dc0-ad07-db53daf78487'; -- Project Site Lead (verifier)
  v_photo uuid := '16130b3e-e416-4d92-bf23-ec0f8aeee3e1'; -- Photo evidence type
  v_video uuid := 'd92d0e0e-1075-4b75-b8f5-d3f8cf9c8bf8'; -- Video evidence type
  v_rt    uuid;
  v_wpt   uuid;
  v_wt    uuid;
  v_step  uuid;
  v_fresh boolean := false;
BEGIN
  SELECT id INTO v_rt FROM public.picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='record_type' AND picklist_value='MULTIFAMILY-ENERGY-ASSESSMENT';

  SELECT id INTO v_wpt FROM public.work_plan_templates
   WHERE wpt_name='Multifamily Building Energy Assessment - Standard' AND wpt_is_deleted IS NOT TRUE
   ORDER BY wpt_created_at LIMIT 1;

  IF v_wpt IS NULL THEN
    INSERT INTO public.work_plan_templates (wpt_record_number, wpt_name, wpt_description, wpt_is_active, wpt_allow_any_order, wpt_owner, wpt_created_by)
    VALUES ('', 'Multifamily Building Energy Assessment - Standard',
      'Building-level multifamily energy assessment. Each section is a photo-first guided screen flow the auditor completes in any order. Captures DOE Asset Score (Full Input Mode) and ASHRAE 211 Level 2 building-level data: geometry & use, whole-building envelope, central & building systems, common-area lighting, diagnostics, and back-office utility/energy + occupancy data. Per-unit data collection is a separate tool.',
      true, true, v_nick, v_nick)
    RETURNING id INTO v_wpt;
    v_fresh := true;
  END IF;

  IF v_fresh THEN
    ---------------------------------------------------------------- 1. Building Photos
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Building Photos',v_nick,v_nick,'Photograph each face of the building.',true,v_lead,v_psl,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_help_text) VALUES
      ('',v_nick,v_nick,v_step,'Front Elevation','mf_elev_front','photo',true,1,true,'The main/front face of the building.'),
      ('',v_nick,v_nick,v_step,'Left Elevation','mf_elev_left','photo',true,2,true,NULL),
      ('',v_nick,v_nick,v_step,'Right Elevation','mf_elev_right','photo',true,3,true,NULL),
      ('',v_nick,v_nick,v_step,'Rear Elevation','mf_elev_rear','photo',true,4,true,NULL);
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Building Photos',v_nick,v_wpt,v_step,1);

    ---------------------------------------------------------------- 2. Building 360 Video
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Building 360 Video',v_nick,v_nick,'Walk the building perimeter capturing a full-circle 360 video (a full phone pan around the site).',true,v_lead,v_psl,v_video,0,false) RETURNING id INTO v_step;
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Building 360 Video',v_nick,v_wpt,v_step,2);

    ---------------------------------------------------------------- 3. Building Geometry & Use
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Building Geometry & Use',v_nick,v_nick,'Whole-building size, shape, and use — the Asset Score geometry inputs.',true,v_lead,v_psl,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_nick,v_nick,v_step,'Building Use Type','mf_use_type','select',true,1,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Gross Floor Area','mf_gross_floor_area','number',true,2,true,'sq ft','Total conditioned floor area of the whole building.'),
      ('',v_nick,v_nick,v_step,'Footprint Length','mf_footprint_length','number',true,3,true,'ft','Longest outside dimension of the building footprint.'),
      ('',v_nick,v_nick,v_step,'Footprint Width','mf_footprint_width','number',true,4,true,'ft','The other outside footprint dimension.'),
      ('',v_nick,v_nick,v_step,'Number of Floors','mf_num_floors','number',true,5,true,NULL,'Above-grade stories.'),
      ('',v_nick,v_nick,v_step,'Orientation','mf_orientation','select',true,6,true,NULL,'Compass direction the FRONT of the building faces.'),
      ('',v_nick,v_nick,v_step,'Year Built','mf_year_built','number',true,7,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Year of Last Major Retrofit','mf_year_retrofit','number',false,8,true,NULL,'Leave blank if none.'),
      ('',v_nick,v_nick,v_step,'Total Dwelling Units','mf_total_units','number',true,9,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Total Bedrooms (all units)','mf_num_bedrooms_total','number',false,10,true,NULL,NULL);
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Building Geometry & Use',v_nick,v_wpt,v_step,3);

    ---------------------------------------------------------------- 4. Roof / Ceiling
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Roof / Ceiling',v_nick,v_nick,'Roof construction and insulation.',true,v_lead,v_psl,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_nick,v_nick,v_step,'Roof Type','mf_roof_type','select',true,1,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Insulation Thickness','mf_roof_insulation_thickness','select',true,2,true,NULL,'Best-matching depth range — the model derives the R-value.'),
      ('',v_nick,v_nick,v_step,'Insulation Type','mf_roof_insulation_type','select',false,3,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'R-Value','mf_roof_r_value','number',false,4,true,NULL,'Only if known from documentation.'),
      ('',v_nick,v_nick,v_step,'Roof','mf_roof_photo','photo',true,5,true,NULL,'Roof surface or attic insulation.');
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Roof / Ceiling',v_nick,v_wpt,v_step,4);

    ---------------------------------------------------------------- 5. Walls
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Walls',v_nick,v_nick,'Exterior wall construction and insulation.',true,v_lead,v_psl,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_nick,v_nick,v_step,'Wall Type','mf_wall_type','select',true,1,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Wall Insulation','mf_wall_insulation','select',false,2,true,NULL,'Cavity = between studs; Continuous = rigid foam.'),
      ('',v_nick,v_nick,v_step,'Insulation Thickness','mf_wall_insulation_thickness','select',false,3,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'R-Value','mf_wall_r_value','number',false,4,true,NULL,'Only if known from documentation.'),
      ('',v_nick,v_nick,v_step,'Exterior Wall','mf_wall_photo','photo',true,5,true,NULL,'A representative exterior wall.');
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Walls',v_nick,v_wpt,v_step,5);

    ---------------------------------------------------------------- 6. Foundation / Floor
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Foundation / Floor',v_nick,v_nick,'Foundation type and floor/slab insulation.',true,v_lead,v_psl,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_help_text) VALUES
      ('',v_nick,v_nick,v_step,'Foundation Type','mf_foundation_type','select',true,1,true,NULL),
      ('',v_nick,v_nick,v_step,'Floor Type','mf_floor_type','select',true,2,true,NULL),
      ('',v_nick,v_nick,v_step,'Foundation / Floor Insulation','mf_foundation_insulation','select',false,3,true,NULL),
      ('',v_nick,v_nick,v_step,'Foundation / Floor','mf_foundation_photo','photo',true,4,true,'Basement, crawlspace, or slab edge.');
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Foundation / Floor',v_nick,v_wpt,v_step,6);

    ---------------------------------------------------------------- 7. Windows & Doors
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Windows & Doors',v_nick,v_nick,'Window frame/glazing, window-to-wall ratio, and primary door type.',true,v_lead,v_psl,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_nick,v_nick,v_step,'Window Frame','mf_window_frame_type','select',true,1,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Glass Type','mf_window_glass_type','select',true,2,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Window-to-Wall Ratio','mf_window_wwr','number',false,3,true,'%','Glazed area as a share of exterior wall area — estimate is fine.'),
      ('',v_nick,v_nick,v_step,'Approx. Number of Windows','mf_window_count','number',false,4,true,NULL,'Use if a window-to-wall ratio is hard to estimate.'),
      ('',v_nick,v_nick,v_step,'U-Value','mf_window_u_value','number',false,5,true,NULL,'From the NFRC label, if present.'),
      ('',v_nick,v_nick,v_step,'SHGC','mf_window_shgc','number',false,6,true,NULL,'From the NFRC label, if present.'),
      ('',v_nick,v_nick,v_step,'Primary Door Type','mf_door_type','select',false,7,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Windows','mf_window_photo','photo',true,8,true,NULL,'A representative window (and its NFRC label if present).');
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Windows & Doors',v_nick,v_wpt,v_step,7);

    ---------------------------------------------------------------- 8. Heating Systems
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Heating Systems',v_nick,v_nick,'The heating system(s) serving the building — central plant or the type serving the units.',true,v_lead,v_psl,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_nick,v_nick,v_step,'System Serves','mf_heating_serves','select',true,1,true,NULL,'How heating is delivered across the building.'),
      ('',v_nick,v_nick,v_step,'Heating System Type','mf_heating_system_type','select',true,2,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Fuel','mf_heating_fuel','select',true,3,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Capacity','mf_heating_capacity','number',false,4,true,'BTU/h','From the nameplate, if legible.'),
      ('',v_nick,v_nick,v_step,'Efficiency (AFUE)','mf_heating_efficiency_afue','number',false,5,true,'%','For fuel-fired systems.'),
      ('',v_nick,v_nick,v_step,'HSPF','mf_heating_hspf','number',false,6,true,NULL,'For heat pumps.'),
      ('',v_nick,v_nick,v_step,'Year of Manufacture','mf_heating_year','number',false,7,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Condition','mf_heating_condition','select',false,8,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Heating System','mf_heating_photo','photo',true,9,true,NULL,'The system and its nameplate.');
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Heating Systems',v_nick,v_wpt,v_step,8);

    ---------------------------------------------------------------- 9. Cooling Systems
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Cooling Systems',v_nick,v_nick,'The cooling system(s) serving the building.',true,v_lead,v_psl,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_nick,v_nick,v_step,'System Serves','mf_cooling_serves','select',true,1,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Cooling System Type','mf_cooling_system_type','select',true,2,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Compressor Type','mf_cooling_compressor_type','select',false,3,true,NULL,'Chillers only.'),
      ('',v_nick,v_nick,v_step,'Condenser Type','mf_cooling_condenser_type','select',false,4,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Efficiency (SEER)','mf_cooling_efficiency_seer','number',false,5,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Efficiency (EER)','mf_cooling_eer','number',false,6,true,NULL,'For chillers/packaged units.'),
      ('',v_nick,v_nick,v_step,'Capacity','mf_cooling_capacity','number',false,7,true,'tons',NULL),
      ('',v_nick,v_nick,v_step,'Year of Manufacture','mf_cooling_year','number',false,8,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Condition','mf_cooling_condition','select',false,9,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Cooling System','mf_cooling_photo','photo',true,10,true,NULL,'The system and its nameplate.');
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Cooling Systems',v_nick,v_wpt,v_step,9);

    ---------------------------------------------------------------- 10. Distribution & Ventilation
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Distribution & Ventilation',v_nick,v_nick,'How conditioned air/water is distributed, and the building ventilation strategy.',true,v_lead,v_psl,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_help_text) VALUES
      ('',v_nick,v_nick,v_step,'Distribution Type','mf_distribution_type','select',true,1,true,NULL),
      ('',v_nick,v_nick,v_step,'Duct Location','mf_duct_location','select',false,2,true,'Where most ductwork runs.'),
      ('',v_nick,v_nick,v_step,'Duct Insulation','mf_duct_insulation','select',false,3,true,NULL),
      ('',v_nick,v_nick,v_step,'Ventilation Type','mf_ventilation_type','select',false,4,true,NULL),
      ('',v_nick,v_nick,v_step,'Distribution / Ventilation','mf_distribution_photo','photo',false,5,true,'Air handler, ducts, or ventilation equipment.');
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Distribution & Ventilation',v_nick,v_wpt,v_step,10);

    ---------------------------------------------------------------- 11. Service Hot Water
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Service Hot Water',v_nick,v_nick,'Domestic hot water system(s) serving the building.',true,v_lead,v_psl,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_nick,v_nick,v_step,'System Serves','mf_dhw_serves','select',true,1,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Water Heater Type','mf_dhw_system_type','select',true,2,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Fuel','mf_dhw_fuel','select',true,3,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Storage Capacity','mf_dhw_capacity_gal','number',false,4,true,'gal',NULL),
      ('',v_nick,v_nick,v_step,'Efficiency (EF / UEF)','mf_dhw_efficiency_ef_uef','number',false,5,true,NULL,'From the rating label, if available.'),
      ('',v_nick,v_nick,v_step,'Setpoint Temperature','mf_dhw_setpoint','number',false,6,true,'°F',NULL),
      ('',v_nick,v_nick,v_step,'Recirculation Loop','mf_dhw_recirc','select',false,7,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Year of Manufacture','mf_dhw_year','number',false,8,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Water Heater','mf_dhw_photo','photo',true,9,true,NULL,'The water heater and its nameplate.');
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Service Hot Water',v_nick,v_wpt,v_step,11);

    ---------------------------------------------------------------- 12. Common-Area Lighting
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Common-Area Lighting',v_nick,v_nick,'The dominant common-area lighting, plus typical in-unit lighting efficiency.',true,v_lead,v_psl,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_nick,v_nick,v_step,'Lighting Type','mf_lighting_type','select',true,1,true,NULL,'The dominant fixture/lamp type in common areas.'),
      ('',v_nick,v_nick,v_step,'Mounting','mf_lighting_mounting','select',false,2,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Watts per Lamp','mf_lighting_watts_per_lamp','number',false,3,true,'W',NULL),
      ('',v_nick,v_nick,v_step,'Lamps per Fixture','mf_lighting_lamps_per_fixture','number',false,4,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Approx. Fixture Count','mf_lighting_fixture_count','number',false,5,true,NULL,'Enter this or % area served.'),
      ('',v_nick,v_nick,v_step,'% of Common Area Served','mf_lighting_pct_area','number',false,6,true,'%',NULL),
      ('',v_nick,v_nick,v_step,'Lighting Controls','mf_lighting_controls','select',false,7,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Typical In-Unit High-Efficiency Lighting','mf_inunit_lighting_pct','select',false,8,true,NULL,'Rough share of LED/CFL in a typical unit.'),
      ('',v_nick,v_nick,v_step,'Lighting','mf_lighting_photo','photo',true,9,true,NULL,'A representative common-area fixture.');
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Common-Area Lighting',v_nick,v_wpt,v_step,12);

    ---------------------------------------------------------------- 13. Building Diagnostics (optional)
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Building Diagnostics',v_nick,v_nick,'Optional whole-building/guarded blower door and central-appliance combustion-safety observations. Skip if no test is run.',true,v_lead,v_psl,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_nick,v_nick,v_step,'Airflow (CFM50)','mf_blower_door_cfm50','number',false,1,true,'CFM50','Whole-building or guarded-zone reading at 50 Pa.'),
      ('',v_nick,v_nick,v_step,'Air Changes per Hour (ACH50)','mf_blower_door_ach50','number',false,2,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Combustion Appliances Present','mf_combustion_present','select',false,3,true,NULL,'Central/common gas appliances.'),
      ('',v_nick,v_nick,v_step,'Ambient CO','mf_combustion_co_ambient','number',false,4,true,'ppm',NULL),
      ('',v_nick,v_nick,v_step,'Draft Test','mf_combustion_draft','select',false,5,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Gas Leak','mf_gas_leak_found','select',false,6,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Diagnostics','mf_diag_photo','photo',false,7,true,NULL,'Blower door setup or combustion analyzer reading.');
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Building Diagnostics',v_nick,v_wpt,v_step,13);

    ---------------------------------------------------------------- 14. Utility & Energy Data (back-office, not gated)
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Utility & Energy Data',v_nick,v_nick,'Back-office entry: 12+ months of whole-building utility data for the ASHRAE Level 2 analysis. Fill from the bills after the visit — not required to complete the assessment.',true,v_lead,v_psl,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_nick,v_nick,v_step,'Electric Meter Number','mf_elec_meter_number','text',false,1,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Gas Meter Number','mf_gas_meter_number','text',false,2,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Annual Electricity Use','mf_annual_elec_kwh','number',false,3,true,'kWh','Whole-building, trailing 12 months.'),
      ('',v_nick,v_nick,v_step,'Peak Electric Demand','mf_peak_demand_kw','number',false,4,true,'kW',NULL),
      ('',v_nick,v_nick,v_step,'Annual Natural Gas Use','mf_annual_gas_therms','number',false,5,true,'therms',NULL),
      ('',v_nick,v_nick,v_step,'Other Fuel','mf_other_fuel_type','select',false,6,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Other Fuel Annual Use','mf_other_fuel_annual','number',false,7,true,NULL,'In that fuel''s native units.'),
      ('',v_nick,v_nick,v_step,'Months of Data Provided','mf_utility_months','number',false,8,true,'months','ASHRAE L2 requires at least 12.'),
      ('',v_nick,v_nick,v_step,'ENERGY STAR Score','mf_energy_star_score','number',false,9,true,NULL,'From Portfolio Manager, if benchmarked.'),
      ('',v_nick,v_nick,v_step,'Site EUI','mf_site_eui','number',false,10,true,'kBtu/ft²/yr',NULL);
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Utility & Energy Data',v_nick,v_wpt,v_step,14);

    ---------------------------------------------------------------- 15. Occupancy & Operating Schedules (back-office)
    INSERT INTO public.work_step_templates (wst_record_number,wst_name,wst_owner,wst_created_by,wst_description,wst_is_active,wst_assigned_owner_role_id,wst_verifier_role_id,wst_required_evidence_type_id,wst_photos_required_count,wst_is_screen_flow)
    VALUES ('','Occupancy & Operating Schedules',v_nick,v_nick,'Back-office entry: occupancy and common-area operating schedules for the ASHRAE Level 2 analysis.',true,v_lead,v_psl,v_photo,0,true) RETURNING id INTO v_step;
    INSERT INTO public.work_step_template_fields (wstf_record_number,wstf_owner,wstf_created_by,work_step_template_id,wstf_field_label,wstf_field_name,wstf_field_type,wstf_is_required,wstf_sort_order,wstf_is_active,wstf_unit,wstf_help_text) VALUES
      ('',v_nick,v_nick,v_step,'Total Occupants','mf_total_occupants','number',false,1,true,NULL,NULL),
      ('',v_nick,v_nick,v_step,'Occupancy','mf_occupancy_pct','number',false,2,true,'%','Share of units occupied.'),
      ('',v_nick,v_nick,v_step,'Common-Area Operating Hours','mf_common_area_hours','text',false,3,true,NULL,'e.g. lobby 24/7, office 8–5 M–F.'),
      ('',v_nick,v_nick,v_step,'Notes','mf_occupancy_notes','text',false,4,true,NULL,NULL);
    INSERT INTO public.work_plan_template_entries (wpte_record_number,wpte_name,wpte_created_by,work_plan_template_id,work_step_template_id,wpte_execution_order)
    VALUES ('','Occupancy & Operating Schedules',v_nick,v_wpt,v_step,15);
  END IF;

  -- ── Wire the pre-existing stub work type WT-00074 (find-or-create by name) ──
  SELECT id INTO v_wt FROM public.work_types
   WHERE work_type_name = 'Multifamily Energy Assessment' AND work_type_is_deleted IS NOT TRUE
   ORDER BY work_type_created_at LIMIT 1;

  IF v_wt IS NULL THEN
    INSERT INTO public.work_types (work_type_record_number, work_type_name, work_type_description, work_type_is_active,
      work_type_duration_minutes, work_type_default_work_plan_template_id, work_type_default_work_order_record_type,
      work_type_is_technician_creatable, work_type_owner, work_type_created_by)
    VALUES ('', 'Multifamily Energy Assessment',
      'Scheduled building-level multifamily energy assessment. The auditor works through guided, photo-first screen-flow sections in LEAP Pad, capturing DOE Asset Score and ASHRAE Level 2 building-level data.',
      true, 180, v_wpt, v_rt, false, v_nick, v_nick);
  ELSE
    UPDATE public.work_types
       SET work_type_default_work_plan_template_id = v_wpt,
           work_type_default_work_order_record_type = v_rt,
           work_type_is_active = true,
           work_type_duration_minutes = COALESCE(work_type_duration_minutes, 180),
           work_type_updated_by = v_nick, work_type_updated_at = now()
     WHERE id = v_wt;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
