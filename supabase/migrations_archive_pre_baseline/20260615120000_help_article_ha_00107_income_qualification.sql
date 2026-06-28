-- =========================================================================
-- HA-00107 — Income Qualification: running the multifamily HUD categorical
-- qualification tool from an incentive application, and the files it produces.
-- =========================================================================

WITH new_article AS (
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
    ha_category, ha_audience, ha_is_published,
    ha_created_by, ha_updated_by
  ) VALUES (
    'HA-00107',
    'income-qualification-multifamily',
    'Income Qualification: categorical qualification from an incentive application',
    'Each incentive application carries an Income Qualification panel on its Related tab. Running it classifies the linked property''s HUD assistance contract categorically, generates the IRA Home Energy Rebates multifamily application PDF and the tenant data sheet XLSX, and saves both files plus a determination record against the application.',
    $md$
**Income Qualification** determines whether a multifamily property qualifies for IRA Home Energy Rebates on a **categorical** basis, then produces the two artifacts the program submission needs. It runs against an **incentive application** — the program enrollment record — not the property directly, because one property enrolled in two programs needs two independent determinations.

### Where it lives

Open any incentive application, go to the **Related** tab, and scroll to the **Income Qualification** card. The card is specific to incentive applications; it does not appear on other objects.

### How the determination works

The tool reads the linked property's HUD assistance data and classifies it into one of two modes:

- **Entire Building** — the property carries a project-based HUD contract (Section 8, Section 202, Section 811, PRAC, or a RAD conversion). Under program rules, at least 50% of occupied units in such a building are categorically low- or moderate-income, so the **whole building qualifies** with no per-tenant income math. The card lists which pathway(s) were detected and the proof document the program expects.
- **Individual Tenants** — no categorical program was found on the HUD record. The building does **not** auto-qualify; each tenant's income must be certified individually before the application can be submitted. The card states this explicitly so it is never mistaken for a passing determination.

The preview at the top of the card shows the mode, total units, assisted units, subsidized share percentage, detected pathways, and the required proof — all before you commit to a run.

### Running it

Click **Run Income Qualification**. The tool:

1. Re-classifies the property at run time (so the determination always reflects current HUD data on the record).
2. Generates the **IRA Home Energy Rebates multifamily application PDF** — a property-data and field-definition sheet plus a filled application-form snapshot.
3. Generates the **tenant data sheet XLSX** — one row per unit, with occupants inferred as bedrooms + 1 and the program's exact column layout, ready for tenant names to be filled in.
4. Saves **both files** to the incentive application as documents (in the program-applications storage area), so they live with the record and are downloadable by anyone with access to it.
5. Writes an **Income Qualification determination record** that links both files and captures the mode, pathways, required proof, and unit math.

### The generated files

Both files appear under **Generated Files** on the card with download links, and again in the application's document list. File names encode the property address and HUD contract number so they are self-describing once downloaded. The PDF is the proof-and-application packet; the XLSX is the tenant roster the program requires as a separate upload.

### Re-running and history

You can run the tool again at any time — for example after the property's HUD data is corrected, or after units change. Each run produces a fresh determination record and a fresh pair of files; nothing is overwritten. The **Run History** section lists every prior determination with its mode, date, unit counts, and direct links to that run's PDF and XLSX, so the full audit trail is preserved.

### What to do with the output

For an **Entire Building** determination, attach the generated PDF as the categorical-eligibility proof and the XLSX as the tenant data sheet to the program submission, then complete the signature step. For an **Individual Tenants** determination, collect and certify per-tenant income before proceeding — the categorical packet alone is not sufficient.
$md$,
    'Qualification',
    'internal',
    true,
    'c5a01ec8-960f-42ab-8a9e-a49822de89af',
    'c5a01ec8-960f-42ab-8a9e-a49822de89af'
  )
  RETURNING id
)
INSERT INTO public.help_article_anchors (
  haa_article_id, haa_anchor_type, haa_route, haa_object, haa_field, haa_concept, haa_sort_order, haa_created_by
)
SELECT new_article.id, a.atype, a.aroute, a.aobj, a.afield, a.aconcept, a.asort, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid
FROM new_article,
LATERAL (VALUES
  ('object'::text,  NULL::text, 'incentive_applications'::text, NULL::text, NULL::text, 0),
  ('object',        NULL,       'income_qualifications',        NULL,        NULL,        10),
  ('field',         NULL,       'income_qualifications',        'iq_qualifying_mode',          NULL, 20),
  ('field',         NULL,       'income_qualifications',        'iq_eligibility_pathways',      NULL, 25),
  ('field',         NULL,       'income_qualifications',        'iq_required_proof',            NULL, 30),
  ('field',         NULL,       'income_qualifications',        'iq_application_pdf_document_id', NULL, 35),
  ('field',         NULL,       'income_qualifications',        'iq_tenant_xlsx_document_id',   NULL, 40),
  ('concept',       NULL,       NULL,                           NULL, 'income-qualification',        5),
  ('concept',       NULL,       NULL,                           NULL, 'categorical-eligibility',     15),
  ('concept',       NULL,       NULL,                           NULL, 'entire-building-qualification', 45),
  ('concept',       NULL,       NULL,                           NULL, 'individual-tenant-certification', 50),
  ('concept',       NULL,       NULL,                           NULL, 'ira-home-energy-rebates',     55)
) AS a(atype, aroute, aobj, afield, aconcept, asort);