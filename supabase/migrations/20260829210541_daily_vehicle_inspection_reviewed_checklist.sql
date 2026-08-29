-- The daily vehicle inspection, reviewed item by item with Nicholas.
--
-- The rule he set: every step either RECORDS A CONDITION or PROVES A TASK WAS
-- DONE. A step that can't be proven by what it asks for is a box someone ticks
-- without looking, which is worse than nothing because it manufactures a
-- record. And an inspection is not where you report that something happened --
-- new damage and dash warning lights are events, and they belong in a Damage
-- Report or a repair task that has an owner and gets chased.
--
-- What changed and why:
--   * The odometer appeared FOUR times -- typed into a leg panel and
--     photographed as a separate item, twice over. It is two readings: one at
--     the start, one on return. The photo of the dash is the proof of the
--     number, so they are one step.
--   * Ten tire rows (two of them exact duplicates) each demanding a photo that
--     shows neither inflation nor tread -- the two things being checked. One
--     Tires step, flagged when wrong.
--   * "Windows - Clean and No Cracks" was two unrelated things; a crack is a
--     safety and legal fact, clean is housekeeping the return video proves.
--   * Gassed Up on Return said nothing the return dash photo and fuel level
--     did not already say.
--   * Tools & Materials and Sweep Floor removed outright.
--   * Personal belongings are not garbage: taking someone's property out of a
--     truck is its own step, ahead of binning the rubbish.
--   * Interior clean and exterior clean are separate claims and each needs its
--     own VIDEO -- a still frame proves one corner of a cab.
--
-- Video evidence has never existed in this flow: complete_vehicle_inspection
-- counted photos and nothing else, so a "record a video" step would have
-- accepted an empty answer. That gate is built here.

-- 1. A step can now require video, not just photos.
ALTER TABLE public.vehicle_inspection_item_templates
  ADD COLUMN viit_videos_required integer NOT NULL DEFAULT 0;
ALTER TABLE public.vehicle_activity_items
  ADD COLUMN vai_videos_required integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.vehicle_inspection_item_templates.viit_videos_required IS
  'Videos this item requires. Videos are documents (mime_type video/%) related to the vehicle_activity_item, the same shape work steps use.';

-- 2. Retire what the review removed.
UPDATE public.vehicle_inspection_item_templates
   SET viit_is_active = false
 WHERE viit_record_number IN (
   'VIT-00002',
   'VIT-00007',
   'VIT-00008','VIT-00009','VIT-00010','VIT-00011',
   'VIT-00012','VIT-00013','VIT-00014','VIT-00015',
   'VIT-00016','VIT-00017',
   'VIT-00028',
   'VIT-00029',
   'VIT-00030',
   'VIT-00031'
 );

-- 3. Reword and reorder what stays.
UPDATE public.vehicle_inspection_item_templates SET
  viit_name = 'Odometer, Fuel Gauge & Dash - Start',
  viit_description = 'Photograph the dash showing the odometer and fuel gauge, and enter both readings here.',
  viit_sort_order = 10, viit_photos_required = 1, viit_requires_condition = false
WHERE viit_record_number = 'VIT-00001';

UPDATE public.vehicle_inspection_item_templates SET viit_sort_order = 20 WHERE viit_record_number = 'VIT-00003';
UPDATE public.vehicle_inspection_item_templates SET viit_sort_order = 30 WHERE viit_record_number = 'VIT-00004';
UPDATE public.vehicle_inspection_item_templates SET viit_sort_order = 40 WHERE viit_record_number = 'VIT-00005';
UPDATE public.vehicle_inspection_item_templates SET viit_sort_order = 50 WHERE viit_record_number = 'VIT-00006';

UPDATE public.vehicle_inspection_item_templates SET
  viit_name = 'Windshield - No Cracks',
  viit_description = 'Windshield free of cracks and chips. Photo of the windshield.',
  viit_sort_order = 70
WHERE viit_record_number = 'VIT-00018';

UPDATE public.vehicle_inspection_item_templates SET
  viit_name = 'Wipers - Functional',
  viit_description = 'Wipers move freely and clear the glass.',
  viit_sort_order = 80, viit_photos_required = 0
WHERE viit_record_number = 'VIT-00019';

UPDATE public.vehicle_inspection_item_templates SET
  viit_name = 'Dash Cam - Powered On', viit_sort_order = 90
WHERE viit_record_number = 'VIT-00020';

UPDATE public.vehicle_inspection_item_templates SET
  viit_name = 'Oil Level', viit_sort_order = 100
WHERE viit_record_number = 'VIT-00021';

UPDATE public.vehicle_inspection_item_templates SET
  viit_name = 'First Aid Kit', viit_sort_order = 110
