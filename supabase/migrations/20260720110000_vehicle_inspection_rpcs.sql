-- =============================================================================
-- Daily Vehicle Inspection RPCs (fleet workstream, phase 1 continued).
--
--   create_vehicle_daily_inspection(p_vehicle_id)
--       Start (or resume) today's inspection for a vehicle. One inspection
--       per vehicle per day: if an open Daily Inspection exists for the
--       vehicle today it is returned instead of creating a duplicate.
--       Instantiates the checklist from vehicle_inspection_item_templates,
--       honoring per-vehicle-type scoping (box trucks: 6 tire items).
--
--   vehicle_inspection_detail(p_activity_id)
--       Everything LEAP Pad needs to render the inspection: activity fields,
--       items in order with photo counts + storage paths.
--
--   record_vehicle_inspection_leg(p_activity_id, p_leg, p_odometer, p_gas_level)
--       Saves the start or return odometer + gas level. The return leg also
--       rolls the vehicle's current odometer forward.
--
--   save_vehicle_inspection_item(p_item_id, p_condition, p_comment)
--       Saves an item's OK / Needs Repair result + comment. A Needs Repair
--       result requires a comment.
--
--   complete_vehicle_inspection(p_activity_id, p_notes)
--       Validates every item (photos present, conditions answered, both legs
--       recorded), stamps the driver's attestation, marks the activity
--       complete, and routes ONE task to the Shop Steward listing every
--       Needs Repair item. Returns {ok:false, missing:[...]} instead of
--       raising when the inspection isn't finished, so the Pad can show
--       exactly what's left.
--
-- All SECURITY DEFINER (standard technician-RPC shape), acting user resolved
-- via current_app_user_id().
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_vehicle_daily_inspection(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_me       uuid := public.current_app_user_id();
  v_vehicle  public.vehicles%ROWTYPE;
  v_rt       uuid;
  v_at       uuid;
  v_today    date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_existing public.vehicle_activities%ROWTYPE;
  v_act_id   uuid;
  v_rn       text;
  v_items    integer;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not signed in as a LEAP user'; END IF;

  SELECT * INTO v_vehicle FROM public.vehicles
  WHERE id = p_vehicle_id AND vehicle_is_deleted IS NOT TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found'; END IF;

  SELECT id INTO v_rt FROM public.picklist_values
  WHERE picklist_object='vehicle_activities' AND picklist_field='record_type' AND picklist_value='daily_inspection';
  SELECT id INTO v_at FROM public.picklist_values
  WHERE picklist_object='vehicle_activities' AND picklist_field='va_activity_type' AND picklist_value='Daily Inspection';

  -- One inspection per vehicle per day: resume the open one if it exists.
  SELECT * INTO v_existing FROM public.vehicle_activities
  WHERE vehicle_id = p_vehicle_id
    AND va_record_type = v_rt
    AND va_activity_date = v_today
    AND va_is_deleted IS NOT TRUE
  ORDER BY va_created_at
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('activity_id', v_existing.id, 'record_number', v_existing.va_record_number, 'resumed', true);
  END IF;

  INSERT INTO public.vehicle_activities (
    va_record_number, va_name, va_record_type, va_activity_type,
    vehicle_id, performed_by_id, va_driver,
    va_activity_date, va_vehicle_activity_status,
    va_owner, va_created_by
  ) VALUES (
    '', 'Daily Inspection - ' || v_vehicle.vehicle_name || ' - ' || to_char(v_today, 'YYYY-MM-DD'),
    v_rt, v_at,
    p_vehicle_id, v_me, v_me,
    v_today, 'Vehicle Activity In Progress',
    v_me, v_me
  )
  RETURNING id, va_record_number INTO v_act_id, v_rn;

  -- Instantiate the checklist for this vehicle's type.
  INSERT INTO public.vehicle_activity_items (
    vai_record_number, vai_name, vehicle_activity_id, inspection_item_template_id,
    vai_leg, vai_sort_order, vai_photos_required, vai_requires_condition, vai_created_by
  )
  SELECT '', t.viit_name, v_act_id, t.id,
         t.viit_leg, t.viit_sort_order, t.viit_photos_required, t.viit_requires_condition, v_me
  FROM public.vehicle_inspection_item_templates t
  WHERE t.viit_is_deleted IS NOT TRUE
    AND t.viit_is_active IS TRUE
    AND (t.viit_vehicle_type_ids IS NULL OR v_vehicle.vehicle_type = ANY(t.viit_vehicle_type_ids));
  GET DIAGNOSTICS v_items = ROW_COUNT;

  RETURN jsonb_build_object('activity_id', v_act_id, 'record_number', v_rn, 'resumed', false, 'items', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.vehicle_inspection_detail(p_activity_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT jsonb_build_object(
    'activity_id', va.id,
    'record_number', va.va_record_number,
    'name', va.va_name,
    'status', va.va_vehicle_activity_status,
    'activity_date', va.va_activity_date,
    'vehicle_id', v.id,
    'vehicle_name', v.vehicle_name,
    'vehicle_record_number', v.vehicle_record_number,
    'vehicle_type', tp.picklist_label,
    'license_plate', v.vehicle_license_plate,
    'odometer_start', va.va_odometer_reading,
    'odometer_return', va.va_odometer_return,
    'gas_level_start', gs.picklist_value,
    'gas_level_return', gr.picklist_value,
    'notes', va.va_notes,
    'attested_at', va.va_attested_at,
    'driver', u.user_name,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'item_id', i.id,
        'record_number', i.vai_record_number,
        'name', i.vai_name,
        'description', t.viit_description,
        'leg', i.vai_leg,
        'sort_order', i.vai_sort_order,
        'photos_required', i.vai_photos_required,
        'requires_condition', i.vai_requires_condition,
        'condition', i.vai_condition,
        'comment', i.vai_comment,
        'completed_at', i.vai_completed_at,
        'photo_count', (SELECT count(*) FROM public.photos ph
                        WHERE ph.related_object = 'vehicle_activity_items'
                          AND ph.related_id = i.id AND ph.is_deleted IS NOT TRUE),
        'photos', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'photo_id', ph.id, 'storage_bucket', ph.storage_bucket,
            'storage_path', COALESCE(NULLIF(ph.storage_path_watermarked,''), ph.storage_path_original))
            ORDER BY ph.created_at)
          FROM public.photos ph
          WHERE ph.related_object = 'vehicle_activity_items'
            AND ph.related_id = i.id AND ph.is_deleted IS NOT TRUE), '[]'::jsonb)
      ) ORDER BY i.vai_sort_order)
      FROM public.vehicle_activity_items i
      LEFT JOIN public.vehicle_inspection_item_templates t ON t.id = i.inspection_item_template_id
      WHERE i.vehicle_activity_id = va.id AND i.vai_is_deleted IS NOT TRUE
    ), '[]'::jsonb)
  )
  FROM public.vehicle_activities va
  JOIN public.vehicles v ON v.id = va.vehicle_id
  LEFT JOIN public.picklist_values tp ON tp.id = v.vehicle_type
  LEFT JOIN public.picklist_values gs ON gs.id = va.va_gas_level_start
  LEFT JOIN public.picklist_values gr ON gr.id = va.va_gas_level_return
  LEFT JOIN public.users u ON u.id = va.va_driver
  WHERE va.id = p_activity_id AND va.va_is_deleted IS NOT TRUE;
