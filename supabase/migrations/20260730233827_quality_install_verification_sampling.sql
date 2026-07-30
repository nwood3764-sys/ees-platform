-- Quality Install Verification — IRA Multifamily Quality Installation photo documentation.
--
-- Adds a building-scoped, opportunity-tied "Quality Install Verification" work order whose
-- per-step required photo count is DERIVED AT RUN TIME from the building's unit count via the
-- IRA Multifamily Quality Install Sampling Rate (admin-managed reference data, nothing hardcoded).
--
-- This is part of the Final Project Payment Request incentive-application verification. It is
-- owned and verified by the Project Coordinator (not a field technician) and reuses the existing
-- LEAP photo pipeline, so original-capture EXIF/GPS/timestamps are preserved and each photo is
-- tagged with its step, whether captured live in LEAP Pad or uploaded after the fact.
--
-- Phase 1 of 3: engine + config + templates + create path. (Phase 2: create UI + grouped step
-- display. Phase 3: the IRA Quality Installation Tool printout as a Final Project Payment Request
-- submittal document.)

-- ============================================================================================
-- 1. IRA Multifamily Quality Install Sampling Rate — admin-managed reference table
-- ============================================================================================
CREATE TABLE public.quality_install_sampling_rates (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qisr_label           text        NOT NULL,
  qisr_min_units       integer     NOT NULL,
  qisr_max_units       integer,                       -- NULL = open-ended upper bound (e.g. 100+)
  qisr_sample_size     integer,                       -- required sample; NULL when qisr_sample_all
  qisr_sample_all      boolean     NOT NULL DEFAULT false,  -- true => sample = total unit count ("all")
  qisr_sort_order      integer     NOT NULL DEFAULT 0,
  qisr_is_active       boolean     NOT NULL DEFAULT true,
  qisr_is_deleted      boolean     NOT NULL DEFAULT false,
  qisr_created_at      timestamptz NOT NULL DEFAULT now(),
  qisr_created_by      uuid,
  qisr_updated_at      timestamptz,
  qisr_updated_by      uuid,
  qisr_deleted_at      timestamptz,
  qisr_deleted_by      uuid,
  qisr_deletion_reason text,
  CONSTRAINT qisr_sample_definition_ck CHECK (qisr_sample_all OR qisr_sample_size IS NOT NULL)
);

COMMENT ON TABLE public.quality_install_sampling_rates IS
  'IRA Multifamily Quality Install Sampling Rate: maps total units with improvements to the required photo sample size applied to each quality-install photo step. Admin-managed; never hardcoded in app logic.';

ALTER TABLE public.quality_install_sampling_rates ENABLE ROW LEVEL SECURITY;

-- Internal staff who can read work orders may read the rate table; only admins may change it.
CREATE POLICY qisr_read_internal ON public.quality_install_sampling_rates
  FOR SELECT USING (public.app_user_can('work_orders','read'));
CREATE POLICY qisr_admin_insert ON public.quality_install_sampling_rates
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY qisr_admin_update ON public.quality_install_sampling_rates
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY qisr_admin_delete ON public.quality_install_sampling_rates
  FOR DELETE USING (public.is_admin());

-- Seed the DOE IRA Multifamily Quality Install Sampling Rate.
INSERT INTO public.quality_install_sampling_rates
  (qisr_label, qisr_min_units, qisr_max_units, qisr_sample_size, qisr_sample_all, qisr_sort_order)
VALUES
  ('2–4 units',   2,   4,   NULL, true,  10),
  ('5–9 units',   5,   9,   4,    false, 20),
  ('10–29 units', 10,  29,  7,    false, 30),
  ('30–49 units', 30,  49,  10,   false, 40),
  ('50–99 units', 50,  99,  15,   false, 50),
  ('100+ units',       100, NULL, 20,  false, 60);

