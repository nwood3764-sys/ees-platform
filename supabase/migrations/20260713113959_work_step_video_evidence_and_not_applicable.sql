-- =====================================================================
-- Work step evidence layer: Video evidence type (hard-gated) +
-- step-level Not Applicable with a required reason.
--
-- Built for the Insulation Removal - Attic work plan (WPT-00004), but
-- generic to every work plan:
--
-- 1. work_steps.work_step_not_applicable_reason — why a step did not
--    apply (e.g. "No can lights present in the attic").
-- 2. Reactivate the existing 'Not Applicable' work step status.
-- 3. New 'Video' required-evidence-type picklist value for step
--    templates (a full-circle pan video recorded on the technician's
--    phone).
-- 4. _work_step_evidence_gap: Video steps require >= 1 video file
--    attached to the step (documents rows with a video/* mime type).
-- 5. rollup_work_plan_status: Not Applicable steps no longer hold a
--    plan open — they are excluded from the applicable-step totals.
-- 6. mark_work_step_not_applicable(p_step_id, p_reason): technician-
--    facing RPC; reason is mandatory.
-- 7. work_order_detail_for_technician: steps now carry video_count,
--    videos, and not_applicable_reason.
--
-- Applied to production 2026-07-13 via MCP (version 20260713113959).
-- =====================================================================

-- 1. Reason column ------------------------------------------------------------
ALTER TABLE public.work_steps
  ADD COLUMN IF NOT EXISTS work_step_not_applicable_reason text;

-- 2. Reactivate 'Not Applicable' work step status ----------------------------
UPDATE public.picklist_values
   SET picklist_is_active = true
 WHERE picklist_object = 'work_steps'
   AND picklist_field  = 'work_step_status'
   AND picklist_value  = 'Not Applicable';

-- 3. 'Video' required evidence type (idempotent) ------------------------------
INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_is_active, picklist_sort_order, picklist_description)
SELECT 'work_step_templates', 'wst_required_evidence_type_id', 'Video', 'Video',
       true, 5,
       'Video capture required as step evidence (e.g. a slow full-circle pan recorded on the technician''s phone).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values
   WHERE picklist_object = 'work_step_templates'
     AND picklist_field  = 'wst_required_evidence_type_id'
     AND picklist_value  = 'Video'
);

-- 4. Evidence gap: add the Video branch ---------------------------------------
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

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public._work_step_evidence_gap(work_steps) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._work_step_evidence_gap(work_steps) TO authenticated, service_role;

-- 5. Plan rollup: Not Applicable steps are excluded from applicable totals ----
CREATE OR REPLACE FUNCTION public.rollup_work_plan_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_plan uuid := COALESCE(NEW.work_plan_id, OLD.work_plan_id);
  -- step status ids
  s_new        uuid := 'e83b77fa-9902-4329-bd2c-a0b73df782ba';
  s_inprog     uuid := 'ccb51848-2251-42f2-97b2-e0f604a672a1';
  s_unable     uuid := '16174ac6-6ec9-44a0-b722-78074e117d5f';
  s_completed  uuid := '101e1e86-2f49-4999-9fbb-fc5451df5fdc';
  s_verified   uuid := 'f25dc618-6416-480d-8a09-b31ba5205329';
  s_na         uuid := 'cecbe14a-485d-4a3c-8b82-ddae05e2f4e2';
  -- plan status ids
  p_new        uuid := 'b895cdea-5af9-455f-8517-f4b7f031665e';
  p_inprog     uuid := '93a2faa6-5eab-44b7-aebf-4bd22b14a05f';
  p_unable     uuid := '85203617-8ebe-48af-8cb0-d0ac31e9fbb2';
  p_completed  uuid := 'fca72be9-c550-4809-b165-10c7c8e40d47';
  p_verified   uuid := 'eb7c0e0b-1bb1-4c20-b575-66b4a876b236';
  n_total int; n_na int; n_unable int; n_verified int; n_done int; n_started int;
  v_new_status uuid;
BEGIN
  -- Not Applicable steps (documented via work_step_not_applicable_reason) do
  -- not count toward the plan's applicable totals — an attic with no can
  -- lights should not hold the plan open or force it Unable to Complete.
  SELECT count(*) FILTER (WHERE work_step_status IS DISTINCT FROM s_na),
         count(*) FILTER (WHERE work_step_status = s_na),
         count(*) FILTER (WHERE work_step_status = s_unable),
         count(*) FILTER (WHERE work_step_status = s_verified),
         count(*) FILTER (WHERE work_step_status IN (s_completed, s_verified)),
         count(*) FILTER (WHERE work_step_status NOT IN (s_new, s_na))
    INTO n_total, n_na, n_unable, n_verified, n_done, n_started
  FROM public.work_steps
  WHERE work_plan_id = v_plan AND COALESCE(work_step_is_deleted,false) = false;

  IF n_total = 0 AND n_na = 0 THEN
    v_new_status := p_new;                 -- no steps at all
  ELSIF n_unable > 0 THEN
    v_new_status := p_unable;              -- any blocked step forces plan Unable to Complete
  ELSIF n_total = 0 THEN
    v_new_status := p_completed;           -- every step Not Applicable
  ELSIF n_verified = n_total THEN
    v_new_status := p_verified;            -- all applicable steps verified
  ELSIF n_done = n_total THEN
    v_new_status := p_completed;           -- all applicable steps completed or verified
  ELSIF n_started > 0 OR n_na > 0 THEN
    v_new_status := p_inprog;
  ELSE
    v_new_status := p_new;
  END IF;

  UPDATE public.work_plans
     SET work_plan_status = v_new_status, work_plan_updated_at = now()
   WHERE id = v_plan AND work_plan_status IS DISTINCT FROM v_new_status;

  RETURN NULL;
END; $function$;

REVOKE ALL ON FUNCTION public.rollup_work_plan_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rollup_work_plan_status() TO authenticated, service_role;

-- 6. Step-level Not Applicable RPC (reason required) ---------------------------
CREATE OR REPLACE FUNCTION public.mark_work_step_not_applicable(p_step_id uuid, p_reason text)
 RETURNS TABLE(step_id uuid, status text, outcome text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor  uuid := public.current_app_user_id();
  v_step   public.work_steps;
  v_cur    text;
  v_na     uuid;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
BEGIN
  SELECT * INTO v_step FROM public.work_steps WHERE id = p_step_id AND work_step_is_deleted IS NOT TRUE;
  IF v_step.id IS NULL THEN
    RETURN QUERY SELECT p_step_id, NULL::text, 'error', 'Work step not found or deleted'; RETURN;
  END IF;

  v_actor := COALESCE(v_actor, v_step.work_step_owner, v_step.work_step_created_by);

  IF v_reason IS NULL THEN
    RETURN QUERY SELECT p_step_id, NULL::text, 'blocked',
      'A reason is required to mark a step Not Applicable (e.g. "No can lights present in the attic").';
    RETURN;
  END IF;

  SELECT picklist_value INTO v_cur FROM public.picklist_values WHERE id = v_step.work_step_status;
  IF v_cur IN ('Completed','Verified') THEN
    RETURN QUERY SELECT p_step_id, v_cur, 'blocked',
      format('Step is already %s and cannot be marked Not Applicable', v_cur);
    RETURN;
  END IF;
  IF v_cur = 'Not Applicable' THEN
    RETURN QUERY SELECT p_step_id, v_cur, 'noop', 'Step is already marked Not Applicable'; RETURN;
  END IF;

  SELECT id INTO v_na FROM public.picklist_values
   WHERE picklist_object='work_steps' AND picklist_field='work_step_status'
     AND picklist_value='Not Applicable' AND picklist_is_active LIMIT 1;
  IF v_na IS NULL THEN
    RETURN QUERY SELECT p_step_id, v_cur, 'error', 'Not Applicable work step status is not configured'; RETURN;
  END IF;

  UPDATE public.work_steps
     SET work_step_status = v_na,
         work_step_not_applicable_reason = v_reason,
         work_step_updated_by = v_actor,
         work_step_updated_at = now()
   WHERE id = p_step_id;

  RETURN QUERY SELECT p_step_id, 'Not Applicable', 'success',
    format('Step "%s" marked Not Applicable: %s', v_step.work_step_name, v_reason);
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_work_step_not_applicable(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_work_step_not_applicable(uuid, text) TO authenticated, service_role;

-- 7. Technician detail: surface videos + Not Applicable reason -----------------
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
