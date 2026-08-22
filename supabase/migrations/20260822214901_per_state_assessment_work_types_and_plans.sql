-- Per-state work types and work plans for the IRA assessment programs.
--
-- Nicholas, 2026-08-22: "if you don't have the work orders or you don't have the
-- record types and work types, create them just like what we're doing in
-- Wisconsin for all the steps. And the work plans."
--
-- Wisconsin's two assessment work types already exist -- WT-00074 Multifamily
-- Energy Assessment (plan WPT-00020, 15 steps / 99 fields) and WT-00072
-- Single-Family Energy Assessment (plan WPT-00018, 17 steps / 145 fields). This
-- gives North Carolina and Michigan their own copies of both, so a state can
-- change its step list without touching anyone else's.
--
-- Work step templates are already never shared between plans anywhere in LEAP
-- (verified: zero work_step_templates rows belong to more than one plan), so a
-- faithful copy has to duplicate the steps and their fields too -- not just
-- re-point new plan entries at Wisconsin's steps. That is what
-- clone_work_plan_template() does, and it is written as a general facility
-- because Michigan is not the last state.
--
-- Deliberately NOT duplicated: the work_orders and projects record types
-- MULTIFAMILY-ENERGY-ASSESSMENT / SINGLE-FAMILY-ENERGY-ASSESSMENT. Nicholas,
-- same day: "The multi-family energy assessment and single-family energy
-- assessment are something totally different." Those describe the KIND OF WORK,
-- not the program, so they are not on the state axis and every state's work type
-- points at the same pair.

-- ---------------------------------------------------------------------------
-- 1. clone_work_plan_template — deep copy of a plan and everything under it.
--
--    plan -> work_plan_template_entries -> NEW work_step_templates -> their
--    work_step_template_fields. Execution order, evidence gates, owner/verifier
--    roles, photo counts and the any-order flag all carry over. Record-number
--    columns are passed '' so each table's trigger fills them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clone_work_plan_template(
  p_source_template_id uuid,
  p_new_name           text,
  p_actor              uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE
  v_src      public.work_plan_templates%ROWTYPE;
  v_new_id   uuid;
  v_actor    uuid;
  v_entry    record;
  v_new_step uuid;
