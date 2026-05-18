-- =========================================================================
-- HA-00051 — Send for Signature, recipient and anchor mismatch warnings
-- =========================================================================
-- Documents the new pre-send anchor mismatch warning shipped in commit
-- bae791e — client-side regex scan of template body_html against the
-- recipient list to surface orphan anchors, unused recipients, and
-- empty templates before submit.
-- =========================================================================

WITH new_article AS (
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
    ha_category, ha_audience, ha_is_published,
    ha_created_by, ha_updated_by
  ) VALUES (
    'HA-00051',
    'recipient-anchor-mismatch-warning',
    'Send for Signature — recipient and anchor mismatch warnings',
    'The Send for Signature review step scans the chosen template for signature anchors and compares the highest ordinal against the recipient list. When they don''t line up, an amber banner explains what will go wrong and offers a one-click jump back to the recipients step.',
    $md$
The Send for Signature modal does a pre-flight scan of the chosen template before you hit Send. The scanner walks the template body looking for tokens like `\sig1\`, `\init2\`, `\date1\`, `\text3\` and groups them by ordinal. The highest ordinal tells you how many recipients the template is designed for. The recipient list tells you how many recipients you've actually added. When those don't match, the review step surfaces an amber warning explaining what's wrong.

### Orphan anchors

The template references more recipients than you've added. Example: the template contains `\sig3\` but you only have 2 recipients on the envelope. Recipient 3 doesn't exist, so `\sig3\` is **dropped at render time** — it never appears as a signing tab and that part of the document goes unsigned.

The warning lists each orphan ordinal and the specific tokens that bind to it. Click **← Add recipient** to jump back to the recipients step and add the missing person.

### Unused recipients

You've added more recipients than the template's anchors expect. Example: you have 3 recipients on the envelope but the template's highest anchor is `\sig2\`. Recipient 3 will receive the signing email but their portal will show no fields to fill in.

This is sometimes intentional (a courtesy CC, or a recipient who will sign a separate counter-document outside the envelope) but more often a mistake. Either remove the extra recipient or add new anchors (`\sig3\`, etc.) to the template.

### No anchors at all

The template body contains no signing anchors. The recipients will get the PDF but there's nothing for them to sign, initial, date, or fill in. Either add anchors to the template body, or — if a no-signature document is genuinely what you want — be aware that the envelope will be completed the moment a recipient acknowledges it with no actual signatures captured.

### Docx-mode templates

If the template is authored in docx mode (uploaded `.docx` asset rather than rich-text HTML), the scanner can't pre-verify anchors from the client — the docx file is opened and merged server-side at render time. The review step shows a blue informational notice instead of an amber warning. Use the **Show signature anchor positions** overlay on the document template preview (see HA-00050) to verify anchor placement before sending.

### Why isn't this a hard block?

The warning never disables Send. Two reasons:

1. The scan uses the same regex the renderer uses, but template authors occasionally use markup or formatting that confuses the scan (e.g. an anchor wrapped in an HTML attribute). False positives shouldn't gate a real send.
2. Some workflows legitimately want orphan or unused anchors — internal counter-sign placeholders, multi-envelope sequences, training templates, etc.

Treat it as a pre-flight check, not a validation rule. If the warning matches your intent, send anyway.
$md$,
    'Communications',
    'internal',
    true,
    'c5a01ec8-960f-42ab-8a9e-a49822de89af',
    'c5a01ec8-960f-42ab-8a9e-a49822de89af'
  )
  RETURNING id
)
INSERT INTO public.help_article_anchors (
  haa_article_id, haa_anchor_type, haa_object, haa_field, haa_concept, haa_sort_order, haa_created_by
)
SELECT new_article.id, a.atype, a.aobj, a.afield, a.aconcept, a.asort, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid
FROM new_article,
LATERAL (VALUES
  ('object'::text,  'envelopes'::text,    NULL::text, NULL::text, 10),
  ('object',        'envelope_recipients', NULL,        NULL, 20),
  ('object',        'envelope_tabs',       NULL,        NULL, 30),
  ('concept',       NULL,                  NULL, 'recipient-anchor-mismatch', 5),
  ('concept',       NULL,                  NULL, 'orphan-anchors',            15),
  ('concept',       NULL,                  NULL, 'recipient-ordinal-binding', 25),
  ('concept',       NULL,                  NULL, 'send-for-signature',        35),
  ('concept',       NULL,                  NULL, 'dropped-anchors',           45)
) AS a(atype, aobj, afield, aconcept, asort);
