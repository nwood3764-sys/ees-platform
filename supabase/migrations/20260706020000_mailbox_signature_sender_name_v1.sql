-- =====================================================================
-- Mailbox signature v2 — lead with the actual sender's name
--
-- send-email-v1 (v14) hydrates {{sender.*}} merge tokens from the app
-- user the send runs as. Signatures now open with the sender's name so
-- customers see who wrote the email, followed by the program identity.
-- =====================================================================

UPDATE public.outbound_mailboxes
SET obm_signature_html =
  '<p style="margin:16px 0 0 0;padding-top:12px;border-top:1px solid #e4e9f2;color:#4a5e7a;font-size:13px;line-height:1.6;font-family:Arial,Helvetica,sans-serif">'
  || '<strong style="color:#0d1a2e">{{sender.user_first_name}} {{sender.user_last_name}}</strong><br>'
  || 'NC IRA Program Team — Energy Efficiency Services of North Carolina<br>'
  || '<a href="mailto:ncira@ees-nc.org" style="color:#2aab72;text-decoration:none">ncira@ees-nc.org</a>'
  || '</p>'
WHERE lower(obm_address) = 'ncira@ees-nc.org'
  AND obm_is_deleted = false;

UPDATE public.outbound_mailboxes
SET obm_signature_html =
  '<p style="margin:16px 0 0 0;padding-top:12px;border-top:1px solid #e4e9f2;color:#4a5e7a;font-size:13px;line-height:1.6;font-family:Arial,Helvetica,sans-serif">'
  || '<strong style="color:#0d1a2e">{{sender.user_first_name}} {{sender.user_last_name}}</strong><br>'
  || 'WI IRA Program Team — Energy Efficiency Services of Wisconsin<br>'
  || '<a href="mailto:ira@ees-wi.org" style="color:#2aab72;text-decoration:none">ira@ees-wi.org</a>'
  || '</p>'
WHERE lower(obm_address) = 'ira@ees-wi.org'
  AND obm_is_deleted = false;
