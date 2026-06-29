-- =============================================================================
-- Project Portal — data-driven stage bar per record type
--
-- get_portal_project_tracker() now returns, per opportunity, the full ordered
-- opportunity_stage list for that opportunity's record type, sourced from
-- picklist_value_record_type_assignments. Each entry is {label, sort_order}
-- where sort_order is a contiguous 1..N rank (ROW_NUMBER over the assigned
-- stages, ordered by the assignment sort order with a fall-back to the picklist
-- value's own sort order, since some record types leave pvrta_sort_order null).
--
-- The opportunity's stage_order is now the rank of its current stage WITHIN that
-- same ordered list (0 if it has no stage / its stage is not assigned), so the
-- portal's progress fill (stage_order / number-of-stages) always aligns with the
-- dots. Nothing about a fixed "10 phases" remains — add or remove a stage
-- assignment on a record type in Admin and the portal reflects it automatically,
-- per record type.
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
  -- Resolve the calling auth user to a portal_users row.
  SELECT pu.id INTO v_portal_user_id
  FROM portal_users pu
  WHERE pu.auth_user_id = auth.uid()
    AND pu.is_deleted = false
    AND pu.status = 'Active'
  LIMIT 1;

  IF v_portal_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_portal_user', 'properties', '[]'::jsonb);
  END IF;

  -- Granted property + building id sets for this portal user.
  WITH granted_properties AS (
    SELECT DISTINCT pug_property_id AS property_id
    FROM portal_user_property_grants
    WHERE pug_portal_user_id = v_portal_user_id
      AND pug_is_deleted = false
      AND pug_property_id IS NOT NULL
  ),
  granted_buildings AS (
    SELECT DISTINCT pug_building_id AS building_id
    FROM portal_user_property_grants
    WHERE pug_portal_user_id = v_portal_user_id
      AND pug_is_deleted = false
      AND pug_building_id IS NOT NULL
  ),
  -- Per-record-type ordered opportunity_stage list, from the record-type
  -- assignments. Ordering falls back to the picklist value's own sort order when
  -- the assignment leaves pvrta_sort_order null; the emitted sort_order is a
  -- contiguous 1..N rank so the portal can compute fill as rank / count.
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
           jsonb_agg(jsonb_build_object('label', stage_label, 'sort_order', rank)
                     ORDER BY rank) AS stages
    FROM rt_stages
    GROUP BY record_type_id
  ),
  -- Opportunities in scope: under a granted property OR a granted building.
  scoped_opps AS (
    SELECT o.id, o.opportunity_record_number, o.opportunity_name,
           o.property_id, o.building_id,
           o.opportunity_record_type AS record_type_id,
           sv.picklist_label     AS stage_label,
           COALESCE(cur.rank, 0) AS stage_order,
           COALESCE(rsl.stages, '[]'::jsonb) AS stages,
           rt.picklist_label     AS program_label
    FROM opportunities o
    LEFT JOIN picklist_values sv ON o.opportunity_stage = sv.id
    LEFT JOIN picklist_values rt ON o.opportunity_record_type = rt.id
    LEFT JOIN rt_stages cur
      ON cur.record_type_id = o.opportunity_record_type
     AND cur.stage_value_id = o.opportunity_stage
    LEFT JOIN rt_stage_lists rsl
      ON rsl.record_type_id = o.opportunity_record_type
    WHERE o.opportunity_is_deleted = false
      AND (
        o.property_id IN (SELECT property_id FROM granted_properties)
        OR o.building_id IN (SELECT building_id FROM granted_buildings)
      )
  ),
  -- Buildings to display: every granted building, plus every building under a
  -- granted property. (A building grant alone shows only that building.)
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
  -- Properties to display: every granted property, plus the parent property of
  -- any granted building (so a building-only grant still renders its property
  -- header, but only the one granted building beneath it).
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
  -- Assemble opportunities per building.
  opps_by_building AS (
    SELECT so.building_id,
           jsonb_agg(jsonb_build_object(
             'id', so.id,
             'record_number', so.opportunity_record_number,
             'name', so.opportunity_name,
             'program', so.program_label,
             'stage_label', so.stage_label,
             'stage_order', so.stage_order,
             'stages', so.stages
           ) ORDER BY so.opportunity_name) AS opps
    FROM scoped_opps so
    WHERE so.building_id IS NOT NULL
    GROUP BY so.building_id
  ),
  buildings_by_property AS (
    SELECT vb.property_id,
           jsonb_agg(jsonb_build_object(
             'id', vb.id,
             'name', vb.building_name,
             'record_number', vb.building_record_number,
             'address', vb.building_address,
             'total_units', COALESCE(vb.building_total_units, vb.building_number_of_units),
             'opportunities', COALESCE(ob.opps, '[]'::jsonb)
           ) ORDER BY vb.building_name) AS buildings
    FROM visible_buildings vb
    LEFT JOIN opps_by_building ob ON ob.building_id = vb.id
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
