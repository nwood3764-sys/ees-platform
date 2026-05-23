-- =============================================================================
-- correct_obm_wi_address_to_actual_provisioned_mailbox
--
-- OBM-00001 was previously seeded as assessments.wi@eeswi.org (no hyphen).
-- The actual provisioned Microsoft 365 shared mailbox is
-- assessments.wi@EES-WI.org (display name "WI Assessments"), confirmed by
-- Nicholas via the Microsoft 365 admin console Shared mailboxes list on
-- 2026-05-23. Without this correction every outbound email from WI fails
-- with Graph ErrorInvalidUser.
--
-- The canonical company domain is EES-WI.org. No other domain
-- variant (eeswi.org without the hyphen, ees-<state>.org per-state, or any
-- other) is to be used anywhere in the codebase.
--
-- The other four state mailboxes (MI/NC/CO/IN, OBM-00002..OBM-00005) remain
-- deactivated until Nicholas provisions them in M365 and confirms their
-- exact addresses.
-- =============================================================================
UPDATE outbound_mailboxes
   SET obm_address    = 'assessments.wi@EES-WI.org',
       obm_updated_at = now()
 WHERE obm_record_number = 'OBM-00001'
   AND obm_state = 'WI'
   AND NOT obm_is_deleted;
