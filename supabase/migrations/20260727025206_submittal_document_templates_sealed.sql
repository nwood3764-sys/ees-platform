-- Sealed-style submittal documents as templates.
--
-- Sealed, Inc. is the primary contractor with EES as a line item — a
-- genuinely different layout from the three EES documents (two-column party
-- header, contractor/name/description items table, zebra-striped rows, red
-- rebate amounts, a totals list). Its sections render through
-- SEALED_SECTION_RENDERERS in src/data/paperworkModel.js. Verified
-- byte-identical to the shipped documents by scripts/paperwork-section-parity.mjs.
--
-- sdt_kind is widened with two Sealed values. It is the discriminator the
-- template editor keys its section palette on: EES sections must not be
-- offered on a Sealed template and vice versa, and 'proposal' already means
-- the EES proposal, so Sealed needs distinct kinds.

ALTER TABLE public.submittal_document_templates
  DROP CONSTRAINT IF EXISTS submittal_document_templates_sdt_kind_check;
ALTER TABLE public.submittal_document_templates
  ADD CONSTRAINT submittal_document_templates_sdt_kind_check
  CHECK (sdt_kind IN ('audit','proposal','invoice','sealed_proposal','sealed_invoice'));

WITH u AS (
  SELECT id FROM public.users WHERE user_is_deleted IS NOT TRUE
  ORDER BY (user_email = 'nicholas.wood@ees-wi.org') DESC, user_created_at LIMIT 1
), t AS (
  INSERT INTO public.submittal_document_templates
    (sdt_record_number, sdt_name, sdt_description, sdt_document_key, sdt_kind,
     sdt_owner, sdt_created_by, is_seed_data)
  SELECT '', v.name, v.descr, v.key, v.kind, u.id, u.id, true
  FROM u CROSS JOIN (VALUES
    ('Sealed Proposal', 'Sealed, Inc. primary-contractor proposal with EES as a line-item contractor. Keeps Sealed''s own format including red rebate amounts.', 'sealed_proposal', 'sealed_proposal'),
    ('Sealed Invoice', 'Sealed, Inc. primary-contractor invoice with EES as a line-item contractor. Keeps Sealed''s own format including red rebate amounts.', 'sealed_invoice', 'sealed_invoice')
  ) AS v(name, descr, key, kind)
  RETURNING id, sdt_document_key
)
INSERT INTO public.submittal_document_template_sections
  (sdts_record_number, sdt_id, sdts_name, sdts_section_type, sdts_config, sdts_sort_order,
   sdts_owner, sdts_created_by, is_seed_data)
SELECT '', t.id, s.name, s.stype, s.cfg::jsonb, s.ord, u.id, u.id, true
FROM (SELECT id FROM public.users WHERE user_is_deleted IS NOT TRUE
      ORDER BY (user_email = 'nicholas.wood@ees-wi.org') DESC, user_created_at LIMIT 1) u
CROSS JOIN (VALUES
  ('sealed_proposal', 'Primary Contractor',   'sealed_primary_contractor_block', '{}', 10),
  ('sealed_proposal', 'Project Details',      'sealed_document_details_block',   '{}', 20),
  ('sealed_proposal', 'Bill To',              'sealed_bill_to_block',            '{}', 30),
  ('sealed_proposal', 'Project Address',      'sealed_project_address_block',    '{}', 40),
  ('sealed_proposal', 'Title',                'sealed_title',                    '{}', 50),
  ('sealed_proposal', 'Line Items',           'sealed_line_items_table',         '{}', 60),
  ('sealed_proposal', 'IRA Rebates',          'sealed_rebate_section',           '{"variant":"ira"}', 70),
  ('sealed_proposal', 'Non-IRA Rebates',      'sealed_rebate_section',           '{"variant":"foe"}', 80),
  ('sealed_proposal', 'Totals',               'sealed_totals_list',              '{}', 90),
  ('sealed_proposal', 'Signature',            'sealed_signature_block',          '{}', 100),

  ('sealed_invoice', 'Primary Contractor',    'sealed_primary_contractor_block', '{}', 10),
  ('sealed_invoice', 'Invoice Details',       'sealed_document_details_block',   '{}', 20),
  ('sealed_invoice', 'Bill To',               'sealed_bill_to_block',            '{}', 30),
  ('sealed_invoice', 'Project Address',       'sealed_project_address_block',    '{}', 40),
  ('sealed_invoice', 'Title',                 'sealed_title',                    '{}', 50),
  ('sealed_invoice', 'Line Items',            'sealed_line_items_table',         '{}', 60),
  ('sealed_invoice', 'IRA Rebates',           'sealed_rebate_section',           '{"variant":"ira"}', 70),
  ('sealed_invoice', 'Non-IRA Rebates',       'sealed_rebate_section',           '{"variant":"foe"}', 80),
  ('sealed_invoice', 'Totals',                'sealed_totals_list',              '{}', 90),
  ('sealed_invoice', 'Signature',             'sealed_signature_block',          '{}', 100)
) AS s(key, name, stype, cfg, ord)
JOIN t ON t.sdt_document_key = s.key;

NOTIFY pgrst, 'reload schema';
