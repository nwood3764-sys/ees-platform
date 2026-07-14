-- =====================================================================
-- Work Order Review experience (Nicholas, 2026-07-14).
--
-- Desktop review for the Project Coordinator (Field module → Verification
-- Reviews): layout-driven record fields per record type (Review Page
-- Layouts — page_layouts.page_layout_type='review', Salesforce
-- approval-page-layout parity, admin-manageable, nothing hardcoded),
-- step-by-step evidence review with per-step Approve / Needs Correction
-- (work_step_pc_approval_status / work_step_pc_comment — columns that
-- existed in the schema, now given their UI), and a work-order-level
-- Verify / Send Back that walks the existing status lifecycle:
--   To Be Verified → Verified          (all applicable steps PC-approved)
--   To Be Verified → Corrections Needed (comment required; rejected steps
--                                        go back to In Progress; task +
--                                        in-app notification to the
--                                        technician — never email)
-- Resubmission walks the designed lifecycle Corrections Needed →
-- In Progress → To Be Verified and resets only the rejected steps' PC
-- decision so the reviewer re-reviews exactly what was reworked.
--
-- Applied to production 2026-07-14 via MCP (registry
-- 20260714…_work_order_review_experience + same-session hot fixes folded
-- in here: photos.latitude/longitude column names and app_user_can's
-- (p_object, p_action) argument order — including the frc_read_internal
-- policy from 20260714110000 which had the arguments reversed).
-- End-to-end verified in a rolled-back probe on WO-00058 as Brittin Wood:
-- approve/reject with comment gates, verify blocked while a rejection
-- exists, send-back task + notification, two-hop resubmission, final
-- Verified + approval lock + technician notification.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Fix from 20260714110000: app_user_can takes (p_object, p_action).
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS frc_read_internal ON public.field_review_coordinator_assignments;
CREATE POLICY frc_read_internal ON public.field_review_coordinator_assignments
  FOR SELECT TO authenticated USING (public.app_user_can('work_orders', 'read'));

