-- The assessment report is the building and its tagged photographs. Nothing else.
--
-- Nicholas, 2026-08-24: "These sections are junk. We just want the photos.
-- Just the tagged photos." — and, of the deliverables/acknowledgment block,
-- "Delete all of this."
--
-- Removed: the Overview narrative, Energy Savings Opportunities, Deliverables,
-- the Acknowledgment and signature block, and the two "Attachments —" framings.
-- All of that was invented; none of it was asked for, and an assessment report
-- is a record of what was seen, not a set of assertions about the document.
--
-- What remains: the cover, the building summary, one section per system in the
-- DOE Audit Template's order (each appearing only when it has photographs),
-- a catch-all for any tagged photograph the sections did not show, and the
-- page footer. Headings drop the "Facility Description — " prefix: with the
-- other parts gone there is nothing to distinguish them from.
--
-- Old rows are soft-deleted, so the previous layout stays recoverable.
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
         sdts_deletion_reason = 'Replaced: the report is the building and its tagged photographs.'
   WHERE s.sdt_id = (SELECT id FROM t)
     AND s.sdts_is_deleted IS NOT TRUE
  RETURNING s.id
)
INSERT INTO public.submittal_document_template_sections
  (sdts_record_number, sdt_id, sdts_name, sdts_section_type, sdts_config, sdts_sort_order,
   sdts_owner, sdts_created_by, is_seed_data)
SELECT '', t.id, v.name, v.stype, v.cfg::jsonb, v.ord, u.id, u.id, true
FROM u CROSS JOIN t
CROSS JOIN (SELECT count(*) FROM retired) AS _retire_first
CROSS JOIN (VALUES
  ('Report Cover', 'assessment_cover', '{}', 10),
  ('Building Summary', 'assessment_building_summary', '{"heading":"Building Summary"}', 20),
  ('Building Characteristics and Use Types', 'assessment_field_data',
    '{"step":"Building Geometry & Use","heading":"Building Characteristics and Use Types","photos":"step"}', 30),
  ('Roofs', 'assessment_field_data',
    '{"step":"Roof / Ceiling","heading":"Roofs","photos":"step"}', 40),
  ('Walls', 'assessment_field_data',
    '{"step":"Walls","heading":"Walls","photos":"step"}', 50),
  ('Windows', 'assessment_field_data',
    '{"step":"Windows & Doors","heading":"Windows","photos":"step"}', 60),
  ('Foundation Types', 'assessment_field_data',
    '{"step":"Foundation / Floor","heading":"Foundation Types","photos":"step"}', 70),
  ('Lighting', 'assessment_field_data',
    '{"step":"Common-Area Lighting","heading":"Lighting","photos":"step"}', 80),
  ('HVAC Systems: Heating', 'assessment_field_data',
    '{"step":"Heating Systems","heading":"HVAC Systems: Heating","photos":"step"}', 90),
  ('HVAC Systems: Cooling', 'assessment_field_data',
    '{"step":"Cooling Systems","heading":"HVAC Systems: Cooling","photos":"step"}', 100),
  ('Distribution Equipment and Zone Controls', 'assessment_field_data',
    '{"step":"Distribution & Ventilation","heading":"Distribution Equipment and Zone Controls","photos":"step"}', 110),
  ('Service Hot Water Systems', 'assessment_field_data',
    '{"step":"Service Hot Water","heading":"Service Hot Water Systems","photos":"step"}', 120),
  ('Enclosure Tightness and Diagnostics', 'assessment_field_data',
    '{"step":"Building Diagnostics","heading":"Enclosure Tightness and Diagnostics","photos":"step"}', 130),
  ('Utility Data and Benchmarking', 'assessment_field_data',
    '{"step":"Utility & Energy Data","heading":"Utility Data and Benchmarking","photos":"step"}', 140),
  ('Occupancy and Operating Schedules', 'assessment_field_data',
    '{"step":"Occupancy & Operating Schedules","heading":"Occupancy and Operating Schedules","photos":"step"}', 150),
  ('Additional Photographs', 'assessment_photo_documentation',
    '{"heading":"Additional Photographs","columns":2,"group_by_step":true,"exclude_printed":true}', 160),
  ('Page Footer', 'assessment_footer', '{}', 170)
) AS v(name, stype, cfg, ord);

DO $$
DECLARE v_live int; v_junk int;
BEGIN
  SELECT count(*) INTO v_live
    FROM public.submittal_document_template_sections s
    JOIN public.submittal_document_templates t ON t.id = s.sdt_id
   WHERE t.sdt_document_key = 'multifamily_energy_assessment_report'
     AND t.sdt_opportunity_record_type IS NULL
     AND s.sdts_is_deleted IS NOT TRUE;
  SELECT count(*) INTO v_junk
    FROM public.submittal_document_template_sections s
    JOIN public.submittal_document_templates t ON t.id = s.sdt_id
   WHERE t.sdt_document_key = 'multifamily_energy_assessment_report'
     AND s.sdts_is_deleted IS NOT TRUE
     AND s.sdts_section_type IN ('assessment_narrative','assessment_deliverables',
                                 'assessment_recommendations','assessment_signature');
  IF v_live <> 17 OR v_junk > 0 THEN
    RAISE EXCEPTION 'Expected 17 live sections and none of the removed types (got %, % removed-type rows)', v_live, v_junk;
  END IF;
  RAISE NOTICE 'Assessment report is the building and its photographs: % sections.', v_live;
END $$;
