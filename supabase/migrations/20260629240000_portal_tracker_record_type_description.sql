-- =============================================================================
-- Project Portal — expose opportunity record-type description
--
-- Each opportunity now also returns its record type's picklist_description
-- (record_type_description), so the Property Dashboard's Opportunities list can
-- show a one-line explanation of the program track beneath the concatenated
-- opportunity name. Everything else unchanged from
-- 20260629200000_portal_tracker_work_step_photos.sql.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_portal_project_tracker()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_portal_user_id uuid;
  v_result jsonb;
BEGIN
  SELECT pu.id INTO v_portal_user_id
  FROM portal_users pu
  WHERE pu.auth_user_id = auth.uid() AND pu.is_deleted = false AND pu.status = 'Active'
  LIMIT 1;

  IF v_portal_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_portal_user', 'properties', '[]'::jsonb);
  END IF;

  WITH granted_properties AS (
    SELECT DISTINCT pug_property_id AS property_id FROM portal_user_property_grants
    WHERE pug_portal_user_id = v_portal_user_id AND pug_is_deleted = false AND pug_property_id IS NOT NULL
  ),
  granted_buildings AS (
    SELECT DISTINCT pug_building_id AS building_id FROM portal_user_property_grants
    WHERE pug_portal_user_id = v_portal_user_id AND pug_is_deleted = false AND pug_building_id IS NOT NULL
  ),
  rt_stages AS (
    SELECT a.pvrta_record_type_id AS record_type_id, sv.id AS stage_value_id, sv.picklist_label AS stage_label,
           (ROW_NUMBER() OVER (PARTITION BY a.pvrta_record_type_id
             ORDER BY COALESCE(a.pvrta_sort_order, sv.picklist_sort_order), sv.picklist_label))::int AS rank
    FROM picklist_value_record_type_assignments a
    JOIN picklist_values sv ON a.pvrta_picklist_value_id = sv.id
    WHERE a.pvrta_is_deleted = false AND sv.picklist_object = 'opportunities' AND sv.picklist_field = 'opportunity_stage'
  ),
  rt_stage_lists AS (
    SELECT record_type_id, jsonb_agg(jsonb_build_object('label', stage_label, 'sort_order', rank) ORDER BY rank) AS stages
    FROM rt_stages GROUP BY record_type_id
  ),
  scoped_opps AS (
    SELECT o.id, o.opportunity_record_number, o.opportunity_name, o.property_id, o.building_id,
           sv.picklist_label AS stage_label, COALESCE(cur.rank, 0) AS stage_order,
           COALESCE(rsl.stages, '[]'::jsonb) AS stages, rt.picklist_label AS program_label,
           rt.picklist_description AS record_type_description
    FROM opportunities o
    LEFT JOIN picklist_values sv ON o.opportunity_stage = sv.id
    LEFT JOIN picklist_values rt ON o.opportunity_record_type = rt.id
    LEFT JOIN rt_stages cur ON cur.record_type_id = o.opportunity_record_type AND cur.stage_value_id = o.opportunity_stage
    LEFT JOIN rt_stage_lists rsl ON rsl.record_type_id = o.opportunity_record_type
    WHERE o.opportunity_is_deleted = false AND o.building_id IS NOT NULL
      AND (o.property_id IN (SELECT property_id FROM granted_properties)
           OR o.building_id IN (SELECT building_id FROM granted_buildings))
  ),
  visible_buildings AS (
    SELECT b.id, b.building_name, b.building_record_number, b.building_address,
           b.building_total_units, b.building_number_of_units, b.property_id
    FROM buildings b
    WHERE b.building_is_deleted = false
      AND (b.property_id IN (SELECT property_id FROM granted_properties)
           OR b.id IN (SELECT building_id FROM granted_buildings))
  ),
  visible_properties AS (
    SELECT DISTINCT p.id, p.property_name, p.property_record_number, p.property_city, p.property_state,
           p.property_total_units, p.property_total_buildings
    FROM properties p
    WHERE p.property_is_deleted = false
      AND (p.id IN (SELECT property_id FROM granted_properties)
           OR p.id IN (SELECT property_id FROM visible_buildings))
  ),
  scoped_projects AS (
    SELECT pr.id, pr.opportunity_id, pr.building_id, pr.project_name,
           prt.picklist_label AS record_type, ps.picklist_label AS status_label
    FROM projects pr
    LEFT JOIN picklist_values prt ON pr.project_record_type = prt.id
    LEFT JOIN picklist_values ps ON pr.project_status = ps.id
    WHERE pr.project_is_deleted IS NOT TRUE
      AND pr.building_id IN (SELECT id FROM visible_buildings)
  ),
  scoped_work_orders AS (
    SELECT wo.id, wo.project_id, wo.unit_id, wo.work_order_name,
           wrt.picklist_label AS record_type, ws.picklist_label AS status_label, u.unit_number
    FROM work_orders wo
    LEFT JOIN picklist_values wrt ON wo.work_order_record_type = wrt.id
    LEFT JOIN picklist_values ws ON wo.work_order_status = ws.id
    LEFT JOIN units u ON wo.unit_id = u.id
    WHERE wo.work_order_is_deleted IS NOT TRUE
      AND wo.project_id IN (SELECT id FROM scoped_projects)
  ),
  scoped_work_steps AS (
    SELECT wst.id, wst.work_order_id, wst.work_step_name, wst.work_step_execution_order AS ord,
           wsv.picklist_label AS status_label, wst.work_step_reference_photo_url AS photo_url
    FROM work_steps wst
    LEFT JOIN picklist_values wsv ON wst.work_step_status = wsv.id
    WHERE wst.work_step_is_deleted IS NOT TRUE
      AND wst.work_order_id IN (SELECT id FROM scoped_work_orders)
  ),
  scoped_photos AS (
    SELECT p.work_step_id,
      jsonb_agg(jsonb_build_object(
        'id', p.id, 'url', p.file_url, 'thumb', p.thumbnail_url,
        'caption', p.caption, 'type', p.photo_type
      ) ORDER BY p.photo_type, p.created_at) AS photos
    FROM photos p
    WHERE p.is_deleted IS NOT TRUE
      AND p.work_step_id IN (SELECT id FROM scoped_work_steps)
    GROUP BY p.work_step_id
  ),
  step_json AS (
    SELECT sws.work_order_id, sws.ord,
      jsonb_build_object(
        'id', sws.id, 'name', sws.work_step_name, 'status', sws.status_label, 'order', sws.ord,
        'photo_url', sws.photo_url, 'photos', COALESCE(sp.photos, '[]'::jsonb)
      ) AS obj
    FROM scoped_work_steps sws
    LEFT JOIN scoped_photos sp ON sp.work_step_id = sws.id
  ),
  ws_by_wo AS (
    SELECT work_order_id, jsonb_agg(obj ORDER BY ord) AS steps
    FROM step_json GROUP BY work_order_id
  ),
  wo_by_project AS (
    SELECT swo.project_id,
      jsonb_agg(jsonb_build_object(
        'id', swo.id, 'name', swo.work_order_name, 'record_type', swo.record_type,
        'status', swo.status_label, 'unit_id', swo.unit_id, 'unit_number', swo.unit_number,
        'work_steps', COALESCE(wsb.steps, '[]'::jsonb)
      ) ORDER BY swo.unit_number, swo.record_type) AS wos
    FROM scoped_work_orders swo
    LEFT JOIN ws_by_wo wsb ON wsb.work_order_id = swo.id
    GROUP BY swo.project_id
  ),
  projects_by_opp AS (
    SELECT sp.opportunity_id,
      jsonb_agg(jsonb_build_object(
        'id', sp.id, 'name', sp.project_name, 'record_type', sp.record_type,
        'status', sp.status_label, 'work_orders', COALESCE(wp.wos, '[]'::jsonb)
      ) ORDER BY sp.record_type, sp.project_name) AS projects
    FROM scoped_projects sp
    LEFT JOIN wo_by_project wp ON wp.project_id = sp.id
    GROUP BY sp.opportunity_id
  ),
  opps_by_building AS (
    SELECT so.building_id,
      jsonb_agg(jsonb_build_object(
        'id', so.id, 'record_number', so.opportunity_record_number, 'name', so.opportunity_name,
        'program', so.program_label, 'record_type_description', so.record_type_description,
        'stage_label', so.stage_label, 'stage_order', so.stage_order,
        'stages', so.stages, 'projects', COALESCE(pbo.projects, '[]'::jsonb)
      ) ORDER BY so.program_label, so.opportunity_name) AS opps
    FROM scoped_opps so
    LEFT JOIN projects_by_opp pbo ON pbo.opportunity_id = so.id
    GROUP BY so.building_id
  ),
  buildings_by_property AS (
    SELECT vb.property_id,
      jsonb_agg(jsonb_build_object(
        'id', vb.id, 'name', vb.building_name, 'record_number', vb.building_record_number,
        'address', vb.building_address,
        'total_units', COALESCE(vb.building_total_units, vb.building_number_of_units),
        'unit_count', (SELECT count(*) FROM units u WHERE u.building_id = vb.id AND u.unit_is_deleted IS NOT TRUE),
        'opportunities', COALESCE(ob.opps, '[]'::jsonb)
      ) ORDER BY vb.building_name) AS buildings
    FROM visible_buildings vb
    LEFT JOIN opps_by_building ob ON ob.building_id = vb.id
    GROUP BY vb.property_id
  )
  SELECT jsonb_build_object(
    'portal_user_id', v_portal_user_id,
    'properties', COALESCE(jsonb_agg(jsonb_build_object(
      'id', vp.id, 'name', vp.property_name, 'record_number', vp.property_record_number,
      'city', vp.property_city, 'state', vp.property_state,
      'total_units', vp.property_total_units, 'total_buildings', vp.property_total_buildings,
      'buildings', COALESCE(bp.buildings, '[]'::jsonb)
    ) ORDER BY vp.property_name), '[]'::jsonb)
  ) INTO v_result
  FROM visible_properties vp
  LEFT JOIN buildings_by_property bp ON bp.property_id = vp.id;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_portal_project_tracker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_portal_project_tracker() TO anon;
GRANT EXECUTE ON FUNCTION public.get_portal_project_tracker() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_portal_project_tracker() TO postgres;
GRANT EXECUTE ON FUNCTION public.get_portal_project_tracker() TO service_role;

NOTIFY pgrst, 'reload schema';
