-- ===========================================================================
-- Submittal Document Text Blocks
--
-- The wording that appears on program submittal documents (measure
-- descriptions, acknowledgment paragraphs, footer lines, document titles) is
-- contractual program language, not application logic. It was hardcoded in
-- src/data/paperworkModel.js; this moves it into the database so it is
-- editable through LEAP Admin without a deploy.
--
-- What stays in code: the program MATH (HOMES tier, Focus on Energy rate
-- bands, breakout fractions, the rounding reconciliation that forces
-- TOTAL DUE to $0.00) and the vector layout engine. Those are business rules
-- and pixel geometry, not content.
--
-- Scoping: each block is keyed by a stable `sdtb_key` and optionally scoped to
-- one opportunity record type (= the program). A row with a NULL record type
-- is the default used by every program; a row carrying a record type overrides
-- the default for that program only. This is what makes "build it out record
-- type by record type" a data edit.
--
-- Tokens: bodies may contain {{baseline_r}} and {{improved_r}}, substituted at
-- render time from the Asset Score reports.
-- ===========================================================================

CREATE SEQUENCE IF NOT EXISTS seq_submittal_document_text_blocks;

CREATE TABLE public.submittal_document_text_blocks (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sdtb_record_number              text NOT NULL,
  sdtb_name                       text NOT NULL,
  sdtb_key                        text NOT NULL,
  sdtb_body                       text NOT NULL,
  -- NULL = the default for every program; set = overrides for that program.
  sdtb_opportunity_record_type    uuid REFERENCES picklist_values(id),
  sdtb_sort_order                 integer NOT NULL DEFAULT 100,
  sdtb_is_active                  boolean NOT NULL DEFAULT true,
  sdtb_notes                      text,
  sdtb_owner                      uuid NOT NULL REFERENCES users(id),
  sdtb_created_by                 uuid NOT NULL REFERENCES users(id),
  sdtb_created_at                 timestamptz NOT NULL DEFAULT now(),
  sdtb_updated_by                 uuid REFERENCES users(id),
  sdtb_updated_at                 timestamptz,
  sdtb_is_deleted                 boolean NOT NULL DEFAULT false,
  sdtb_deleted_at                 timestamptz,
  sdtb_deleted_by                 uuid REFERENCES users(id),
  sdtb_deletion_reason            text,
  is_seed_data                    boolean NOT NULL DEFAULT false
);

-- One block per key per program (and one global default per key).
CREATE UNIQUE INDEX uq_sdtb_key_record_type
  ON public.submittal_document_text_blocks (sdtb_key, sdtb_opportunity_record_type)
  WHERE sdtb_is_deleted = false AND sdtb_opportunity_record_type IS NOT NULL;
CREATE UNIQUE INDEX uq_sdtb_key_default
  ON public.submittal_document_text_blocks (sdtb_key)
  WHERE sdtb_is_deleted = false AND sdtb_opportunity_record_type IS NULL;
CREATE INDEX idx_sdtb_record_type
  ON public.submittal_document_text_blocks (sdtb_opportunity_record_type)
  WHERE sdtb_is_deleted = false;

CREATE OR REPLACE FUNCTION public.set_sdtb_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog' AS $fn$
BEGIN
  NEW.sdtb_record_number := generate_record_number('SDTB-', 'seq_submittal_document_text_blocks');
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_sdtb_rn BEFORE INSERT ON public.submittal_document_text_blocks
  FOR EACH ROW EXECUTE FUNCTION set_sdtb_record_number();
CREATE TRIGGER trg_audit_sdtb AFTER INSERT OR UPDATE OR DELETE ON public.submittal_document_text_blocks
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_sdtb_no_hard_delete BEFORE DELETE ON public.submittal_document_text_blocks
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();

ALTER TABLE public.submittal_document_text_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY sdtb_select ON public.submittal_document_text_blocks
  FOR SELECT TO authenticated USING (true);
CREATE POLICY sdtb_insert ON public.submittal_document_text_blocks
  FOR INSERT TO authenticated WITH CHECK (app_user_can('submittal_document_text_blocks','create'));
CREATE POLICY sdtb_update ON public.submittal_document_text_blocks
  FOR UPDATE TO authenticated USING (app_user_can('submittal_document_text_blocks','update'))
  WITH CHECK (app_user_can('submittal_document_text_blocks','update'));
CREATE POLICY sdtb_delete ON public.submittal_document_text_blocks
  FOR DELETE TO authenticated USING (app_user_can('submittal_document_text_blocks','delete'));

NOTIFY pgrst, 'reload schema';
