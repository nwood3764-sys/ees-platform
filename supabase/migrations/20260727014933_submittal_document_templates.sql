-- Submittal Document Templates
--
-- A submittal document IS its ordered list of sections. Storing that list
-- makes each document a record that can be opened and edited, and makes a new
-- program's document a COPY of a working one rather than a code change.
--
-- Every section renders through real vector-drawing code (SECTION_RENDERERS in
-- src/data/paperworkModel.js), so templates keep the layout quality a
-- docx/HTML pipeline would destroy. `sdts_config` holds the editable content
-- for that section -- headings, fixed row sets, list items, signature label.

CREATE SEQUENCE IF NOT EXISTS seq_submittal_document_templates;
CREATE SEQUENCE IF NOT EXISTS seq_submittal_document_template_sections;

CREATE TABLE public.submittal_document_templates (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sdt_record_number             text NOT NULL,
  sdt_name                      text NOT NULL,
  sdt_description               text,
  sdt_document_key              text NOT NULL,
  sdt_kind                      text NOT NULL CHECK (sdt_kind IN ('audit','proposal','invoice')),
  sdt_opportunity_record_type   uuid REFERENCES picklist_values(id),
  sdt_is_active                 boolean NOT NULL DEFAULT true,
  sdt_notes                     text,
  sdt_owner                     uuid NOT NULL REFERENCES users(id),
  sdt_created_by                uuid NOT NULL REFERENCES users(id),
  sdt_created_at                timestamptz NOT NULL DEFAULT now(),
  sdt_updated_by                uuid REFERENCES users(id),
  sdt_updated_at                timestamptz,
  sdt_is_deleted                boolean NOT NULL DEFAULT false,
  sdt_deleted_at                timestamptz,
  sdt_deleted_by                uuid REFERENCES users(id),
  sdt_deletion_reason           text,
  is_seed_data                  boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX uq_sdt_key_record_type
  ON public.submittal_document_templates (sdt_document_key, sdt_opportunity_record_type)
  WHERE sdt_is_deleted = false AND sdt_opportunity_record_type IS NOT NULL;
CREATE UNIQUE INDEX uq_sdt_key_default
  ON public.submittal_document_templates (sdt_document_key)
  WHERE sdt_is_deleted = false AND sdt_opportunity_record_type IS NULL;

CREATE TABLE public.submittal_document_template_sections (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sdts_record_number      text NOT NULL,
  sdt_id                  uuid NOT NULL REFERENCES submittal_document_templates(id),
  sdts_name               text NOT NULL,
  sdts_section_type       text NOT NULL,
  sdts_config             jsonb NOT NULL DEFAULT '{}'::jsonb,
  sdts_sort_order         integer NOT NULL DEFAULT 100,
  sdts_is_active          boolean NOT NULL DEFAULT true,
  sdts_owner              uuid NOT NULL REFERENCES users(id),
  sdts_created_by         uuid NOT NULL REFERENCES users(id),
  sdts_created_at         timestamptz NOT NULL DEFAULT now(),
  sdts_updated_by         uuid REFERENCES users(id),
  sdts_updated_at         timestamptz,
  sdts_is_deleted         boolean NOT NULL DEFAULT false,
  sdts_deleted_at         timestamptz,
  sdts_deleted_by         uuid REFERENCES users(id),
  sdts_deletion_reason    text,
  is_seed_data            boolean NOT NULL DEFAULT false
);

CREATE INDEX idx_sdts_template ON public.submittal_document_template_sections (sdt_id)
  WHERE sdts_is_deleted = false;

CREATE OR REPLACE FUNCTION public.set_sdt_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog' AS $fn$
BEGIN
  NEW.sdt_record_number := generate_record_number('SDT-', 'seq_submittal_document_templates');
  RETURN NEW;
END $fn$;
CREATE OR REPLACE FUNCTION public.set_sdts_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog' AS $fn$
BEGIN
  NEW.sdts_record_number := generate_record_number('SDTS-', 'seq_submittal_document_template_sections');
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_sdt_rn BEFORE INSERT ON public.submittal_document_templates
  FOR EACH ROW EXECUTE FUNCTION set_sdt_record_number();
CREATE TRIGGER trg_audit_sdt AFTER INSERT OR UPDATE OR DELETE ON public.submittal_document_templates
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_sdt_no_hard_delete BEFORE DELETE ON public.submittal_document_templates
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();
CREATE TRIGGER trg_sdts_rn BEFORE INSERT ON public.submittal_document_template_sections
  FOR EACH ROW EXECUTE FUNCTION set_sdts_record_number();
CREATE TRIGGER trg_audit_sdts AFTER INSERT OR UPDATE OR DELETE ON public.submittal_document_template_sections
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_sdts_no_hard_delete BEFORE DELETE ON public.submittal_document_template_sections
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();

ALTER TABLE public.submittal_document_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY sdt_select ON public.submittal_document_templates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY sdt_insert ON public.submittal_document_templates
  FOR INSERT TO authenticated WITH CHECK (app_user_can('submittal_document_templates','create'));
CREATE POLICY sdt_update ON public.submittal_document_templates
  FOR UPDATE TO authenticated USING (app_user_can('submittal_document_templates','update'))
  WITH CHECK (app_user_can('submittal_document_templates','update'));
CREATE POLICY sdt_delete ON public.submittal_document_templates
  FOR DELETE TO authenticated USING (app_user_can('submittal_document_templates','delete'));

ALTER TABLE public.submittal_document_template_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY sdts_select ON public.submittal_document_template_sections
  FOR SELECT TO authenticated USING (true);
CREATE POLICY sdts_insert ON public.submittal_document_template_sections
  FOR INSERT TO authenticated WITH CHECK (app_user_can('submittal_document_template_sections','create'));
CREATE POLICY sdts_update ON public.submittal_document_template_sections
  FOR UPDATE TO authenticated USING (app_user_can('submittal_document_template_sections','update'))
  WITH CHECK (app_user_can('submittal_document_template_sections','update'));
CREATE POLICY sdts_delete ON public.submittal_document_template_sections
  FOR DELETE TO authenticated USING (app_user_can('submittal_document_template_sections','delete'));

NOTIFY pgrst, 'reload schema';
