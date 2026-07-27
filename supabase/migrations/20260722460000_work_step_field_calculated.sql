-- Calculated work-step fields.
--
-- Some assessment fields are derived from other fields the auditor enters,
-- rather than captured directly. Output Capacity, for example, is BTU Input ×
-- AFUE efficiency — the auditor should never type it. This adds a data-driven
-- "calculated field" capability: a field flagged wstf_is_calculated carries an
-- arithmetic expression over sibling field names (wstf_calc_expression); LEAP
-- Pad computes it from the values the auditor entered, shows it read-only on the
-- section review, and persists it on save. No expression is ever evaluated in
-- the database — the column is metadata the client interprets.

ALTER TABLE public.work_step_template_fields
  ADD COLUMN IF NOT EXISTS wstf_is_calculated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wstf_calc_expression text;

COMMENT ON COLUMN public.work_step_template_fields.wstf_is_calculated IS
  'When true, the field is derived from other fields via wstf_calc_expression and is not captured directly.';
COMMENT ON COLUMN public.work_step_template_fields.wstf_calc_expression IS
  'Arithmetic expression over sibling wstf_field_name values (+ - * / and parentheses), evaluated client-side to produce the calculated value.';

-- Heating Output Capacity is calculated: BTU Input × AFUE efficiency.
UPDATE public.work_step_template_fields
SET wstf_is_calculated  = true,
    wstf_calc_expression = 'heating_system_btu * heating_efficiency_afue / 100',
    wstf_help_text       = 'Calculated automatically: BTU Input × AFUE efficiency.'
WHERE wstf_field_name = 'heating_output_capacity'
  AND wstf_is_deleted IS NOT TRUE;

-- Surface the new keys on the technician detail RPC.
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

NOTIFY pgrst, 'reload schema';
