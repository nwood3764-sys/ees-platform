-- =============================================================================
-- The Multifamily Building Energy Assessment Report is laid out to mirror the
-- DOE Audit Template report.
--
-- Nicholas: "we're pairing all these with the asset score. What if I give you
-- the audit template from asset score and you format it and make it in the
-- same order, same headers, same sections, so that somebody can read them side
-- by side? And they'd be in the same order, so all the photos from the systems
-- would be on the same systems."
--
-- Taken from the real report for 101-111 Queens Court, Rocky Mount (DOE Audit
-- Template, PNNL, ANSI/ASHRAE/ACCA Standard 211-2018). Its six parts, in its
-- order, are now this report's order:
--
--   Overview · Contact Information and Audit Details · Facility Description ·
--   Utility Data and Benchmarking · Energy Savings Opportunities · Attachments
--
-- and its sub-section names are this report's headings: Roofs, Walls, Windows,
-- Foundation Types, Lighting, HVAC Systems (Heating / Cooling), Distribution
-- Equipment and Zone Controls, Service Hot Water Systems. Each is fed by the
-- LEAP work step that captured it and prints that step's flagged photos, so
-- the systems photos sit against the same systems in both documents.
--
-- Two ordering facts worth recording, because they are why this list is NOT
-- the work plan's own walk order: Audit Template puts **Windows before
-- Foundation Types** and **Lighting before HVAC**. "Building 360 Video" has no
-- Audit Template counterpart and cannot render in a PDF, so it has none here.
-- Contact/audit details are on this report's cover, which is why that part has
-- no separate section.
--
-- The section list is regenerated from
-- DEFAULT_DOCUMENT_SECTIONS.energyAssessmentReport in src/data/paperworkModel.js
-- so the stored template and the built-in fallback stay the same document.
--
-- SAFETY: this REPLACES the section list of the global (unscoped) template
-- seeded hours earlier in 20260824201155, which nobody has edited yet. A
-- program-scoped clone is untouched — the WHERE clause requires
-- sdt_opportunity_record_type IS NULL. Old rows are soft-deleted, never hard
-- deleted, so the previous layout remains recoverable.
-- =============================================================================

WITH u AS (
  SELECT id FROM public.users WHERE user_is_deleted IS NOT TRUE
  ORDER BY (user_email = 'nicholas.wood@ees-wi.org') DESC, user_created_at LIMIT 1
), t AS (
  SELECT id FROM public.submittal_document_templates
   WHERE sdt_document_key = 'multifamily_energy_assessment_report'
     AND sdt_opportunity_record_type IS NULL
     AND sdt_is_deleted IS NOT TRUE
   LIMIT 1
), retired AS (
  UPDATE public.submittal_document_template_sections s
     SET sdts_is_deleted = true,
         sdts_deleted_at = now(),
         sdts_deleted_by = (SELECT id FROM u),
         sdts_deletion_reason = 'Replaced by the layout that mirrors the DOE Audit Template report.'
   WHERE s.sdt_id = (SELECT id FROM t)
     AND s.sdts_is_deleted IS NOT TRUE
  RETURNING s.id
)
INSERT INTO public.submittal_document_template_sections
  (sdts_record_number, sdt_id, sdts_name, sdts_section_type, sdts_config, sdts_sort_order,
   sdts_owner, sdts_created_by, is_seed_data)
