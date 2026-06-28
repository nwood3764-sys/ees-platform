-- ============================================================================
-- 20260512195215 audit_triggers_for_envelope_family
--
-- Closes the 'medium-value unaudited tables' item from the session 5
-- coverage scan that remained after the PRT family was wired in commit
-- 5dc957c. Envelopes drive the e-signature workflow — each row is a
-- signed-or-pending document tied to a real customer or partner. Edits
-- to envelopes, their recipient lists, or their signature-tab placements
-- change what someone is being asked to sign or where they sign it.
-- That's high-stakes enough to warrant a full audit trail.
--
-- envelope_events is deliberately skipped — it is itself an audit-style
-- table (one row per state-change event from the e-signature provider),
-- so adding generic audit on top would double-log every signature
-- progression with no signal gain.
-- ============================================================================

CREATE TRIGGER trg_audit_envelopes
  AFTER INSERT OR UPDATE OR DELETE ON public.envelopes
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_envelope_recipients
  AFTER INSERT OR UPDATE OR DELETE ON public.envelope_recipients
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

CREATE TRIGGER trg_audit_envelope_tabs
  AFTER INSERT OR UPDATE OR DELETE ON public.envelope_tabs
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();
