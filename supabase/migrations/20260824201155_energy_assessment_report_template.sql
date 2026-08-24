-- =============================================================================
-- Energy Assessment Report — its own document kind and its own template.
--
-- An energy assessment report is the DELIVERABLE OF THE AUDIT: the write-up of
-- what the assessor found on the building. It is not a program submittal.
-- Project Reservation and Final Project Payment Request are filings to a
-- program administering body at an incentive application stage, and they are
-- generated on the PROJECT. This one is generated from the assessment WORK
-- ORDER that captured the data, and it is the first consumer of the
-- `photos.include_in_final_report` curation flag (added 20260720140000, until
-- now read by nothing).
--
-- Keyed by the assessment work order's record type, via the document key:
--   MULTIFAMILY-ENERGY-ASSESSMENT  → multifamily_energy_assessment_report
-- because the report's SHAPE follows what was assessed (a whole multifamily
-- building vs a single-family home), not which program pays for it. Program
-- variation on top of that shape rides the existing axis: a template scoped to
-- an opportunity record type overrides this global default for that program.
--
-- The section list below is generated from
-- DEFAULT_DOCUMENT_SECTIONS.energyAssessmentReport in src/data/paperworkModel.js,
-- so the seeded template and the built-in fallback are the same document.
-- =============================================================================

-- 1. The new kind. Additive: every existing kind is preserved.
ALTER TABLE public.submittal_document_templates
  DROP CONSTRAINT IF EXISTS submittal_document_templates_sdt_kind_check;
ALTER TABLE public.submittal_document_templates
  ADD CONSTRAINT submittal_document_templates_sdt_kind_check
  CHECK (sdt_kind = ANY (ARRAY[
    'audit', 'proposal', 'invoice',
    'sealed_proposal', 'sealed_invoice',
    'combustion_safety_notification',
    'energy_assessment_report'
  ]));

-- 2. The Multifamily Building Energy Assessment Report template, global
--    (sdt_opportunity_record_type NULL) so every state's MF audit program gets
--    a working report on day one; a program that needs different wording is a
--    Clone Template away.
WITH u AS (
  SELECT id FROM public.users WHERE user_is_deleted IS NOT TRUE
  ORDER BY (user_email = 'nicholas.wood@ees-wi.org') DESC, user_created_at LIMIT 1
), t AS (
  INSERT INTO public.submittal_document_templates
    (sdt_record_number, sdt_name, sdt_description, sdt_document_key, sdt_kind,
     sdt_owner, sdt_created_by, is_seed_data)
  SELECT '',
    'Multifamily Building Energy Assessment Report',
    'The audit''s own deliverable, generated from a Multifamily Energy Assessment work order. Prints every captured section of the work plan with its questions and answers, each with the photos flagged "Include in final report" on that section. Reorder and rename the sections here to mirror the Asset Score report.',
    'multifamily_energy_assessment_report', 'energy_assessment_report',
    u.id, u.id, true
  FROM u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.submittal_document_templates
     WHERE sdt_document_key = 'multifamily_energy_assessment_report'
       AND sdt_opportunity_record_type IS NULL
       AND sdt_is_deleted IS NOT TRUE)
  RETURNING id
)
INSERT INTO public.submittal_document_template_sections
  (sdts_record_number, sdt_id, sdts_name, sdts_section_type, sdts_config, sdts_sort_order,
   sdts_owner, sdts_created_by, is_seed_data)
