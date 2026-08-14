-- Interim NC sender for customer scheduling emails.
--
-- Decision (Nicholas): send NC booking/reschedule/reminder emails from the
-- already-provisioned NC program mailbox ncira@ees-nc.org, rather than standing
-- up a new assessments@ees-nc.org mailbox in Microsoft 365 right now.
--
-- fire-notification.resolveAssessmentsMailbox() routes by (state, purpose=
-- 'Assessments', active). So:
--   * make ncira (OBM-00006) NC's active Assessments mailbox, and
--   * deactivate the not-yet-provisioned assessments@ees-nc.org (OBM-00003),
--     which would otherwise be preferred and would bounce.
--
-- The NC invite template (ET-00007) references OBM-00006 by id, so this purpose
-- change does not affect it. When assessments@ees-nc.org is later provisioned,
-- revert: reactivate OBM-00003 and set OBM-00006 back to 'General Correspondence'.

UPDATE outbound_mailboxes
SET obm_is_active = false, obm_updated_at = now()
WHERE obm_record_number = 'OBM-00003' AND obm_is_deleted IS NOT TRUE;

UPDATE outbound_mailboxes
SET obm_purpose = 'Assessments', obm_updated_at = now()
WHERE obm_record_number = 'OBM-00006' AND obm_is_deleted IS NOT TRUE;
