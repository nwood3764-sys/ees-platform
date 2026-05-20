-- =====================================================================
-- Correct the WI mailbox address to the real provisioned one, and mark
-- the other four state mailboxes inactive since they don't exist in
-- Microsoft 365 yet. Sending to one of the inactive rows produced the
-- 404 ErrorInvalidUser seen in the Cascade Smoke compose attempt.
--
-- Real WI mailbox per Nicholas: assessments.wi@eeswi.org
-- The other four states (CO, NC, MI, IN) are aspirational placeholders
-- per the May 2026 outbound-topology decision — they remain in the
-- table but with obm_is_active=false so the resolver returns NULL
-- (and send-email-v1 surfaces "no mailbox configured for state X"
-- rather than calling Graph and getting a 404).
-- =====================================================================

UPDATE public.outbound_mailboxes
SET obm_address      = 'assessments.wi@eeswi.org',
    obm_display_name = 'EES Wisconsin — Assessments',
    obm_updated_at   = now(),
    obm_updated_by   = 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid
WHERE obm_record_number = 'OBM-00001'
  AND obm_state = 'WI';

UPDATE public.outbound_mailboxes
SET obm_is_active   = false,
    obm_updated_at  = now(),
    obm_updated_by  = 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid
WHERE obm_state IN ('CO', 'NC', 'MI', 'IN')
  AND obm_is_active = true
  AND obm_is_deleted = false;
