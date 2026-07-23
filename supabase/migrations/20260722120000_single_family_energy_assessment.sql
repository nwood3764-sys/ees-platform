-- =====================================================================
-- Single-Family Energy Assessment + work-step "screen flow" (Nicholas,
-- 2026-07-22). Rebuilds the legacy Salesforce single-family assessment
-- field workflow as a LEAP scheduled work order whose sections are GUIDED
-- SCREEN FLOWS: tapping a section opens a full-screen, one-prompt-at-a-
-- time capture flow (photo -> field -> field -> ... -> save) instead of
-- the flat inline step card.
--
-- Two generic, reusable capabilities (nothing hardcoded):
--   * work_step_templates.wst_is_screen_flow — when true, LEAP Pad
--     renders the step as a launchable section that runs its photo
--     requirement + work_step_template_fields as sequential screens,
--     reusing the existing photo/field/complete RPCs and the server
--     evidence gate. Any step template can opt in.
--   * work_plan_templates.wpt_allow_any_order — when true, the work
--     order's sections can be completed in ANY order (auditors walk a
--     house non-linearly). Enforcement of order was already purely a
--     client concern — complete_work_step never checked predecessors —
--     so this is surfaced to LEAP Pad which relaxes step locking.
-- work_order_detail_for_technician surfaces both to the technician app.
--
-- Config built this migration:
--   * Work Type "Single-Family Energy Assessment" (scheduled) with its
--     own new record type single_family_energy_assessment (purpose-built,
--     NOT the legacy hes_assessment type).
--   * Work Plan Template "Single-Family Energy Assessment - Standard"
--     (any-order), starting with the fully-built Heating System section.
--   * Heating System screen-flow step: 1 required photo + Heating System
--     Type (select) + Fuel Type (select) + Condition (select) + Model
--     Number (text), all required and hard-gated by the evidence gate.
--   * Admin-managed option lists for the three selects under
--     picklist_object='work_step_fields'.
-- Remaining assessment sections (Cooling, Water Heating, Attic, ...) are added
-- as their field lists are provided.
-- =====================================================================

-- ── 1. Reusable flags ─────────────────────────────────────────────────────────
ALTER TABLE public.work_step_templates
  ADD COLUMN IF NOT EXISTS wst_is_screen_flow boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.work_step_templates.wst_is_screen_flow IS
  'When true, LEAP Pad renders this step as a launchable guided screen flow (photo requirement + fields walked one prompt per screen) instead of an inline step card. Reuses the standard photo/field/complete RPCs and evidence gate.';

ALTER TABLE public.work_plan_templates
  ADD COLUMN IF NOT EXISTS wpt_allow_any_order boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.work_plan_templates.wpt_allow_any_order IS
  'When true, work orders built from this plan let the technician complete sections in any order (LEAP Pad drops step locking). complete_work_step never enforced order, so this only affects the client experience.';

