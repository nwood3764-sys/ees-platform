-- =====================================================================
-- Key source field type (Nicholas, 2026-07-13): key custody is dynamic —
-- keys come from a lockbox (outside, or in an office we have the
-- combination to) OR from a person (a contact on the account, e.g. the
-- property manager). 'key_source' fields render in LEAP Pad as a
-- Lockbox / Person choice; picking Person offers the account's contacts
-- (with a free-text fallback for someone not yet in CRM). Stored as
-- readable text: "Lockbox" or "Person: <name>".
--
-- Config data applied separately on prod: the two key custody step
-- templates renamed source-agnostic ('Key Checkout Photo' /
-- 'Key Check-In Photo') and given required key_source fields
-- ('Checked Out From' / 'Returned To').
--
-- Applied to production 2026-07-13 via MCP.
-- =====================================================================

ALTER TABLE public.work_step_template_fields
  DROP CONSTRAINT IF EXISTS work_step_template_fields_wstf_field_type_check;
ALTER TABLE public.work_step_template_fields
  ADD CONSTRAINT work_step_template_fields_wstf_field_type_check
  CHECK (wstf_field_type = ANY (ARRAY['number'::text, 'text'::text, 'user_multiselect'::text, 'key_source'::text]));
