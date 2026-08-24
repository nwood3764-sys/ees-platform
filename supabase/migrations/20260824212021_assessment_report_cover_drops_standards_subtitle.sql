-- The report title carries no standards subtitle.
--
-- Nicholas, 2026-08-24: "remove this wording. ANSI/ASHRAE/ACCA Standard 211
-- Level 2 — Field Data Record ... from the report title."
--
-- The standard is still named in the Overview narrative, where it explains why
-- the report's sections follow the Audit Template's order. It does not belong
-- under the title, where it reads as a claim about the document rather than a
-- description of its layout.
UPDATE public.submittal_document_template_sections s
   SET sdts_config = (s.sdts_config - 'subtitle'),
       sdts_updated_at = now()
  FROM public.submittal_document_templates t
 WHERE t.id = s.sdt_id
   AND t.sdt_document_key = 'multifamily_energy_assessment_report'
   AND s.sdts_section_type = 'assessment_cover'
   AND s.sdts_is_deleted IS NOT TRUE
   AND s.sdts_config ? 'subtitle';

DO $$
DECLARE v_left int;
BEGIN
  SELECT count(*) INTO v_left
    FROM public.submittal_document_template_sections s
    JOIN public.submittal_document_templates t ON t.id = s.sdt_id
   WHERE t.sdt_document_key = 'multifamily_energy_assessment_report'
     AND s.sdts_section_type = 'assessment_cover'
     AND s.sdts_is_deleted IS NOT TRUE
     AND s.sdts_config ? 'subtitle';
  IF v_left > 0 THEN
    RAISE EXCEPTION 'Cover still carries a subtitle on % live section(s)', v_left;
  END IF;
  RAISE NOTICE 'Assessment report cover subtitle removed.';
END $$;
