-- seed_purge_tenant_data() — admin-only RPC that wipes every row currently
-- flagged is_seed_data=true across all tenant-data tables.
--
-- Mechanics: inside one transaction we SET CONSTRAINTS ALL DEFERRED so the
-- FK graph doesn't fight us on ordering. Then we DELETE FROM each table
-- WHERE is_seed_data=true. Postgres re-checks constraints at COMMIT — if any
-- production row references a seed parent (which shouldn't happen if the
-- flag is being maintained correctly), the transaction rolls back atomically
-- and nothing is lost.
--
-- Returns a JSONB of {table_name: deleted_count}. Two-phase invocation:
-- first call with confirm_token=NULL returns a dry-run count without deleting;
-- second call with the literal token 'PURGE_ALL_SEED_DATA' actually deletes.
-- This stops a misclick or stray RPC call from wiping anything.
--
-- SECURITY: marked SECURITY DEFINER and only callable by users with the
-- 'Admin' role (checked against public.roles.role_name). Non-admin callers
-- get an exception.

CREATE OR REPLACE FUNCTION public.seed_purge_tenant_data(confirm_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_caller_user_id uuid;
  v_caller_role    text;
  v_table          text;
  v_count          bigint;
  v_dry_run        boolean := (confirm_token IS NULL OR confirm_token <> 'PURGE_ALL_SEED_DATA');
  v_result         jsonb := '{}'::jsonb;
  v_total          bigint := 0;
  v_tenant_tables  text[] := ARRAY[
    -- Order does not strictly matter because we defer constraints, but we
    -- still list children before parents as a defense-in-depth measure.
    'message_ai_transcripts','message_attachments',
    'unmatched_inbox','messages','conversations',
    'envelope_events','envelope_tabs','envelope_recipients','envelopes','email_sends',
    'occurrence_participants','occurrences',
    'notification_logs','notifications',
    'comments','tasks','activities',
    'chat_messages','chat_threads',
    'gps_points','vehicle_activities','equipment_activities','asset_assignments',
    'time_sheet_entries','time_sheets',
    'job_kit_line_items','job_kits',
    'materials_request_line_items','materials_requests',
    'product_transfers','product_items',
    'work_steps','work_plans',
    'service_appointment_assignments','service_appointment_tokens','service_appointments',
    'dispatcher_followup_requests',
    'work_orders',
    'diagnostic_tests','efr_reports','assessments',
    'payment_receipts','project_payment_requests','project_reservations',
    'incentives','incentive_applications',
    'income_qualifications',
    'cfp_scenarios','cfp_projects',
    'mechanical_equipment','equipment_information',
    'opportunity_line_items','opportunity_contact_roles','opportunities',
    'property_programs','property_distances','units','buildings','properties',
    'projects',
    'documents','photos','status_change_events',
    'account_contact_relations','contacts','portal_users','accounts'
  ];
BEGIN
  SELECT u.id INTO v_caller_user_id
    FROM public.users u
   WHERE u.auth_user_id = auth.uid()
   LIMIT 1;

  IF v_caller_user_id IS NULL THEN
    RAISE EXCEPTION 'seed_purge_tenant_data: caller has no public.users record (auth.uid()=%)', auth.uid();
  END IF;

  SELECT r.role_name INTO v_caller_role
    FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
   WHERE u.id = v_caller_user_id;

  IF v_caller_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'seed_purge_tenant_data: only Admin users can execute (caller role: %)', coalesce(v_caller_role, 'unknown');
  END IF;

  IF NOT v_dry_run THEN
    SET CONSTRAINTS ALL DEFERRED;
  END IF;

  FOREACH v_table IN ARRAY v_tenant_tables LOOP
    IF v_dry_run THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE is_seed_data', v_table) INTO v_count;
    ELSE
      EXECUTE format('WITH d AS (DELETE FROM public.%I WHERE is_seed_data RETURNING 1) SELECT count(*) FROM d', v_table) INTO v_count;
    END IF;
    v_result := v_result || jsonb_build_object(v_table, v_count);
    v_total  := v_total + v_count;
  END LOOP;

  RETURN jsonb_build_object(
    'mode',          CASE WHEN v_dry_run THEN 'dry_run' ELSE 'purged' END,
    'total_rows',    v_total,
    'per_table',     v_result,
    'caller_user',   v_caller_user_id,
    'executed_at',   now()
  );
END
$function$;

REVOKE ALL ON FUNCTION public.seed_purge_tenant_data(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_purge_tenant_data(text) TO authenticated;

COMMENT ON FUNCTION public.seed_purge_tenant_data(text) IS
  'Admin-only purge of every row in tenant-data tables where is_seed_data=true. Call with confirm_token=NULL for a dry-run row-count. Call with confirm_token=''PURGE_ALL_SEED_DATA'' to actually delete. System config (picklists, templates, layouts, roles, etc.) is never touched. SECURITY DEFINER + role check.';
