-- The assessment report can carry the work order's documents.
--
-- Nicholas, 2026-08-25: "we definitely need to have any kind of documents…
-- when we generate the report, you need to show the user the documents, and
-- then they can select the documents to include and do a preview if available.
-- If not, just do a link that the report viewer can download later." — and,
-- on where they come from: "it's the documents related list".
--
-- Which documents appear is chosen at generate time from the work order's
-- Documents related list (the same listing the card on the record shows).
-- Nothing is included until it is picked, so this section prints nothing on a
-- report where none were chosen — it sits before the footer and is invisible
-- otherwise.
--
-- Inserted rather than rebuilt, so the layout the user has is left alone.
WITH u AS (
  SELECT id FROM public.users WHERE user_is_deleted IS NOT TRUE
  ORDER BY (user_email = 'nicholas.wood@ees-wi.org') DESC, user_created_at LIMIT 1
), t AS (
  SELECT id FROM public.submittal_document_templates
   WHERE sdt_document_key = 'multifamily_energy_assessment_report'
     AND sdt_opportunity_record_type IS NULL
     AND sdt_is_deleted IS NOT TRUE
   LIMIT 1
), footer AS (
  SELECT s.id, s.sdts_sort_order
    FROM public.submittal_document_template_sections s
   WHERE s.sdt_id = (SELECT id FROM t)
     AND s.sdts_section_type = 'assessment_footer'
     AND s.sdts_is_deleted IS NOT TRUE
   LIMIT 1
), bumped AS (
  -- Make room immediately before the footer.
  UPDATE public.submittal_document_template_sections s
     SET sdts_sort_order = s.sdts_sort_order + 10
   WHERE s.id = (SELECT id FROM footer)
  RETURNING s.id
)
INSERT INTO public.submittal_document_template_sections
  (sdts_record_number, sdt_id, sdts_name, sdts_section_type, sdts_config, sdts_sort_order,
   sdts_owner, sdts_created_by, is_seed_data)
SELECT '', t.id, 'Documents', 'assessment_documents',
  '{"heading":"Documents","link_hint":"Click the name to open or download this file."}'::jsonb,
  (SELECT sdts_sort_order FROM footer), u.id, u.id, true
FROM u CROSS JOIN t
CROSS JOIN (SELECT count(*) FROM bumped) AS _bump_first
WHERE NOT EXISTS (
  SELECT 1 FROM public.submittal_document_template_sections s2
   WHERE s2.sdt_id = (SELECT id FROM t)
     AND s2.sdts_section_type = 'assessment_documents'
     AND s2.sdts_is_deleted IS NOT TRUE);

DO $$
DECLARE v_docs int; v_doc_ord int; v_footer_ord int;
BEGIN
  SELECT count(*) INTO v_docs
    FROM public.submittal_document_template_sections s
    JOIN public.submittal_document_templates t ON t.id = s.sdt_id
   WHERE t.sdt_document_key = 'multifamily_energy_assessment_report'
     AND s.sdts_section_type = 'assessment_documents'
     AND s.sdts_is_deleted IS NOT TRUE;
  SELECT s.sdts_sort_order INTO v_doc_ord
    FROM public.submittal_document_template_sections s
    JOIN public.submittal_document_templates t ON t.id = s.sdt_id
   WHERE t.sdt_document_key = 'multifamily_energy_assessment_report'
     AND s.sdts_section_type = 'assessment_documents' AND s.sdts_is_deleted IS NOT TRUE;
  SELECT s.sdts_sort_order INTO v_footer_ord
    FROM public.submittal_document_template_sections s
    JOIN public.submittal_document_templates t ON t.id = s.sdt_id
   WHERE t.sdt_document_key = 'multifamily_energy_assessment_report'
     AND s.sdts_section_type = 'assessment_footer' AND s.sdts_is_deleted IS NOT TRUE;
  IF v_docs <> 1 OR v_doc_ord IS NULL OR v_footer_ord IS NULL OR v_doc_ord >= v_footer_ord THEN
    RAISE EXCEPTION 'Documents section not placed before the footer (docs %, doc_ord %, footer_ord %)',
      v_docs, v_doc_ord, v_footer_ord;
  END IF;
  RAISE NOTICE 'Documents section added at % (footer at %).', v_doc_ord, v_footer_ord;
END $$;
