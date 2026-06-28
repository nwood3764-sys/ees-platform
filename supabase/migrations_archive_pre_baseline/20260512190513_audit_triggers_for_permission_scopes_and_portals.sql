-- ============================================================================
-- 20260512190513 audit_triggers_for_permission_scopes_and_portals
--
-- High-value audit triggers: permission/scope grants + portals. Follow-up to
-- 20260504183938 which covered the Reports module + Permission Builder
-- definition tables. This commit closes the remaining gap on the tables
-- that actually grant authority to specific users or define portals:
--
--   • role_object_access       — role-baseline grants (what a role CAN do)
--   • user_permission_sets     — user↔permission_set junction
--   • user_account_scopes      — per-user account row-visibility scoping
--   • user_program_scopes      — per-user program row-visibility scoping
--   • portal_role_assignments  — external portal user → portal role
--   • portals                  — portal definitions
--
-- All six pick up INSERT / UPDATE / DELETE / soft-delete-detect /
-- field-level history through the existing log_audit_and_field_history
-- function — same pattern as the previous audit-trigger commit.
-- ============================================================================

CREATE TRIGGER trg_audit_role_object_access
  AFTER INSERT OR UPDATE OR DELETE ON public.role_object_access
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_user_permission_sets
  AFTER INSERT OR UPDATE OR DELETE ON public.user_permission_sets
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_user_account_scopes
  AFTER INSERT OR UPDATE OR DELETE ON public.user_account_scopes
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_user_program_scopes
  AFTER INSERT OR UPDATE OR DELETE ON public.user_program_scopes
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_portal_role_assignments
  AFTER INSERT OR UPDATE OR DELETE ON public.portal_role_assignments
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_portals
  AFTER INSERT OR UPDATE OR DELETE ON public.portals
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();
