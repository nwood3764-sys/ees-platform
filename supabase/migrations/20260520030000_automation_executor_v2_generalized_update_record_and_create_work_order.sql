-- Automation executor v2. Generalizes _automation_action_update_record beyond
-- the single (parent_project + all_work_orders_verified) shape it shipped
-- with, and adds _automation_action_create_work_order so the seeded
-- "Auto-generate shop kit work order on opportunity win" rule actually
-- produces a work order instead of returning 'skipped'.
--
-- See migration 20260520050000 for the final pluralization fix; this
-- migration's first cut of update_record had a y→s bug that gave
-- 'opportunitys' instead of 'opportunities'.

CREATE OR REPLACE FUNCTION public._automation_status_column_for(p_object text)
RETURNS text AS $$
BEGIN
  RETURN CASE p_object
    WHEN 'accounts'               THEN 'account_status'
    WHEN 'assessments'            THEN 'assessment_status'
    WHEN 'incentive_applications' THEN 'ia_status'
    WHEN 'opportunities'          THEN 'opportunity_status'
    WHEN 'projects'               THEN 'project_status'
    WHEN 'work_orders'            THEN 'work_order_status'
    ELSE NULL
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public._automation_resolve_parent_record(
  p_source_object text,
  p_source_id     uuid,
  p_parent_object text,
  OUT v_parent_id uuid
) AS $$
BEGIN
  v_parent_id := NULL;
  IF p_source_id IS NULL OR p_parent_object IS NULL THEN RETURN; END IF;

  IF p_parent_object = 'projects' THEN
    IF p_source_object = 'work_orders' THEN
      SELECT project_id INTO v_parent_id FROM public.work_orders WHERE id = p_source_id;
    END IF;
  ELSIF p_parent_object = 'opportunities' THEN
    IF p_source_object = 'projects' THEN
      SELECT opportunity_id INTO v_parent_id FROM public.projects WHERE id = p_source_id;
    ELSIF p_source_object = 'work_orders' THEN
      SELECT opportunity_id INTO v_parent_id FROM public.work_orders WHERE id = p_source_id;
    ELSIF p_source_object = 'incentive_applications' THEN
      SELECT opportunity_id INTO v_parent_id FROM public.incentive_applications WHERE id = p_source_id;
    ELSIF p_source_object = 'assessments' THEN
      SELECT opportunity_id INTO v_parent_id FROM public.assessments WHERE id = p_source_id;
    END IF;
  ELSIF p_parent_object = 'accounts' THEN
    IF p_source_object = 'opportunities' THEN
      SELECT opportunity_account_id INTO v_parent_id FROM public.opportunities WHERE id = p_source_id;
    ELSIF p_source_object = 'properties' THEN
      SELECT property_account_id INTO v_parent_id FROM public.properties WHERE id = p_source_id;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- update_record is replaced in migration 20260520050000; placeholder body
-- created here so the dispatcher reference resolves correctly during
-- transitional rollouts. Final shape lives in 20260520050000.

CREATE OR REPLACE FUNCTION public._automation_action_create_work_order(
  p_rule       automation_rules,
  p_record_id  uuid,
  OUT v_outcome     text,
  OUT v_message     text,
  OUT v_created_id  uuid
) AS $$
DECLARE
  v_work_type_name text;
  v_assigned_role  text;
  v_name           text;
  v_work_type_id   uuid;
  v_assignee_id    uuid;
  v_project_id     uuid;
  v_opp_id         uuid;
  v_property_id    uuid;
  v_building_id    uuid;
  v_unit_id        uuid;
  v_status_id      uuid;
