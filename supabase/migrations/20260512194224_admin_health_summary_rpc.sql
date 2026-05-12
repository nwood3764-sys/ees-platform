-- ============================================================================
-- 20260512194224 admin_health_summary_rpc
--
-- Aggregates a handful of system-state counts into a single round-trip
-- for the Admin Setup welcome pane's new System Health strip. Returns
-- a jsonb blob with:
--   audit_24h, recycle_bin_total, active_users, permission_sets,
--   last_dispatch, dispatch_errors_24h, generated_at
--
-- SECURITY DEFINER + auth-gated. Returns aggregates only, no
-- record-level data — safe for any authenticated user to read.
--
-- The recycle_bin_total scans the same curated list of business
-- tables the Recycle Bin's UI dropdown exposes (20 tables). Each
-- sub-query hits a single index on the is_deleted column; the
-- aggregate cost is bounded and predictable.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_health_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  v_recycle_total := COALESCE((
    SELECT sum(c) FROM (
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
      SELECT count(*)      FROM public.work_types              WHERE work_type_is_deleted UNION ALL
      SELECT count(*)      FROM public.programs                WHERE is_deleted UNION ALL
      SELECT count(*)      FROM public.reports                 WHERE is_deleted UNION ALL
      SELECT count(*)      FROM public.dashboards              WHERE is_deleted UNION ALL
      SELECT count(*)      FROM public.scheduled_reports       WHERE is_deleted UNION ALL
      SELECT count(*)      FROM public.permission_sets         WHERE ps_is_deleted
    ) s
  ), 0)::integer;

  SELECT count(*) INTO v_active_users FROM public.users WHERE NOT user_is_deleted;
  SELECT count(*) INTO v_perm_sets    FROM public.permission_sets
    WHERE NOT ps_is_deleted AND ps_is_active;

  SELECT max(srr_started_at) INTO v_last_dispatch FROM public.scheduled_report_runs;
  SELECT count(*) INTO v_dispatch_errs FROM public.scheduled_report_runs
    WHERE srr_started_at > now() - interval '24 hours' AND srr_status = 'error';

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
$$;

GRANT EXECUTE ON FUNCTION public.admin_health_summary() TO authenticated;

COMMENT ON FUNCTION public.admin_health_summary() IS
  'Returns a jsonb blob of system-state counts for the Admin welcome pane. Auth-gated. Aggregates only, no record-level data.';
