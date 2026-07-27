-- Seed the three EES submittal documents as templates, fully populated: every
-- section present, in order, with its real content in sdts_config so the
-- templates work as-is and can be edited rather than assembled from scratch.
-- Verified byte-identical to the shipped documents by
-- scripts/paperwork-section-parity.mjs.
WITH u AS (
  SELECT id FROM public.users WHERE user_is_deleted IS NOT TRUE
  ORDER BY (user_email = 'nicholas.wood@ees-wi.org') DESC, user_created_at LIMIT 1
), t AS (
  INSERT INTO public.submittal_document_templates
    (sdt_record_number, sdt_name, sdt_description, sdt_document_key, sdt_kind,
     sdt_owner, sdt_created_by, is_seed_data)
  SELECT '', v.name, v.descr, v.key, v.kind, u.id, u.id, true
  FROM u CROSS JOIN (VALUES
    ('Energy Audit Invoice', 'Audit program payment claim. One page: $2,000 gross with the IRA HOMES audit incentive applied as an instant discount, TOTAL DUE $0.00.', 'energy_audit_invoice', 'audit'),
    ('Project Reservation Proposal', 'Wisconsin IRA HOMES Program Project Proposal — the Project Reservation submittal.', 'homes_project_proposal', 'proposal'),
    ('Final Project Payment Request Invoice', 'HOMES Project Invoice — the Final Project Payment Request submittal. Requires signature.', 'homes_project_invoice', 'invoice')
  ) AS v(name, descr, key, kind)
  RETURNING id, sdt_document_key
)
INSERT INTO public.submittal_document_template_sections
  (sdts_record_number, sdt_id, sdts_name, sdts_section_type, sdts_config, sdts_sort_order,
   sdts_owner, sdts_created_by, is_seed_data)
SELECT '', t.id, s.name, s.stype, s.cfg::jsonb, s.ord, u.id, u.id, true
FROM u CROSS JOIN (VALUES
  ('energy_audit_invoice', 'Company Header',        'company_header',               '{}', 10),
  ('energy_audit_invoice', 'Meta and Parties',      'document_meta_and_parties',    '{}', 20),
  ('energy_audit_invoice', 'Audit Services',        'audit_services_table',
    '{"heading":"Audit Services","rows":[["1","Whole-Building Energy Audit — Multifamily","1","Building","$2,000.00","$2,000.00"],["2","Per-Unit Blower Door and Diagnostic Testing","","Unit","","Included"],["3","Common Area and Building Envelope Assessment","1","Lump Sum","","Included"],["4","Mechanical Systems Survey","1","Lump Sum","","Included"]]}', 30),
  ('energy_audit_invoice', 'Rebates and Incentives','rebate_credits_table',         '{"heading":"Rebates & Incentives Applied"}', 40),
  ('energy_audit_invoice', 'Totals',                'totals_box',                   '{}', 50),
  ('energy_audit_invoice', 'Deliverables',          'deliverables_list',
    '{"heading":"Deliverables","items":["Whole-Building Energy Audit Report (ASHRAE Level II equivalent)","HPXML v4 / BuildingSync file from Asset Score","Customer Report / Building Assessment Tool Report"]}', 60),
  ('energy_audit_invoice', 'Acknowledgment and Signature','acknowledgment_and_signature',
    '{"heading":"Acknowledgment & Acceptance","signer_label":"Property Owner / Authorized Representative"}', 70),
  ('energy_audit_invoice', 'Footer',                'page_footer',                  '{}', 80),

  ('homes_project_proposal', 'Company Header',      'company_header',               '{}', 10),
  ('homes_project_proposal', 'Meta and Parties',    'document_meta_and_parties',    '{}', 20),
  ('homes_project_proposal', 'Measure Line Items',  'measure_line_items_table',
    '{"heading":"Proposed Scope of Work — HOMES Project"}', 30),
  ('homes_project_proposal', 'Rebates and Incentives','rebate_credits_table',       '{"heading":"Applicable Rebates & Incentives"}', 40),
  ('homes_project_proposal', 'Totals',              'totals_box',                   '{}', 50),
  ('homes_project_proposal', 'Acknowledgment and Signature','acknowledgment_and_signature',
    '{"heading":"Acknowledgment & Acceptance","signer_label":"Property Owner / Authorized Representative"}', 60),
  ('homes_project_proposal', 'Footer',              'page_footer',                  '{}', 70),

  ('homes_project_invoice', 'Company Header',       'company_header',               '{}', 10),
  ('homes_project_invoice', 'Meta and Parties',     'document_meta_and_parties',    '{}', 20),
  ('homes_project_invoice', 'Measure Line Items',   'measure_line_items_table',
    '{"heading":"Installed Scope of Work — HOMES Project"}', 30),
  ('homes_project_invoice', 'Rebates and Incentives','rebate_credits_table',        '{"heading":"Applicable Rebates & Incentives"}', 40),
  ('homes_project_invoice', 'Totals',               'totals_box',                   '{}', 50),
  ('homes_project_invoice', 'Acknowledgment and Signature','acknowledgment_and_signature',
    '{"heading":"Acknowledgment & Acceptance","signer_label":"Property Owner / Authorized Representative"}', 60),
  ('homes_project_invoice', 'Footer',               'page_footer',                  '{}', 70)
) AS s(key, name, stype, cfg, ord)
JOIN t ON t.sdt_document_key = s.key;