-- ---------------------------------------------------------------------
-- 1. Reviewer detail RPC: header + raw record row (for the review layout)
--    + steps with photo/video/measurement evidence and PC review state.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.work_order_detail_for_review(p_wo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := public.current_app_user_id();
  v_header jsonb;
  v_record jsonb;
  v_steps  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('outcome','error','message','Not authenticated.');
  END IF;
  IF NOT public.app_user_can('work_orders','read') THEN
    RETURN jsonb_build_object('outcome','error','message','No access to work orders.');
  END IF;

  SELECT jsonb_build_object(
    'work_order_id',            wo.id,
    'work_order_record_number', wo.work_order_record_number,
    'work_order_name',          wo.work_order_name,
    'work_order_status',        wost.picklist_value,
    'work_order_status_id',     wo.work_order_status,
    'approval_status',          apst.picklist_value,
    'record_type_id',           wo.work_order_record_type,
    'record_type_value',        rt.picklist_value,
    'work_type_name',           wt.work_type_name,
    'property_name',            p.property_name,
    'building',                 COALESCE(NULLIF(wo.work_order_building,''), b.building_number_or_name, b.building_name),
    'unit',                     COALESCE(NULLIF(wo.work_order_unit,''), u.unit_number, u.unit_name),
    'project_name',             pr.project_name,
    'technician_name',          tech.user_name,
    'coordinator_name',         pc.user_name,
    'submitted_at',             wo.work_order_updated_at,
    'reject_reason',            wo.work_order_reject_reason,
    'approver_comment',         wo.work_order_approver_comment
  ), to_jsonb(wo)
  INTO v_header, v_record
  FROM public.work_orders wo
  LEFT JOIN public.picklist_values wost ON wost.id = wo.work_order_status
  LEFT JOIN public.picklist_values apst ON apst.id = wo.work_order_approval_status
  LEFT JOIN public.picklist_values rt   ON rt.id   = wo.work_order_record_type
  LEFT JOIN public.work_types wt ON wt.id = wo.work_type_id
  LEFT JOIN public.properties p  ON p.id  = wo.property_id
  LEFT JOIN public.buildings  b  ON b.id  = wo.building_id
  LEFT JOIN public.units      u  ON u.id  = wo.unit_id
  LEFT JOIN public.projects   pr ON pr.id = wo.project_id
  LEFT JOIN public.users tech ON tech.id = wo.work_order_owner
  LEFT JOIN public.users pc   ON pc.id   = wo.project_coordinator_id
  WHERE wo.id = p_wo_id AND wo.work_order_is_deleted IS NOT TRUE;

  IF v_header IS NULL THEN
    RETURN jsonb_build_object('outcome','error','message','Work order not found.');
  END IF;

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
      'evidence_type',           et.picklist_value,
      'not_applicable_reason',   ws.work_step_not_applicable_reason,
      'pc_approval_status',      pcst.picklist_value,
      'pc_comment',              ws.work_step_pc_comment,
      'photo_count',             (SELECT count(*) FROM public.photos p2 WHERE p2.work_step_id = ws.id AND p2.is_deleted = false),
      'photos',                  (SELECT coalesce(jsonb_agg(jsonb_build_object(
                                     'id', p2.id, 'photo_type', p2.photo_type,
                                     'bucket', p2.storage_bucket, 'path', p2.storage_path_original,
                                     'taken_at', p2.taken_at,
                                     'latitude', p2.latitude, 'longitude', p2.longitude
                                   ) ORDER BY p2.taken_at), '[]'::jsonb)
                                   FROM public.photos p2 WHERE p2.work_step_id = ws.id AND p2.is_deleted = false),
      'videos',                  (SELECT coalesce(jsonb_agg(jsonb_build_object(
                                     'id', d.id, 'name', d.name,
                                     'bucket', d.storage_bucket, 'path', d.storage_path,
                                     'created_at', d.created_at
                                   ) ORDER BY d.created_at), '[]'::jsonb)
                                   FROM public.documents d
                                   WHERE d.related_object = 'work_steps' AND d.related_id = ws.id
                                     AND d.is_deleted = false AND d.mime_type ILIKE 'video/%'),
      'fields',                  (SELECT coalesce(jsonb_agg(jsonb_build_object(
                                     'field_id', f.id, 'label', f.wstf_field_label,
                                     'type', f.wstf_field_type, 'unit', f.wstf_unit,
                                     'required', coalesce(f.wstf_is_required,false),
                                     'numeric_value', fv.wsfv_numeric_value, 'text_value', fv.wsfv_text_value
                                   ) ORDER BY f.wstf_sort_order), '[]'::jsonb)
                                   FROM public.work_step_template_fields f
                                   LEFT JOIN public.work_step_field_values fv
                                     ON fv.work_step_template_field_id = f.id AND fv.work_step_id = ws.id
                                        AND fv.wsfv_is_deleted IS NOT TRUE
                                   WHERE f.work_step_template_id = ws.work_step_template_id
                                     AND f.wstf_is_deleted IS NOT TRUE AND f.wstf_is_active IS TRUE)
    ) AS step
    FROM public.work_steps ws
    LEFT JOIN public.picklist_values wsst ON wsst.id = ws.work_step_status
    LEFT JOIN public.picklist_values et   ON et.id   = ws.work_step_required_evidence_type_id
    LEFT JOIN public.picklist_values pcst ON pcst.id = ws.work_step_pc_approval_status
    WHERE ws.work_order_id = p_wo_id AND ws.work_step_is_deleted IS NOT TRUE
  ) s;

  RETURN jsonb_build_object('outcome','ok', 'header', v_header, 'record', v_record, 'steps', v_steps);
END; $function$;

