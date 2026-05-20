-- Hook the automation executor into change_record_status.
--
-- The previous version of change_record_status validated transitions, did
-- the UPDATE, and wrote a status_change_events audit row. This version adds
-- one extra step at the tail: PERFORM execute_automation_rules(...) to fire
-- every active automation rule registered for (object, 'status_change',
-- new_status_label).
--
-- Failure isolation: the PERFORM is wrapped in a sub-block with EXCEPTION
-- WHEN OTHERS that catches any error from the executor and writes a row to
-- automation_run_log with arl_rule_id = NULL + arl_action_type = 'dispatcher'.
-- This ensures a misbehaving rule (or executor bug) can never roll back a
-- status change — the status change is the source-of-truth user action, the
-- automation is a downstream side effect.

CREATE OR REPLACE FUNCTION public.change_record_status(
  p_object text, p_status_field text, p_record_id uuid,
  p_to_status_id uuid, p_note text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_event_id       uuid;
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

  INSERT INTO public.status_change_events (
    sce_record_number, sce_object, sce_record_id, sce_transition_id,
    sce_from_status_id, sce_to_status_id, sce_note, sce_created_by
  ) VALUES (
    '', p_object, p_record_id, v_transition_id,
    v_current_status, p_to_status_id,
    NULLIF(btrim(p_note), ''),
    v_user_id
  )
  RETURNING id INTO v_event_id;

  -- Fire automation rules. Sub-block isolates rule errors from the status
  -- change itself — status stays committed even if every rule crashes.
  BEGIN
    PERFORM public.execute_automation_rules(p_object, p_record_id, 'status_change', v_pv_value);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.automation_run_log
      (arl_record_number, arl_rule_id, arl_rule_name,
       arl_trigger_object, arl_trigger_record_id, arl_trigger_event, arl_trigger_status,
       arl_action_type, arl_outcome, arl_outcome_message, arl_fired_by)
    VALUES
      ('', NULL, '(executor itself)',
       p_object, p_record_id, 'status_change', v_pv_value,
       'dispatcher', 'error',
       format('%s: %s', SQLSTATE, SQLERRM),
       v_user_id);
  END;

  RETURN jsonb_build_object(
    'ok',                true,
    'transition_id',     v_transition_id,
    'transition_label',  v_transition_label,
    'from_status_id',    v_current_status,
    'to_status_id',      p_to_status_id,
    'event_id',          v_event_id
  );
END;
$function$;