BEGIN
  SELECT * INTO v_src
    FROM public.work_plan_templates
   WHERE id = p_source_template_id AND wpt_is_deleted IS NOT TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clone_work_plan_template: source template % not found or deleted', p_source_template_id;
  END IF;

  v_actor := COALESCE(p_actor, public.current_app_user_id(), v_src.wpt_owner, v_src.wpt_created_by);

  INSERT INTO public.work_plan_templates (
    wpt_record_number, wpt_name, wpt_owner, wpt_created_by, wpt_description,
    wpt_is_active, wpt_relative_execution_order, wpt_record_type, wpt_allow_any_order
  ) VALUES (
    '', p_new_name, v_actor, v_actor, v_src.wpt_description,
    v_src.wpt_is_active, v_src.wpt_relative_execution_order, v_src.wpt_record_type,
    v_src.wpt_allow_any_order
  ) RETURNING id INTO v_new_id;

  FOR v_entry IN
    SELECT e.wpte_name, e.wpte_execution_order, s.*
      FROM public.work_plan_template_entries e
      JOIN public.work_step_templates s ON s.id = e.work_step_template_id
     WHERE e.work_plan_template_id = p_source_template_id
       AND e.wpte_is_deleted IS NOT TRUE
       AND s.wst_is_deleted IS NOT TRUE
     ORDER BY e.wpte_execution_order
  LOOP
    INSERT INTO public.work_step_templates (
      wst_record_number, wst_name, wst_owner, wst_created_by, wst_description,
      wst_action_type, wst_action_definition, wst_is_active, wst_reference_photo_url,
      wst_estimated_duration_minutes, wst_assigned_owner_role_id, wst_verifier_role_id,
      wst_required_evidence_type_id, wst_photos_required_count,
      wst_photo_before_required, wst_photo_after_required, wst_record_type,
      wst_completion_notifies_project_coordinator, wst_is_screen_flow,
      wst_photos_required_from_sampling, wst_category
    ) VALUES (
      '', v_entry.wst_name, v_actor, v_actor, v_entry.wst_description,
      v_entry.wst_action_type, v_entry.wst_action_definition, v_entry.wst_is_active,
      v_entry.wst_reference_photo_url, v_entry.wst_estimated_duration_minutes,
      v_entry.wst_assigned_owner_role_id, v_entry.wst_verifier_role_id,
      v_entry.wst_required_evidence_type_id, v_entry.wst_photos_required_count,
      v_entry.wst_photo_before_required, v_entry.wst_photo_after_required,
      v_entry.wst_record_type, v_entry.wst_completion_notifies_project_coordinator,
      v_entry.wst_is_screen_flow, v_entry.wst_photos_required_from_sampling,
      v_entry.wst_category
    ) RETURNING id INTO v_new_step;

    INSERT INTO public.work_step_template_fields (
      wstf_record_number, wstf_owner, wstf_created_by, work_step_template_id,
      wstf_field_label, wstf_field_name, wstf_field_type, wstf_is_required,
      wstf_unit, wstf_sort_order, wstf_is_active, wstf_help_text,
      wstf_illustration_url, wstf_is_calculated, wstf_calc_expression,
      wstf_allow_not_present
    )
    SELECT
      '', v_actor, v_actor, v_new_step,
      f.wstf_field_label, f.wstf_field_name, f.wstf_field_type, f.wstf_is_required,
      f.wstf_unit, f.wstf_sort_order, f.wstf_is_active, f.wstf_help_text,
      f.wstf_illustration_url, f.wstf_is_calculated, f.wstf_calc_expression,
      f.wstf_allow_not_present
    FROM public.work_step_template_fields f
    WHERE f.work_step_template_id = v_entry.id
      AND f.wstf_is_deleted IS NOT TRUE;

    INSERT INTO public.work_plan_template_entries (
      wpte_record_number, wpte_name, wpte_created_by,
      work_plan_template_id, work_step_template_id, wpte_execution_order
    ) VALUES (
      '', v_entry.wpte_name, v_actor,
      v_new_id, v_new_step, v_entry.wpte_execution_order
    );
  END LOOP;

  RETURN v_new_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.clone_work_plan_template(uuid, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.clone_work_plan_template(uuid, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. One work type + one cloned plan per state program.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_actor    uuid;
  v_spec     record;
  v_src_wt   public.work_types%ROWTYPE;
  v_new_plan uuid;
  v_new_wt   uuid;
  v_made     integer := 0;
BEGIN
  SELECT id INTO v_actor FROM public.users WHERE user_email = 'nicholas.wood@ees-wi.org' LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Owner user not found — refusing to seed work types without an owner.';
  END IF;

  FOR v_spec IN
    SELECT * FROM (VALUES
      ('NC-IRA-MF-HOMES-AUDIT', 'Multifamily Energy Assessment'),
      ('NC-IRA-SF-HOMES-AUDIT', 'Single-Family Energy Assessment'),
      ('MI-IRA-MF-HOMES-AUDIT', 'Multifamily Energy Assessment'),
      ('MI-IRA-SF-HOMES-AUDIT', 'Single-Family Energy Assessment')
    ) AS t(program, source_work_type)
  LOOP
    -- Already built? (idempotent re-run)
    IF EXISTS (
      SELECT 1 FROM public.work_types
       WHERE work_type_name = v_spec.program || ' Energy Assessment'
         AND work_type_is_deleted IS NOT TRUE
    ) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_src_wt
      FROM public.work_types
     WHERE work_type_name = v_spec.source_work_type
       AND work_type_is_deleted IS NOT TRUE
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Source work type "%" not found.', v_spec.source_work_type;
    END IF;
    IF v_src_wt.work_type_default_work_plan_template_id IS NULL THEN
      RAISE EXCEPTION 'Source work type "%" has no default work plan template.', v_spec.source_work_type;
    END IF;

    v_new_plan := public.clone_work_plan_template(
      v_src_wt.work_type_default_work_plan_template_id,
      v_spec.program || ' Energy Assessment - Standard',
      v_actor
    );

    INSERT INTO public.work_types (
      work_type_record_number, work_type_name, work_type_record_type,
      work_type_owner, work_type_created_by, work_type_description,
      work_type_is_active, work_type_estimated_duration, work_type_duration_minutes,
      work_type_duration_type, work_type_minimum_crew_size, work_type_recommended_crew_size,
      work_type_auto_create_service_appt, work_type_default_work_plan_template_id,
      work_type_is_publicly_schedulable, work_type_customer_facing_description,
      work_type_duration_per_unit_minutes, work_type_unit_count_intake_field,
      work_type_default_project_record_type, work_type_post_buffer_minutes,
      work_type_is_technician_creatable, work_type_default_work_order_record_type,
      work_type_is_daily_building_access, work_type_customer_facing_name
    ) VALUES (
      '', v_spec.program || ' Energy Assessment', v_src_wt.work_type_record_type,
      v_actor, v_actor,
      'Energy assessment for the ' || v_spec.program || ' program. Cloned from "'
        || v_spec.source_work_type || '" on 2026-08-22; this state''s steps are its own.',
      true, v_src_wt.work_type_estimated_duration, v_src_wt.work_type_duration_minutes,
      v_src_wt.work_type_duration_type, v_src_wt.work_type_minimum_crew_size,
      v_src_wt.work_type_recommended_crew_size, v_src_wt.work_type_auto_create_service_appt,
      v_new_plan,
      v_src_wt.work_type_is_publicly_schedulable, v_src_wt.work_type_customer_facing_description,
      v_src_wt.work_type_duration_per_unit_minutes, v_src_wt.work_type_unit_count_intake_field,
      v_src_wt.work_type_default_project_record_type, v_src_wt.work_type_post_buffer_minutes,
      v_src_wt.work_type_is_technician_creatable, v_src_wt.work_type_default_work_order_record_type,
      v_src_wt.work_type_is_daily_building_access, v_src_wt.work_type_customer_facing_name
    ) RETURNING id INTO v_new_wt;

    v_made := v_made + 1;
  END LOOP;

  RAISE NOTICE 'Created % state work type(s) with cloned plans.', v_made;
END $do$;

NOTIFY pgrst, 'reload schema';
