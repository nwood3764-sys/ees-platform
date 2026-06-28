-- =========================================================================
-- HA-00050 — Document template preview, verifying signature anchor positions
-- =========================================================================
-- Documents the new anchor overlay toggle on the document template Preview
-- modal (shipped in commit b3a0c12 alongside render-document-template-pdf v3).
-- =========================================================================

WITH new_article AS (
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
    ha_category, ha_audience, ha_is_published,
    ha_created_by, ha_updated_by
  ) VALUES (
    'HA-00050',
    'anchor-preview-overlay',
    'Document template preview — verifying signature anchor positions',
    'Toggle the anchor overlay on the document template Preview modal to render labeled, color-coded rectangles over every signature, initial, date, and text token in the rendered PDF — so you can visually confirm placement before publishing the template.',
    $md$
Anchor tokens such as `\sig1\`, `\init1\`, `\date1\`, and `\text1\` are scanned out of the template body at render time and consumed as bounding boxes — they never appear as visible text in the rendered PDF. Because they're invisible, it's easy to misplace one (wrong line, wrong page, embedded inside other content) and not notice until a recipient opens the signing portal and the field lands somewhere unexpected.

The **anchor preview overlay** closes that gap.

### How to use it

1. Open the document template record.
2. Click **Preview PDF** in the page header.
3. In the modal, pick a parent record (Project / Property / Opportunity, depending on the template's related object) to merge against.
4. Tick **Show signature anchor positions**.
5. Click **Generate Preview with Anchors**.

The rendered PDF opens in a new tab with a colored translucent rectangle drawn over every anchor's resolved bounding box, with a short label inside (`sig 1`, `init 2`, `date 1`, `text 1`).

### Color legend

| Token | Color | Default size |
|---|---|---|
| `\sig{n}\` | Green | 180 × 36 pt |
| `\init{n}\` | Sky blue | 60 × 30 pt |
| `\date{n}\` | Amber | 90 × 18 pt |
| `\text{n}\` | Gray | 140 × 18 pt |

The ordinal number after the type binds the field to a recipient — `\sig1\` is for recipient 1, `\sig2\` for recipient 2, and so on.

### Safety

The overlay is a preview-only artifact. The edge function refuses to draw rectangles unless both `preview: true` and `include_anchor_overlay: true` are set in the request. Signed envelopes never carry the overlay — `send-envelope` calls `render-document-template-pdf` without those flags and produces a clean unsigned PDF.

For background on how anchors map to envelope recipients, see HA-00049 — Signature tabs in document templates.
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
  ('object'::text,  'document_templates'::text,  NULL::text, NULL::text, 10),
  ('field',         'document_templates',        'body_html', NULL, 20),
  ('field',         'document_templates',        'dt_authoring_mode', NULL, 30),
  ('concept',       NULL,                         NULL, 'anchor-preview-overlay', 5),
  ('concept',       NULL,                         NULL, 'signature-anchor-format', 40),
  ('concept',       NULL,                         NULL, 'signature-tab-picker', 50),
  ('concept',       NULL,                         NULL, 'envelope-tabs', 60)
) AS a(atype, aobj, afield, aconcept, asort);