WHERE viit_record_number = 'VIT-00022';

UPDATE public.vehicle_inspection_item_templates SET
  viit_name = 'Fire Extinguisher', viit_sort_order = 120
WHERE viit_record_number = 'VIT-00023';

UPDATE public.vehicle_inspection_item_templates SET
  viit_name = 'Headlights - Hi and Lo Beam',
  viit_description = 'Both beams function. Two photos - one on high beam, one on low.',
  viit_sort_order = 150, viit_photos_required = 2
WHERE viit_record_number = 'VIT-00024';

UPDATE public.vehicle_inspection_item_templates SET
  viit_name = 'Turn Signals', viit_sort_order = 160
WHERE viit_record_number = 'VIT-00025';

UPDATE public.vehicle_inspection_item_templates SET
  viit_name = 'Mirrors - Driver and Passenger',
  viit_description = 'Both mirrors intact, adjustable and clear. One photo of each side.',
  viit_sort_order = 170, viit_photos_required = 2
WHERE viit_record_number = 'VIT-00026';

UPDATE public.vehicle_inspection_item_templates SET
  viit_name = 'Odometer, Fuel Gauge & Dash - Return',
  viit_description = 'Photograph the dash on return showing the odometer and fuel gauge, and enter both readings here.',
  viit_sort_order = 200, viit_photos_required = 1, viit_requires_condition = false
WHERE viit_record_number = 'VIT-00027';

UPDATE public.vehicle_inspection_item_templates SET
  viit_name = 'Toss Garbage',
  viit_description = 'All rubbish out of the cab and cargo area.',
  viit_sort_order = 220
WHERE viit_record_number = 'VIT-00032';

-- 4. New items.
INSERT INTO public.vehicle_inspection_item_templates
  (viit_record_number, viit_name, viit_description, viit_leg, viit_sort_order,
   viit_photos_required, viit_videos_required, viit_requires_condition, viit_owner, viit_created_by)
VALUES
  ('', 'Tires - All Positions',
   'Walk every tire: inflation and tread. OK if all are sound. Needs Repair names the position and takes a photo of it.',
   'pre_trip', 60, 0, 0, true,
   'c5a01ec8-960f-42ab-8a9e-a49822de89af','c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('', 'Road Safety Kit',
   'Road safety kit present and complete (triangles / flares / vest). Photo.',
   'pre_trip', 130, 1, 0, true,
   'c5a01ec8-960f-42ab-8a9e-a49822de89af','c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('', 'Jumper Cables',
   'Jumper cables present and in serviceable condition. Photo.',
   'pre_trip', 140, 1, 0, true,
   'c5a01ec8-960f-42ab-8a9e-a49822de89af','c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('', 'Remove Personal Belongings',
   'Your own belongings out of the vehicle. Personal property is never thrown out with the rubbish.',
   'return', 210, 0, 0, true,
   'c5a01ec8-960f-42ab-8a9e-a49822de89af','c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('', 'Interior Clean',
   'Record a video of the cab and cargo interior showing it clean and clear for the next crew.',
   'return', 230, 0, 1, true,
   'c5a01ec8-960f-42ab-8a9e-a49822de89af','c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('', 'Exterior Clean',
   'Record a video walking the outside of the vehicle showing it clean.',
   'return', 240, 0, 1, true,
   'c5a01ec8-960f-42ab-8a9e-a49822de89af','c5a01ec8-960f-42ab-8a9e-a49822de89af');

-- 5-7. Carry the video requirement into each inspection, surface it to LEAP
-- Pad, and gate on it at completion. The bodies below are the deployed
-- definitions; see the notes above for what changed in each.