-- ── 2. Technician detail: surface is_screen_flow + allow_any_order ─────────────
-- (Full body — byte-identical to the live version plus the two additions:
--  header.allow_any_order and each step's is_screen_flow.)
CREATE OR REPLACE FUNCTION public.work_order_detail_for_technician(p_wo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := public.current_app_user_id();
  v_header jsonb;
  v_steps  jsonb;
  v_first  timestamptz;
  v_last   timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('outcome','error','message','Not authenticated.');
  END IF;

  SELECT jsonb_build_object(
    'work_order_id',          wo.id,
    'work_order_record_number', wo.work_order_record_number,
    'work_order_name',        wo.work_order_name,
    'work_order_status',      wost.picklist_value,
    'work_order_status_id',   wo.work_order_status,
    'property_name',          COALESCE(NULLIF(wo.work_order_property_name,''), p.property_name),
    'property_address',       NULLIF(trim(BOTH ', ' FROM
                                concat_ws(', ',
                                  COALESCE(NULLIF(wo.work_order_building_address,''), b.building_address, p.property_street),
                                  COALESCE(b.building_city, p.property_city),
                                  COALESCE(b.building_state, p.property_state),
                                  COALESCE(b.building_zip, p.property_zip)
                                )), ''),
    'building',               COALESCE(NULLIF(wo.work_order_building,''), b.building_number_or_name, b.building_name),
    'unit',                   COALESCE(NULLIF(wo.work_order_unit,''), u.unit_number, u.unit_name),
    'customer_name',          wo.work_order_customer_name,
    'work_type_name',         wt.work_type_name,
    'updated_at',             wo.work_order_updated_at,
    'allow_any_order',        COALESCE((
                                SELECT wpt.wpt_allow_any_order
                                FROM public.work_plans wp
                                JOIN public.work_plan_templates wpt ON wpt.id = wp.work_plan_template_id
                                WHERE wp.work_order_id = wo.id AND wp.work_plan_is_deleted IS NOT TRUE
                                ORDER BY wp.work_plan_created_at
                                LIMIT 1), false),
    'scheduled_start',        (SELECT sa.sa_scheduled_start_time FROM service_appointments sa
                                 WHERE sa.work_order_id = wo.id AND sa.sa_is_deleted IS NOT TRUE
                                 ORDER BY sa.sa_scheduled_start_time DESC NULLS LAST LIMIT 1)
  )
  INTO v_header
  FROM public.work_orders wo
  LEFT JOIN public.picklist_values wost ON wost.id = wo.work_order_status
  LEFT JOIN public.work_types wt ON wt.id = wo.work_type_id
  LEFT JOIN public.properties p ON p.id = wo.property_id
  LEFT JOIN public.buildings  b ON b.id = wo.building_id
  LEFT JOIN public.units      u ON u.id = wo.unit_id
  WHERE wo.id = p_wo_id AND wo.work_order_is_deleted IS NOT TRUE;

  IF v_header IS NULL THEN
    RETURN jsonb_build_object('outcome','error','message','Work order not found.');
  END IF;

  -- Evidence-bracketed duration: first and last photo across all steps on this WO.
  SELECT min(ph.taken_at), max(ph.taken_at)
  INTO v_first, v_last
  FROM public.photos ph
  JOIN public.work_steps ws ON ws.id = ph.work_step_id
  WHERE ws.work_order_id = p_wo_id AND ph.is_deleted = false AND ph.taken_at IS NOT NULL;

  SELECT coalesce(jsonb_agg(step ORDER BY (step->>'execution_order')::int NULLS LAST), '[]'::jsonb)
  INTO v_steps
  FROM (
    SELECT jsonb_build_object(
      'work_step_id',            ws.id,
      'work_step_record_number', ws.work_step_record_number,
      'name',                    ws.work_step_name,
      'description',             ws.work_step_description,
      'execution_order',         ws.work_step_execution_order,
      'status',                  wsst.picklist_value,
      'status_id',               ws.work_step_status,
      'is_screen_flow',          COALESCE(wstpl.wst_is_screen_flow, false),
      'photos_required_count',   coalesce(ws.work_step_photos_required_count,0),
      'photo_before_required',   coalesce(ws.work_step_photo_before_required,false),
      'photo_after_required',    coalesce(ws.work_step_photo_after_required,false),
      'evidence_type',           et.picklist_value,
      'reference_photo_url',     ws.work_step_reference_photo_url,
      'not_applicable_reason',   ws.work_step_not_applicable_reason,
      'photo_count',             (SELECT count(*) FROM public.photos p2 WHERE p2.work_step_id = ws.id AND p2.is_deleted = false),
      'before_count',            (SELECT count(*) FROM public.photos p2 WHERE p2.work_step_id = ws.id AND p2.is_deleted = false AND lower(coalesce(p2.photo_type,''))='before'),
      'after_count',             (SELECT count(*) FROM public.photos p2 WHERE p2.work_step_id = ws.id AND p2.is_deleted = false AND lower(coalesce(p2.photo_type,''))='after'),
      'photos',                  (SELECT coalesce(jsonb_agg(jsonb_build_object(
                                     'id', p2.id, 'photo_type', p2.photo_type,
                                     'bucket', p2.storage_bucket, 'path', p2.storage_path_original,
                                     'taken_at', p2.taken_at
                                   ) ORDER BY p2.taken_at), '[]'::jsonb)
                                   FROM public.photos p2 WHERE p2.work_step_id = ws.id AND p2.is_deleted = false),
      'video_count',             (SELECT count(*) FROM public.documents d
                                   WHERE d.related_object = 'work_steps' AND d.related_id = ws.id
                                     AND d.is_deleted = false AND d.mime_type ILIKE 'video/%'),
      'videos',                  (SELECT coalesce(jsonb_agg(jsonb_build_object(
                                     'id', d.id, 'name', d.name,
                                     'bucket', d.storage_bucket, 'path', d.storage_path,
                                     'created_at', d.created_at
                                   ) ORDER BY d.created_at), '[]'::jsonb)
                                   FROM public.documents d
                                   WHERE d.related_object = 'work_steps' AND d.related_id = ws.id
                                     AND d.is_deleted = false AND d.mime_type ILIKE 'video/%'),
      'fields',                  (SELECT coalesce(jsonb_agg(jsonb_build_object(
                                     'field_id', f.id, 'label', f.wstf_field_label, 'name', f.wstf_field_name,
                                     'type', f.wstf_field_type, 'unit', f.wstf_unit,
                                     'required', coalesce(f.wstf_is_required,false),
                                     'numeric_value', fv.wsfv_numeric_value, 'text_value', fv.wsfv_text_value
                                   ) ORDER BY f.wstf_sort_order), '[]'::jsonb)
                                   FROM public.work_step_template_fields f
                                   LEFT JOIN public.work_step_field_values fv
                                     ON fv.work_step_template_field_id = f.id AND fv.work_step_id = ws.id
                                        AND fv.wsfv_is_deleted IS NOT TRUE
                                   WHERE f.work_step_template_id = ws.work_step_template_id
                                     AND f.wstf_is_deleted IS NOT TRUE AND f.wstf_is_active IS TRUE),
      'evidence_gap',            public._work_step_evidence_gap(ws.*),
      'pc_comment',              ws.work_step_pc_comment,
      'psl_comment',             ws.work_step_psl_comment
    ) AS step
    FROM public.work_steps ws
    LEFT JOIN public.picklist_values wsst ON wsst.id = ws.work_step_status
    LEFT JOIN public.picklist_values et   ON et.id   = ws.work_step_required_evidence_type_id
    LEFT JOIN public.work_step_templates wstpl ON wstpl.id = ws.work_step_template_id
    WHERE ws.work_order_id = p_wo_id AND ws.work_step_is_deleted IS NOT TRUE
  ) s;

  RETURN jsonb_build_object(
    'outcome','ok',
    'header', v_header,
    'steps',  v_steps,
    'first_photo_at', v_first,
    'last_photo_at',  v_last,
    'duration_minutes', CASE WHEN v_first IS NOT NULL AND v_last IS NOT NULL AND v_last > v_first
                             THEN round(EXTRACT(EPOCH FROM (v_last - v_first))/60.0, 1) ELSE NULL END
  );
END; $function$;

REVOKE ALL ON FUNCTION public.work_order_detail_for_technician(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_order_detail_for_technician(uuid) TO authenticated, service_role;

-- ── 3. Record type + option lists ─────────────────────────────────────────────
INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
VALUES ('work_orders', 'record_type', 'single_family_energy_assessment', 'Single-Family Energy Assessment', true,
        (SELECT COALESCE(max(picklist_sort_order),0)+1 FROM public.picklist_values WHERE picklist_object='work_orders' AND picklist_field='record_type'),
        'c5a01ec8-960f-42ab-8a9e-a49822de89af');

-- Heating System Type — starter list, admin-extendable in LEAP Admin.
INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
VALUES
  ('work_step_fields', 'heating_system_type', 'Forced Air Furnace',           'Forced Air Furnace',           true, 10,  'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('work_step_fields', 'heating_system_type', 'Forced Air Gas Furnace',       'Forced Air Gas Furnace',       true, 20,  'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('work_step_fields', 'heating_system_type', 'Electric Furnace',             'Electric Furnace',             true, 30,  'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('work_step_fields', 'heating_system_type', 'Electric Resistance Baseboard','Electric Resistance Baseboard',true, 40,  'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('work_step_fields', 'heating_system_type', 'Hydronic Baseboard',           'Hydronic Baseboard',           true, 50,  'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('work_step_fields', 'heating_system_type', 'Central Boiler',               'Central Boiler',               true, 60,  'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('work_step_fields', 'heating_system_type', 'Heat Pump',                    'Heat Pump',                    true, 70,  'c5a01ec8-960f-42ab-8a9e-a49822de89af');

-- Fuel Type — Nicholas's required two.
INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
VALUES
  ('work_step_fields', 'heating_system_fuel_type', 'Gas',      'Gas',      true, 10, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('work_step_fields', 'heating_system_fuel_type', 'Electric', 'Electric', true, 20, 'c5a01ec8-960f-42ab-8a9e-a49822de89af');

-- Condition.
INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
VALUES
  ('work_step_fields', 'heating_system_condition', 'Good', 'Good', true, 10, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('work_step_fields', 'heating_system_condition', 'Fair', 'Fair', true, 20, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('work_step_fields', 'heating_system_condition', 'Poor', 'Poor', true, 30, 'c5a01ec8-960f-42ab-8a9e-a49822de89af');

-- ── 4. Work type + plan template + Heating System screen-flow step ─────────────
DO $$
DECLARE
  v_nick  uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_lead  uuid := '4a93279e-f88e-4f12-9db8-6bd4e0e80262'; -- Lead Technician
  v_psl   uuid := '7495dd05-ec12-4dc0-ad07-db53daf78487'; -- Project Site Lead
  v_photo uuid := '16130b3e-e416-4d92-bf23-ec0f8aeee3e1'; -- Photo evidence type
  v_rt    uuid;
  v_wpt   uuid;
  v_wt    uuid;
  v_heat  uuid;
BEGIN
  SELECT id INTO v_rt FROM public.picklist_values
  WHERE picklist_object='work_orders' AND picklist_field='record_type' AND picklist_value='single_family_energy_assessment';

  INSERT INTO public.work_plan_templates (wpt_record_number, wpt_name, wpt_description, wpt_is_active, wpt_allow_any_order, wpt_owner, wpt_created_by)
  VALUES ('', 'Single-Family Energy Assessment - Standard',
          'Guided single-family home energy assessment. Each section is a photo-first screen flow the auditor completes in any order. First section: Heating System. Additional assessment sections (Exterior, Cooling, Water Heating, Foundation, Kitchen, Lighting, Attic, Blower Door, Exhaust Fans, Gas Leak Test, Fire Protection, CAZ) are added as their field lists are defined.',
          true, true, v_nick, v_nick)
  RETURNING id INTO v_wpt;

  INSERT INTO public.work_step_templates (wst_record_number, wst_name, wst_description, wst_is_active,
    wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id, wst_photos_required_count,
    wst_is_screen_flow, wst_owner, wst_created_by)
  VALUES ('', 'Heating System',
    'Photograph the heating system, then record its type, fuel, condition, and model number. The step completes once every prompt is answered.',
    true, v_lead, v_psl, v_photo, 1, true, v_nick, v_nick)
  RETURNING id INTO v_heat;

  INSERT INTO public.work_step_template_fields (wstf_record_number, work_step_template_id, wstf_field_label, wstf_field_name, wstf_field_type, wstf_is_required, wstf_unit, wstf_sort_order, wstf_owner, wstf_created_by)
  VALUES
    ('', v_heat, 'Heating System Type', 'heating_system_type',      'select', true, NULL, 1, v_nick, v_nick),
    ('', v_heat, 'Fuel Type',           'heating_system_fuel_type', 'select', true, NULL, 2, v_nick, v_nick),
    ('', v_heat, 'Condition',           'heating_system_condition', 'select', true, NULL, 3, v_nick, v_nick),
    ('', v_heat, 'Model Number',        'heating_system_model_number', 'text', true, NULL, 4, v_nick, v_nick);

  INSERT INTO public.work_plan_template_entries (wpte_record_number, wpte_name, wpte_created_by, work_plan_template_id, work_step_template_id, wpte_execution_order)
  VALUES ('', 'Heating System', v_nick, v_wpt, v_heat, 1);

  -- Attach to the pre-existing "Single-Family Energy Assessment" work type if one
  -- already exists (prod has WT-00072, a stub created 2026-05-14); otherwise create
  -- it. Never duplicate — the work type is a single purpose-named artifact.
  SELECT id INTO v_wt FROM public.work_types
   WHERE work_type_name = 'Single-Family Energy Assessment' AND work_type_is_deleted IS NOT TRUE
   ORDER BY work_type_created_at LIMIT 1;

  IF v_wt IS NULL THEN
    INSERT INTO public.work_types (work_type_record_number, work_type_name, work_type_description, work_type_is_active,
      work_type_duration_minutes, work_type_default_work_plan_template_id, work_type_default_work_order_record_type,
      work_type_is_technician_creatable, work_type_owner, work_type_created_by)
    VALUES ('', 'Single-Family Energy Assessment',
            'Scheduled in-home single-family energy assessment. The auditor works through guided, photo-first screen-flow sections in LEAP Pad. Starts with the Heating System section.',
            true, 90, v_wpt, v_rt, false, v_nick, v_nick);
  ELSE
    UPDATE public.work_types
       SET work_type_default_work_plan_template_id = v_wpt,
           work_type_default_work_order_record_type = v_rt,
           work_type_is_active = true,
           work_type_updated_by = v_nick, work_type_updated_at = now()
     WHERE id = v_wt;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
