-- ============================================================================
-- 20260512200105 audit_triggers_for_folders_shares_and_help
--
-- Final pass on the unaudited-tables scan. After commit 05a903b
-- (envelope family) the remaining unaudited tables with id columns
-- were the folder + folder-share + help-article + object_chat_enabled
-- group. This commit attaches log_audit_and_field_history to all of them.
--
-- Tables added (9):
--   • report_folders, dashboard_folders
--   • report_folder_role_shares, report_folder_user_shares,
--     dashboard_folder_role_shares, dashboard_folder_user_shares
--   • help_articles, help_article_anchors
--   • object_chat_enabled
--
-- Folder shares are grants — each row gives a role or user access to a
-- folder. Same shape as user_permission_sets (audited in commit b0f0f5d).
-- The spec's "role assignments" audit bullet applies.
--
-- After this commit, every remaining unaudited table is skip-by-design:
--   audit_log, field_history, scheduled_report_runs, envelope_events,
--   email_sends, gps_points       — audit/event streams (self-logging
--                                   or high-volume telemetry)
--   chat_messages, chat_threads   — conversational content
--   *_snapshots                   — parent audit covers them
--   user_outlook_connections      — OAuth tokens (transient)
--   cfp_projects, cfp_scenarios   — module not yet exposed in production
-- ============================================================================

CREATE TRIGGER trg_audit_report_folders
  AFTER INSERT OR UPDATE OR DELETE ON public.report_folders
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_dashboard_folders
  AFTER INSERT OR UPDATE OR DELETE ON public.dashboard_folders
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_report_folder_role_shares
  AFTER INSERT OR UPDATE OR DELETE ON public.report_folder_role_shares
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_report_folder_user_shares
  AFTER INSERT OR UPDATE OR DELETE ON public.report_folder_user_shares
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_dashboard_folder_role_shares
  AFTER INSERT OR UPDATE OR DELETE ON public.dashboard_folder_role_shares
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_dashboard_folder_user_shares
  AFTER INSERT OR UPDATE OR DELETE ON public.dashboard_folder_user_shares
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_help_articles
  AFTER INSERT OR UPDATE OR DELETE ON public.help_articles
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_help_article_anchors
  AFTER INSERT OR UPDATE OR DELETE ON public.help_article_anchors
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_object_chat_enabled
  AFTER INSERT OR UPDATE OR DELETE ON public.object_chat_enabled
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();
