-- =============================================================================
-- The signature request email is an editable template
--
-- Nicholas, 2026-09-05, on the email a property owner actually received:
-- "where do I adjust this email template, because this needs some work? ... is
-- this a template, or do we just change the wording directly? I need to know."
--
-- It was NEITHER, which is the answer he was owed. renderEmailHtml() inside the
-- send-envelope edge function composed the whole message, so changing one
-- sentence was a code change AND an edge function deploy -- the exact route that
-- left the LEAP Assistant's 529 fix inert on production for five days. Wording a
-- customer reads is configuration, not code.
--
-- It is an email_templates row now, edited at Setup -> Communication Templates
-- like every other message LEAP sends.
--
-- Matched by NAME, never by this row's id: a seeded id differs on staging and on
-- any branch replay, and a lookup by id would silently fall back to the built-in
-- wording there while looking perfectly correct here.
--
-- THE FAILURE DIRECTION IS ALWAYS "SEND". A missing, archived or unreadable
-- template falls back to the built-in wording rather than holding the request --
-- a property owner not receiving their document is the failure this entire
-- workstream started with (ENV-00014, which read Sent and delivered nothing).
--
-- The wording follows what he asked for -- name the project, name the document,
-- and say WHY it needs signing ("so that our team can reserve the funding for
-- this project") -- with one deliberate change of shape. The project name is NOT
-- placed inside a sentence: an enrollment's name is derived as "<property
-- address> - <record type label>", so inline it would read "Your project at 570
-- Clark Street - Wisconsin IRA Multifamily Income Qualification is ready", which
-- is not a sentence anybody would write. It is a labelled fact on its own line,
-- where the suffix is unremarkable.
--
-- The button is navy, not the #1f7ae0 it used to be. That blue is in no LEAP
-- palette, and white on the palette's own emerald cannot clear 4.5:1 at 14px
-- bold -- a contrast floor, not a preference, on the one email a property owner
-- has to be able to act on.
--
-- Also corrected here: ET-00005's subject carried the retired platform name in a
-- live outbound subject line. An Active template is locked from edits on
-- purpose, so the correction takes the platform's OWN path -- unpublish to
-- Draft, correct, republish -- rather than switching the guard off. A rule worth
-- having is worth following inside a migration too, and the guard still being
-- armed afterwards is asserted as a control.
-- =============================================================================

BEGIN;

INSERT INTO public.email_templates
  (name, description, subject, body_html, related_object,
   is_manual, is_automated, status, owner_id, created_by, et_record_number)
SELECT
  'Signature Request',
  'The email a recipient receives when a document is sent to them for signature. Sent by the send-envelope pipeline; the wording here is what they read. Tokens: {{recipient.first_name}}, {{recipient.name}}, {{document.name}}, {{record.name}}, {{record.number}}, {{sender.name}}, {{signing_url}}, {{company.name}}. A token nothing supplies renders empty, never as braces.',
  'Please review and sign: {{document.name}}',
  '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;line-height:1.55;color:#0d1a2e;max-width:600px;margin:0 auto;padding:24px;background:#ffffff;">
<p style="font-size:15px;">Hi {{recipient.first_name}},</p>
<p style="font-size:14px;">Your project is ready for your review and signature.</p>
<table cellpadding="0" cellspacing="0" style="font-size:14px;margin:18px 0;border-collapse:collapse;">
  <tr><td style="padding:4px 16px 4px 0;color:#4a5e7a;">Project</td><td style="padding:4px 0;color:#0d1a2e;font-weight:600;">{{record.name}}</td></tr>
  <tr><td style="padding:4px 16px 4px 0;color:#4a5e7a;">Document</td><td style="padding:4px 0;color:#0d1a2e;font-weight:600;">{{document.name}}</td></tr>
</table>
<p style="font-size:14px;">Please review it and add your signature. Once it is signed, our team can reserve the programme funding for this project and move it forward to scheduling. There is no cost to you.</p>
<div style="margin:28px 0;">
  <a href="{{signing_url}}" style="background:#0d1a2e;color:#ffffff;padding:13px 28px;text-decoration:none;border-radius:6px;font-weight:600;display:inline-block;font-size:14px;">Review and Sign</a>
</div>
<p style="font-size:12px;color:#4a5e7a;">If the button does not work, paste this address into your browser:<br><a href="{{signing_url}}" style="color:#1e466b;word-break:break-all;">{{signing_url}}</a></p>
<hr style="border:none;border-top:1px solid #e4e9f2;margin:24px 0;">
<p style="font-size:11px;color:#8fa0b8;">Sent on behalf of {{sender.name}} at {{company.name}}. This signing link is unique to you and expires in 30 days. If anything in the document is not right, reply to this email instead of signing and we will correct it.</p>
</body></html>',
  'envelopes',
  false,
  true,
  (SELECT id FROM public.picklist_values
    WHERE picklist_object='email_templates' AND picklist_field='status'
      AND picklist_value='Active'),
  fam.owner_id, fam.owner_id, ''
FROM (
  SELECT e.owner_id
    FROM public.email_templates e
   WHERE coalesce(e.is_deleted,false)=false AND e.owner_id IS NOT NULL
   ORDER BY e.et_record_number
   LIMIT 1
) fam
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates x
   WHERE x.name='Signature Request' AND coalesce(x.is_deleted,false)=false);