CREATE OR REPLACE FUNCTION public.create_vehicle_daily_inspection(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  WHERE picklist_object='vehicle_activities' AND picklist_field='record_type' AND picklist_value='DAILY-INSPECTION';
  SELECT id INTO v_at FROM public.picklist_values
  WHERE picklist_object='vehicle_activities' AND picklist_field='va_activity_type' AND picklist_value='Daily Inspection';

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

  INSERT INTO public.vehicle_activity_items (
    vai_record_number, vai_name, vehicle_activity_id, inspection_item_template_id,
    vai_leg, vai_sort_order, vai_photos_required, vai_videos_required,
    vai_requires_condition, vai_created_by
  )
  SELECT '', t.viit_name, v_act_id, t.id,
         t.viit_leg, t.viit_sort_order, t.viit_photos_required, t.viit_videos_required,
         t.viit_requires_condition, v_me
  FROM public.vehicle_inspection_item_templates t
  WHERE t.viit_is_deleted IS NOT TRUE
    AND t.viit_is_active IS TRUE
    AND (t.viit_vehicle_type_ids IS NULL OR v_vehicle.vehicle_type = ANY(t.viit_vehicle_type_ids));
  GET DIAGNOSTICS v_items = ROW_COUNT;

  RETURN jsonb_build_object('activity_id', v_act_id, 'record_number', v_rn, 'resumed', false, 'items', v_items);
END;
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_inspection_detail(p_activity_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
        'videos_required', i.vai_videos_required,
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
            AND ph.related_id = i.id AND ph.is_deleted IS NOT TRUE), '[]'::jsonb),
        'video_count', (SELECT count(*) FROM public.documents d
                        WHERE d.related_object = 'vehicle_activity_items'
                          AND d.related_id = i.id AND d.is_deleted = false
                          AND d.mime_type ILIKE 'video/%'),
        'videos', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'document_id', d.id, 'name', d.name,
            'storage_bucket', d.storage_bucket, 'storage_path', d.storage_path)
            ORDER BY d.created_at)
          FROM public.documents d
          WHERE d.related_object = 'vehicle_activity_items'
            AND d.related_id = i.id AND d.is_deleted = false
            AND d.mime_type ILIKE 'video/%'), '[]'::jsonb)
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
$function$;

