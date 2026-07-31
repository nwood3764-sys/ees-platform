-- ============================================================================================
-- Quality Install Verification — data-driven work-step CATEGORY
-- --------------------------------------------------------------------------------------------
-- The Quality Install Verification photo package (ZIP + PDF) groups photos "per category, per
-- work step" — Attic Air Sealing vs Attic Insulation. That category currently exists only as a
-- prose prefix inside each step's description, which is not a reliable grouping key. This adds a
-- first-class `category` field to work step templates + work steps, backfills the 12 Quality
-- Install Verification steps from their description prefix, and teaches instantiate_work_plan to
-- carry the template category onto each instantiated step. Additive and nullable — every other
-- work plan is unaffected (category stays NULL and the package falls back to ungrouped).
-- ============================================================================================

-- 1. Columns ---------------------------------------------------------------------------------
ALTER TABLE public.work_step_templates
  ADD COLUMN IF NOT EXISTS wst_category text;
COMMENT ON COLUMN public.work_step_templates.wst_category IS
  'Optional grouping label for a step within a work plan (e.g. "Attic Air Sealing"). Copied onto each work step at instantiation; used to group evidence photos in exports.';

ALTER TABLE public.work_steps
  ADD COLUMN IF NOT EXISTS work_step_category text;
COMMENT ON COLUMN public.work_steps.work_step_category IS
  'Grouping label carried from the step template (wst_category). Groups evidence photos "per category, per work step" in the Quality Install photo package.';

-- 2. Backfill the Quality Install Verification templates from their description prefix ---------
--    Scoped to exactly this plan's steps (via the plan template entries), so no other plan's
--    templates are touched. The prefix is the authoritative category text the steps were seeded
--    with in migration 20260730233827.
UPDATE public.work_step_templates wst
   SET wst_category = CASE
         WHEN wst.wst_description LIKE 'Attic Air Sealing%' THEN 'Attic Air Sealing'
         WHEN wst.wst_description LIKE 'Attic Insulation%'  THEN 'Attic Insulation'
       END
  FROM public.work_plan_template_entries e
  JOIN public.work_plan_templates wpt ON wpt.id = e.work_plan_template_id
 WHERE e.work_step_template_id = wst.id
   AND wpt.wpt_name = 'Attic Quality Install Verification - HOMES & HEAR'
   AND wst.wst_category IS NULL
   AND (wst.wst_description LIKE 'Attic Air Sealing%' OR wst.wst_description LIKE 'Attic Insulation%');

-- 3. Backfill any already-instantiated work steps from their template category -----------------
UPDATE public.work_steps ws
   SET work_step_category = wst.wst_category
  FROM public.work_step_templates wst
 WHERE ws.work_step_template_id = wst.id
   AND ws.work_step_category IS NULL
   AND wst.wst_category IS NOT NULL;

