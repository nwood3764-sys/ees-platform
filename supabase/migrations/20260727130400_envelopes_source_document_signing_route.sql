-- Signing route for pre-generated PDFs (e.g. the Final Project Payment Request
-- invoice, which is produced in-app by paperworkModel, not from a
-- document_template). The e-signature pipeline previously required a
-- document_template + published snapshot to render from; a generated PDF has
-- no such route in.
--
-- Additive and backward-compatible: existing envelopes all carry a
-- document_template_id and are unaffected. An envelope now references EITHER a
-- document template OR a source document (exactly one), enforced by a CHECK.
-- The generated PDF's bytes are read from the documents row's storage location;
-- everything downstream (unsigned.pdf upload, recipients, tokens, tabs, signing
-- portal, stamping) is unchanged because it already operates on
-- env_unsigned_pdf_path + envelope_tabs.

ALTER TABLE public.envelopes ALTER COLUMN document_template_id DROP NOT NULL;

ALTER TABLE public.envelopes
  ADD COLUMN IF NOT EXISTS env_source_document_id uuid REFERENCES public.documents(id);

-- Exactly one source: a document template (the existing path) or a generated
-- source document (the new path). num_nonnulls = 1 holds for every existing
-- row (document_template_id set, env_source_document_id null).
ALTER TABLE public.envelopes
  DROP CONSTRAINT IF EXISTS envelopes_source_xor_template;
ALTER TABLE public.envelopes
  ADD CONSTRAINT envelopes_source_xor_template
  CHECK (num_nonnulls(document_template_id, env_source_document_id) = 1);

NOTIFY pgrst, 'reload schema';
