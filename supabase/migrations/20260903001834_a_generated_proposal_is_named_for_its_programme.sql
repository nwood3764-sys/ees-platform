-- A generated proposal is named for its programme, not humanized from its slug.
--
-- The four documents LEAP builds from a record — the HOMES proposal, the HOMES
-- payment-request invoice, the HOMES assessment invoice, and now the HEAR
-- proposal — file themselves under `documents.document_type` slugs that were
-- never registered in the documents.document_type picklist. An unregistered
-- slug is humanized by src/lib/documentTypes.js, so:
--
--   · the 2 HOMES proposals already on prod show as "Homes Proposal", and
--   · a HEAR proposal would show as "Hear Proposal" — the verb, in a Type
--     column, on a programme document.
--
-- LEAP names its programmes HOMES and HEAR. Registering the four slugs gives
-- each the label a person would write, which is the mechanism that already
-- exists for exactly this (HA: the "reservation_customer_report" case). The
-- humanizer keeps both words upper-case as a floor for any future slug, but the
-- registry rows are the answer — a label an admin can edit beats a rule in code.

BEGIN;

INSERT INTO public.picklist_values (
  picklist_object, picklist_field, picklist_value, picklist_label,
  picklist_sort_order, picklist_is_active
)
SELECT v.value, v.field, v.slug, v.label, v.sort, true
FROM (VALUES
  ('documents','document_type','homes_proposal',                'IRA Multifamily HOMES Proposal',                220),
  ('documents','document_type','hear_proposal',                 'IRA Multifamily HEAR Proposal',                 221),
  ('documents','document_type','homes_payment_request_invoice', 'HOMES Payment Request Invoice',                 222),
  ('documents','document_type','homes_assessment_invoice',      'Multifamily Energy Assessment Invoice',         223)
) AS v(value, field, slug, label, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
  WHERE p.picklist_object = 'documents' AND p.picklist_field = 'document_type'
    AND p.picklist_value = v.slug
);

DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(s.slug, ', ') INTO v_missing
  FROM (VALUES ('homes_proposal'),('hear_proposal'),
               ('homes_payment_request_invoice'),('homes_assessment_invoice')) AS s(slug)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.picklist_values p
    WHERE p.picklist_object = 'documents' AND p.picklist_field = 'document_type'
      AND p.picklist_value = s.slug AND p.picklist_is_active
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'These generated-document types are still unregistered and would print humanized: %', v_missing;
  END IF;

  -- The 2 HOMES proposals already filed now resolve to a real label rather than
  -- "Homes Proposal". Asserted because they are the rows this fixes.
  IF EXISTS (SELECT 1 FROM public.documents WHERE document_type = 'homes_proposal')
     AND NOT EXISTS (
       SELECT 1 FROM public.picklist_values
       WHERE picklist_object = 'documents' AND picklist_field = 'document_type'
         AND picklist_value = 'homes_proposal' AND picklist_label LIKE '%HOMES%') THEN
    RAISE EXCEPTION 'The filed HOMES proposals still have no HOMES-labelled type.';
  END IF;
END $$;

COMMIT;