SELECT '', t.id, v.name, v.stype, v.cfg::jsonb, v.ord, u.id, u.id, true
FROM u CROSS JOIN t
CROSS JOIN (SELECT count(*) FROM retired) AS _force_retire_first
CROSS JOIN (VALUES
  ('Report Cover', 'assessment_cover',
    '{"subtitle":"ANSI/ASHRAE/ACCA Standard 211 Level 2 — Field Data Record"}', 10),
  ('Overview', 'assessment_narrative',
    '{"heading":"Overview","body":"Energy Efficiency Services performed a whole-building energy assessment of the building identified above. This report is the field record of that assessment: the observed condition of the building’s envelope, its central and common-area mechanical systems, its service hot water and lighting, and the utility and occupancy data collected for it, together with the photographs taken on site.\n\nIts sections follow the DOE Audit Template report (ANSI/ASHRAE/ACCA Standard 211) so the two documents can be read side by side, section for section. Contact information and audit details — who performed the assessment, for whom, and on what date — appear on the cover of this report."}', 20),
  ('Facility Description — Building Summary', 'assessment_building_summary',
    '{"heading":"Facility Description — Building Summary"}', 30),
  ('Facility Description — Building Characteristics and Use Types', 'assessment_field_data',
    '{"step":"Building Geometry & Use","heading":"Facility Description — Building Characteristics and Use Types","photos":"step"}', 40),
  ('Facility Description — Roofs', 'assessment_field_data',
    '{"step":"Roof / Ceiling","heading":"Facility Description — Roofs","photos":"step"}', 50),
  ('Facility Description — Walls', 'assessment_field_data',
    '{"step":"Walls","heading":"Facility Description — Walls","photos":"step"}', 60),
  ('Facility Description — Windows', 'assessment_field_data',
    '{"step":"Windows & Doors","heading":"Facility Description — Windows","photos":"step"}', 70),
  ('Facility Description — Foundation Types', 'assessment_field_data',
    '{"step":"Foundation / Floor","heading":"Facility Description — Foundation Types","photos":"step"}', 80),
  ('Facility Description — Lighting', 'assessment_field_data',
    '{"step":"Common-Area Lighting","heading":"Facility Description — Lighting","photos":"step"}', 90),
  ('Facility Description — HVAC Systems: Heating', 'assessment_field_data',
    '{"step":"Heating Systems","heading":"Facility Description — HVAC Systems: Heating","photos":"step"}', 100),
  ('Facility Description — HVAC Systems: Cooling', 'assessment_field_data',
    '{"step":"Cooling Systems","heading":"Facility Description — HVAC Systems: Cooling","photos":"step"}', 110),
  ('Facility Description — Distribution Equipment and Zone Controls', 'assessment_field_data',
    '{"step":"Distribution & Ventilation","heading":"Facility Description — Distribution Equipment and Zone Controls","photos":"step"}', 120),
  ('Facility Description — Service Hot Water Systems', 'assessment_field_data',
    '{"step":"Service Hot Water","heading":"Facility Description — Service Hot Water Systems","photos":"step"}', 130),
  ('Facility Description — Enclosure Tightness and Diagnostics', 'assessment_field_data',
    '{"step":"Building Diagnostics","heading":"Facility Description — Enclosure Tightness and Diagnostics","photos":"step"}', 140),
  ('Utility Data and Benchmarking', 'assessment_field_data',
    '{"step":"Utility & Energy Data","heading":"Utility Data and Benchmarking","photos":"step"}', 150),
  ('Utility Data and Benchmarking — Occupancy and Operating Schedules', 'assessment_field_data',
    '{"step":"Occupancy & Operating Schedules","heading":"Utility Data and Benchmarking — Occupancy and Operating Schedules","photos":"step"}', 160),
  ('Energy Savings Opportunities', 'assessment_recommendations',
    '{"heading":"Energy Savings Opportunities","body":"The measures below are the opportunities identified during this assessment. Their modelled energy savings, cost, incentives and payback are produced by the energy model and are reported in the Audit Template report’s Energy Savings Opportunities section; they are not computed here."}', 170),
  ('Attachments — Building Photographs', 'assessment_field_data',
    '{"step":"Building Photos","heading":"Attachments — Building Photographs","photos":"step"}', 180),
  ('Attachments — Additional Photo Documentation', 'assessment_photo_documentation',
    '{"heading":"Attachments — Additional Photo Documentation","columns":2,"group_by_step":true,"exclude_printed":true,"empty_label":"All photos marked “Include in final report” are shown with their sections above."}', 190),
  ('Deliverables', 'assessment_deliverables',
    '{"heading":"Deliverables","items":["Whole-Building Energy Audit Report (ASHRAE Level II equivalent)","DOE Audit Template report","HPXML v4 / BuildingSync file from Asset Score","Customer Report / Building Assessment Tool Report"]}', 200),
  ('Acknowledgment & Signature', 'assessment_signature',
    '{}', 210),
  ('Page Footer', 'assessment_footer',
    '{}', 220)
) AS v(name, stype, cfg, ord);

