-- "Required unless not present": a required photo field can opt into being
-- satisfied by an explicit "Not Present" mark instead of a photo, for equipment
-- that genuinely isn't there (e.g. no HVAC flue in this attic). Plus wiring the
-- attic photo-prompt illustrations.

ALTER TABLE public.work_step_template_fields
  ADD COLUMN IF NOT EXISTS wstf_allow_not_present boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.work_step_template_fields.wstf_allow_not_present IS
  'When true, a required photo field may be satisfied by an explicit "Not Present" mark (stored as the field value) instead of a photo.';

-- The attic flues and exhaust-fan photos are required, but may legitimately be
-- absent — allow "Not Present".
UPDATE public.work_step_template_fields
SET wstf_allow_not_present = true
WHERE wstf_field_name IN (
  'hvac_flue_photo','water_heater_flue_photo',
  'exhaust_fan_ducting_photo','exhaust_fan_termination_photo','exhaust_fan_exposed_photo'
) AND wstf_is_deleted IS NOT TRUE;

-- Evidence gate: a required photo field marked "Not Present" is satisfied.
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

-- Surface allow_not_present on the technician detail RPC's fields.
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

REVOKE ALL ON FUNCTION public.work_order_detail_for_technician(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_order_detail_for_technician(uuid) TO authenticated, service_role;

-- Wire the attic photo-prompt illustrations (shared ones reused across slots).
UPDATE public.work_step_template_fields f
SET wstf_illustration_url = m.url, wstf_updated_at = now()
FROM (VALUES
  ('attic_insulation_depth_photo','/illustrations/assessment/attic-depth-tape.svg'),
  ('hvac_flue_photo','/illustrations/assessment/attic-hvac-flue.svg'),
  ('water_heater_flue_photo','/illustrations/assessment/attic-wh-flue.svg'),
  ('exhaust_fan_ducting_photo','/illustrations/assessment/attic-fan-ducting.svg'),
  ('exhaust_fan_termination_photo','/illustrations/assessment/attic-fan-termination.svg'),
  ('exhaust_fan_exposed_photo','/illustrations/assessment/attic-fan-exposed.svg'),
  ('exhaust_fan2_ducting_photo','/illustrations/assessment/attic-fan-ducting.svg'),
  ('exhaust_fan2_termination_photo','/illustrations/assessment/attic-fan-termination.svg'),
  ('exhaust_fan2_exposed_photo','/illustrations/assessment/attic-fan-exposed.svg'),
  ('soffit_ventilation_photo','/illustrations/assessment/attic-soffit-vent.svg'),
  ('air_sealing_photo_1','/illustrations/assessment/attic-air-sealing.svg'),
  ('air_sealing_photo_2','/illustrations/assessment/attic-air-sealing.svg'),
  ('air_sealing_photo_3','/illustrations/assessment/attic-air-sealing.svg'),
  ('air_sealing_photo_4','/illustrations/assessment/attic-air-sealing.svg'),
  ('top_plates_photo_1','/illustrations/assessment/attic-top-plates.svg'),
  ('top_plates_photo_2','/illustrations/assessment/attic-top-plates.svg'),
  ('pipes_wires_photo_1','/illustrations/assessment/attic-pipes-wires.svg'),
  ('pipes_wires_photo_2','/illustrations/assessment/attic-pipes-wires.svg'),
  ('attic_bypasses_photo','/illustrations/assessment/attic-bypasses.svg')
) AS m(field_name,url)
WHERE f.wstf_field_name = m.field_name AND f.wstf_is_deleted IS NOT TRUE;

-- Attic 360 Video step reference illustration.
UPDATE public.work_step_templates st
SET wst_reference_photo_url = '/illustrations/assessment/attic-360.svg', wst_updated_at = now()
WHERE st.wst_name = 'Attic 360 Video' AND st.wst_is_deleted IS NOT TRUE
  AND EXISTS (SELECT 1 FROM public.work_plan_template_entries e
              WHERE e.work_step_template_id = st.id
                AND e.work_plan_template_id = 'b122ffcf-b0e5-4ac0-8d17-d1f063f12ac5'
                AND e.wpte_is_deleted IS NOT TRUE);

NOTIFY pgrst, 'reload schema';
