-- ============================================================================
-- 20260512193852 audit_triggers_for_project_report_template_family
--
-- Audit triggers for the four PRT-family tables. Continues the broader
-- audit-coverage sweep from f9fb5ab + b0f0f5d. Closes the "medium-value
-- unaudited tables" item from session 5's standing backlog.
--
-- Tables: project_report_templates, project_report_template_sections,
--         project_report_template_record_type_assignments,
--         project_report_template_snapshots
--
-- The PRT family drives customer-facing PDFs. Template-structure edits
-- literally change what shows up in customer reports — the spec calls
-- out audit-logging for template changes alongside permission changes.
--
-- Coexistence: existing PRT triggers are all BEFORE-row (auto-numbering
-- via set_*_record_number, edit-lockdown on Active via
-- prevent_active_prt_edits / prevent_active_prts_iud). The audit
-- triggers added here are AFTER-row, so no firing-order conflict.
-- ============================================================================

CREATE TRIGGER trg_audit_project_report_templates
  AFTER INSERT OR UPDATE OR DELETE ON public.project_report_templates
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_project_report_template_sections
  AFTER INSERT OR UPDATE OR DELETE ON public.project_report_template_sections
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_project_report_template_record_type_assignments
  AFTER INSERT OR UPDATE OR DELETE ON public.project_report_template_record_type_assignments
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_project_report_template_snapshots
  AFTER INSERT OR UPDATE OR DELETE ON public.project_report_template_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();