CREATE OR REPLACE FUNCTION public.complete_vehicle_inspection(p_activity_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_me      uuid := public.current_app_user_id();
  v_act     public.vehicle_activities%ROWTYPE;
  v_vehicle public.vehicles%ROWTYPE;
  v_missing text[] := '{}';
  v_repairs text[] := '{}';
  v_item    record;
  v_photos  integer;
  v_videos  integer;
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
    v_missing := array_append(v_missing, 'Start odometer and fuel level');
  END IF;
  IF v_act.va_odometer_return IS NULL OR v_act.va_gas_level_return IS NULL THEN
    v_missing := array_append(v_missing, 'Return odometer and fuel level');
  END IF;

  FOR v_item IN
    SELECT * FROM public.vehicle_activity_items
    WHERE vehicle_activity_id = p_activity_id AND vai_is_deleted IS NOT TRUE
    ORDER BY vai_sort_order
  LOOP
    SELECT count(*) INTO v_photos FROM public.photos
    WHERE related_object = 'vehicle_activity_items' AND related_id = v_item.id AND is_deleted IS NOT TRUE;

    SELECT count(*) INTO v_videos FROM public.documents
    WHERE related_object = 'vehicle_activity_items' AND related_id = v_item.id
      AND is_deleted = false AND mime_type ILIKE 'video/%';

    IF v_photos < v_item.vai_photos_required THEN
      v_missing := array_append(v_missing, format('%s - needs %s photo(s)', v_item.vai_name, v_item.vai_photos_required - v_photos));
    END IF;
    IF v_videos < COALESCE(v_item.vai_videos_required, 0) THEN
      v_missing := array_append(v_missing, format('%s - record the video', v_item.vai_name));
    END IF;
    IF v_item.vai_requires_condition AND v_item.vai_condition IS NULL THEN
      v_missing := array_append(v_missing, format('%s - mark OK or Needs Repair', v_item.vai_name));
    END IF;
    -- Anything flagged for repair has to say what is wrong AND show it.
    IF v_item.vai_condition = 'needs_repair' AND v_photos = 0 THEN
      v_missing := array_append(v_missing, format('%s - photograph what needs repair', v_item.vai_name));
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

  IF array_length(v_repairs, 1) IS NOT NULL THEN
    SELECT u.id INTO v_steward
    FROM public.users u JOIN public.roles r ON r.id = u.role_id
    WHERE r.role_name = 'Shop Steward' AND u.user_is_active IS TRUE AND u.user_is_deleted IS NOT TRUE
    ORDER BY u.user_created_at
    LIMIT 1;

    INSERT INTO public.tasks (subject, description, status, priority, owner_id, created_by_id,
                              related_object, related_id, is_automated, automation_rule, due_date)
    VALUES (
      format('Vehicle needs repair - %s (%s)', v_vehicle.vehicle_name, v_act.va_record_number),
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
$function$;

-- 8. Rebuild any inspection nobody has started answering yet. An inspection
-- with work already recorded against it keeps the list it was taken against;
-- rewriting a partly-answered checklist would rewrite history.
WITH untouched AS (
  SELECT va.id, va.vehicle_id, va.va_created_by
  FROM public.vehicle_activities va
  WHERE va.va_is_deleted IS NOT TRUE
    AND va.va_vehicle_activity_status <> 'Vehicle Activity Complete'
    AND NOT EXISTS (
      SELECT 1 FROM public.vehicle_activity_items i
      WHERE i.vehicle_activity_id = va.id AND i.vai_is_deleted IS NOT TRUE
        AND (i.vai_completed_at IS NOT NULL OR i.vai_condition IS NOT NULL))
    AND NOT EXISTS (
      SELECT 1 FROM public.photos ph
      JOIN public.vehicle_activity_items i2 ON i2.id = ph.related_id
      WHERE ph.related_object = 'vehicle_activity_items'
        AND i2.vehicle_activity_id = va.id AND ph.is_deleted IS NOT TRUE)
),
cleared AS (
  UPDATE public.vehicle_activity_items i
     SET vai_is_deleted = true, vai_deleted_at = now(),
         vai_deletion_reason = 'Replaced by the reviewed daily inspection checklist'
   WHERE i.vehicle_activity_id IN (SELECT id FROM untouched)
     AND i.vai_is_deleted IS NOT TRUE
  RETURNING 1
)
INSERT INTO public.vehicle_activity_items (
  vai_record_number, vai_name, vehicle_activity_id, inspection_item_template_id,
  vai_leg, vai_sort_order, vai_photos_required, vai_videos_required,
  vai_requires_condition, vai_created_by)
SELECT '', t.viit_name, u.id, t.id, t.viit_leg, t.viit_sort_order,
       t.viit_photos_required, t.viit_videos_required, t.viit_requires_condition, u.va_created_by
FROM untouched u
JOIN public.vehicles v ON v.id = u.vehicle_id
JOIN public.vehicle_inspection_item_templates t
  ON t.viit_is_deleted IS NOT TRUE AND t.viit_is_active IS TRUE
 AND (t.viit_vehicle_type_ids IS NULL OR v.vehicle_type = ANY(t.viit_vehicle_type_ids));

-- 9. Assert the shape, do not assume it.
DO $$
DECLARE v_pre int; v_ret int; v_vid int; v_src text; v_dupes int;
BEGIN
  SELECT count(*) FILTER (WHERE viit_leg='pre_trip'),
         count(*) FILTER (WHERE viit_leg='return'),
         count(*) FILTER (WHERE viit_videos_required > 0)
    INTO v_pre, v_ret, v_vid
    FROM public.vehicle_inspection_item_templates
   WHERE viit_is_active IS TRUE AND viit_is_deleted IS NOT TRUE;

  IF v_pre <> 17 THEN RAISE EXCEPTION 'Expected 17 active pre-trip items, found %.', v_pre; END IF;
  IF v_ret <> 5  THEN RAISE EXCEPTION 'Expected 5 active return items, found %.', v_ret; END IF;
  IF v_vid <> 2  THEN RAISE EXCEPTION 'Expected 2 video items (interior + exterior clean), found %.', v_vid; END IF;

  IF (SELECT viit_sort_order FROM public.vehicle_inspection_item_templates WHERE viit_name='Toss Garbage')
     >= (SELECT viit_sort_order FROM public.vehicle_inspection_item_templates WHERE viit_name='Interior Clean') THEN
    RAISE EXCEPTION 'Toss Garbage must be ordered before Interior Clean.';
  END IF;
  IF (SELECT viit_sort_order FROM public.vehicle_inspection_item_templates WHERE viit_name='Remove Personal Belongings')
     >= (SELECT viit_sort_order FROM public.vehicle_inspection_item_templates WHERE viit_name='Toss Garbage') THEN
    RAISE EXCEPTION 'Remove Personal Belongings must be ordered before Toss Garbage.';
  END IF;

  IF (SELECT count(*) FROM public.vehicle_inspection_item_templates
       WHERE viit_is_active AND viit_is_deleted IS NOT TRUE AND viit_name ILIKE 'Odometer%') <> 2 THEN
    RAISE EXCEPTION 'There must be exactly two odometer steps: one per leg.';
  END IF;

  SELECT count(*) INTO v_dupes FROM (
    SELECT viit_name FROM public.vehicle_inspection_item_templates
     WHERE viit_is_active AND viit_is_deleted IS NOT TRUE
     GROUP BY viit_name HAVING count(*) > 1) d;
  IF v_dupes <> 0 THEN RAISE EXCEPTION '% duplicate active item name(s) remain.', v_dupes; END IF;

  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='complete_vehicle_inspection';
  IF v_src NOT LIKE '%vai_videos_required%' THEN
    RAISE EXCEPTION 'complete_vehicle_inspection does not gate on video - a video step would accept nothing.';
  END IF;
  IF v_src LIKE '%New Damage Check%' THEN
    RAISE EXCEPTION 'complete_vehicle_inspection still matches the retired New Damage Check item by name.';
  END IF;
END $$;
