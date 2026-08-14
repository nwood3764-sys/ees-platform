-- Activate the North Carolina Assessments outbound mailbox so the customer
-- scheduler routes NC booking/reschedule/reminder emails from the NC inbox
-- (assessments@ees-nc.org) instead of the WI default. fire-notification's
-- resolveAssessmentsMailbox() picks the active Assessments mailbox for the
-- property's state.
--
-- NOTE: this only controls WHICH from-address LEAP asks Microsoft Graph to
-- send as. The mailbox itself must exist in Microsoft 365 with the app granted
-- send permission (as ncira@ees-nc.org already is); otherwise Graph rejects the
-- send and the email is logged failed in notification_logs.

UPDATE outbound_mailboxes
SET obm_is_active = true,
    obm_updated_at = now()
WHERE obm_record_number = 'OBM-00003'
  AND obm_address = 'assessments@ees-nc.org'
  AND obm_is_deleted IS NOT TRUE;