UPDATE public.email_templates
   SET status = (SELECT id FROM public.picklist_values
                  WHERE picklist_object='email_templates' AND picklist_field='status'
                    AND picklist_value='Draft')
 WHERE subject LIKE '%Anura%' AND coalesce(is_deleted,false)=false;

UPDATE public.email_templates
   SET subject = replace(subject, 'Anura Weekly Digest', 'LEAP Weekly Digest')
 WHERE subject LIKE '%Anura%' AND coalesce(is_deleted,false)=false;

UPDATE public.email_templates
   SET status = (SELECT id FROM public.picklist_values
                  WHERE picklist_object='email_templates' AND picklist_field='status'
                    AND picklist_value='Active')
 WHERE et_record_number='ET-00005' AND coalesce(is_deleted,false)=false;

DO $$
DECLARE
  v_n int;
  v_body text;
  v_subject text;
BEGIN
  SELECT count(*) INTO v_n FROM public.email_templates
   WHERE name='Signature Request' AND coalesce(is_deleted,false)=false;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one Signature Request template, found %', v_n;
  END IF;

  SELECT body_html, subject INTO v_body, v_subject FROM public.email_templates
   WHERE name='Signature Request' AND coalesce(is_deleted,false)=false;

  SELECT count(*) INTO v_n FROM public.email_templates t
   JOIN public.picklist_values p ON p.id = t.status
   WHERE t.name='Signature Request' AND coalesce(t.is_deleted,false)=false
     AND p.picklist_value='Active';
  IF v_n <> 1 THEN RAISE EXCEPTION 'the Signature Request template is not Active'; END IF;

  IF v_body NOT LIKE '%{{signing_url}}%' THEN
    RAISE EXCEPTION 'the template carries no signing link';
  END IF;
  IF v_body NOT LIKE '%{{recipient.first_name}}%'
     OR v_body NOT LIKE '%{{document.name}}%'
     OR v_body NOT LIKE '%{{record.name}}%' THEN
    RAISE EXCEPTION 'the template is missing one of the naming tokens';
  END IF;
  IF v_subject NOT LIKE '%{{document.name}}%' THEN
    RAISE EXCEPTION 'the subject does not name the document';
  END IF;

  -- CONTROL: no token may be spelled with a name the renderer does not supply.
  -- signatureRequestTokens() supplies exactly these eight; anything else renders
  -- EMPTY in a customer's email, which is silent and looks fine from here.
  IF EXISTS (
    SELECT 1 FROM regexp_matches(v_body || ' ' || v_subject,
                                 '\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}', 'g') AS m(tok)
     WHERE m.tok[1] NOT IN ('recipient.first_name','recipient.name','document.name',
                            'record.name','record.number','sender.name',
                            'signing_url','company.name')
  ) THEN
    RAISE EXCEPTION 'the template uses a token the send pipeline does not supply';
  END IF;

  IF v_body ILIKE '%#1f7ae0%' THEN
    RAISE EXCEPTION 'the template still carries the off-palette action colour';
  END IF;

  SELECT count(*) INTO v_n FROM public.email_templates
   WHERE coalesce(is_deleted,false)=false
     AND (subject ILIKE '%anura%' OR body_html ILIKE '%anura%' OR name ILIKE '%anura%');
  IF v_n > 0 THEN
    RAISE EXCEPTION '% live email templates still carry the retired name', v_n;
  END IF;

  -- CONTROL: the edit guard is still armed. A migration that switched it off and
  -- forgot to switch it back would look exactly like this one.
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgrelid='public.email_templates'::regclass
     AND tgname='trg_prevent_active_email_template_edits'
     AND NOT tgisinternal AND tgenabled <> 'D';
  IF v_n <> 1 THEN RAISE EXCEPTION 'the Active-template edit guard is not armed'; END IF;

  -- ET-00005 went back to Active, not left unpublished.
  SELECT count(*) INTO v_n FROM public.email_templates t
   JOIN public.picklist_values p ON p.id=t.status
   WHERE t.et_record_number='ET-00005' AND p.picklist_value='Active';
  IF v_n <> 1 THEN RAISE EXCEPTION 'ET-00005 was left unpublished'; END IF;
END $$;

COMMIT;