-- Also record what this report pairs with, so the description says it.
UPDATE public.submittal_document_templates
   SET sdt_description = 'The audit''s own deliverable, generated from a Multifamily Energy Assessment work order. Laid out to mirror the DOE Audit Template report (ANSI/ASHRAE/ACCA Standard 211) — same parts, same order, same sub-section names — so the two can be read side by side. Each section prints the questions and answers from the work step that captured it, with that step''s photos marked "Include in final report".'
 WHERE sdt_document_key = 'multifamily_energy_assessment_report'
   AND sdt_opportunity_record_type IS NULL
   AND sdt_is_deleted IS NOT TRUE;

-- Verify: exactly one live section list, of the expected length, in the
-- expected order — or fail loudly rather than ship a half-replaced template.
DO $$
DECLARE v_live int; v_first text; v_windows int; v_foundation int;
BEGIN
  SELECT count(*) INTO v_live
    FROM public.submittal_document_template_sections s
    JOIN public.submittal_document_templates t ON t.id = s.sdt_id
   WHERE t.sdt_document_key = 'multifamily_energy_assessment_report'
     AND t.sdt_opportunity_record_type IS NULL
     AND s.sdts_is_deleted IS NOT TRUE;
  SELECT s.sdts_section_type INTO v_first
    FROM public.submittal_document_template_sections s
    JOIN public.submittal_document_templates t ON t.id = s.sdt_id
   WHERE t.sdt_document_key = 'multifamily_energy_assessment_report'
     AND t.sdt_opportunity_record_type IS NULL
     AND s.sdts_is_deleted IS NOT TRUE
   ORDER BY s.sdts_sort_order LIMIT 1;
  SELECT s.sdts_sort_order INTO v_windows
    FROM public.submittal_document_template_sections s
    JOIN public.submittal_document_templates t ON t.id = s.sdt_id
   WHERE t.sdt_document_key = 'multifamily_energy_assessment_report'
     AND t.sdt_opportunity_record_type IS NULL
     AND s.sdts_is_deleted IS NOT TRUE
     AND s.sdts_config->>'step' = 'Windows & Doors';
  SELECT s.sdts_sort_order INTO v_foundation
    FROM public.submittal_document_template_sections s
    JOIN public.submittal_document_templates t ON t.id = s.sdt_id
   WHERE t.sdt_document_key = 'multifamily_energy_assessment_report'
     AND t.sdt_opportunity_record_type IS NULL
     AND s.sdts_is_deleted IS NOT TRUE
     AND s.sdts_config->>'step' = 'Foundation / Floor';
  IF v_live <> 22 OR v_first <> 'assessment_cover' THEN
    RAISE EXCEPTION 'Assessment report template is not the expected 22 sections starting with the cover (got % sections, first %)', v_live, v_first;
  END IF;
  -- The Audit Template order, asserted rather than assumed.
  IF v_windows IS NULL OR v_foundation IS NULL OR v_windows >= v_foundation THEN
    RAISE EXCEPTION 'Windows must precede Foundation Types to match the Audit Template (windows %, foundation %)', v_windows, v_foundation;
  END IF;
  RAISE NOTICE 'Assessment report mirrors the Audit Template: % live sections.', v_live;
END $$;
