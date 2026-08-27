-- Document types, in words.
--
-- `documents.document_type` is free text holding an internal slug, stamped by
-- whichever document SLOT a file was uploaded into or by the generator that
-- produced it. Nothing ever translated it, so every screen printed the slug
-- raw: on the WI-IRA-MF-HOMES-PR enrollment layout a column headed "Type" read
-- `reservation_customer_report`.
--
-- Nicholas, 2026-08-27: "where did these types come in?… I don't understand
-- that. When the type is like a PDF or Word document" — then, having seen the
-- slot cards they came from: "all of those names came from the enrollment
-- screen from the program, so keep them the same."
--
-- So this changes NO name and NO stored value. It registers the label each
-- slug already had on screen, as a value-keyed picklist under
-- (documents, document_type) — exactly the shape photos.photo_type already
-- uses. The client renders the label; the column, the generators and the slot
-- cards keep writing and matching the same slug they always did.
--
-- Labels are the program's own wording, taken from the widget titles that
-- declare each slug, trimmed only of the parenthetical examples that belong on
-- a card heading rather than under a filename. An unregistered slug is
-- humanized by the client (src/lib/documentTypes.js), so this list is a
-- courtesy, not a dependency — and an admin renames any of them in Setup with
-- no deploy.
--
-- 'attachment' is deliberately NOT registered: it is the sentinel for "no
-- particular kind" (documents.document_type is NOT NULL), and the card
-- configuration form offers it as "Any document (catch-all)" in its own right.

INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label, picklist_sort_order, picklist_is_active)
VALUES
  -- Project Reservation stage (WI-IRA-MF-HOMES-PR enrollment layout)
  ('documents', 'document_type', 'reservation_hpxml',                  'Reservation HPXMLv4 / BuildingSync File', 10, true),
  ('documents', 'document_type', 'audit_template_report',              'Audit Template Report',                   20, true),
  ('documents', 'document_type', 'reservation_customer_report',        'Reservation Customer Report',             30, true),
  ('documents', 'document_type', 'customer_contract_sow',              'Customer Contract Scope of Work',         40, true),
  ('documents', 'document_type', 'li_owner_acknowledgment',            'Low-Income Building Owner Acknowledgment Form', 50, true),
  -- Final Project Payment Request stage
  ('documents', 'document_type', 'payment_hpxml',                      'Payment HPXMLv4 / BuildingSync File',     60, true),
  ('documents', 'document_type', 'payment_customer_report',            'Payment Customer Report',                 70, true),
  ('documents', 'document_type', 'payment_w9',                         'Payment W-9',                             80, true),
  ('documents', 'document_type', 'homes_final_invoice',                'HOMES Final Invoice',                     90, true),
  ('documents', 'document_type', 'project_summary_offer_letter',       'Project Summary / Offer Letter',         100, true),
  ('documents', 'document_type', 'notification_combustion_safety_mf5', 'Combustion Safety Notification (MF5)',   110, true),
  ('documents', 'document_type', 'qi_tool_pdf',                        'QI Tool Report',                         120, true),
  -- Audit / assessment program
  ('documents', 'document_type', 'assessment_asset_score',             'Asset Score Report',                     130, true),
  ('documents', 'document_type', 'assessment_buildingsync_file',       'BuildingSync File',                      140, true),
  ('documents', 'document_type', 'assessment_invoice',                 'Assessment Invoice',                     150, true),
  ('documents', 'document_type', 'energy_assessment_report',           'Energy Assessment Report',               160, true),
  -- Income qualification (generated on enrollments)
  ('documents', 'document_type', 'income_qualification_application',   'Income Qualification Application',       170, true),
  ('documents', 'document_type', 'income_qualification_tenant_sheet',  'Income Qualification Tenant Data',       180, true),
  -- General
  ('documents', 'document_type', 'w9',                                 'W-9',                                    190, true),
  ('documents', 'document_type', 'coi',                                'Certificate of Insurance',               200, true),
  ('documents', 'document_type', 'video',                              'Video',                                  210, true);

-- Every type carried by a live document, and every type a slot card declares,
-- must now resolve to a label — otherwise a screen still shows a slug that a
-- person has actually seen. Raise rather than ship a half-registered list.
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(DISTINCT t, ', ') INTO v_missing
  FROM (
    SELECT document_type AS t
      FROM public.documents
     WHERE is_deleted IS NOT TRUE
       AND document_type IS NOT NULL
       AND document_type <> 'attachment'
    UNION
    SELECT w.widget_config->>'document_type'
      FROM public.page_layout_widgets w
      JOIN public.page_layouts pl ON pl.id = w.page_layout_id
     WHERE w.is_deleted IS NOT TRUE
       AND pl.is_deleted IS NOT TRUE
       AND w.widget_type = 'file_gallery'
       AND coalesce(w.widget_config->>'document_type', 'attachment') <> 'attachment'
  ) AS used
  WHERE NOT EXISTS (
    SELECT 1 FROM public.picklist_values pv
     WHERE pv.picklist_object = 'documents'
       AND pv.picklist_field = 'document_type'
       AND pv.picklist_value = used.t
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'document types in use with no registered label: %', v_missing;
  END IF;
END $$;