BEGIN
  v_work_type_name := p_rule.action_config ->> 'work_type';
  v_assigned_role  := p_rule.action_config ->> 'assigned_role';
  v_name           := p_rule.action_config ->> 'name';
  v_created_id     := NULL;

  IF v_work_type_name IS NULL THEN
    v_outcome := 'error';
    v_message := 'create_work_order: action_config.work_type required';
    RETURN;
  END IF;

  SELECT id INTO v_work_type_id
    FROM public.work_types
   WHERE work_type_name = v_work_type_name AND NOT work_type_is_deleted
   LIMIT 1;
  IF v_work_type_id IS NULL THEN
    v_outcome := 'error';
    v_message := format('No active work_type named "%s"', v_work_type_name);
    RETURN;
  END IF;

  IF v_assigned_role IS NOT NULL THEN
    v_assignee_id := _automation_resolve_role_user(v_assigned_role);
    IF v_assignee_id IS NULL THEN
      v_outcome := 'error';
      v_message := format('No user found with role "%s"', v_assigned_role);
      RETURN;
    END IF;
  ELSE
    v_outcome := 'error';
    v_message := 'create_work_order: action_config.assigned_role required (owner is NOT NULL)';
    RETURN;
  END IF;

  IF p_rule.trigger_object = 'opportunities' THEN
    v_opp_id := p_record_id;
    SELECT property_id, building_id INTO v_property_id, v_building_id
      FROM public.opportunities WHERE id = v_opp_id;
    SELECT id INTO v_project_id
      FROM public.projects
     WHERE opportunity_id = v_opp_id AND NOT project_is_deleted
     ORDER BY project_created_at DESC NULLS LAST
     LIMIT 1;
    IF v_project_id IS NULL THEN
      v_outcome := 'skipped';
      v_message := format(
        'No live project exists for opportunity %s yet — create the project first, then the WO rule can fire',
        v_opp_id);
      RETURN;
    END IF;
  ELSIF p_rule.trigger_object = 'projects' THEN
    v_project_id := p_record_id;
    SELECT opportunity_id, property_id, building_id
      INTO v_opp_id, v_property_id, v_building_id
      FROM public.projects WHERE id = v_project_id;
  ELSIF p_rule.trigger_object = 'work_orders' THEN
    SELECT project_id, opportunity_id, property_id, building_id, unit_id
      INTO v_project_id, v_opp_id, v_property_id, v_building_id, v_unit_id
      FROM public.work_orders WHERE id = p_record_id;
  ELSE
    v_outcome := 'error';
    v_message := format('create_work_order: unsupported trigger_object "%s"', p_rule.trigger_object);
    RETURN;
  END IF;

  SELECT id INTO v_status_id
    FROM public.picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='work_order_status'
     AND picklist_value='Work Order To Be Scheduled' AND picklist_is_active
   LIMIT 1;

  IF v_name IS NULL OR length(trim(v_name)) = 0 THEN
    v_name := v_work_type_name;
  END IF;

  INSERT INTO public.work_orders (
    work_order_record_number,
    work_order_name,
    work_order_status,
    work_type_id,
    work_order_owner,
    work_order_created_by,
    project_id, opportunity_id, property_id, building_id, unit_id,
    is_seed_data, work_order_is_deleted
  ) VALUES (
    '',
    v_name,
    v_status_id,
    v_work_type_id,
    v_assignee_id,
    v_assignee_id,
    v_project_id, v_opp_id, v_property_id, v_building_id, v_unit_id,
    false, false
  ) RETURNING id INTO v_created_id;

  v_outcome := 'success';
  v_message := format('Created work_order/%s ("%s") on project/%s', v_created_id, v_name, v_project_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dispatcher routes create_work_order to the new handler.

CREATE OR REPLACE FUNCTION public.execute_automation_rules(
  p_object text,
  p_record_id uuid,
  p_event text,
  p_status_label text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rule public.automation_rules%ROWTYPE;
  v_outcome text;
  v_message text;
  v_created_id uuid;
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM public.users WHERE auth_user_id = auth.uid();

  FOR v_rule IN
    SELECT *
      FROM public.automation_rules
     WHERE is_active = true
       AND trigger_object = p_object
       AND trigger_event = p_event
       AND (
         (p_event = 'status_change' AND p_status_label IS NOT NULL
            AND trigger_status = p_status_label)
         OR p_event <> 'status_change'
       )
     ORDER BY execution_order ASC NULLS LAST, created_at ASC
  LOOP
    BEGIN
      IF v_rule.action_type = 'send_email' THEN
        SELECT * INTO v_outcome, v_message, v_created_id
          FROM _automation_action_send_email(v_rule, p_record_id);
      ELSIF v_rule.action_type = 'create_task' THEN
        SELECT * INTO v_outcome, v_message, v_created_id
          FROM _automation_action_create_task(v_rule, p_record_id);
      ELSIF v_rule.action_type = 'update_record' THEN
        SELECT * INTO v_outcome, v_message, v_created_id
          FROM _automation_action_update_record(v_rule, p_record_id);
      ELSIF v_rule.action_type = 'create_work_order' THEN
        SELECT * INTO v_outcome, v_message, v_created_id
          FROM _automation_action_create_work_order(v_rule, p_record_id);
      ELSE
        v_outcome := 'skipped';
        v_message := format('Action type "%s" not implemented yet', v_rule.action_type);
        v_created_id := NULL;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_outcome := 'error';
      v_message := format('%s: %s', SQLSTATE, SQLERRM);
      v_created_id := NULL;
    END;

    INSERT INTO public.automation_run_log
      (arl_record_number, arl_rule_id, arl_rule_name,
       arl_trigger_object, arl_trigger_record_id, arl_trigger_event, arl_trigger_status,
       arl_action_type, arl_outcome, arl_outcome_message, arl_created_target_id, arl_fired_by)
    VALUES
      ('', v_rule.id, v_rule.name,
       p_object, p_record_id, p_event, p_status_label,
       v_rule.action_type, v_outcome, v_message, v_created_id, v_user_id);
  END LOOP;
END;
$$;
