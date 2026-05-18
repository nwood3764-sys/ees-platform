-- Communications Module v1, Slice 1 — seed outbound_mailboxes
--
-- State separation is in the domain (ees-wi.org, ees-mi.org, ees-nc.org,
-- ees-co.org, ees-in.org), all five live. One assessments shared mailbox per
-- state to start. obm_program_id NULL — state-only routing for now; program-
-- specific mailboxes (if added later) take precedence via send-email-v1's
-- mailbox-selection logic: program × state match wins, falls back to state-only
-- when only state matches, dropdown when multiple match.
--
-- Owner: Nicholas Wood (c5a01ec8-960f-42ab-8a9e-a49822de89af).
-- All five active=true; mock-mode send-email-v1 doesn't actually hit M365, so
-- these can carry traffic for end-to-end testing without real Graph credentials.

INSERT INTO public.outbound_mailboxes (
  obm_record_number, obm_address, obm_display_name,
  obm_program_id, obm_state, obm_is_active,
  obm_owner, obm_created_by, obm_updated_by
)
VALUES
  ('', 'assessments@ees-wi.org', 'EES Wisconsin — Assessments',
   NULL, 'WI', true,
   'c5a01ec8-960f-42ab-8a9e-a49822de89af',
   'c5a01ec8-960f-42ab-8a9e-a49822de89af',
   'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('', 'assessments@ees-mi.org', 'EES Michigan — Assessments',
   NULL, 'MI', true,
   'c5a01ec8-960f-42ab-8a9e-a49822de89af',
   'c5a01ec8-960f-42ab-8a9e-a49822de89af',
   'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('', 'assessments@ees-nc.org', 'EES North Carolina — Assessments',
   NULL, 'NC', true,
   'c5a01ec8-960f-42ab-8a9e-a49822de89af',
   'c5a01ec8-960f-42ab-8a9e-a49822de89af',
   'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('', 'assessments@ees-co.org', 'EES Colorado — Assessments',
   NULL, 'CO', true,
   'c5a01ec8-960f-42ab-8a9e-a49822de89af',
   'c5a01ec8-960f-42ab-8a9e-a49822de89af',
   'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('', 'assessments@ees-in.org', 'EES Indiana — Assessments',
   NULL, 'IN', true,
   'c5a01ec8-960f-42ab-8a9e-a49822de89af',
   'c5a01ec8-960f-42ab-8a9e-a49822de89af',
   'c5a01ec8-960f-42ab-8a9e-a49822de89af');
