-- Final shape of _automation_action_update_record. Replaces the v2 version
-- that singularized 'parent_opportunity' to 'opportunity' and then re-
-- pluralized via simple s-append, giving the broken 'opportunitys' table
-- name. Now uses an explicit map from the parent name to the actual table
-- name; also accepts the plural table name directly so action_config can
-- say either 'parent_opportunity' or 'parent_opportunities'.
--
-- Supported action_config shapes:
--   { target: 'parent_project',
--     condition: 'all_work_orders_verified',
--     new_status: 'Project Verified' }       -- backwards-compatible path
--   { target: 'self', new_status: '<label>' }
--   { target: 'self', set_field: '<col>', set_value: '<scalar>' }
--   { target: 'parent_<name>', new_status: '<label>' }
--   { target: 'parent_<name>', set_field: '<col>', set_value: '<scalar>' }

CREATE OR REPLACE FUNCTION public._automation_action_update_record(
  p_rule       automation_rules,
  p_record_id  uuid,
  OUT v_outcome     text,
  OUT v_message     text,
  OUT v_created_id  uuid
) AS $$
DECLARE
  v_target      text;
  v_condition   text;
  v_new_status  text;
  v_set_field   text;
  v_set_value   text;

  v_parent_name   text;
  v_target_object text;
  v_target_id     uuid;

  v_status_col    text;
  v_new_status_id uuid;
  v_current_status_id uuid;

  v_all_verified  boolean;
BEGIN
  v_target     := p_rule.action_config ->> 'target';
  v_condition  := p_rule.action_config ->> 'condition';
  v_new_status := p_rule.action_config ->> 'new_status';
  v_set_field  := p_rule.action_config ->> 'set_field';
  v_set_value  := p_rule.action_config ->> 'set_value';
  v_created_id := NULL;

  IF v_target = 'self' THEN
    v_target_object := p_rule.trigger_object;
    v_target_id     := p_record_id;
  ELSIF v_target LIKE 'parent_%' THEN
    v_parent_name := substring(v_target FROM 'parent_(.+)');
    v_target_object := CASE v_parent_name
      WHEN 'project'        THEN 'projects'
      WHEN 'projects'       THEN 'projects'
      WHEN 'opportunity'    THEN 'opportunities'
      WHEN 'opportunities'  THEN 'opportunities'
      WHEN 'account'        THEN 'accounts'
      WHEN 'accounts'       THEN 'accounts'
      WHEN 'assessment'     THEN 'assessments'
      WHEN 'assessments'    THEN 'assessments'
      WHEN 'building'       THEN 'buildings'
      WHEN 'buildings'      THEN 'buildings'
      WHEN 'property'       THEN 'properties'
      WHEN 'properties'     THEN 'properties'
      ELSE NULL
    END;
    IF v_target_object IS NULL THEN
      v_outcome := 'error';
      v_message := format('Unknown parent type: %s', v_parent_name);
      RETURN;
    END IF;
    SELECT _automation_resolve_parent_record(p_rule.trigger_object, p_record_id, v_target_object)
      INTO v_target_id;
    IF v_target_id IS NULL THEN
      v_outcome := 'skipped';
      v_message := format('No %s found for %s/%s',
        v_target_object, p_rule.trigger_object, p_record_id);
      RETURN;
    END IF;
  ELSE
    v_outcome := 'skipped';
    v_message := format('Unsupported target: %s', v_target);
    RETURN;
  END IF;

  IF v_condition IS NOT NULL AND v_condition <> 'always' THEN
    IF v_condition = 'all_work_orders_verified'
       AND p_rule.trigger_object = 'work_orders'
       AND v_target_object = 'projects' THEN
      SELECT NOT EXISTS (
        SELECT 1 FROM public.work_orders w
          LEFT JOIN public.picklist_values pv ON pv.id = w.work_order_status
         WHERE w.project_id = v_target_id
           AND NOT w.work_order_is_deleted
           AND COALESCE(pv.picklist_value,'') NOT LIKE '%Verified%'
      ) INTO v_all_verified;
      IF NOT v_all_verified THEN
        v_outcome := 'skipped';
        v_message := 'Not all work orders on this project are verified yet';
        RETURN;
      END IF;
    ELSE
      v_outcome := 'skipped';
      v_message := format('Unsupported condition: %s on target %s', v_condition, v_target);
      RETURN;
    END IF;
  END IF;

  IF v_new_status IS NOT NULL THEN
    v_status_col := _automation_status_column_for(v_target_object);
    IF v_status_col IS NULL THEN
      v_outcome := 'error';
      v_message := format('No status column registered for %s', v_target_object);
      RETURN;
    END IF;
    SELECT id INTO v_new_status_id
      FROM public.picklist_values
     WHERE picklist_object = v_target_object
       AND picklist_field  = v_status_col
       AND picklist_value  = v_new_status
       AND picklist_is_active
     LIMIT 1;
    IF v_new_status_id IS NULL THEN
      v_outcome := 'error';
      v_message := format('No active %s picklist value "%s"', v_status_col, v_new_status);
      RETURN;
    END IF;
    EXECUTE format('SELECT %I FROM public.%I WHERE id = $1', v_status_col, v_target_object)
      INTO v_current_status_id
      USING v_target_id;
    IF v_current_status_id = v_new_status_id THEN
      v_outcome := 'skipped';
      v_message := format('%s already at "%s"', v_target_object, v_new_status);
      RETURN;
    END IF;
    EXECUTE format('UPDATE public.%I SET %I = $1 WHERE id = $2',
                   v_target_object, v_status_col)
      USING v_new_status_id, v_target_id;
    v_created_id := v_target_id;
    v_outcome := 'success';
    v_message := format('Set %s/%s.%s to "%s"',
      v_target_object, v_target_id, v_status_col, v_new_status);
    RETURN;
  END IF;

  IF v_set_field IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=v_target_object AND column_name=v_set_field
    ) THEN
      v_outcome := 'error';
      v_message := format('Column %s.%s does not exist', v_target_object, v_set_field);
      RETURN;
    END IF;
    EXECUTE format('UPDATE public.%I SET %I = $1 WHERE id = $2',
                   v_target_object, v_set_field)
      USING v_set_value, v_target_id;
    v_created_id := v_target_id;
    v_outcome := 'success';
    v_message := format('Set %s/%s.%s', v_target_object, v_target_id, v_set_field);
    RETURN;
  END IF;

  v_outcome := 'skipped';
  v_message := 'update_record: neither new_status nor set_field provided in action_config';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