REVOKE ALL ON FUNCTION public.work_order_detail_for_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_order_detail_for_review(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Per-step PC review: Approve / Needs Correction with required comment.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_work_step(p_work_step_id uuid, p_approved boolean, p_comment text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := public.current_app_user_id();
  v_ws  public.work_steps;
  v_val uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('outcome','error','message','Not authenticated.');
  END IF;
  IF NOT public.app_user_can('work_steps','update') THEN
    RETURN jsonb_build_object('outcome','error','message','No permission to review work steps.');
  END IF;

  SELECT * INTO v_ws FROM public.work_steps WHERE id = p_work_step_id AND work_step_is_deleted IS NOT TRUE;
  IF v_ws.id IS NULL THEN
    RETURN jsonb_build_object('outcome','error','message','Work step not found.');
  END IF;

  IF NOT p_approved AND nullif(trim(coalesce(p_comment,'')), '') IS NULL THEN
    RETURN jsonb_build_object('outcome','error','message','A comment is required when a step needs correction.');
  END IF;

  SELECT id INTO v_val FROM public.picklist_values
   WHERE picklist_object='work_steps' AND picklist_field='work_step_pc_approval_status'
     AND picklist_value = CASE WHEN p_approved THEN 'Approved' ELSE 'Rejected' END
     AND picklist_is_active LIMIT 1;

  UPDATE public.work_steps SET
    work_step_pc_approval_status = v_val,
    work_step_pc_comment = nullif(trim(coalesce(p_comment,'')), ''),
    work_step_updated_at = now(),
    work_step_updated_by = v_uid
  WHERE id = p_work_step_id;

  RETURN jsonb_build_object('outcome','ok',
    'pc_approval_status', CASE WHEN p_approved THEN 'Approved' ELSE 'Rejected' END);
END; $function$;

REVOKE ALL ON FUNCTION public.review_work_step(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_work_step(uuid, boolean, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Complete the review: Verify, or Send Back for Corrections.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_work_order_review(p_wo_id uuid, p_outcome text, p_comment text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := public.current_app_user_id();
  v_wo  public.work_orders;
  v_cur text;
  v_unreviewed int;
  v_rejected int;
  v_status_id uuid;
  v_appr_id uuid;
  v_in_progress uuid;
  v_rejected_list text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('outcome','error','message','Not authenticated.');
  END IF;
  IF NOT public.app_user_can('work_orders','update') THEN
    RETURN jsonb_build_object('outcome','error','message','No permission to review work orders.');
  END IF;
  IF p_outcome NOT IN ('verified','corrections_needed') THEN
    RETURN jsonb_build_object('outcome','error','message','Outcome must be verified or corrections_needed.');
  END IF;

  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_wo_id AND work_order_is_deleted IS NOT TRUE;
  IF v_wo.id IS NULL THEN
    RETURN jsonb_build_object('outcome','error','message','Work order not found.');
  END IF;

  SELECT picklist_value INTO v_cur FROM public.picklist_values WHERE id = v_wo.work_order_status;
  IF v_cur <> 'To Be Verified' THEN
    RETURN jsonb_build_object('outcome','error',
      'message', format('Work order is "%s". Only a work order in To Be Verified can be reviewed.', coalesce(v_cur,'(no status)')));
  END IF;

  IF p_outcome = 'verified' THEN
    -- Every applicable step must be PC-approved; Not Applicable steps are exempt.
    SELECT count(*) FILTER (WHERE coalesce(pcst.picklist_value,'') <> 'Approved'
                              AND coalesce(wsst.picklist_value,'') <> 'Not Applicable'),
           count(*) FILTER (WHERE pcst.picklist_value = 'Rejected')
    INTO v_unreviewed, v_rejected
    FROM public.work_steps ws
    LEFT JOIN public.picklist_values pcst ON pcst.id = ws.work_step_pc_approval_status
    LEFT JOIN public.picklist_values wsst ON wsst.id = ws.work_step_status
    WHERE ws.work_order_id = p_wo_id AND ws.work_step_is_deleted IS NOT TRUE;

    IF v_rejected > 0 THEN
      RETURN jsonb_build_object('outcome','error',
        'message', format('%s step(s) are marked Needs Correction. Send the work order back for corrections instead.', v_rejected));
    END IF;
    IF v_unreviewed > 0 THEN
      RETURN jsonb_build_object('outcome','error',
        'message', format('%s step(s) have not been approved yet. Approve every applicable step before verifying.', v_unreviewed));
    END IF;

    SELECT id INTO v_status_id FROM public.picklist_values
     WHERE picklist_object='work_orders' AND picklist_field='work_order_status'
       AND picklist_value='Verified' AND picklist_is_active LIMIT 1;
    SELECT id INTO v_appr_id FROM public.picklist_values
     WHERE picklist_object='work_orders' AND picklist_field='work_order_approval_status'
       AND picklist_value='Approved' AND picklist_is_active LIMIT 1;

    PERFORM public.change_record_status('work_orders', p_wo_id, 'work_order_status', v_status_id,
      'Verified by Project Coordinator review');

    UPDATE public.work_orders SET
      work_order_approval_status = v_appr_id,
      work_order_approver_comment = nullif(trim(coalesce(p_comment,'')), ''),
      work_order_is_approval_locked = true,
      work_order_updated_at = now(),
      work_order_updated_by = v_uid
    WHERE id = p_wo_id;

    -- Close out the open review task(s) for this work order.
    UPDATE public.tasks SET status = 'Completed', completed_date = now(), updated_at = now()
    WHERE related_object = 'work_orders' AND related_id = p_wo_id
      AND automation_rule IN ('work_order_to_be_verified_review_task','field_created_data_review')
      AND status <> 'Completed' AND is_deleted IS NOT TRUE;

    -- In-app notification to the technician. No email — assessment scheduling
    -- is the only customer/email pipeline, and staff notifications stay in-app.
    INSERT INTO public.notifications (recipient_id, notification_type, title, body,
                                      related_object, related_id, channel, is_automated, triggered_by)
    VALUES (v_wo.work_order_owner, 'work_order_verified',
            format('Work order %s verified', v_wo.work_order_record_number),
            format('%s — %s passed Project Coordinator review and is now Verified.',
                   v_wo.work_order_record_number, coalesce(v_wo.work_order_name,'work order')),
            'work_orders', p_wo_id, 'in_app', true, v_uid);

    RETURN jsonb_build_object('outcome','ok','status','Verified');
  END IF;

  -- corrections_needed
  IF nullif(trim(coalesce(p_comment,'')), '') IS NULL THEN
    RETURN jsonb_build_object('outcome','error','message','A comment is required when sending a work order back for corrections.');
  END IF;

  SELECT string_agg(format('%s — %s', ws.work_step_name, coalesce(ws.work_step_pc_comment,'see review')), E'\n' ORDER BY ws.work_step_execution_order)
  INTO v_rejected_list
  FROM public.work_steps ws
  JOIN public.picklist_values pcst ON pcst.id = ws.work_step_pc_approval_status
  WHERE ws.work_order_id = p_wo_id AND ws.work_step_is_deleted IS NOT TRUE
    AND pcst.picklist_value = 'Rejected';

  SELECT id INTO v_status_id FROM public.picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='work_order_status'
     AND picklist_value='Corrections Needed' AND picklist_is_active LIMIT 1;
  SELECT id INTO v_appr_id FROM public.picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='work_order_approval_status'
     AND picklist_value='Correction Needed' AND picklist_is_active LIMIT 1;

  PERFORM public.change_record_status('work_orders', p_wo_id, 'work_order_status', v_status_id,
    'Sent back for corrections by Project Coordinator review');

  UPDATE public.work_orders SET
    work_order_approval_status = v_appr_id,
    work_order_reject_reason = trim(p_comment),
    work_order_updated_at = now(),
    work_order_updated_by = v_uid
  WHERE id = p_wo_id;

  -- Rejected steps go back to In Progress so the technician can rework them
  -- (LEAP Pad shows the PC comment on the step).
  SELECT id INTO v_in_progress FROM public.picklist_values
   WHERE picklist_object='work_steps' AND picklist_field='work_step_status'
     AND picklist_value='In Progress' AND picklist_is_active LIMIT 1;

  UPDATE public.work_steps ws SET
    work_step_status = v_in_progress,
    work_step_updated_at = now(),
    work_step_updated_by = v_uid
  FROM public.picklist_values pcst
  WHERE pcst.id = ws.work_step_pc_approval_status
    AND ws.work_order_id = p_wo_id AND ws.work_step_is_deleted IS NOT TRUE
    AND pcst.picklist_value = 'Rejected';

  -- Task to the technician; the task insert fires the in-app notification.
  INSERT INTO public.tasks (subject, description, status, priority, owner_id, created_by_id,
                            related_object, related_id, is_automated, automation_rule, due_date)
  VALUES (
    format('Corrections needed — %s', v_wo.work_order_record_number),
    format('The Project Coordinator sent %s back for corrections: %s%s Rework the flagged steps in LEAP Pad and resubmit for verification. Open the work order: /work_orders/%s',
           v_wo.work_order_record_number, trim(p_comment),
           CASE WHEN v_rejected_list IS NOT NULL THEN E'\n\nSteps needing correction:\n' || v_rejected_list || E'\n\n' ELSE ' ' END,
           p_wo_id),
    'Open', 'High', v_wo.work_order_owner, v_uid,
    'work_orders', p_wo_id, true, 'work_order_corrections_needed',
    (now() AT TIME ZONE 'America/Chicago')::date
  );

  -- Close the reviewer's own open review task(s).
  UPDATE public.tasks SET status = 'Completed', completed_date = now(), updated_at = now()
  WHERE related_object = 'work_orders' AND related_id = p_wo_id
    AND automation_rule = 'work_order_to_be_verified_review_task'
    AND status <> 'Completed' AND is_deleted IS NOT TRUE;

  RETURN jsonb_build_object('outcome','ok','status','Corrections Needed');
END; $function$;

REVOKE ALL ON FUNCTION public.complete_work_order_review(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_work_order_review(uuid, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Resubmission: Corrections Needed walks the designed lifecycle
--    (→ In Progress → To Be Verified); rejected steps' PC decision resets
--    so they get a fresh review; earlier approvals stand.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_work_order_for_verification(p_wo_id uuid)
 RETURNS TABLE(wo_id uuid, status text, outcome text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_wo            public.work_orders;
  v_cur           text;
  v_to_verify     uuid;
  v_in_progress   uuid;
  v_open_count    integer := 0;
  v_first_gap     text;
  v_res           jsonb;
BEGIN
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_wo_id AND work_order_is_deleted IS NOT TRUE;
  IF v_wo.id IS NULL THEN
    RETURN QUERY SELECT p_wo_id, NULL::text, 'error', 'Work order not found or deleted'; RETURN;
  END IF;

  SELECT picklist_value INTO v_cur FROM public.picklist_values WHERE id = v_wo.work_order_status;
  IF v_cur NOT IN ('In Progress','Corrections Needed') THEN
    RETURN QUERY SELECT p_wo_id, v_cur, 'blocked',
      format('Work order is "%s". Only a work order In Progress or in Corrections Needed can be submitted for verification. Begin work on the work order first.', COALESCE(v_cur,'(no status)'));
    RETURN;
  END IF;

  -- Any step not Completed/Verified/Not Applicable blocks submission.
  SELECT count(*) INTO v_open_count
  FROM public.work_steps ws
  JOIN public.picklist_values pv ON pv.id = ws.work_step_status
  WHERE ws.work_order_id = p_wo_id AND ws.work_step_is_deleted IS NOT TRUE
    AND pv.picklist_value NOT IN ('Completed','Verified','Not Applicable');

  IF v_open_count > 0 THEN
    -- Surface the first concrete evidence gap if one exists; else the count.
    SELECT public._work_step_evidence_gap(ws) INTO v_first_gap
    FROM public.work_steps ws
    JOIN public.picklist_values pv ON pv.id = ws.work_step_status
    WHERE ws.work_order_id = p_wo_id AND ws.work_step_is_deleted IS NOT TRUE
      AND pv.picklist_value NOT IN ('Completed','Verified','Not Applicable')
      AND public._work_step_evidence_gap(ws) IS NOT NULL
    ORDER BY ws.work_step_execution_order LIMIT 1;

    RETURN QUERY SELECT p_wo_id, v_cur, 'blocked',
      COALESCE(v_first_gap,
        format('%s work step(s) are not yet complete. Complete all required steps before submitting for verification.', v_open_count));
    RETURN;
  END IF;

  SELECT id INTO v_to_verify FROM public.picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='work_order_status'
     AND picklist_value='To Be Verified' AND picklist_is_active LIMIT 1;

  IF v_cur = 'Corrections Needed' THEN
    -- Reset the rejected steps' PC decision so the reviewer re-reviews exactly
    -- what was reworked; approvals stand.
    UPDATE public.work_steps ws SET
      work_step_pc_approval_status = NULL,
      work_step_updated_at = now()
    FROM public.picklist_values pcst
    WHERE pcst.id = ws.work_step_pc_approval_status
      AND ws.work_order_id = p_wo_id AND ws.work_step_is_deleted IS NOT TRUE
      AND pcst.picklist_value = 'Rejected';

    -- The lifecycle resubmits through In Progress:
    -- Corrections Needed -> In Progress -> To Be Verified.
    SELECT id INTO v_in_progress FROM public.picklist_values
     WHERE picklist_object='work_orders' AND picklist_field='work_order_status'
       AND picklist_value='In Progress' AND picklist_is_active LIMIT 1;
    v_res := public.change_record_status('work_orders', p_wo_id, 'work_order_status', v_in_progress,
              'Corrections reworked');
  END IF;

  v_res := public.change_record_status('work_orders', p_wo_id, 'work_order_status', v_to_verify,
            CASE WHEN v_cur = 'Corrections Needed' THEN 'Resubmitted for verification after corrections'
                 ELSE 'Submitted for verification' END);

  RETURN QUERY SELECT p_wo_id, 'To Be Verified', 'success',
    format('Work order %s submitted for verification', v_wo.work_order_record_number);
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_work_order_for_verification(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_work_order_for_verification(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Review Page Layouts (Salesforce approval-page-layout parity).
--    page_layout_type='review'; resolution mirrors record pages:
--    record-type-specific layout first, master default fallback.
--    Master seed for work_orders + a slimmer Building Access layout as the
--    first per-record-type example. Fields are data — edit in LEAP Admin
--    (Layouts pane, "Review Page" type).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_admin uuid;
  v_layout uuid;
  v_section uuid;
  v_ba_rt uuid;
BEGIN
  SELECT u.id INTO v_admin
  FROM public.users u JOIN public.roles r ON r.id = u.role_id
  WHERE r.role_name = 'Admin' AND u.user_is_active IS TRUE AND u.user_is_deleted IS NOT TRUE
  ORDER BY u.user_created_at LIMIT 1;

  INSERT INTO public.page_layouts (page_layout_record_number, page_layout_name, page_layout_object,
                                   page_layout_type, page_layout_is_default, record_type_id,
                                   page_layout_description, page_layout_owner, page_layout_created_by)
  VALUES ('', 'Work Order Review Layout — Master', 'work_orders', 'review', true, NULL,
          'Fields shown to the reviewer on the work order review screen when the record type has no review layout of its own.',
          v_admin, v_admin)
  RETURNING id INTO v_layout;

  INSERT INTO public.page_layout_sections (page_layout_id, section_label, section_order, section_columns, section_tab, section_placement)
  VALUES (v_layout, 'Work Order Review Details', 1, 2, 'Details', 'main')
  RETURNING id INTO v_section;

  INSERT INTO public.page_layout_widgets (page_layout_widget_record_number, page_layout_id, section_id,
                                          widget_type, widget_title, widget_column, widget_position, widget_config)
  VALUES ('', v_layout, v_section, 'field_group', 'Work Order Review Details', 1, 1, '{
    "fields": [
      {"name": "work_order_record_number", "type": "text", "label": "Work Order #"},
      {"name": "work_order_status", "type": "picklist", "label": "Status"},
      {"name": "work_type_id", "type": "lookup", "label": "Work Type", "lookup_table": "work_types", "lookup_field": "work_type_name"},
      {"name": "work_order_owner", "type": "lookup", "label": "Technician (Owner)", "lookup_table": "users", "lookup_field": "user_name"},
      {"name": "project_coordinator_id", "type": "lookup", "label": "Project Coordinator", "lookup_table": "users", "lookup_field": "user_name"},
      {"name": "property_id", "type": "lookup", "label": "Property", "lookup_table": "properties", "lookup_field": "property_name"},
      {"name": "building_id", "type": "lookup", "label": "Building", "lookup_table": "buildings", "lookup_field": "building_name"},
      {"name": "unit_id", "type": "lookup", "label": "Unit", "lookup_table": "units", "lookup_field": "unit_name"},
      {"name": "project_id", "type": "lookup", "label": "Project", "lookup_table": "projects", "lookup_field": "project_name"},
      {"name": "work_order_subject", "type": "text", "label": "Subject"},
      {"name": "work_order_scheduled_start_date", "type": "date", "label": "Scheduled Start"},
      {"name": "work_order_description", "type": "textarea", "label": "Description"}
    ]
  }'::jsonb);

  SELECT id INTO v_ba_rt FROM public.picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='record_type' AND picklist_value='building_access';

  IF v_ba_rt IS NOT NULL THEN
    INSERT INTO public.page_layouts (page_layout_record_number, page_layout_name, page_layout_object,
                                     page_layout_type, page_layout_is_default, record_type_id,
                                     page_layout_description, page_layout_owner, page_layout_created_by)
    VALUES ('', 'Building Access Review Layout', 'work_orders', 'review', true, v_ba_rt,
            'Reviewer fields for Building Access chain-of-custody work orders.',
            v_admin, v_admin)
    RETURNING id INTO v_layout;

    INSERT INTO public.page_layout_sections (page_layout_id, section_label, section_order, section_columns, section_tab, section_placement)
    VALUES (v_layout, 'Building Access Review Details', 1, 2, 'Details', 'main')
    RETURNING id INTO v_section;

    INSERT INTO public.page_layout_widgets (page_layout_widget_record_number, page_layout_id, section_id,
                                            widget_type, widget_title, widget_column, widget_position, widget_config)
    VALUES ('', v_layout, v_section, 'field_group', 'Building Access Review Details', 1, 1, '{
      "fields": [
        {"name": "work_order_record_number", "type": "text", "label": "Work Order #"},
        {"name": "work_order_status", "type": "picklist", "label": "Status"},
        {"name": "work_order_owner", "type": "lookup", "label": "Technician (Owner)", "lookup_table": "users", "lookup_field": "user_name"},
        {"name": "property_id", "type": "lookup", "label": "Property", "lookup_table": "properties", "lookup_field": "property_name"},
        {"name": "building_id", "type": "lookup", "label": "Building", "lookup_table": "buildings", "lookup_field": "building_name"},
        {"name": "unit_id", "type": "lookup", "label": "Unit", "lookup_table": "units", "lookup_field": "unit_name"},
        {"name": "work_order_description", "type": "textarea", "label": "Description"}
      ]
    }'::jsonb);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