SELECT '', t.id, s.name, s.stype, s.cfg::jsonb, s.ord, u.id, u.id, true
FROM u CROSS JOIN t CROSS JOIN (VALUES
  ('Report Cover', 'assessment_cover',
    '{}', 10),
  ('Scope & Methodology', 'assessment_narrative',
    '{"heading":"Scope & Methodology","body":"Energy Efficiency Services performed a whole-building energy assessment of the property identified above. The assessment documents the building’s geometry and use, envelope assemblies, central and common-area mechanical systems, service hot water, common-area lighting, and available utility and occupancy data. Findings are recorded in the field at the time of the visit and are supported by the photographic documentation included in this report."}', 20),
  ('Building Summary', 'assessment_building_summary',
    '{"heading":"Building Summary"}', 30),
  ('Building Photographs', 'assessment_field_data',
    '{"step":"Building Photos","heading":"Building Photographs","photos":"step"}', 40),
  ('Building Geometry & Use', 'assessment_field_data',
    '{"step":"Building Geometry & Use","heading":"Building Geometry & Use","photos":"step"}', 50),
  ('Envelope — Roof / Ceiling', 'assessment_field_data',
    '{"step":"Roof / Ceiling","heading":"Envelope — Roof / Ceiling","photos":"step"}', 60),
  ('Envelope — Walls', 'assessment_field_data',
    '{"step":"Walls","heading":"Envelope — Walls","photos":"step"}', 70),
  ('Envelope — Foundation / Floor', 'assessment_field_data',
    '{"step":"Foundation / Floor","heading":"Envelope — Foundation / Floor","photos":"step"}', 80),
  ('Envelope — Windows & Doors', 'assessment_field_data',
    '{"step":"Windows & Doors","heading":"Envelope — Windows & Doors","photos":"step"}', 90),
  ('Heating Systems', 'assessment_field_data',
    '{"step":"Heating Systems","heading":"Heating Systems","photos":"step"}', 100),
  ('Cooling Systems', 'assessment_field_data',
    '{"step":"Cooling Systems","heading":"Cooling Systems","photos":"step"}', 110),
  ('Distribution & Ventilation', 'assessment_field_data',
    '{"step":"Distribution & Ventilation","heading":"Distribution & Ventilation","photos":"step"}', 120),
  ('Service Hot Water', 'assessment_field_data',
    '{"step":"Service Hot Water","heading":"Service Hot Water","photos":"step"}', 130),
  ('Common-Area Lighting', 'assessment_field_data',
    '{"step":"Common-Area Lighting","heading":"Common-Area Lighting","photos":"step"}', 140),
  ('Building Diagnostics', 'assessment_field_data',
    '{"step":"Building Diagnostics","heading":"Building Diagnostics","photos":"step"}', 150),
  ('Utility & Energy Data', 'assessment_field_data',
    '{"step":"Utility & Energy Data","heading":"Utility & Energy Data","photos":"step"}', 160),
  ('Occupancy & Operating Schedules', 'assessment_field_data',
    '{"step":"Occupancy & Operating Schedules","heading":"Occupancy & Operating Schedules","photos":"step"}', 170),
  ('Additional Photo Documentation', 'assessment_photo_documentation',
    '{"heading":"Additional Photo Documentation","columns":2,"group_by_step":true,"exclude_printed":true,"empty_label":"All photos marked “Include in final report” are shown with their sections above."}', 180),
  ('Findings & Recommended Measures', 'assessment_recommendations',
    '{"heading":"Findings & Recommended Measures"}', 190),
  ('Deliverables', 'assessment_deliverables',
    '{"heading":"Deliverables","items":["Whole-Building Energy Audit Report (ASHRAE Level II equivalent)","HPXML v4 / BuildingSync file from Asset Score","Customer Report / Building Assessment Tool Report"]}', 200),
  ('Acknowledgment & Signature', 'assessment_signature',
    '{}', 210),
  ('Page Footer', 'assessment_footer',
    '{}', 220)
) AS s(name, stype, cfg, ord);

-- 3. Verify: the template exists with its full section list, or fail loudly.
DO $$
DECLARE v_sections int; v_templates int;
BEGIN
  SELECT count(*) INTO v_templates
    FROM public.submittal_document_templates
   WHERE sdt_document_key = 'multifamily_energy_assessment_report'
     AND sdt_is_deleted IS NOT TRUE;
  SELECT count(*) INTO v_sections
    FROM public.submittal_document_template_sections s
    JOIN public.submittal_document_templates t ON t.id = s.sdt_id
   WHERE t.sdt_document_key = 'multifamily_energy_assessment_report'
     AND s.sdts_is_deleted IS NOT TRUE;
  IF v_templates < 1 OR v_sections < 20 THEN
    RAISE EXCEPTION 'Energy Assessment Report template did not seed: % template(s), % section(s)',
      v_templates, v_sections;
  END IF;
  RAISE NOTICE 'Energy Assessment Report seeded: % template(s), % section(s)', v_templates, v_sections;
END $$;
