-- =====================================================================
-- Outbound mailbox program signature (v1)
--
-- Every outbound email now carries the sending mailbox's signature —
-- program identity, managed on the outbound_mailboxes record, never
-- typed by the sender. send-email-v1 (v13) appends the token-substituted
-- signature HTML to the body on every send, replies included.
-- Starter signatures seeded for the two live correspondence mailboxes;
-- content is data, editable per mailbox without code changes.
-- =====================================================================

ALTER TABLE public.outbound_mailboxes
  ADD COLUMN IF NOT EXISTS obm_signature_html text;

UPDATE public.outbound_mailboxes
SET obm_signature_html =
  '<p style="margin:16px 0 0 0;padding-top:12px;border-top:1px solid #e4e9f2;color:#4a5e7a;font-size:13px;line-height:1.6;font-family:Arial,Helvetica,sans-serif">'
  || '<strong style="color:#0d1a2e">NC IRA Program Team</strong><br>'
  || 'Energy Efficiency Services of North Carolina<br>'
  || '<a href="mailto:ncira@ees-nc.org" style="color:#2aab72;text-decoration:none">ncira@ees-nc.org</a>'
  || '</p>'
WHERE lower(obm_address) = 'ncira@ees-nc.org'
  AND obm_is_deleted = false
  AND obm_signature_html IS NULL;

UPDATE public.outbound_mailboxes
SET obm_signature_html =
  '<p style="margin:16px 0 0 0;padding-top:12px;border-top:1px solid #e4e9f2;color:#4a5e7a;font-size:13px;line-height:1.6;font-family:Arial,Helvetica,sans-serif">'
  || '<strong style="color:#0d1a2e">WI IRA Program Team</strong><br>'
  || 'Energy Efficiency Services of Wisconsin<br>'
  || '<a href="mailto:ira@ees-wi.org" style="color:#2aab72;text-decoration:none">ira@ees-wi.org</a>'
  || '</p>'
WHERE lower(obm_address) = 'ira@ees-wi.org'
  AND obm_is_deleted = false
  AND obm_signature_html IS NULL;

NOTIFY pgrst, 'reload schema';
