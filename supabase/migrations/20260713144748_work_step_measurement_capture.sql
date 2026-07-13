-- =====================================================================
-- Measurement capture for work steps (Nicholas, 2026-07-13).
-- The insulation removal plan tracks attic square footage removed at
-- timed checkpoints and end of day; work orders are cut into ~5,000
-- sq ft / 8-hour blocks. The field definitions existed
-- (work_step_template_fields) but nothing captured values or gated on
-- them:
--   1. save_work_step_field_value(p_step_id, p_template_field_id,
--      p_value) — technician RPC; validates the field belongs to the
--      step, numbers parse (and are >= 0), and the step isn't closed.
--      Upserts into work_step_field_values.
--   2. _work_step_evidence_gap — steps with required fields cannot be
--      completed until every required field has a value (same hard
--      gate as photos/videos).
--   3. work_order_detail_for_technician — each step now carries
--      'fields' (definitions + current values) so LEAP Pad can render
--      the entry boxes.
--
-- Applied to production 2026-07-13 via MCP (version 20260713144748);
-- verified in a rolled-back probe: gap blocks -> save accepts "2,450"
-- -> gap clears.
-- =====================================================================

-- 1. Save RPC -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_work_step_field_value(p_step_id uuid, p_template_field_id uuid, p_value text)
 RETURNS TABLE(step_id uuid, status text, outcome text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor    uuid := public.current_app_user_id();
  v_step     public.work_steps;
  v_field    public.work_step_template_fields;
  v_cur      text;
  v_txt      text := nullif(trim(coalesce(p_value, '')), '');
  v_num      numeric;
  v_existing uuid;
BEGIN
  SELECT * INTO v_step FROM public.work_steps WHERE id = p_step_id AND work_step_is_deleted IS NOT TRUE;
  IF v_step.id IS NULL THEN
    RETURN QUERY SELECT p_step_id, NULL::text, 'error', 'Work step not found or deleted'; RETURN;
  END IF;

  v_actor := COALESCE(v_actor, v_step.work_step_owner, v_step.work_step_created_by);

  SELECT * INTO v_field FROM public.work_step_template_fields
   WHERE id = p_template_field_id AND wstf_is_deleted IS NOT TRUE AND wstf_is_active IS TRUE
     AND work_step_template_id = v_step.work_step_template_id;
  IF v_field.id IS NULL THEN
    RETURN QUERY SELECT p_step_id, NULL::text, 'error', 'Field does not belong to this work step'; RETURN;
  END IF;

  SELECT picklist_value INTO v_cur FROM public.picklist_values WHERE id = v_step.work_step_status;
  IF v_cur IN ('Completed','Verified','Not Applicable') THEN
    RETURN QUERY SELECT p_step_id, v_cur, 'blocked',
      format('Step is %s — its values are locked', v_cur);
    RETURN;
  END IF;

  IF v_txt IS NULL THEN
    RETURN QUERY SELECT p_step_id, v_cur, 'blocked',
      format('Enter a value for "%s"', v_field.wstf_field_label);
    RETURN;
  END IF;

  IF v_field.wstf_field_type = 'number' THEN
    BEGIN
      v_num := replace(v_txt, ',', '')::numeric;
    EXCEPTION WHEN others THEN
      RETURN QUERY SELECT p_step_id, v_cur, 'blocked',
        format('"%s" must be a number', v_field.wstf_field_label);
      RETURN;
    END;
    IF v_num < 0 THEN
      RETURN QUERY SELECT p_step_id, v_cur, 'blocked',
        format('"%s" must be zero or greater', v_field.wstf_field_label);
      RETURN;
    END IF;
    v_txt := NULL;
  ELSE
    v_num := NULL;
  END IF;

  SELECT id INTO v_existing FROM public.work_step_field_values
   WHERE work_step_id = p_step_id AND work_step_template_field_id = p_template_field_id
     AND wsfv_is_deleted IS NOT TRUE
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.work_step_field_values
       SET wsfv_numeric_value = v_num, wsfv_text_value = v_txt,
           wsfv_updated_by = v_actor, wsfv_updated_at = now()
     WHERE id = v_existing;
  ELSE
    INSERT INTO public.work_step_field_values
      (wsfv_record_number, wsfv_owner, wsfv_created_by,
       work_step_id, work_step_template_field_id, wsfv_numeric_value, wsfv_text_value)
    VALUES ('', v_actor, v_actor, p_step_id, p_template_field_id, v_num, v_txt);
  END IF;

  RETURN QUERY SELECT p_step_id, v_cur, 'success',
    format('"%s" saved', v_field.wstf_field_label);
END;
$function$;

REVOKE ALL ON FUNCTION public.save_work_step_field_value(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_work_step_field_value(uuid, uuid, text) TO authenticated, service_role;

-- 2. Evidence gap: required fields must have values ----------------------------
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
  v_req_count   integer := COALESCE(p_step.work_step_photos_required_count, 0);
  v_missing_field text;
BEGIN
  SELECT picklist_value INTO v_etype
    FROM public.picklist_values WHERE id = p_step.work_step_required_evidence_type_id;

  -- Photo tallies (apply to any step that declares photo requirements).
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

  -- Document Upload steps need at least one document artifact on the step.
  IF v_etype = 'Document Upload' THEN
    SELECT count(*) INTO v_doc_n
    FROM public.documents
    WHERE related_object = 'work_steps' AND related_id = p_step.id AND is_deleted = false;
    IF v_doc_n < 1 THEN
      RETURN format('Step "%s" requires a document upload; none attached. Upload the required document before completing.',
                    p_step.work_step_name);
    END IF;
  END IF;

  -- Video steps need at least one video file attached to the step.
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

  -- Required fields (measurements etc.) need saved values.
  SELECT f.wstf_field_label INTO v_missing_field
  FROM public.work_step_template_fields f
  WHERE f.work_step_template_id = p_step.work_step_template_id
    AND f.wstf_is_deleted IS NOT TRUE AND f.wstf_is_active IS TRUE AND f.wstf_is_required IS TRUE
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

REVOKE ALL ON FUNCTION public._work_step_evidence_gap(work_steps) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._work_step_evidence_gap(work_steps) TO authenticated, service_role;

-- 3. Technician detail: field definitions + current values ---------------------
-- (full function body — matches production verbatim)
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

NOTIFY pgrst, 'reload schema';