-- 4. Teach instantiate_work_plan to copy the category template → step -------------------------
--    Full body re-issued from 20260730233827 with work_step_category added to the INSERT/SELECT;
--    everything else is byte-identical. Signature unchanged, so existing grants are preserved
--    (re-issued below belt-and-suspenders).
CREATE OR REPLACE FUNCTION public.instantiate_work_plan(p_work_order_id uuid)
 RETURNS TABLE(work_plan_id uuid, step_count integer, outcome text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor       uuid := public.current_app_user_id();
  v_wo          public.work_orders;
  v_wpt_id      uuid;
  v_wpt_name    text;
  v_owner       uuid;
  v_new_plan_id uuid;
  v_status_new  uuid;
  v_count       integer := 0;
BEGIN
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_work_order_id AND work_order_is_deleted IS NOT TRUE;
  IF v_wo.id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 0, 'error', format('Work order %s not found or deleted', p_work_order_id);
    RETURN;
  END IF;

  -- Actor: prefer the session app-user; fall back to the work order's owner/creator
  -- so the function never writes a NULL audit actor regardless of how it is invoked.
  v_actor := COALESCE(v_actor, v_wo.work_order_owner, v_wo.work_order_created_by);
  v_owner := COALESCE(v_wo.work_order_owner, v_actor);

  SELECT wp.id INTO v_new_plan_id
    FROM public.work_plans wp
   WHERE wp.work_order_id = p_work_order_id AND wp.work_plan_is_deleted IS NOT TRUE
   LIMIT 1;
  IF v_new_plan_id IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.work_steps ws WHERE ws.work_plan_id = v_new_plan_id AND ws.work_step_is_deleted IS NOT TRUE;
    RETURN QUERY SELECT v_new_plan_id, v_count, 'exists', 'Work plan already instantiated for this work order';
    RETURN;
  END IF;

  SELECT wt.work_type_default_work_plan_template_id INTO v_wpt_id
    FROM public.work_types wt WHERE wt.id = v_wo.work_type_id;
  IF v_wpt_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 0, 'error',
      'Work type has no default work plan template — set work_type_default_work_plan_template_id first';
    RETURN;
  END IF;

  SELECT wpt.wpt_name INTO v_wpt_name FROM public.work_plan_templates wpt WHERE wpt.id = v_wpt_id AND wpt.wpt_is_deleted IS NOT TRUE;
  IF v_wpt_name IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 0, 'error', 'Default work plan template is missing or deleted';
    RETURN;
  END IF;

  SELECT id INTO v_status_new FROM public.picklist_values
   WHERE picklist_object='work_steps' AND picklist_field='work_step_status' AND picklist_value='New' AND picklist_is_active LIMIT 1;

  INSERT INTO public.work_plans (
    work_plan_record_number, work_plan_name, work_plan_owner, work_plan_created_by,
    work_order_id, work_plan_template_id, work_plan_description, work_plan_execution_order,
    is_seed_data, work_plan_is_deleted
  ) VALUES (
    '', v_wpt_name, v_owner, v_actor,
    p_work_order_id, v_wpt_id,
    (SELECT wpt_description FROM public.work_plan_templates WHERE id = v_wpt_id),
    1, false, false
  ) RETURNING id INTO v_new_plan_id;

  INSERT INTO public.work_steps (
    work_step_record_number, work_step_name, work_step_owner, work_step_created_by,
    work_plan_id, work_order_id, work_step_template_id,
    work_step_status, work_step_execution_order, work_step_plan_execution_order,
    work_step_description, work_step_action_type, work_step_action_definition,
    work_step_reference_photo_url,
    work_step_required_evidence_type_id, work_step_photos_required_count,
    work_step_photos_required_from_sampling,
    work_step_category,
    work_step_photo_before_required, work_step_photo_after_required,
    work_step_estimated_duration_minutes,
    work_step_assigned_owner_role_id, work_step_verifier_role_id,
    is_seed_data, work_step_is_deleted
  )
  SELECT
    '', wst.wst_name, v_owner, v_actor,
    v_new_plan_id, p_work_order_id, wst.id,
    v_status_new, e.wpte_execution_order, e.wpte_execution_order,
    wst.wst_description, wst.wst_action_type, wst.wst_action_definition,
    wst.wst_reference_photo_url,
    wst.wst_required_evidence_type_id, COALESCE(wst.wst_photos_required_count, 0),
    COALESCE(wst.wst_photos_required_from_sampling, false),
    wst.wst_category,
    COALESCE(wst.wst_photo_before_required, false), COALESCE(wst.wst_photo_after_required, false),
    wst.wst_estimated_duration_minutes,
    wst.wst_assigned_owner_role_id, wst.wst_verifier_role_id,
    false, false
  FROM public.work_plan_template_entries e
  JOIN public.work_step_templates wst ON wst.id = e.work_step_template_id AND wst.wst_is_deleted IS NOT TRUE
  WHERE e.work_plan_template_id = v_wpt_id AND e.wpte_is_deleted IS NOT TRUE
  ORDER BY e.wpte_execution_order;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN QUERY SELECT v_new_plan_id, v_count, 'success',
    format('Instantiated work plan "%s" with %s steps on work order %s', v_wpt_name, v_count, v_wo.work_order_record_number);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.instantiate_work_plan(p_work_order_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.instantiate_work_plan(p_work_order_id uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.instantiate_work_plan(p_work_order_id uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