-- ============================================================================================
-- 2. quality_install_sample_size(units) — the lookup, resolved from the rate table
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.quality_install_sample_size(p_units integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT CASE
    WHEN p_units IS NULL OR p_units <= 0 THEN 0
    ELSE COALESCE((
      SELECT CASE WHEN r.qisr_sample_all THEN p_units
                  ELSE LEAST(r.qisr_sample_size, p_units) END
      FROM public.quality_install_sampling_rates r
      WHERE r.qisr_is_active AND r.qisr_is_deleted IS NOT TRUE
        AND p_units >= r.qisr_min_units
        AND (r.qisr_max_units IS NULL OR p_units <= r.qisr_max_units)
      ORDER BY r.qisr_min_units DESC
      LIMIT 1
    ), p_units)   -- fall back to "all" when no bracket matches (e.g. a single-unit building)
  END;
$function$;

REVOKE ALL ON FUNCTION public.quality_install_sample_size(integer) FROM public, anon, authenticated;

-- ============================================================================================
-- 3. Per-step effective required photo count (static count, or sampled from the building)
-- ============================================================================================
ALTER TABLE public.work_step_templates
  ADD COLUMN IF NOT EXISTS wst_photos_required_from_sampling boolean NOT NULL DEFAULT false;
ALTER TABLE public.work_steps
  ADD COLUMN IF NOT EXISTS work_step_photos_required_from_sampling boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.work_step_templates.wst_photos_required_from_sampling IS
  'When true, the required photo count for this step is derived at run time from the work order building unit count via quality_install_sample_size(), instead of the static wst_photos_required_count.';

CREATE OR REPLACE FUNCTION public._work_step_required_photo_count(p_step public.work_steps)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_units integer;
BEGIN
  IF COALESCE(p_step.work_step_photos_required_from_sampling, false) THEN
    SELECT count(*) INTO v_units
    FROM public.units u
    JOIN public.work_orders wo ON wo.id = p_step.work_order_id
    WHERE u.building_id = wo.building_id
      AND u.unit_is_deleted IS NOT TRUE;
    RETURN public.quality_install_sample_size(v_units);
  END IF;
  RETURN COALESCE(p_step.work_step_photos_required_count, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public._work_step_required_photo_count(public.work_steps) FROM public, anon, authenticated;

-- ============================================================================================
-- 4. Evidence gate — use the effective (possibly sampled) required count
-- ============================================================================================
CREATE OR REPLACE FUNCTION public._work_step_evidence_gap(p_step work_steps)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_etype       text;
  v_photo_total integer := 0;
  v_before_n    integer := 0;
  v_after_n     integer := 0;
  v_doc_n       integer := 0;
  v_video_n     integer := 0;
  v_req_count   integer := public._work_step_required_photo_count(p_step);
  v_missing_field text;
  v_missing_photo text;
BEGIN
  SELECT picklist_value INTO v_etype
    FROM public.picklist_values WHERE id = p_step.work_step_required_evidence_type_id;

  SELECT
    count(*),
    count(*) FILTER (WHERE lower(coalesce(photo_type,'')) = 'before'),
    count(*) FILTER (WHERE lower(coalesce(photo_type,'')) = 'after')
  INTO v_photo_total, v_before_n, v_after_n
  FROM public.photos
  WHERE work_step_id = p_step.id AND is_deleted = false;

  IF v_req_count > 0 AND v_photo_total < v_req_count THEN
    RETURN format('Step "%s" requires %s photo(s); %s captured. Capture the remaining photo(s) before completing.',
                  p_step.work_step_name, v_req_count, v_photo_total);
  END IF;

  IF p_step.work_step_photo_before_required AND v_before_n < 1 THEN
    RETURN format('Step "%s" requires a BEFORE photo; none captured. Capture a before photo before completing.',
                  p_step.work_step_name);
  END IF;

  IF p_step.work_step_photo_after_required AND v_after_n < 1 THEN
    RETURN format('Step "%s" requires an AFTER photo; none captured. Capture an after photo before completing.',
                  p_step.work_step_name);
  END IF;

  SELECT f.wstf_field_label INTO v_missing_photo
  FROM public.work_step_template_fields f
  WHERE f.work_step_template_id = p_step.work_step_template_id
    AND f.wstf_is_deleted IS NOT TRUE AND f.wstf_is_active IS TRUE
    AND f.wstf_is_required IS TRUE AND f.wstf_field_type = 'photo'
    AND NOT EXISTS (
      SELECT 1 FROM public.photos ph
      WHERE ph.work_step_id = p_step.id AND ph.is_deleted = false
        AND ph.photo_type = f.wstf_field_name
    )
    AND NOT (
      COALESCE(f.wstf_allow_not_present, false) AND EXISTS (
        SELECT 1 FROM public.work_step_field_values v
        WHERE v.work_step_id = p_step.id AND v.work_step_template_field_id = f.id
          AND v.wsfv_is_deleted IS NOT TRUE
          AND nullif(trim(coalesce(v.wsfv_text_value,'')),'') IS NOT NULL
      )
    )
  ORDER BY f.wstf_sort_order
  LIMIT 1;
  IF v_missing_photo IS NOT NULL THEN
    RETURN format('Step "%s" needs the "%s" — capture it before completing.',
                  p_step.work_step_name, v_missing_photo);
  END IF;

  IF v_etype = 'Document Upload' THEN
    SELECT count(*) INTO v_doc_n
    FROM public.documents
    WHERE related_object = 'work_steps' AND related_id = p_step.id AND is_deleted = false;
    IF v_doc_n < 1 THEN
      RETURN format('Step "%s" requires a document upload; none attached. Upload the required document before completing.',
                    p_step.work_step_name);
    END IF;
  END IF;

  IF v_etype = 'Video' THEN
    SELECT count(*) INTO v_video_n
    FROM public.documents
    WHERE related_object = 'work_steps' AND related_id = p_step.id AND is_deleted = false
      AND mime_type ILIKE 'video/%';
    IF v_video_n < 1 THEN
      RETURN format('Step "%s" requires a video; none attached. Record and attach the video before completing.',
                    p_step.work_step_name);
    END IF;
  END IF;

  SELECT f.wstf_field_label INTO v_missing_field
  FROM public.work_step_template_fields f
  WHERE f.work_step_template_id = p_step.work_step_template_id
    AND f.wstf_is_deleted IS NOT TRUE AND f.wstf_is_active IS TRUE AND f.wstf_is_required IS TRUE
    AND f.wstf_field_type <> 'photo'
    AND NOT EXISTS (
      SELECT 1 FROM public.work_step_field_values v
      WHERE v.work_step_id = p_step.id AND v.work_step_template_field_id = f.id
        AND v.wsfv_is_deleted IS NOT TRUE
        AND (v.wsfv_numeric_value IS NOT NULL
             OR nullif(trim(coalesce(v.wsfv_text_value,'')),'') IS NOT NULL)
    )
  ORDER BY f.wstf_sort_order
  LIMIT 1;
  IF v_missing_field IS NOT NULL THEN
    RETURN format('Step "%s" requires "%s" — enter the value before completing.',
                  p_step.work_step_name, v_missing_field);
  END IF;

  RETURN NULL;
END;
$function$;

-- ============================================================================================
-- 5. Instantiation — copy the sampling flag template -> step
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.instantiate_work_plan(p_work_order_id uuid)
 RETURNS TABLE(work_plan_id uuid, step_count integer, outcome text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor       uuid := public.current_app_user_id();
  v_wo          public.work_orders;
  v_wpt_id      uuid;
  v_wpt_name    text;
  v_owner       uuid;
  v_new_plan_id uuid;
  v_status_new  uuid;
  v_count       integer := 0;
BEGIN
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_work_order_id AND work_order_is_deleted IS NOT TRUE;
  IF v_wo.id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 0, 'error', format('Work order %s not found or deleted', p_work_order_id);
    RETURN;
  END IF;

  -- Actor: prefer the session app-user; fall back to the work order's owner/creator
  -- so the function never writes a NULL audit actor regardless of how it is invoked.
  v_actor := COALESCE(v_actor, v_wo.work_order_owner, v_wo.work_order_created_by);
  v_owner := COALESCE(v_wo.work_order_owner, v_actor);

  SELECT wp.id INTO v_new_plan_id
    FROM public.work_plans wp
   WHERE wp.work_order_id = p_work_order_id AND wp.work_plan_is_deleted IS NOT TRUE
   LIMIT 1;
  IF v_new_plan_id IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.work_steps ws WHERE ws.work_plan_id = v_new_plan_id AND ws.work_step_is_deleted IS NOT TRUE;
    RETURN QUERY SELECT v_new_plan_id, v_count, 'exists', 'Work plan already instantiated for this work order';
    RETURN;
  END IF;

  SELECT wt.work_type_default_work_plan_template_id INTO v_wpt_id
    FROM public.work_types wt WHERE wt.id = v_wo.work_type_id;
  IF v_wpt_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 0, 'error',
      'Work type has no default work plan template — set work_type_default_work_plan_template_id first';
    RETURN;
  END IF;

  SELECT wpt.wpt_name INTO v_wpt_name FROM public.work_plan_templates wpt WHERE wpt.id = v_wpt_id AND wpt.wpt_is_deleted IS NOT TRUE;
  IF v_wpt_name IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 0, 'error', 'Default work plan template is missing or deleted';
    RETURN;
  END IF;

  SELECT id INTO v_status_new FROM public.picklist_values
   WHERE picklist_object='work_steps' AND picklist_field='work_step_status' AND picklist_value='New' AND picklist_is_active LIMIT 1;

  INSERT INTO public.work_plans (
    work_plan_record_number, work_plan_name, work_plan_owner, work_plan_created_by,
    work_order_id, work_plan_template_id, work_plan_description, work_plan_execution_order,
    is_seed_data, work_plan_is_deleted
  ) VALUES (
    '', v_wpt_name, v_owner, v_actor,
    p_work_order_id, v_wpt_id,
    (SELECT wpt_description FROM public.work_plan_templates WHERE id = v_wpt_id),
    1, false, false
  ) RETURNING id INTO v_new_plan_id;

  INSERT INTO public.work_steps (
    work_step_record_number, work_step_name, work_step_owner, work_step_created_by,
    work_plan_id, work_order_id, work_step_template_id,
    work_step_status, work_step_execution_order, work_step_plan_execution_order,
    work_step_description, work_step_action_type, work_step_action_definition,
    work_step_reference_photo_url,
    work_step_required_evidence_type_id, work_step_photos_required_count,
    work_step_photos_required_from_sampling,
    work_step_photo_before_required, work_step_photo_after_required,
    work_step_estimated_duration_minutes,
    work_step_assigned_owner_role_id, work_step_verifier_role_id,
    is_seed_data, work_step_is_deleted
  )
  SELECT
    '', wst.wst_name, v_owner, v_actor,
    v_new_plan_id, p_work_order_id, wst.id,
    v_status_new, e.wpte_execution_order, e.wpte_execution_order,
    wst.wst_description, wst.wst_action_type, wst.wst_action_definition,
    wst.wst_reference_photo_url,
    wst.wst_required_evidence_type_id, COALESCE(wst.wst_photos_required_count, 0),
    COALESCE(wst.wst_photos_required_from_sampling, false),
    COALESCE(wst.wst_photo_before_required, false), COALESCE(wst.wst_photo_after_required, false),
    wst.wst_estimated_duration_minutes,
    wst.wst_assigned_owner_role_id, wst.wst_verifier_role_id,
    false, false
  FROM public.work_plan_template_entries e
  JOIN public.work_step_templates wst ON wst.id = e.work_step_template_id AND wst.wst_is_deleted IS NOT TRUE
  WHERE e.work_plan_template_id = v_wpt_id AND e.wpte_is_deleted IS NOT TRUE
  ORDER BY e.wpte_execution_order;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN QUERY SELECT v_new_plan_id, v_count, 'success',
    format('Instantiated work plan "%s" with %s steps on work order %s', v_wpt_name, v_count, v_wo.work_order_record_number);
END;
$function$;

-- ============================================================================================
-- 6. Technician detail RPC — surface the effective required count + sampling context
-- ============================================================================================
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
    'building_unit_count',    (SELECT count(*) FROM public.units uu
                                 WHERE uu.building_id = wo.building_id AND uu.unit_is_deleted IS NOT TRUE),
    'quality_install_sample_size', public.quality_install_sample_size(
                                (SELECT count(*)::int FROM public.units uu
                                   WHERE uu.building_id = wo.building_id AND uu.unit_is_deleted IS NOT TRUE)),
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

  SELECT min(ph.created_at), max(ph.created_at)
  INTO v_first, v_last
  FROM public.photos ph
  JOIN public.work_steps ws ON ws.id = ph.work_step_id
  WHERE ws.work_order_id = p_wo_id AND ph.is_deleted = false;

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
      'photos_required_count',   public._work_step_required_photo_count(ws.*),
      'photos_required_from_sampling', COALESCE(ws.work_step_photos_required_from_sampling, false),
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
                                     'help', f.wstf_help_text,
                                     'illustration', f.wstf_illustration_url,
                                     'calculated', coalesce(f.wstf_is_calculated,false),
                                     'calc', f.wstf_calc_expression,
                                     'allow_not_present', coalesce(f.wstf_allow_not_present,false),
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

-- ============================================================================================
-- 7. Work type + work plan template + 12 photo step templates + WO record type
-- ============================================================================================
DO $mig$
DECLARE
  v_owner     uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';         -- platform system/admin user
  v_pc_role   uuid := 'a449faf4-deed-4878-a9f4-6f4529813a52';         -- Project Coordinator role
  v_photo_evi uuid := '16130b3e-e416-4d92-bf23-ec0f8aeee3e1';         -- evidence type: Photo
  v_wt_rt     uuid := 'b8216c81-878e-4c02-81e6-98db2ad86c88';         -- work_types record type: VERIFICATION
  v_wpt_rt    uuid := '5492c001-9e9c-4a61-9692-5f91044ce2f4';         -- work_plan_templates record type: STANDARD
  v_wo_rt     uuid;
  v_wpt_id    uuid;
  v_wt_id     uuid;
  v_step_id   uuid;
  r           record;
BEGIN
  -- Work order record type
  SELECT id INTO v_wo_rt FROM public.picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='record_type' AND picklist_value='QUALITY-INSTALL-VERIFICATION';
  IF v_wo_rt IS NULL THEN
    INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label,
        picklist_is_active, picklist_sort_order, picklist_show_in_path, picklist_created_by)
    VALUES ('work_orders','record_type','QUALITY-INSTALL-VERIFICATION','Quality Install Verification',
        true, 900, true, v_owner)
    RETURNING id INTO v_wo_rt;
  END IF;

  -- Work plan template
  INSERT INTO public.work_plan_templates (wpt_record_number, wpt_name, wpt_owner, wpt_created_by,
      wpt_description, wpt_record_type, wpt_is_active, wpt_allow_any_order, wpt_is_deleted)
  VALUES ('', 'Attic Quality Install Verification - HOMES & HEAR', v_owner, v_owner,
      'IRA Multifamily quality installation verification photo documentation for attic air sealing and attic insulation (HOMES & HEAR). The required photo count per step is sampled from the building unit count per the IRA Multifamily Quality Install Sampling Rate. Owned and verified by the Project Coordinator; supports both live LEAP Pad capture and after-the-fact desktop upload with original-capture EXIF/GPS preserved.',
      v_wpt_rt, true, true, false)
  RETURNING id INTO v_wpt_id;

  -- Work type (created via the opportunity action / RPC, not the LEAP Pad technician menu)
  INSERT INTO public.work_types (work_type_record_number, work_type_name, work_type_owner, work_type_created_by,
      work_type_description, work_type_record_type, work_type_is_active,
      work_type_default_work_plan_template_id, work_type_default_work_order_record_type,
      work_type_is_technician_creatable, work_type_is_deleted)
  VALUES ('', 'Attic Quality Install Verification (HOMES & HEAR)', v_owner, v_owner,
      'Final quality installation verification for HOMES & HEAR attic air sealing and insulation. Building-scoped, tied to the opportunity, owned and verified by the Project Coordinator. The photo sampling gate reads the building unit count.',
      v_wt_rt, true, v_wpt_id, v_wo_rt, false, false)
  RETURNING id INTO v_wt_id;

  -- 12 photo step templates (8 Attic Air Sealing, 4 Attic Insulation), each sampling-gated
  FOR r IN
    SELECT * FROM (VALUES
      (1,  'Wire and Pipe Penetrations Photos',     'Attic Air Sealing (HOMES & HEAR): Take a photo of electrical wire and pipe penetrations sealed.'),
      (2,  'Drywall to Top Plate Photos',           'Attic Air Sealing (HOMES & HEAR): Take a photo of the drywall to top plate seam sealed.'),
      (3,  'Recessed Light Photos',                 'Attic Air Sealing (HOMES & HEAR): Take a photo of a recessed light fixture treatment.'),
      (4,  'Heat Source Photos',                    'Attic Air Sealing (HOMES & HEAR): Take a photo of fire caulking and the sheet metal dam of the chimney / flue pipe.'),
      (5,  'Exhaust Fan Sealed to Drywall Photos',  'Attic Air Sealing (HOMES & HEAR): Take a photo of the exhaust fan sealed to drywall.'),
      (6,  'Attic Access Dam Photos',               'Attic Air Sealing (HOMES & HEAR): Take a photo of the installed and sealed insulation dam around the attic access.'),
      (7,  'Attic Access Weatherstrip Photos',      'Attic Air Sealing (HOMES & HEAR): Take a photo of the weatherstrip air sealed attic access.'),
      (8,  'Attic Floor Preparation Photos',        'Attic Air Sealing (HOMES & HEAR): Take a photo of the attic floor with insulation removed.'),
      (9,  'Insulation Measuring Rulers Photos',    'Attic Insulation (HOMES & HEAR): Take a photo of one ruler showing depth of insulation.'),
      (10, 'Insulation Product Photos',             'Attic Insulation (HOMES & HEAR): Take a photo of the insulation bag, product, or manufacturer spec sheet.'),
      (11, 'Wide Angle Photos',                     'Attic Insulation (HOMES & HEAR): Take at least one photo showing insulation uniformity.'),
      (12, 'Attic Door/Hatch Photos',              'Attic Insulation (HOMES & HEAR): Take a photo of insulation on the attic door / hatch.')
    ) AS t(ord, nm, descr)
    ORDER BY ord
  LOOP
    INSERT INTO public.work_step_templates (wst_record_number, wst_name, wst_owner, wst_created_by,
        wst_description, wst_is_active, wst_required_evidence_type_id,
        wst_photos_required_count, wst_photos_required_from_sampling,
        wst_photo_before_required, wst_photo_after_required,
        wst_assigned_owner_role_id, wst_verifier_role_id, wst_is_screen_flow, wst_is_deleted)
    VALUES ('', r.nm, v_owner, v_owner, r.descr, true, v_photo_evi,
        0, true, false, false, v_pc_role, v_pc_role, false, false)
    RETURNING id INTO v_step_id;

    INSERT INTO public.work_plan_template_entries (wpte_record_number, wpte_name,
        work_plan_template_id, work_step_template_id, wpte_execution_order, wpte_created_by, wpte_is_deleted)
    VALUES ('', r.nm, v_wpt_id, v_step_id, r.ord, v_owner, false);
  END LOOP;
END $mig$;

-- ============================================================================================
-- 8. Create path — a building-scoped, opportunity-tied Quality Install Verification work order
-- The opportunity is the primary tie (this feeds the Final Project Payment Request application);
-- work_orders.project_id is NOT NULL, so we also reference the install project being verified,
-- resolved from the opportunity + building when the caller does not name one explicitly.
-- ============================================================================================
DROP FUNCTION IF EXISTS public.create_quality_install_verification_work_order(uuid, uuid);
CREATE OR REPLACE FUNCTION public.create_quality_install_verification_work_order(
  p_opportunity_id uuid, p_building_id uuid, p_project_id uuid DEFAULT NULL)
 RETURNS TABLE(work_order_id uuid, record_number text, outcome text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := public.current_app_user_id();
  v_wt    public.work_types;
  v_opp   public.opportunities;
  v_bld   public.buildings;
  v_pc    uuid;
  v_status uuid;
  v_prop  uuid;
  v_acct  uuid;
  v_proj  uuid;
  v_proj_n integer;
  v_new   uuid;
  v_rn    text;
  v_label text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Not authenticated.'; RETURN;
  END IF;

  SELECT * INTO v_wt FROM public.work_types
   WHERE work_type_name = 'Attic Quality Install Verification (HOMES & HEAR)'
     AND work_type_is_deleted IS NOT TRUE;
  IF v_wt.id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Quality Install Verification work type not found.'; RETURN;
  END IF;

  SELECT * INTO v_opp FROM public.opportunities WHERE id = p_opportunity_id AND opportunity_is_deleted IS NOT TRUE;
  IF v_opp.id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Opportunity not found.'; RETURN;
  END IF;

  SELECT * INTO v_bld FROM public.buildings WHERE id = p_building_id AND building_is_deleted IS NOT TRUE;
  IF v_bld.id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Building not found.'; RETURN;
  END IF;

  -- Resolve the install project being verified (work_orders.project_id is required).
  IF p_project_id IS NOT NULL THEN
    SELECT id INTO v_proj FROM public.projects WHERE id = p_project_id AND project_is_deleted IS NOT TRUE;
    IF v_proj IS NULL THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Project not found.'; RETURN;
    END IF;
  ELSE
    SELECT count(*), min(id) INTO v_proj_n, v_proj FROM public.projects
     WHERE opportunity_id = p_opportunity_id AND building_id = p_building_id AND project_is_deleted IS NOT TRUE;
    IF v_proj_n = 0 THEN
      SELECT count(*), min(id) INTO v_proj_n, v_proj FROM public.projects
       WHERE opportunity_id = p_opportunity_id AND project_is_deleted IS NOT TRUE;
    END IF;
    IF v_proj IS NULL THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'error',
        'No project found on this opportunity — specify the install project to verify.'; RETURN;
    END IF;
    IF v_proj_n > 1 THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'error',
        'Multiple projects on this opportunity/building — specify which install project to verify.'; RETURN;
    END IF;
  END IF;

  v_prop  := COALESCE(v_bld.property_id, v_opp.property_id);
  v_acct  := v_opp.opportunity_account_id;
  v_pc    := COALESCE(public._resolve_field_review_coordinator(), v_actor);
  v_label := COALESCE(NULLIF(v_bld.building_number_or_name,''), v_bld.building_name, 'Building');

  SELECT id INTO v_status FROM public.picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='work_order_status'
     AND picklist_value='New' AND picklist_is_active LIMIT 1;

  INSERT INTO public.work_orders (
    work_order_record_number, work_order_name, work_order_owner, work_order_created_by,
    opportunity_id, project_id, property_id, building_id, work_order_account_id,
    work_type_id, work_order_record_type, work_order_status, project_coordinator_id,
    work_order_subject, work_order_description
  ) VALUES (
    '', 'Quality Install Verification - ' || v_label, v_pc, v_actor,
    p_opportunity_id, v_proj, v_prop, p_building_id, v_acct,
    v_wt.id, v_wt.work_type_default_work_order_record_type, v_status, v_pc,
    v_wt.work_type_name,
    format('IRA Multifamily quality installation verification photo documentation for %s. Required photos per step are sampled from the building unit count.', v_label)
  ) RETURNING id, work_orders.work_order_record_number INTO v_new, v_rn;

  RETURN QUERY SELECT v_new, v_rn, 'success', format('%s %s created', v_wt.work_type_name, v_rn);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_quality_install_verification_work_order(uuid, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_quality_install_verification_work_order(uuid, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
