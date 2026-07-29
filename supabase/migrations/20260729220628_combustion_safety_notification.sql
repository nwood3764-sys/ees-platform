-- ===========================================================================
-- Notification of Combustion Safety (Large Multifamily 5+ Units)
-- IRA Wisconsin HOMES — required submittal for the Final Project Payment Request.
--
-- The captured test results live on diagnostic_tests (its purpose-built home —
-- it already carries per-unit / per-building combustion CO, efficiency, CFM and
-- appliance fields). This migration is ADDITIVE:
--   * relaxes diagnostic_tests.unit_id NOT NULL so a building-level
--     "Common Areas / Shared Equipment" line can exist without a dwelling unit;
--   * adds the notification's categorical result fields to diagnostic_tests;
--   * adds building-level mechanical-ventilation fields;
--   * seeds the picklists, a "Combustion Safety Notification" record type,
--     the new document kind, and the WI HOMES final-payment requirement;
--   * adds save_combustion_safety_notification() to upsert the whole form.
--
-- Existing diagnostic_tests rows, documents and program wiring are untouched.
-- ===========================================================================

-- --- 1. Allow building-level (common-area) diagnostic rows -------------------
ALTER TABLE public.diagnostic_tests ALTER COLUMN unit_id DROP NOT NULL;

-- --- 2. Notification result fields on diagnostic_tests -----------------------
ALTER TABLE public.diagnostic_tests
  ADD COLUMN IF NOT EXISTS diagnostic_combustion_scope        uuid,
  ADD COLUMN IF NOT EXISTS diagnostic_gas_leak_result         uuid,
  ADD COLUMN IF NOT EXISTS diagnostic_gas_leak_location       text,
  ADD COLUMN IF NOT EXISTS diagnostic_gas_detector_installed  boolean,
  ADD COLUMN IF NOT EXISTS diagnostic_ambient_co_result       uuid,
  ADD COLUMN IF NOT EXISTS diagnostic_co_detector_installed   boolean,
  ADD COLUMN IF NOT EXISTS diagnostic_co_detector_location    text,
  ADD COLUMN IF NOT EXISTS diagnostic_heating_plant_co_status uuid,
  ADD COLUMN IF NOT EXISTS diagnostic_heating_plant_spillage  uuid,
  ADD COLUMN IF NOT EXISTS diagnostic_water_heater_co_status  uuid,
  ADD COLUMN IF NOT EXISTS diagnostic_water_heater_spillage   uuid,
  ADD COLUMN IF NOT EXISTS diagnostic_stove_co_status         uuid,
  ADD COLUMN IF NOT EXISTS diagnostic_combustion_notes        text;

DO $fk$
BEGIN
  PERFORM 1;
  -- picklist FKs (referential integrity, matching platform convention)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='diagnostic_tests_combustion_scope_fkey') THEN
    ALTER TABLE public.diagnostic_tests
      ADD CONSTRAINT diagnostic_tests_combustion_scope_fkey        FOREIGN KEY (diagnostic_combustion_scope)        REFERENCES public.picklist_values(id),
      ADD CONSTRAINT diagnostic_tests_gas_leak_result_fkey         FOREIGN KEY (diagnostic_gas_leak_result)         REFERENCES public.picklist_values(id),
      ADD CONSTRAINT diagnostic_tests_ambient_co_result_fkey       FOREIGN KEY (diagnostic_ambient_co_result)       REFERENCES public.picklist_values(id),
      ADD CONSTRAINT diagnostic_tests_heating_plant_co_status_fkey FOREIGN KEY (diagnostic_heating_plant_co_status) REFERENCES public.picklist_values(id),
      ADD CONSTRAINT diagnostic_tests_heating_plant_spillage_fkey  FOREIGN KEY (diagnostic_heating_plant_spillage)  REFERENCES public.picklist_values(id),
      ADD CONSTRAINT diagnostic_tests_water_heater_co_status_fkey  FOREIGN KEY (diagnostic_water_heater_co_status)  REFERENCES public.picklist_values(id),
      ADD CONSTRAINT diagnostic_tests_water_heater_spillage_fkey   FOREIGN KEY (diagnostic_water_heater_spillage)   REFERENCES public.picklist_values(id),
      ADD CONSTRAINT diagnostic_tests_stove_co_status_fkey         FOREIGN KEY (diagnostic_stove_co_status)         REFERENCES public.picklist_values(id);
  END IF;
