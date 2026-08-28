-- Help article for the new Property Marketing Description field.
-- Guarded by slug so a replay on a database that already has the article is a no-op.
-- ha_record_number is left '' so the trg_help_articles_rn trigger assigns the number.

INSERT INTO public.help_articles
  (ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown, ha_category, ha_audience, ha_is_published)
SELECT
  '',
  'property-marketing-description',
  'Property Marketing Description',
  'The owner-provided public marketing and tenant-eligibility description shown on a property record.',
  $md$## What it is

**Property Marketing Description** is a free-text field on a property that holds the owner-provided, public-facing description of the community — unit mix, tenant eligibility preferences (age, disability, family), and income-restriction notes. It is distinct from **Property Notes**, which is for internal staff notes.

## Where to find it

Open any **Multifamily** property record. The **Property Marketing Description** section sits on the **Details** tab, directly under **Property Information**. Admins can add the field to other property record-type layouts through the Page Layout editor.

## Editing

Click into the field and type or paste the description, then save. The field accepts multiple paragraphs.

## Background

Descriptions for the Lutheran Social Services property portfolio were loaded into this field for the 42 properties matched to existing LEAP records. Properties that were not matched, or that share a single LEAP record (e.g. two roster entries at one address), were left blank for manual review.
$md$,
  'Properties',
  'all',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.help_articles WHERE ha_slug = 'property-marketing-description'
);
