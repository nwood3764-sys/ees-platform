-- Both state-scoping help articles promised a grandfather clause that no longer
-- exists, and HA-00183 said North Carolina and Michigan had no payment request
-- form. Correct them where they are wrong rather than adding a third article
-- about the same rule.
UPDATE public.help_articles
   SET ha_body_markdown = replace(
         ha_body_markdown,
'Opportunities that already carried a mismatched program before this rule existed keep working and stay editable. They are not corrected automatically, because which program they should have been is a business decision.',
'There is no exemption for older records. When this rule shipped, five opportunities on North Carolina properties were still carrying **FOE-2024-WI**, a Wisconsin program the public scheduler had stamped on them; they were left editable while their real program was decided. They have since been moved to **NC-IRA-SF-HOMES-AUDIT** — the North Carolina single-family audit program, which is what a single-family energy assessment actually is — and the exemption is gone with them. A record whose program does not run where its property is can no longer be saved at all.

**A property cannot be moved out from under its records either.** Changing a property''s state is refused while any opportunity, assessment or incentive application on it runs another state''s program, and the message names them. Move those records first, then move the property — there is no automatic answer for what FOE-2024-WI becomes in North Carolina, which is exactly why it is a decision and not a conversion.'),
       ha_updated_at = now()
 WHERE ha_slug = 'state-scoped-opportunity-record-types'
   AND ha_is_deleted IS NOT TRUE;

UPDATE public.help_articles
   SET ha_body_markdown = replace(
         ha_body_markdown,
'Applications created before this rule existed keep working and stay editable. They are not corrected automatically, because which program they should have been is a business decision.',
'There is no exemption for older records, on this object or on opportunities. A record whose form does not run where its property is, or does not belong to its opportunity''s program, cannot be saved at all — and a property cannot change state while any record on it runs another state''s program.'),
       ha_updated_at = now()
 WHERE ha_slug = 'incentive-application-state-and-program-scoping'
   AND ha_is_deleted IS NOT TRUE;

UPDATE public.help_articles
   SET ha_body_markdown = replace(
         ha_body_markdown,
'The six IRA programs each state runs — MF/SF × HEAR, HOMES and HOMES-AUDIT — now have their own **NC-** and **MI-** application record types, each with **its own page layout**, cloned from the Wisconsin original so they start complete. States share nothing: edit a North Carolina layout freely and Wisconsin''s does not move.',
'The six IRA programs each state runs — MF/SF × HEAR, HOMES and HOMES-AUDIT — now have their own **NC-** and **MI-** application record types, each with **its own page layout**, cloned from the Wisconsin original so they start complete. States share nothing: edit a North Carolina layout freely and Wisconsin''s does not move.

Each state''s **multifamily HOMES payment request** is its own form too — NC-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST and MI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST, alongside Wisconsin''s. Every MF HOMES program therefore offers two forms: its application and its payment request. They start as copies of Wisconsin''s and are expected to diverge, because each state''s program asks for different things.'),
       ha_updated_at = now()
 WHERE ha_slug = 'incentive-application-state-and-program-scoping'
   AND ha_is_deleted IS NOT TRUE;
