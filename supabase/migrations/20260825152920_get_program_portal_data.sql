-- =============================================================================
-- The Program Manager Portal's single read.
--
-- Scope is ONLY what portal_record_grants names — there is no implicit access
-- and no way to widen it from the client. From a granted assessment (or a
-- granted project, which shares the assessments recorded against it) it
-- resolves downward to the ASSESSMENT work orders, their work steps, the photos
-- on those steps, and any generated Energy Assessment Report.
--
-- Work orders are filtered to the assessment record types on purpose. An
-- assessment's project can also carry install work orders (insulation removal
-- and the like); those are not what was shared and must not appear merely
-- because they hang off the same project. Today every assessment project
-- carries only its assessment work order — the filter is there so that stays
-- true when it stops being true of the data.
--
-- The assessment header is an explicit field WHITELIST, not "the record minus
-- financials": field-level tiers are unbuilt platform-wide, so nothing is
-- exposed that was not deliberately listed.
--
-- Downloading needs BOTH the organisation (accounts.account_allow_portal_download)
-- and the individual (portal_users.portal_user_allow_download) to be permitted;
-- the flag is returned here so the UI can hide what it must not offer, and is
-- re-checked server-side by the file route before any URL is signed.
--
-- Photos and reports are returned as IDs only. Nothing in this payload is a
-- usable file URL — those are minted, permission-checked and logged separately.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_program_portal_data(
  p_view_as_portal_user_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_portal_user_id uuid;
  v_account_id     uuid;
  v_can_download   boolean := false;
  v_org            text;
  v_result jsonb;
BEGIN
  IF p_view_as_portal_user_id IS NOT NULL THEN
    IF NOT public.app_is_admin() THEN
      RETURN jsonb_build_object('error', 'not_authorized', 'properties', '[]'::jsonb);
    END IF;
    SELECT pu.id, pu.portal_user_account_id INTO v_portal_user_id, v_account_id
    FROM portal_users pu
    WHERE pu.id = p_view_as_portal_user_id AND pu.is_deleted = false
      AND pu.record_type = 'Program Manager User';
  ELSE
    SELECT pu.id, pu.portal_user_account_id INTO v_portal_user_id, v_account_id
    FROM portal_users pu
    WHERE pu.auth_user_id = auth.uid()
      AND pu.is_deleted = false
      AND pu.record_type = 'Program Manager User'
      AND pu.status NOT IN ('Portal User Suspended', 'Portal User Deactivated')
    LIMIT 1;
  END IF;

  IF v_portal_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_portal_user', 'properties', '[]'::jsonb);
  END IF;

  SELECT COALESCE(a.account_allow_portal_download, false) AND COALESCE(pu.portal_user_allow_download, false),
         a.account_name
    INTO v_can_download, v_org
  FROM portal_users pu
  LEFT JOIN accounts a ON a.id = pu.portal_user_account_id
  WHERE pu.id = v_portal_user_id;

  WITH granted_assessments AS (
    SELECT a.*
    FROM portal_record_grants g
    JOIN assessments a ON a.id = g.prg_record_id AND a.assessment_is_deleted IS NOT TRUE
    WHERE g.prg_portal_user_id = v_portal_user_id
      AND g.prg_is_deleted = false
      AND g.prg_object = 'assessments'
    UNION
    SELECT a.*
    FROM portal_record_grants g
    JOIN assessments a ON a.project_id = g.prg_record_id AND a.assessment_is_deleted IS NOT TRUE
    WHERE g.prg_portal_user_id = v_portal_user_id
      AND g.prg_is_deleted = false
      AND g.prg_object = 'projects'
  ),
  assessment_wo AS (
    SELECT ga.id AS assessment_id, wo.id AS work_order_id, wo.work_order_name,
           wrt.picklist_label AS work_order_record_type,
           ws2.picklist_label AS work_order_status
    FROM granted_assessments ga
    JOIN work_orders wo ON wo.project_id = ga.project_id AND wo.work_order_is_deleted IS NOT TRUE
    JOIN picklist_values wrt ON wrt.id = wo.work_order_record_type
      AND wrt.picklist_value IN ('MULTIFAMILY-ENERGY-ASSESSMENT','SINGLE-FAMILY-ENERGY-ASSESSMENT','HES-ASSESSMENT')
    LEFT JOIN picklist_values ws2 ON ws2.id = wo.work_order_status
  ),
  steps AS (
    SELECT awo.work_order_id, wst.id, wst.work_step_name, wst.work_step_execution_order AS ord,
           sv.picklist_label AS status_label,
           wst.work_step_not_applicable_reason AS na_reason
    FROM assessment_wo awo
    JOIN work_steps wst ON wst.work_order_id = awo.work_order_id AND wst.work_step_is_deleted IS NOT TRUE
    LEFT JOIN picklist_values sv ON sv.id = wst.work_step_status
  ),
  step_photos AS (
    SELECT p.work_step_id,
           jsonb_agg(jsonb_build_object(
             'id', p.id, 'caption', p.caption, 'type', p.photo_type,
             'taken_at', p.taken_at
           ) ORDER BY p.photo_type, p.created_at) AS photos
    FROM photos p
    WHERE p.is_deleted IS NOT TRUE
      AND p.work_step_id IN (SELECT id FROM steps)
    GROUP BY p.work_step_id
  ),
  steps_by_wo AS (
    SELECT s.work_order_id,
           jsonb_agg(jsonb_build_object(
             'id', s.id, 'name', s.work_step_name, 'order', s.ord,
             'status', s.status_label, 'not_applicable_reason', s.na_reason,
             'photos', COALESCE(sp.photos, '[]'::jsonb)
           ) ORDER BY s.ord) AS work_steps
    FROM steps s
    LEFT JOIN step_photos sp ON sp.work_step_id = s.id
    GROUP BY s.work_order_id
  ),
  reports_by_wo AS (
    SELECT d.related_id AS work_order_id,
           jsonb_agg(jsonb_build_object(
             'id', d.id, 'name', COALESCE(d.name, 'Energy Assessment Report'),
             'created_at', d.created_at
           ) ORDER BY d.created_at DESC) AS reports
    FROM documents d
    WHERE d.is_deleted IS NOT TRUE
      AND d.related_object = 'work_orders'
      AND d.document_type = 'energy_assessment_report'
      AND d.related_id IN (SELECT work_order_id FROM assessment_wo)
    GROUP BY d.related_id
  ),
  wo_by_assessment AS (
    SELECT awo.assessment_id,
           jsonb_agg(jsonb_build_object(
             'id', awo.work_order_id, 'name', awo.work_order_name,
             'record_type', awo.work_order_record_type, 'status', awo.work_order_status,
             'work_steps', COALESCE(sbw.work_steps, '[]'::jsonb),
             'reports', COALESCE(rbw.reports, '[]'::jsonb)
           ) ORDER BY awo.work_order_name) AS work_orders
    FROM assessment_wo awo
    LEFT JOIN steps_by_wo sbw ON sbw.work_order_id = awo.work_order_id
    LEFT JOIN reports_by_wo rbw ON rbw.work_order_id = awo.work_order_id
    GROUP BY awo.assessment_id
  ),
  assessments_by_building AS (
    SELECT ga.building_id, ga.property_id,
           jsonb_agg(jsonb_build_object(
             'id', ga.id,
             'record_number', ga.assessment_record_number,
             'name', ga.assessment_name,
             'record_type', art.picklist_label,
             'status', ast.picklist_label,
             'assessment_date', ga.assessment_date,
             'work_orders', COALESCE(wba.work_orders, '[]'::jsonb)
           ) ORDER BY ga.assessment_record_number) AS assessments
    FROM granted_assessments ga
    LEFT JOIN picklist_values art ON art.id = ga.assessment_record_type
    LEFT JOIN picklist_values ast ON ast.id = ga.assessment_status
    LEFT JOIN wo_by_assessment wba ON wba.assessment_id = ga.id
    GROUP BY ga.building_id, ga.property_id
  ),
  buildings_by_property AS (
    SELECT ab.property_id,
           jsonb_agg(jsonb_build_object(
             'id', b.id, 'name', b.building_name,
             'record_number', b.building_record_number,
             'address', b.building_address,
             'assessments', ab.assessments
           ) ORDER BY b.building_name) AS buildings
    FROM assessments_by_building ab
    LEFT JOIN buildings b ON b.id = ab.building_id
    GROUP BY ab.property_id
  )
  SELECT jsonb_build_object(
    'portal_user_id', v_portal_user_id,
    'organization', v_org,
    'can_download', v_can_download,
    'properties', COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.property_name,
      'record_number', p.property_record_number,
      'city', p.property_city, 'state', p.property_state,
      'buildings', COALESCE(bp.buildings, '[]'::jsonb)
    ) ORDER BY p.property_name), '[]'::jsonb)
  ) INTO v_result
  FROM buildings_by_property bp
  JOIN properties p ON p.id = bp.property_id AND p.property_is_deleted = false;

  RETURN COALESCE(v_result, jsonb_build_object(
    'portal_user_id', v_portal_user_id, 'organization', v_org,
    'can_download', v_can_download, 'properties', '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_program_portal_data(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_program_portal_data(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_program_portal_data(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_program_portal_data(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
