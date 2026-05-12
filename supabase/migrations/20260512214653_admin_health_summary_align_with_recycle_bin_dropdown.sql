-- ============================================================================
-- 20260512214653 admin_health_summary_align_with_recycle_bin_dropdown
--
-- The Setup Home 'In Recycle Bin' card derives from
-- admin_health_summary's recycle_bin_total. That total was summing
-- across 20 tables, but RecycleBinPane's RECYCLE_BIN_TABLES dropdown
-- shows 29. The 9-table gap meant admins could see 'In Recycle Bin: 5'
-- on the home pane and then find 14 deleted records in the bin
-- itself — the home stat broke its implicit promise of being the
-- bin's total.
--
-- This migration adds the missing 9 tables to the UNION ALL:
--
--   work_plan_templates       wpt_is_deleted
--   work_step_templates       wst_is_deleted
--   price_books               price_book_is_deleted
--   products                  product_is_deleted
--   document_templates        is_deleted
--   email_templates           is_deleted
--   project_report_templates  prt_is_deleted
--   vehicles                  vehicle_is_deleted
--   equipment                 equipment_is_deleted
--   job_kits                  is_deleted
--
-- Other body fields (audit_24h, active_users, permission_sets,
-- last_dispatch, dispatch_errors_24h, generated_at) are unchanged.
-- Function attributes (STABLE SECURITY DEFINER, search_path public,
-- auth gate via current_app_user_id) are unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_health_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller          uuid := public.current_app_user_id();
  v_audit_24h       integer;
  v_recycle_total   integer;
  v_active_users    integer;
  v_perm_sets       integer;
  v_last_dispatch   timestamptz;
  v_dispatch_errs   integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'admin_health_summary: must be authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_audit_24h FROM public.audit_log
  WHERE al_performed_at > now() - interval '24 hours';

  -- Curated recycle-bin total: matches RECYCLE_BIN_TABLES in
  -- src/modules/admin/SetupHome.jsx (29 tables).
  v_recycle_total := COALESCE((
    SELECT sum(c) FROM (
      -- Primary business objects
      SELECT count(*) AS c FROM public.projects                WHERE project_is_deleted UNION ALL
      SELECT count(*)      FROM public.opportunities           WHERE opportunity_is_deleted UNION ALL
      SELECT count(*)      FROM public.work_orders             WHERE work_order_is_deleted UNION ALL
      SELECT count(*)      FROM public.properties              WHERE property_is_deleted UNION ALL
      SELECT count(*)      FROM public.buildings               WHERE building_is_deleted UNION ALL
      SELECT count(*)      FROM public.units                   WHERE unit_is_deleted UNION ALL
      SELECT count(*)      FROM public.accounts                WHERE account_is_deleted UNION ALL
      SELECT count(*)      FROM public.contacts                WHERE contact_is_deleted UNION ALL
      SELECT count(*)      FROM public.assessments             WHERE assessment_is_deleted UNION ALL
      SELECT count(*)      FROM public.incentive_applications  WHERE ia_is_deleted UNION ALL
      SELECT count(*)      FROM public.incentives              WHERE incentive_is_deleted UNION ALL
      SELECT count(*)      FROM public.project_payment_requests WHERE is_deleted UNION ALL
      SELECT count(*)      FROM public.payment_receipts        WHERE is_deleted UNION ALL
      SELECT count(*)      FROM public.documents               WHERE is_deleted UNION ALL
      -- Configuration / builder objects
      SELECT count(*)      FROM public.work_types              WHERE work_type_is_deleted UNION ALL
      SELECT count(*)      FROM public.work_plan_templates     WHERE wpt_is_deleted UNION ALL
      SELECT count(*)      FROM public.work_step_templates     WHERE wst_is_deleted UNION ALL
      SELECT count(*)      FROM public.programs                WHERE is_deleted UNION ALL
      SELECT count(*)      FROM public.price_books             WHERE price_book_is_deleted UNION ALL
      SELECT count(*)      FROM public.products                WHERE product_is_deleted UNION ALL
      SELECT count(*)      FROM public.document_templates      WHERE is_deleted UNION ALL
      SELECT count(*)      FROM public.email_templates         WHERE is_deleted UNION ALL
      SELECT count(*)      FROM public.project_report_templates WHERE prt_is_deleted UNION ALL
      -- Reports module
      SELECT count(*)      FROM public.reports                 WHERE is_deleted UNION ALL
      SELECT count(*)      FROM public.dashboards              WHERE is_deleted UNION ALL
      SELECT count(*)      FROM public.scheduled_reports       WHERE is_deleted UNION ALL
      -- Permission Builder
      SELECT count(*)      FROM public.permission_sets         WHERE ps_is_deleted UNION ALL
      -- Field operations
      SELECT count(*)      FROM public.vehicles                WHERE vehicle_is_deleted UNION ALL
      SELECT count(*)      FROM public.equipment               WHERE equipment_is_deleted UNION ALL
      SELECT count(*)      FROM public.job_kits                WHERE is_deleted
    ) s
  ), 0)::integer;

  SELECT count(*) INTO v_active_users FROM public.users WHERE NOT user_is_deleted;
  SELECT count(*) INTO v_perm_sets    FROM public.permission_sets
    WHERE NOT ps_is_deleted AND ps_is_active;

  SELECT max(srr_started_at) INTO v_last_dispatch
    FROM public.scheduled_report_runs;
  SELECT count(*) INTO v_dispatch_errs FROM public.scheduled_report_runs
    WHERE srr_started_at > now() - interval '24 hours'
      AND srr_status = 'error';

  RETURN jsonb_build_object(
    'audit_24h',           v_audit_24h,
    'recycle_bin_total',   v_recycle_total,
    'active_users',        v_active_users,
    'permission_sets',     v_perm_sets,
    'last_dispatch',       v_last_dispatch,
    'dispatch_errors_24h', v_dispatch_errs,
    'generated_at',        now()
  );
END;
$function$;