END $fk$;

CREATE INDEX IF NOT EXISTS diagnostic_tests_combustion_building_idx
  ON public.diagnostic_tests (building_id) WHERE diagnostic_combustion_scope IS NOT NULL;

-- --- 3. Building-level mechanical ventilation --------------------------------
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS building_combustion_ventilation_status uuid,
  ADD COLUMN IF NOT EXISTS building_combustion_ventilation_cfm    numeric(9,1),
  ADD COLUMN IF NOT EXISTS building_combustion_ventilation_notes  text;

DO $fk2$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='buildings_combustion_ventilation_status_fkey') THEN
    ALTER TABLE public.buildings
      ADD CONSTRAINT buildings_combustion_ventilation_status_fkey
        FOREIGN KEY (building_combustion_ventilation_status) REFERENCES public.picklist_values(id);
  END IF;
END $fk2$;

-- --- 4. Picklists (idempotent) ----------------------------------------------
DO $seed$
DECLARE
  v_owner uuid;
BEGIN
  SELECT diagnostic_owner INTO v_owner FROM public.diagnostic_tests
    WHERE diagnostic_owner IS NOT NULL ORDER BY diagnostic_created_at NULLS LAST LIMIT 1;
  IF v_owner IS NULL THEN SELECT id INTO v_owner FROM public.users WHERE user_is_deleted IS NOT TRUE ORDER BY user_created_at LIMIT 1; END IF;

  INSERT INTO public.picklist_values (id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
  SELECT gen_random_uuid(), s.obj, s.fld, s.val, s.val, true, s.ord, v_owner
  FROM (VALUES
    ('diagnostic_tests','record_type','COMBUSTION-SAFETY-NOTIFICATION','Combustion Safety Notification',5),
    ('diagnostic_tests','combustion_scope','Common Areas / Shared Equipment','Common Areas / Shared Equipment',10),
    ('diagnostic_tests','combustion_scope','In-Unit','In-Unit',20),
    ('diagnostic_tests','gas_leak_result','Not Tested / Not Applicable','Not Tested / Not Applicable',10),
    ('diagnostic_tests','gas_leak_result','Found','Found',20),
    ('diagnostic_tests','gas_leak_result','None Found','None Found',30),
    ('diagnostic_tests','ambient_co_result','Not Tested / Not Applicable','Not Tested / Not Applicable',10),
    ('diagnostic_tests','ambient_co_result','0-8 ppm','0-8 ppm',20),
    ('diagnostic_tests','ambient_co_result','9-35 ppm','9-35 ppm',30),
    ('diagnostic_tests','ambient_co_result','36-69 ppm','36-69 ppm',40),
    ('diagnostic_tests','ambient_co_result','70+ ppm','70+ ppm',50),
    ('diagnostic_tests','heating_plant_co_status','Not Tested / Not Applicable','Not Tested / Not Applicable',10),
    ('diagnostic_tests','heating_plant_co_status','Acceptable','Acceptable',20),
    ('diagnostic_tests','heating_plant_co_status','Unacceptable','Unacceptable',30),
    ('diagnostic_tests','heating_plant_spillage','Not Tested / Not Applicable','Not Tested / Not Applicable',10),
    ('diagnostic_tests','heating_plant_spillage','None Found','None Found',20),
    ('diagnostic_tests','heating_plant_spillage','Found','Found',30),
    ('diagnostic_tests','water_heater_co_status','Not Tested / Not Applicable','Not Tested / Not Applicable',10),
    ('diagnostic_tests','water_heater_co_status','Acceptable','Acceptable',20),
    ('diagnostic_tests','water_heater_co_status','Unacceptable','Unacceptable',30),
    ('diagnostic_tests','water_heater_spillage','Not Tested / Not Applicable','Not Tested / Not Applicable',10),
    ('diagnostic_tests','water_heater_spillage','None Found','None Found',20),
    ('diagnostic_tests','water_heater_spillage','Found','Found',30),
    ('diagnostic_tests','stove_co_status','Not Tested / Not Applicable','Not Tested / Not Applicable',10),
    ('diagnostic_tests','stove_co_status','Acceptable','Acceptable',20),
    ('diagnostic_tests','stove_co_status','Unacceptable','Unacceptable',30),
    ('buildings','combustion_ventilation_status','Not Tested','Not Tested',10),
    ('buildings','combustion_ventilation_status','Tested','Tested',20)
  ) AS s(obj,fld,val,lbl,ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.picklist_values p
    WHERE p.picklist_object=s.obj AND p.picklist_field=s.fld AND p.picklist_value=s.val);
END $seed$;

-- --- 5. New document kind on submittal templates ----------------------------
DO $kind$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conname='submittal_document_templates_sdt_kind_check' AND conrelid='public.submittal_document_templates'::regclass;
  IF v_def IS NOT NULL AND position('combustion_safety_notification' in v_def)=0 THEN
    ALTER TABLE public.submittal_document_templates DROP CONSTRAINT submittal_document_templates_sdt_kind_check;
    ALTER TABLE public.submittal_document_templates ADD CONSTRAINT submittal_document_templates_sdt_kind_check
      CHECK (sdt_kind IN ('audit','proposal','invoice','sealed_proposal','sealed_invoice','combustion_safety_notification'));
  END IF;
END $kind$;

-- --- 6. Require the notification on WI HOMES Final Project Payment Request ----
DO $req$
DECLARE
  v_owner uuid;
  v_stage uuid;
BEGIN
  SELECT id INTO v_stage FROM public.picklist_values
    WHERE picklist_object='opportunities' AND picklist_field='opportunity_stage'
      AND picklist_value='HOMES Phase 8: Payment Request Submitted' LIMIT 1;
  SELECT sdr_owner INTO v_owner FROM public.stage_document_requirements WHERE sdr_owner IS NOT NULL LIMIT 1;
  IF v_owner IS NULL THEN SELECT id INTO v_owner FROM public.users WHERE user_is_deleted IS NOT TRUE ORDER BY user_created_at LIMIT 1; END IF;
  IF v_stage IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM public.stage_document_requirements
      WHERE sdr_object='opportunities' AND sdr_stage_value_id=v_stage
        AND sdr_document_key='combustion_safety_notification' AND sdr_is_deleted IS NOT TRUE) THEN
    INSERT INTO public.stage_document_requirements
      (id, sdr_record_number, sdr_name, sdr_object, sdr_stage_value_id, sdr_document_key,
       sdr_requires_signature, sdr_signer_role, sdr_sort_order, sdr_owner, sdr_created_by)
    VALUES
      (gen_random_uuid(), '', 'Notification of Combustion Safety', 'opportunities', v_stage, 'combustion_safety_notification',
       true, 'Property Owner', 40, v_owner, v_owner);
  END IF;
