-- =============================================================================
-- Project Portal — unit tier + per-program tracks
--
-- get_portal_project_tracker() now returns a Property → Building → Unit →
-- Opportunity tree. Each unit carries its opportunities (typically one HOMES
-- and one HEAR), each still with its record type's data-driven stage list
-- ([{label, sort_order}]) and stage_order (rank of the current stage). Building
-- rows also keep a building-level `opportunities` array for any opportunity not
-- pinned to a unit (unit_id IS NULL), so single-family / building-level records
-- still render. Stage logic is unchanged from the data-driven version.
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
  WHERE pu.auth_user_id = auth.uid()
    AND pu.is_deleted = false
    AND pu.status = 'Active'
  LIMIT 1;

  IF v_portal_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_portal_user', 'properties', '[]'::jsonb);
  END IF;

  WITH granted_properties AS (
    SELECT DISTINCT pug_property_id AS property_id
    FROM portal_user_property_grants
    WHERE pug_portal_user_id = v_portal_user_id
      AND pug_is_deleted = false AND pug_property_id IS NOT NULL
  ),
  granted_buildings AS (
    SELECT DISTINCT pug_building_id AS building_id
    FROM portal_user_property_grants
    WHERE pug_portal_user_id = v_portal_user_id
      AND pug_is_deleted = false AND pug_building_id IS NOT NULL
  ),
  rt_stages AS (
    SELECT a.pvrta_record_type_id AS record_type_id,
           sv.id AS stage_value_id,
           sv.picklist_label AS stage_label,
           (ROW_NUMBER() OVER (
             PARTITION BY a.pvrta_record_type_id
             ORDER BY COALESCE(a.pvrta_sort_order, sv.picklist_sort_order), sv.picklist_label
           ))::int AS rank
    FROM picklist_value_record_type_assignments a
    JOIN picklist_values sv ON a.pvrta_picklist_value_id = sv.id
    WHERE a.pvrta_is_deleted = false
      AND sv.picklist_object = 'opportunities'
      AND sv.picklist_field = 'opportunity_stage'
  ),
  rt_stage_lists AS (
    SELECT record_type_id,
           jsonb_agg(jsonb_build_object('label', stage_label, 'sort_order', rank) ORDER BY rank) AS stages
    FROM rt_stages GROUP BY record_type_id
  ),
  scoped_opps AS (
    SELECT o.id, o.opportunity_record_number, o.opportunity_name,
           o.property_id, o.building_id, o.unit_id,
           sv.picklist_label     AS stage_label,
           COALESCE(cur.rank, 0) AS stage_order,
           COALESCE(rsl.stages, '[]'::jsonb) AS stages,
           rt.picklist_label     AS program_label
    FROM opportunities o
    LEFT JOIN picklist_values sv ON o.opportunity_stage = sv.id
    LEFT JOIN picklist_values rt ON o.opportunity_record_type = rt.id
    LEFT JOIN rt_stages cur
      ON cur.record_type_id = o.opportunity_record_type AND cur.stage_value_id = o.opportunity_stage
    LEFT JOIN rt_stage_lists rsl ON rsl.record_type_id = o.opportunity_record_type
    WHERE o.opportunity_is_deleted = false
      AND (
        o.property_id IN (SELECT property_id FROM granted_properties)
        OR o.building_id IN (SELECT building_id FROM granted_buildings)
      )
  ),
  visible_buildings AS (
    SELECT b.id, b.building_name, b.building_record_number, b.building_address,
           b.building_total_units, b.building_number_of_units, b.property_id
    FROM buildings b
    WHERE b.building_is_deleted = false
      AND (
        b.property_id IN (SELECT property_id FROM granted_properties)
        OR b.id IN (SELECT building_id FROM granted_buildings)
      )
  ),
  visible_units AS (
    SELECT u.id, u.unit_name, u.unit_number, u.unit_record_number, u.building_id
    FROM units u
    WHERE u.unit_is_deleted IS NOT TRUE
      AND u.building_id IN (SELECT id FROM visible_buildings)
  ),
  visible_properties AS (
    SELECT DISTINCT p.id, p.property_name, p.property_record_number,
           p.property_city, p.property_state,
           p.property_total_units, p.property_total_buildings
    FROM properties p
    WHERE p.property_is_deleted = false
      AND (
        p.id IN (SELECT property_id FROM granted_properties)
        OR p.id IN (SELECT property_id FROM visible_buildings)
      )
  ),
  opp_json AS (
    SELECT so.*, jsonb_build_object(
      'id', so.id,
      'record_number', so.opportunity_record_number,
      'name', so.opportunity_name,
      'program', so.program_label,
      'stage_label', so.stage_label,
      'stage_order', so.stage_order,
      'stages', so.stages
    ) AS obj
    FROM scoped_opps so
  ),
  opps_by_unit AS (
    SELECT unit_id,
           jsonb_agg(obj ORDER BY program_label, opportunity_name) AS opps
    FROM opp_json WHERE unit_id IS NOT NULL GROUP BY unit_id
  ),
  opps_by_building_nounit AS (
    SELECT building_id,
           jsonb_agg(obj ORDER BY program_label, opportunity_name) AS opps
    FROM opp_json WHERE unit_id IS NULL AND building_id IS NOT NULL GROUP BY building_id
  ),
  units_by_building AS (
    SELECT vu.building_id,
           jsonb_agg(jsonb_build_object(
             'id', vu.id,
             'name', vu.unit_name,
             'unit_number', vu.unit_number,
             'record_number', vu.unit_record_number,
             'opportunities', COALESCE(ou.opps, '[]'::jsonb)
           ) ORDER BY vu.unit_number) AS units
    FROM visible_units vu
    LEFT JOIN opps_by_unit ou ON ou.unit_id = vu.id
    GROUP BY vu.building_id
  ),
  buildings_by_property AS (
    SELECT vb.property_id,
           jsonb_agg(jsonb_build_object(
             'id', vb.id,
             'name', vb.building_name,
             'record_number', vb.building_record_number,
             'address', vb.building_address,
             'total_units', COALESCE(vb.building_total_units, vb.building_number_of_units),
             'units', COALESCE(ub.units, '[]'::jsonb),
             'opportunities', COALESCE(obn.opps, '[]'::jsonb)
           ) ORDER BY vb.building_name) AS buildings
    FROM visible_buildings vb
    LEFT JOIN units_by_building ub ON ub.building_id = vb.id
    LEFT JOIN opps_by_building_nounit obn ON obn.building_id = vb.id
    GROUP BY vb.property_id
  )
  SELECT jsonb_build_object(
    'portal_user_id', v_portal_user_id,
    'properties', COALESCE(jsonb_agg(jsonb_build_object(
      'id', vp.id,
      'name', vp.property_name,
      'record_number', vp.property_record_number,
      'city', vp.property_city,
      'state', vp.property_state,
      'total_units', vp.property_total_units,
      'total_buildings', vp.property_total_buildings,
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
