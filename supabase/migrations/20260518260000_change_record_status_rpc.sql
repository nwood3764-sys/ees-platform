-- =========================================================================
-- change_record_status — runtime consumer of status_transitions.
--
-- Validates that a non-deleted active transition exists from the record's
-- current status to the requested new status on (p_object,
-- p_status_field), then updates the row's status column plus the
-- standard audit columns (*_updated_at, *_updated_by). Returns the
-- transition_id used and the new status info.
--
-- Permission gate: app_user_can(p_object, 'update'). Admin role
-- short-circuits to true.
--
-- Returns jsonb: { ok, transition_id, transition_label, from_status_id,
-- to_status_id }, or raises an exception with a clear message on
-- validation failure.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.change_record_status(
  p_object        text,
  p_status_field  text,
  p_record_id     uuid,
  p_to_status_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id        uuid;
  v_updated_by_col text;
  v_updated_at_col text;
  v_table_prefix   text;
  v_current_status uuid;
  v_transition_id  uuid;
  v_transition_label text;
  v_pv_object      text;
  v_pv_field       text;
  v_pv_value       text;
  v_sql            text;
BEGIN
  SELECT id INTO v_user_id FROM public.users WHERE auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.app_user_can(p_object, 'update') THEN
    RAISE EXCEPTION 'User does not have update permission on %', p_object
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT picklist_object, picklist_field, picklist_value
    INTO v_pv_object, v_pv_field, v_pv_value
  FROM public.picklist_values WHERE id = p_to_status_id;
  IF v_pv_object IS NULL THEN
    RAISE EXCEPTION 'p_to_status_id does not reference an existing picklist value';
  END IF;
  IF v_pv_object <> p_object OR v_pv_field <> p_status_field THEN
    RAISE EXCEPTION 'p_to_status_id (% on %.%) does not match transition scope %.%',
      v_pv_value, v_pv_object, v_pv_field, p_object, p_status_field;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=p_object AND column_name=p_status_field
  ) THEN
    RAISE EXCEPTION 'Column %.% does not exist', p_object, p_status_field;
  END IF;

  v_table_prefix := regexp_replace(p_object, 's$', '');

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name=p_object
               AND column_name = v_table_prefix || '_updated_by') THEN
    v_updated_by_col := v_table_prefix || '_updated_by';
    v_updated_at_col := v_table_prefix || '_updated_at';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name=p_object
                  AND column_name = 'updated_by') THEN
    v_updated_by_col := 'updated_by';
    v_updated_at_col := 'updated_at';
  ELSE
    v_updated_by_col := NULL;
    v_updated_at_col := NULL;
  END IF;

  EXECUTE format('SELECT %I FROM public.%I WHERE id = $1', p_status_field, p_object)
    INTO v_current_status USING p_record_id;

  SELECT id, st_transition_label INTO v_transition_id, v_transition_label
  FROM public.status_transitions
  WHERE st_object         = p_object
    AND st_status_field   = p_status_field
    AND st_to_status_id   = p_to_status_id
    AND st_from_status_id IS NOT DISTINCT FROM v_current_status
    AND st_is_active      = true
    AND st_is_deleted     = false
  LIMIT 1;

  IF v_transition_id IS NULL THEN
    RAISE EXCEPTION 'No active transition exists for %.% from % to %',
      p_object, p_status_field,
      COALESCE(v_current_status::text, '(initial creation)'),
      p_to_status_id::text
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_updated_by_col IS NOT NULL THEN
    v_sql := format(
      'UPDATE public.%I SET %I = $1, %I = $2, %I = now() WHERE id = $3',
      p_object, p_status_field, v_updated_by_col, v_updated_at_col
    );
    EXECUTE v_sql USING p_to_status_id, v_user_id, p_record_id;
  ELSE
    v_sql := format('UPDATE public.%I SET %I = $1 WHERE id = $2', p_object, p_status_field);
    EXECUTE v_sql USING p_to_status_id, p_record_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',                true,
    'transition_id',     v_transition_id,
    'transition_label',  v_transition_label,
    'from_status_id',    v_current_status,
    'to_status_id',      p_to_status_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.change_record_status(text, text, uuid, uuid) TO authenticated;
