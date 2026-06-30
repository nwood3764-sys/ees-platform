-- =============================================================================
-- Project Portal — calendar: include property + building addresses
--
-- get_portal_calendar() now also returns each visit's property_address
-- (assembled from property_street/city/state/zip) and building_address, so the
-- calendar can show/filter by address (not just name).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_portal_calendar()
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
    RETURN jsonb_build_object('error', 'no_portal_user', 'appointments', '[]'::jsonb);
  END IF;

  WITH granted_properties AS (
    SELECT DISTINCT pug_property_id AS property_id FROM portal_user_property_grants
    WHERE pug_portal_user_id = v_portal_user_id AND pug_is_deleted = false AND pug_property_id IS NOT NULL
  ),
  granted_buildings AS (
    SELECT DISTINCT pug_building_id AS building_id FROM portal_user_property_grants
    WHERE pug_portal_user_id = v_portal_user_id AND pug_is_deleted = false AND pug_building_id IS NOT NULL
  ),
  rows AS (
    SELECT sa.id,
           COALESCE(sa.sa_subject, sa.sa_name) AS subject,
           st.picklist_label AS status,
           sa.sa_scheduled_start_time AS start_ts,
           sa.sa_scheduled_end_time AS end_ts,
           p.id AS property_id, p.property_name,
           NULLIF(trim(BOTH ', ' FROM concat_ws(', ',
             p.property_street,
             p.property_city,
             nullif(concat_ws(' ', p.property_state, p.property_zip), ''))), '') AS property_address,
           b.id AS building_id, b.building_name, b.building_address,
           u.unit_number,
           wrt.picklist_label AS work_order_type
    FROM service_appointments sa
    JOIN work_orders wo ON sa.work_order_id = wo.id AND wo.work_order_is_deleted IS NOT TRUE
    LEFT JOIN properties p ON wo.property_id = p.id
    LEFT JOIN buildings b ON wo.building_id = b.id
    LEFT JOIN units u ON wo.unit_id = u.id
    LEFT JOIN picklist_values st ON sa.sa_status = st.id
    LEFT JOIN picklist_values wrt ON wo.work_order_record_type = wrt.id
    WHERE sa.sa_is_deleted IS NOT TRUE
      AND sa.sa_scheduled_start_time IS NOT NULL
      AND (wo.property_id IN (SELECT property_id FROM granted_properties)
           OR wo.building_id IN (SELECT building_id FROM granted_buildings))
  )
  SELECT jsonb_build_object('appointments', COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'subject', subject, 'status', status,
    'start', start_ts, 'end', end_ts,
    'property_id', property_id, 'property_name', property_name, 'property_address', property_address,
    'building_id', building_id, 'building_name', building_name, 'building_address', building_address,
    'unit_number', unit_number, 'work_order_type', work_order_type
  ) ORDER BY start_ts), '[]'::jsonb)) INTO v_result
  FROM rows;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_portal_calendar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_portal_calendar() TO anon;
GRANT EXECUTE ON FUNCTION public.get_portal_calendar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_portal_calendar() TO postgres;
GRANT EXECUTE ON FUNCTION public.get_portal_calendar() TO service_role;

NOTIFY pgrst, 'reload schema';
