-- ============================================================================
-- Service Provider onboarding pipeline — expanded application stages
-- ----------------------------------------------------------------------------
-- Turns the two-state "Submitted → Approved/Declined" flow into a real
-- onboarding pipeline: Submitted → Under Review → Information Requested →
-- Interview → Onboarding → Training → Approved → (portal invite) / Declined.
-- Plus a stage-advance RPC used by the Service Providers review dashboard.
-- ============================================================================

-- New pipeline stages
INSERT INTO public.picklist_values (id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order)
SELECT gen_random_uuid(), 'service_provider_applications', 'stage', v.val, v.val, true, v.ord
FROM (VALUES
  ('Application Interview',   40),
  ('Application Onboarding',  50),
  ('Application Training',    60)
) AS v(val, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
  WHERE p.picklist_object='service_provider_applications' AND p.picklist_field='stage' AND p.picklist_value=v.val
);

-- Re-sequence the terminal stages after the new ones
UPDATE public.picklist_values SET picklist_sort_order = 70
 WHERE picklist_object='service_provider_applications' AND picklist_field='stage' AND picklist_value='Application Approved';
UPDATE public.picklist_values SET picklist_sort_order = 80
 WHERE picklist_object='service_provider_applications' AND picklist_field='stage' AND picklist_value='Application Declined';

-- ----------------------------------------------------------------------------
-- advance_service_provider_application(app, stage_value, note)
--   Move an application to any pipeline stage; optional note recorded on the
--   application. Terminal Approve (with portal invite) stays its own RPC.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.advance_service_provider_application(
  p_application_id uuid, p_stage_value text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE v_caller uuid; v_stage uuid; v_acct uuid;
BEGIN
  IF NOT public.app_user_can('service_provider_applications','update') THEN
    RAISE EXCEPTION 'Not authorized to update service provider applications' USING errcode='42501';
  END IF;
  v_caller := public.current_app_user_id();

  SELECT id INTO v_stage FROM picklist_values
   WHERE picklist_object='service_provider_applications' AND picklist_field='stage' AND picklist_value=p_stage_value;
  IF v_stage IS NULL THEN RETURN jsonb_build_object('error','unknown_stage'); END IF;

  SELECT spa_account_id INTO v_acct FROM service_provider_applications
   WHERE id = p_application_id AND spa_is_deleted IS NOT TRUE;
  IF v_acct IS NULL THEN RETURN jsonb_build_object('error','application_not_found'); END IF;

  UPDATE service_provider_applications
     SET spa_stage = v_stage,
         spa_reviewer_user_id = v_caller,
         spa_reviewed_at = now(),
         spa_decision_notes = COALESCE(NULLIF(trim(p_note),''), spa_decision_notes),
         spa_updated_by = v_caller,
         spa_updated_at = now()
   WHERE id = p_application_id;

  RETURN jsonb_build_object('ok', true, 'stage', p_stage_value);
END $$;

REVOKE ALL ON FUNCTION public.advance_service_provider_application(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_service_provider_application(uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
