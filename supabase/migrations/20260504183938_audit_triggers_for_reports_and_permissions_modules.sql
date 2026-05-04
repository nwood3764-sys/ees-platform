-- ============================================================================
-- 20260504183938 audit_triggers_for_reports_and_permissions_modules
--
-- Attach the existing log_audit_and_field_history() trigger to the Reports
-- module + Permission Builder tables that didn't have it. The data-standards
-- spec (anura-data-standards.md) calls out audit-logging for permission
-- changes and bulk record changes; this brings 11 previously-untracked
-- tables into compliance.
--
-- Tables added:
--   • reports, report_filters, report_groupings, report_calculated_fields
--   • dashboards, dashboard_widgets, dashboard_filters
--   • scheduled_reports
--   • permission_sets, permission_set_object_access,
--     permission_set_field_permissions
--
-- scheduled_report_runs deliberately skipped — it IS the audit table for
-- the dispatcher, so triggering audit_log on it would double-log.
--
-- Side-effect: the four clone_* RPCs added in commits 7a7189a, b2549fc,
-- 41d3c0a, a64932b now produce audit rows automatically (one for the
-- parent INSERT plus one per child INSERT). Useful for tracing exactly
-- which child rows a clone propagated.
-- ============================================================================

CREATE TRIGGER trg_audit_reports
  AFTER INSERT OR UPDATE OR DELETE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_report_filters
  AFTER INSERT OR UPDATE OR DELETE ON public.report_filters
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_report_groupings
  AFTER INSERT OR UPDATE OR DELETE ON public.report_groupings
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_report_calculated_fields
  AFTER INSERT OR UPDATE OR DELETE ON public.report_calculated_fields
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_dashboards
  AFTER INSERT OR UPDATE OR DELETE ON public.dashboards
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_dashboard_widgets
  AFTER INSERT OR UPDATE OR DELETE ON public.dashboard_widgets
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_dashboard_filters
  AFTER INSERT OR UPDATE OR DELETE ON public.dashboard_filters
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_scheduled_reports
  AFTER INSERT OR UPDATE OR DELETE ON public.scheduled_reports
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_permission_sets
  AFTER INSERT OR UPDATE OR DELETE ON public.permission_sets
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_permission_set_object_access
  AFTER INSERT OR UPDATE OR DELETE ON public.permission_set_object_access
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_permission_set_field_permissions
  AFTER INSERT OR UPDATE OR DELETE ON public.permission_set_field_permissions
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();
