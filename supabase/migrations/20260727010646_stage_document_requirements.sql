-- Stage Document Requirements
--
-- Nicholas's rule (2026-07-27): "Documents are really based on the stage that
-- a record is at. Doesn't really matter what module."
--
-- So the mapping is (object, status/stage value) -> documents, not a
-- module-specific matrix. `sdr_object` is a bare table name, so this works for
-- opportunities, projects, work orders, enrollments -- anything with a status.
--
-- For opportunities this is a SINGLE lookup, because opportunity stage
-- picklists are record-type-scoped and never shared: the value "Opportunity --
-- WI HOMES Audit Phase 4: Project Reservation" already means *this program,
-- this submittal*. Program and stage are one key, not two axes.
--
-- A requirement points at EITHER a code-generated document (sdr_document_key,
-- matching DOCUMENTS in src/data/paperworkSubmittals.js) OR a document
-- template row -- never both.

CREATE SEQUENCE IF NOT EXISTS seq_stage_document_requirements;

CREATE TABLE public.stage_document_requirements (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sdr_record_number         text NOT NULL,
  sdr_name                  text NOT NULL,
  sdr_object                text NOT NULL,
  sdr_stage_value_id        uuid NOT NULL REFERENCES picklist_values(id),
  sdr_document_key          text,
  sdr_document_template_id  uuid REFERENCES document_templates(id),
  sdr_is_required           boolean NOT NULL DEFAULT true,
  sdr_requires_signature    boolean NOT NULL DEFAULT false,
  sdr_signer_role           text,
  sdr_sort_order            integer NOT NULL DEFAULT 100,
  sdr_is_active             boolean NOT NULL DEFAULT true,
  sdr_notes                 text,
  sdr_owner                 uuid NOT NULL REFERENCES users(id),
  sdr_created_by            uuid NOT NULL REFERENCES users(id),
  sdr_created_at            timestamptz NOT NULL DEFAULT now(),
  sdr_updated_by            uuid REFERENCES users(id),
  sdr_updated_at            timestamptz,
  sdr_is_deleted            boolean NOT NULL DEFAULT false,
  sdr_deleted_at            timestamptz,
  sdr_deleted_by            uuid REFERENCES users(id),
  sdr_deletion_reason       text,
  is_seed_data              boolean NOT NULL DEFAULT false,
  CONSTRAINT sdr_one_document_source CHECK (
    (sdr_document_key IS NOT NULL AND sdr_document_template_id IS NULL) OR
    (sdr_document_key IS NULL AND sdr_document_template_id IS NOT NULL)
  )
);

CREATE INDEX idx_sdr_stage ON public.stage_document_requirements (sdr_stage_value_id)
  WHERE sdr_is_deleted = false;
CREATE INDEX idx_sdr_object ON public.stage_document_requirements (sdr_object)
  WHERE sdr_is_deleted = false;

CREATE OR REPLACE FUNCTION public.set_sdr_requirement_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog' AS $fn$
BEGIN
  NEW.sdr_record_number := generate_record_number('SDR-', 'seq_stage_document_requirements');
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_sdr_rn BEFORE INSERT ON public.stage_document_requirements
  FOR EACH ROW EXECUTE FUNCTION set_sdr_requirement_record_number();
CREATE TRIGGER trg_audit_sdr_req AFTER INSERT OR UPDATE OR DELETE ON public.stage_document_requirements
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_sdr_req_no_hard_delete BEFORE DELETE ON public.stage_document_requirements
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();

ALTER TABLE public.stage_document_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY sdr_req_select ON public.stage_document_requirements
  FOR SELECT TO authenticated USING (true);
CREATE POLICY sdr_req_insert ON public.stage_document_requirements
  FOR INSERT TO authenticated WITH CHECK (app_user_can('stage_document_requirements','create'));
CREATE POLICY sdr_req_update ON public.stage_document_requirements
  FOR UPDATE TO authenticated USING (app_user_can('stage_document_requirements','update'))
  WITH CHECK (app_user_can('stage_document_requirements','update'));
CREATE POLICY sdr_req_delete ON public.stage_document_requirements
  FOR DELETE TO authenticated USING (app_user_can('stage_document_requirements','delete'));

NOTIFY pgrst, 'reload schema';
