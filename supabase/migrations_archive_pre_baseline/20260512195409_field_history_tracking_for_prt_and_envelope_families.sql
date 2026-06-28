-- ============================================================================
-- 20260512195409 field_history_tracking_for_prt_and_envelope_families
--
-- Registers field-history tracking for 27 columns across six tables in
-- the PRT (Project Report Template) and envelope (e-signature) families.
-- The audit triggers added in commits 5dc957c + 05a903b capture
-- row-level INSERT/UPDATE/DELETE in audit_log; this commit makes the
-- column-level deltas visible via field_history (rendered inline on
-- each record's Activity tab).
--
-- Selection criteria: columns whose change alters customer-visible
-- behavior or document content. Auto-generated bookkeeping
-- (record_number, version, *_at timestamps, paths) is deliberately
-- excluded as noise.
--
-- Columns tracked (27 total):
--
--   project_report_templates (7):
--     prt_name, prt_description, prt_status, prt_orientation,
--     prt_paper_size, prt_is_default_for_unmapped, prt_owner
--
--   project_report_template_sections (7):
--     prts_section_order, prts_section_title, prts_body_template,
--     prts_config, prts_filter_config, prts_show_if_empty,
--     prts_page_break_after
--
--   project_report_template_record_type_assignments (1):
--     prtrta_is_default
--
--   envelopes (5):
--     env_subject, env_message, env_status, env_void_reason,
--     env_failure_reason
--
--   envelope_recipients (6):
--     recipient_email, recipient_name, recipient_role,
--     recipient_order, recipient_status, recipient_decline_reason
--
--   envelope_tabs (1):
--     tab_filled_value
-- ============================================================================

INSERT INTO public.field_history_tracked_fields
  (fhtf_table_name, fhtf_column_name, fhtf_is_active, fhtf_description)
VALUES
  ('project_report_templates', 'prt_name', true,
    'Template name. Renaming changes how authors reference it; track for traceability.'),
  ('project_report_templates', 'prt_description', true,
    'Template description — intent commentary.'),
  ('project_report_templates', 'prt_status', true,
    'Lifecycle status (Draft / Active / Archived). Publish/unpublish/archive transitions are reflected here.'),
  ('project_report_templates', 'prt_orientation', true,
    'Page orientation (landscape/portrait). Layout-affecting.'),
  ('project_report_templates', 'prt_paper_size', true,
    'Paper size (Letter/A4/Legal). Layout-affecting.'),
  ('project_report_templates', 'prt_is_default_for_unmapped', true,
    'Whether this template is the catch-all for projects with no record-type assignment.'),
  ('project_report_templates', 'prt_owner', true,
    'Template owner. Ownership transfer changes who can publish/edit.'),

  ('project_report_template_sections', 'prts_section_order', true,
    'Section ordering within the template. Reordering changes how the report reads.'),
  ('project_report_template_sections', 'prts_section_title', true,
    'Section heading text shown in the rendered PDF.'),
  ('project_report_template_sections', 'prts_body_template', true,
    'Section body markup. The single most-edited content field on a PRT.'),
  ('project_report_template_sections', 'prts_config', true,
    'Section-type-specific config jsonb (e.g. table column selection, image source).'),
  ('project_report_template_sections', 'prts_filter_config', true,
    'Section data filter jsonb. Changes what records the section pulls.'),
  ('project_report_template_sections', 'prts_show_if_empty', true,
    'Whether the section renders when its data set is empty.'),
  ('project_report_template_sections', 'prts_page_break_after', true,
    'Whether a page break follows this section in the rendered PDF.'),

  ('project_report_template_record_type_assignments', 'prtrta_is_default', true,
    'Whether this PRT is the default template for its record-type assignment. Only one per record type should be true.'),

  ('envelopes', 'env_subject', true,
    'Email subject the customer sees. Track changes for traceability if a signer claims confusion about what they signed.'),
  ('envelopes', 'env_message', true,
    'Email body the customer sees. Same reason as subject.'),
  ('envelopes', 'env_status', true,
    'Envelope status (Sent / Delivered / Completed / Declined / Voided / Failed). Workflow critical.'),
  ('envelopes', 'env_void_reason', true,
    'Reason recorded if the envelope was voided.'),
  ('envelopes', 'env_failure_reason', true,
    'Reason recorded if the e-signature provider returned a failure.'),

  ('envelope_recipients', 'recipient_email', true,
    'Recipient email — who actually gets the signing link. Changes are critical for legal traceability.'),
  ('envelope_recipients', 'recipient_name', true,
    'Recipient display name on the signed certificate.'),
  ('envelope_recipients', 'recipient_role', true,
    'Recipient role (Signer / CC / Approver / etc).'),
  ('envelope_recipients', 'recipient_order', true,
    'Signing order. Reordering changes routing.'),
  ('envelope_recipients', 'recipient_status', true,
    'Per-recipient workflow status.'),
  ('envelope_recipients', 'recipient_decline_reason', true,
    'Reason recorded if the recipient declined.'),

  ('envelope_tabs', 'tab_filled_value', true,
    'Value the recipient typed/selected at signing time. Should be write-once at signing; any subsequent change is a red flag worth tracking.')
ON CONFLICT DO NOTHING;