$$;

CREATE OR REPLACE FUNCTION public.record_vehicle_inspection_leg(
  p_activity_id uuid, p_leg text, p_odometer numeric, p_gas_level text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_me  uuid := public.current_app_user_id();
  v_act public.vehicle_activities%ROWTYPE;
  v_gas uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not signed in as a LEAP user'; END IF;
  IF p_leg NOT IN ('pre_trip','return') THEN RAISE EXCEPTION 'p_leg must be pre_trip or return'; END IF;
  IF p_odometer IS NULL OR p_odometer < 0 THEN RAISE EXCEPTION 'A valid odometer reading is required'; END IF;

  SELECT * INTO v_act FROM public.vehicle_activities
  WHERE id = p_activity_id AND va_is_deleted IS NOT TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inspection not found'; END IF;
  IF v_act.va_vehicle_activity_status = 'Vehicle Activity Complete' THEN
    RAISE EXCEPTION 'This inspection is already complete';
  END IF;

  SELECT id INTO v_gas FROM public.picklist_values
  WHERE picklist_object='vehicle_activities' AND picklist_field='gas_level' AND picklist_value = p_gas_level;
  IF p_gas_level IS NOT NULL AND v_gas IS NULL THEN
    RAISE EXCEPTION 'Gas level must be one of E, 1/4, 1/2, 3/4, F';
  END IF;

  IF p_leg = 'pre_trip' THEN
    UPDATE public.vehicle_activities
    SET va_odometer_reading = p_odometer, va_gas_level_start = v_gas,
        va_time_of_check_out = COALESCE(va_time_of_check_out, now()),
        va_updated_by = v_me, va_updated_at = now()
    WHERE id = p_activity_id;
  ELSE
    UPDATE public.vehicle_activities
    SET va_odometer_return = p_odometer, va_gas_level_return = v_gas,
        va_time_of_check_in = COALESCE(va_time_of_check_in, now()),
        va_updated_by = v_me, va_updated_at = now()
    WHERE id = p_activity_id;
    UPDATE public.vehicles
    SET vehicle_current_odometer = p_odometer, vehicle_odometer_updated_at = now(),
        vehicle_updated_by = v_me, vehicle_updated_at = now()
    WHERE id = v_act.vehicle_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.save_vehicle_inspection_item(
  p_item_id uuid, p_condition text, p_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_me   uuid := public.current_app_user_id();
  v_item public.vehicle_activity_items%ROWTYPE;
  v_status text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not signed in as a LEAP user'; END IF;

  SELECT i.* INTO v_item FROM public.vehicle_activity_items i
  WHERE i.id = p_item_id AND i.vai_is_deleted IS NOT TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inspection item not found'; END IF;

  SELECT va_vehicle_activity_status INTO v_status FROM public.vehicle_activities WHERE id = v_item.vehicle_activity_id;
  IF v_status = 'Vehicle Activity Complete' THEN
    RAISE EXCEPTION 'This inspection is already complete';
  END IF;

  IF v_item.vai_requires_condition THEN
    IF p_condition NOT IN ('ok','needs_repair') THEN
      RAISE EXCEPTION 'Condition must be ok or needs_repair';
    END IF;
    IF p_condition = 'needs_repair' AND (p_comment IS NULL OR btrim(p_comment) = '') THEN
      RAISE EXCEPTION 'Describe what needs repair in the comment';
    END IF;
  END IF;

  UPDATE public.vehicle_activity_items
  SET vai_condition = CASE WHEN vai_requires_condition THEN p_condition ELSE vai_condition END,
      vai_comment = COALESCE(NULLIF(btrim(p_comment), ''), vai_comment),
      vai_completed_at = now(),
      vai_updated_by = v_me, vai_updated_at = now()
  WHERE id = p_item_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_vehicle_inspection(
  p_activity_id uuid, p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_me      uuid := public.current_app_user_id();
  v_act     public.vehicle_activities%ROWTYPE;
  v_vehicle public.vehicles%ROWTYPE;
  v_missing text[] := '{}';
  v_repairs text[] := '{}';
  v_item    record;
  v_photos  integer;
  v_steward uuid;
  v_task    boolean := false;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not signed in as a LEAP user'; END IF;

  SELECT * INTO v_act FROM public.vehicle_activities
  WHERE id = p_activity_id AND va_is_deleted IS NOT TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inspection not found'; END IF;
  IF v_act.va_vehicle_activity_status = 'Vehicle Activity Complete' THEN
    RETURN jsonb_build_object('ok', true, 'already_complete', true);
  END IF;

  SELECT * INTO v_vehicle FROM public.vehicles WHERE id = v_act.vehicle_id;

  IF v_act.va_odometer_reading IS NULL OR v_act.va_gas_level_start IS NULL THEN
    v_missing := array_append(v_missing, 'Start odometer and gas level');
  END IF;
  IF v_act.va_odometer_return IS NULL OR v_act.va_gas_level_return IS NULL THEN
    v_missing := array_append(v_missing, 'Return odometer and gas level');
  END IF;

  FOR v_item IN
    SELECT * FROM public.vehicle_activity_items
    WHERE vehicle_activity_id = p_activity_id AND vai_is_deleted IS NOT TRUE
    ORDER BY vai_sort_order
  LOOP
    SELECT count(*) INTO v_photos FROM public.photos
    WHERE related_object = 'vehicle_activity_items' AND related_id = v_item.id AND is_deleted IS NOT TRUE;

    IF v_photos < v_item.vai_photos_required THEN
      v_missing := array_append(v_missing, format('%s — needs %s photo(s)', v_item.vai_name, v_item.vai_photos_required - v_photos));
    END IF;
    IF v_item.vai_requires_condition AND v_item.vai_condition IS NULL THEN
      v_missing := array_append(v_missing, format('%s — mark OK or Needs Repair', v_item.vai_name));
    END IF;
    IF v_item.vai_condition = 'needs_repair' AND v_photos = 0 AND v_item.vai_name = 'New Damage Check' THEN
      v_missing := array_append(v_missing, 'New Damage Check — photograph the damage');
    END IF;
    IF v_item.vai_condition = 'needs_repair' THEN
      v_repairs := array_append(v_repairs, format('%s: %s', v_item.vai_name, COALESCE(v_item.vai_comment, 'no comment')));
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'missing', to_jsonb(v_missing));
  END IF;

  UPDATE public.vehicle_activities
  SET va_vehicle_activity_status = 'Vehicle Activity Complete',
      va_notes = COALESCE(NULLIF(btrim(p_notes), ''), va_notes),
      va_attested_at = now(), va_attested_by = v_me,
      va_vehicle_activity_follow_up_required = (array_length(v_repairs, 1) IS NOT NULL),
      va_updated_by = v_me, va_updated_at = now()
  WHERE id = p_activity_id;

  -- Needs Repair findings route ONE task to the Shop Steward (first active,
  -- data-driven by role); fall back to the driver so it is never unrouted.
  IF array_length(v_repairs, 1) IS NOT NULL THEN
    SELECT u.id INTO v_steward
    FROM public.users u JOIN public.roles r ON r.id = u.role_id
    WHERE r.role_name = 'Shop Steward' AND u.user_is_active IS TRUE AND u.user_is_deleted IS NOT TRUE
    ORDER BY u.user_created_at
    LIMIT 1;

    INSERT INTO public.tasks (subject, description, status, priority, owner_id, created_by_id,
                              related_object, related_id, is_automated, automation_rule, due_date)
    VALUES (
      format('Vehicle needs repair — %s (%s)', v_vehicle.vehicle_name, v_act.va_record_number),
      format('Daily inspection %s on %s flagged %s item(s) as Needs Repair:%s%s%sOpen the inspection: /vehicle_activities/%s',
             v_act.va_record_number, v_vehicle.vehicle_name, array_length(v_repairs, 1),
             E'\n\n', array_to_string(v_repairs, E'\n'), E'\n\n', v_act.id),
      'Open', 'High', COALESCE(v_steward, v_act.va_driver, v_me), v_me,
      'vehicle_activities', v_act.id, true, 'vehicle_inspection_needs_repair_task',
      (now() AT TIME ZONE 'America/Chicago')::date
    );
    v_task := true;
  END IF;

  RETURN jsonb_build_object('ok', true, 'needs_repair_count', COALESCE(array_length(v_repairs, 1), 0), 'task_routed', v_task);
END;
$$;

-- Standard technician-RPC grants: authenticated may execute; anon may not.
REVOKE ALL ON FUNCTION public.create_vehicle_daily_inspection(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vehicle_inspection_detail(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_vehicle_inspection_leg(uuid, text, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_vehicle_inspection_item(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_vehicle_inspection(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_vehicle_daily_inspection(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vehicle_inspection_detail(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_vehicle_inspection_leg(uuid, text, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_vehicle_inspection_item(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_vehicle_inspection(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