END $req$;

-- --- 7. Upsert RPC ----------------------------------------------------------
-- Resolve a picklist value string to its id for a diagnostic_tests field.
CREATE OR REPLACE FUNCTION public._combustion_pv(p_object text, p_field text, p_value text)
RETURNS uuid LANGUAGE sql STABLE
SET search_path = public AS $$
  SELECT id FROM public.picklist_values
   WHERE picklist_object=p_object AND picklist_field=p_field
     AND picklist_value=p_value AND picklist_is_active IS NOT FALSE
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.save_combustion_safety_notification(
  p_building_id uuid,
  p_ventilation jsonb DEFAULT '{}'::jsonb,
  p_common      jsonb DEFAULT NULL,
  p_units       jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public AS $$
DECLARE
  v_user  uuid := public.current_app_user_id();
  v_rt    uuid;
  v_bname text;
  v_common_id uuid;
  v_row   jsonb;
  v_uid   uuid;
  v_did   uuid;
  v_unit_ids uuid[] := '{}';
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No application user in context'; END IF;
  SELECT id INTO v_rt FROM public.picklist_values
    WHERE picklist_object='diagnostic_tests' AND picklist_field='record_type'
      AND picklist_value='COMBUSTION-SAFETY-NOTIFICATION' LIMIT 1;
  SELECT building_name INTO v_bname FROM public.buildings WHERE id=p_building_id;

  -- Building mechanical ventilation
  UPDATE public.buildings SET
    building_combustion_ventilation_status = public._combustion_pv('buildings','combustion_ventilation_status', NULLIF(p_ventilation->>'status','')),
    building_combustion_ventilation_cfm    = NULLIF(p_ventilation->>'cfm','')::numeric,
    building_combustion_ventilation_notes  = NULLIF(p_ventilation->>'notes',''),
    building_updated_by = v_user, building_updated_at = now()
  WHERE id = p_building_id;

  -- Common Areas / Shared Equipment row (unit_id NULL)
  IF p_common IS NOT NULL THEN
    SELECT id INTO v_common_id FROM public.diagnostic_tests
      WHERE building_id=p_building_id AND diagnostic_record_type=v_rt
        AND unit_id IS NULL AND diagnostic_is_deleted IS NOT TRUE
      ORDER BY diagnostic_created_at DESC LIMIT 1;
    IF v_common_id IS NULL THEN
      INSERT INTO public.diagnostic_tests
        (id, diagnostic_record_number, diagnostic_name, diagnostic_record_type, diagnostic_owner,
         diagnostic_created_by, diagnostic_test_date, building_id, is_seed_data)
      VALUES (gen_random_uuid(), '', 'Combustion Safety — Common Areas — '||coalesce(v_bname,''),
         v_rt, v_user, v_user, current_date, p_building_id, false)
      RETURNING id INTO v_common_id;
    END IF;
    UPDATE public.diagnostic_tests SET
      diagnostic_combustion_scope        = public._combustion_pv('diagnostic_tests','combustion_scope','Common Areas / Shared Equipment'),
      diagnostic_gas_leak_result         = public._combustion_pv('diagnostic_tests','gas_leak_result',         NULLIF(p_common->>'gas_leak_result','')),
      diagnostic_gas_leak_location       = NULLIF(p_common->>'gas_leak_location',''),
      diagnostic_gas_detector_installed  = (p_common->>'gas_detector_installed')::boolean,
      diagnostic_ambient_co_result       = public._combustion_pv('diagnostic_tests','ambient_co_result',       NULLIF(p_common->>'ambient_co_result','')),
      diagnostic_co_detector_installed   = (p_common->>'co_detector_installed')::boolean,
      diagnostic_co_detector_location    = NULLIF(p_common->>'co_detector_location',''),
      diagnostic_heating_plant_co_status = public._combustion_pv('diagnostic_tests','heating_plant_co_status', NULLIF(p_common->>'heating_plant_co_status','')),
      diagnostic_heating_plant_spillage  = public._combustion_pv('diagnostic_tests','heating_plant_spillage',  NULLIF(p_common->>'heating_plant_spillage','')),
      diagnostic_water_heater_co_status  = public._combustion_pv('diagnostic_tests','water_heater_co_status',  NULLIF(p_common->>'water_heater_co_status','')),
      diagnostic_water_heater_spillage   = public._combustion_pv('diagnostic_tests','water_heater_spillage',   NULLIF(p_common->>'water_heater_spillage','')),
      diagnostic_combustion_notes        = NULLIF(p_common->>'notes',''),
      diagnostic_updated_by = v_user, diagnostic_updated_at = now()
    WHERE id = v_common_id;
  END IF;

  -- Per sampled unit rows
  FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(p_units,'[]'::jsonb)) LOOP
    v_uid := NULLIF(v_row->>'unit_id','')::uuid;
    IF v_uid IS NULL THEN CONTINUE; END IF;
    SELECT id INTO v_did FROM public.diagnostic_tests
      WHERE building_id=p_building_id AND diagnostic_record_type=v_rt
        AND unit_id=v_uid AND diagnostic_is_deleted IS NOT TRUE
      ORDER BY diagnostic_created_at DESC LIMIT 1;
    IF v_did IS NULL THEN
      INSERT INTO public.diagnostic_tests
        (id, diagnostic_record_number, diagnostic_name, diagnostic_record_type, diagnostic_owner,
         diagnostic_created_by, diagnostic_test_date, building_id, unit_id, is_seed_data)
      VALUES (gen_random_uuid(), '',
         'Combustion Safety — '||coalesce(NULLIF(v_row->>'unit_number',''),'Unit')||' — '||coalesce(v_bname,''),
         v_rt, v_user, v_user, current_date, p_building_id, v_uid, false)
      RETURNING id INTO v_did;
    END IF;
    UPDATE public.diagnostic_tests SET
      diagnostic_combustion_scope        = public._combustion_pv('diagnostic_tests','combustion_scope','In-Unit'),
      diagnostic_gas_leak_result         = public._combustion_pv('diagnostic_tests','gas_leak_result',         NULLIF(v_row->>'gas_leak_result','')),
      diagnostic_gas_leak_location       = NULLIF(v_row->>'gas_leak_location',''),
      diagnostic_gas_detector_installed  = (v_row->>'gas_detector_installed')::boolean,
      diagnostic_ambient_co_result       = public._combustion_pv('diagnostic_tests','ambient_co_result',       NULLIF(v_row->>'ambient_co_result','')),
      diagnostic_co_detector_installed   = (v_row->>'co_detector_installed')::boolean,
      diagnostic_co_detector_location    = NULLIF(v_row->>'co_detector_location',''),
      diagnostic_heating_plant_co_status = public._combustion_pv('diagnostic_tests','heating_plant_co_status', NULLIF(v_row->>'furnace_co_status','')),
      diagnostic_heating_plant_spillage  = public._combustion_pv('diagnostic_tests','heating_plant_spillage',  NULLIF(v_row->>'furnace_spillage','')),
      diagnostic_water_heater_co_status  = public._combustion_pv('diagnostic_tests','water_heater_co_status',  NULLIF(v_row->>'water_heater_co_status','')),
      diagnostic_water_heater_spillage   = public._combustion_pv('diagnostic_tests','water_heater_spillage',   NULLIF(v_row->>'water_heater_spillage','')),
      diagnostic_stove_co_status         = public._combustion_pv('diagnostic_tests','stove_co_status',         NULLIF(v_row->>'stove_co_status','')),
      diagnostic_combustion_notes        = NULLIF(v_row->>'notes',''),
      diagnostic_updated_by = v_user, diagnostic_updated_at = now()
    WHERE id = v_did;
    v_unit_ids := array_append(v_unit_ids, v_uid);
  END LOOP;

  RETURN jsonb_build_object('building_id', p_building_id, 'common_id', v_common_id, 'unit_ids', to_jsonb(v_unit_ids));
END $$;

REVOKE ALL ON FUNCTION public.save_combustion_safety_notification(uuid,jsonb,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_combustion_safety_notification(uuid,jsonb,jsonb,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public._combustion_pv(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._combustion_pv(text,text,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
