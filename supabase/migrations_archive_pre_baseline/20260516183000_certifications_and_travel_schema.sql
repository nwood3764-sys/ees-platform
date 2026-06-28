-- Phase 2 — skills/certifications + property travel buffer (schema only)
--
-- Four new tables: certifications (reference catalog), contact_certifications
-- (junction with issued/expires dates), work_type_required_certifications
-- (junction), and property_distances (symmetric drive-time matrix).
-- Pattern matches service_appointment_assignments: prefixed soft-delete cols,
-- record-number auto-numbering trigger, audit trigger, no-hard-delete guard,
-- and RLS policies gated on app_is_office_side().

-- ── certifications ──────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_certifications;
CREATE TABLE public.certifications (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_record_number     text NOT NULL,
  certification_name              text NOT NULL,
  certification_description       text,
  certification_issuing_body      text,
  certification_owner             uuid NOT NULL REFERENCES users(id),
  certification_created_by        uuid NOT NULL REFERENCES users(id),
  certification_created_at        timestamptz NOT NULL DEFAULT now(),
  certification_updated_by        uuid REFERENCES users(id),
  certification_updated_at        timestamptz,
  certification_is_active         boolean NOT NULL DEFAULT true,
  certification_is_deleted        boolean DEFAULT false,
  certification_deleted_at        timestamptz,
  certification_deleted_by        uuid REFERENCES users(id),
  certification_deletion_reason   text,
  UNIQUE (certification_name)
);
CREATE OR REPLACE FUNCTION public.set_certification_record_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.certification_record_number := generate_record_number('CERT-', 'seq_certifications'); RETURN NEW; END $$;
CREATE TRIGGER trg_certification_rn BEFORE INSERT ON public.certifications
  FOR EACH ROW EXECUTE FUNCTION set_certification_record_number();
CREATE TRIGGER trg_audit_certifications AFTER INSERT OR UPDATE OR DELETE ON public.certifications
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_certifications_no_hard_delete BEFORE DELETE ON public.certifications
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();
ALTER TABLE public.certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY certification_select ON public.certifications FOR SELECT TO authenticated USING (true);
CREATE POLICY certification_insert ON public.certifications FOR INSERT TO authenticated WITH CHECK (app_is_office_side());
CREATE POLICY certification_update ON public.certifications FOR UPDATE TO authenticated USING (app_is_office_side()) WITH CHECK (app_is_office_side());
CREATE POLICY certification_delete ON public.certifications FOR DELETE TO authenticated USING (app_is_office_side());

-- ── contact_certifications ──────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_contact_certifications;
CREATE TABLE public.contact_certifications (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cc_record_number                    text NOT NULL,
  cc_name                             text NOT NULL,
  cc_owner                            uuid NOT NULL REFERENCES users(id),
  cc_created_by                       uuid NOT NULL REFERENCES users(id),
  cc_created_at                       timestamptz NOT NULL DEFAULT now(),
  cc_updated_by                       uuid REFERENCES users(id),
  cc_updated_at                       timestamptz,
  cc_is_deleted                       boolean DEFAULT false,
  cc_deleted_at                       timestamptz,
  cc_deleted_by                       uuid REFERENCES users(id),
  cc_deletion_reason                  text,
  contact_id                          uuid NOT NULL REFERENCES contacts(id),
  certification_id                    uuid NOT NULL REFERENCES certifications(id),
  cc_certificate_number               text,
  cc_issued_date                      date,
  cc_expires_date                     date,
  cc_notes                            text,
  UNIQUE (contact_id, certification_id)
);
CREATE INDEX idx_cc_contact ON public.contact_certifications(contact_id) WHERE cc_is_deleted=false;
CREATE INDEX idx_cc_certification ON public.contact_certifications(certification_id) WHERE cc_is_deleted=false;
CREATE OR REPLACE FUNCTION public.set_cc_record_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.cc_record_number := generate_record_number('CC-', 'seq_contact_certifications'); RETURN NEW; END $$;
CREATE TRIGGER trg_cc_rn BEFORE INSERT ON public.contact_certifications
  FOR EACH ROW EXECUTE FUNCTION set_cc_record_number();
CREATE TRIGGER trg_audit_contact_certifications AFTER INSERT OR UPDATE OR DELETE ON public.contact_certifications
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_contact_certifications_no_hard_delete BEFORE DELETE ON public.contact_certifications
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();
ALTER TABLE public.contact_certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY cc_select ON public.contact_certifications FOR SELECT TO authenticated USING (true);
CREATE POLICY cc_insert ON public.contact_certifications FOR INSERT TO authenticated WITH CHECK (app_is_office_side());
CREATE POLICY cc_update ON public.contact_certifications FOR UPDATE TO authenticated USING (app_is_office_side()) WITH CHECK (app_is_office_side());
CREATE POLICY cc_delete ON public.contact_certifications FOR DELETE TO authenticated USING (app_is_office_side());

-- ── work_type_required_certifications ───────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_work_type_required_certs;
CREATE TABLE public.work_type_required_certifications (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wtrc_record_number                  text NOT NULL,
  wtrc_name                           text NOT NULL,
  wtrc_owner                          uuid NOT NULL REFERENCES users(id),
  wtrc_created_by                     uuid NOT NULL REFERENCES users(id),
  wtrc_created_at                     timestamptz NOT NULL DEFAULT now(),
  wtrc_updated_by                     uuid REFERENCES users(id),
  wtrc_updated_at                     timestamptz,
  wtrc_is_deleted                     boolean DEFAULT false,
  wtrc_deleted_at                     timestamptz,
  wtrc_deleted_by                     uuid REFERENCES users(id),
  wtrc_deletion_reason                text,
  work_type_id                        uuid NOT NULL REFERENCES work_types(id),
  certification_id                    uuid NOT NULL REFERENCES certifications(id),
  wtrc_notes                          text,
  UNIQUE (work_type_id, certification_id)
);
CREATE INDEX idx_wtrc_work_type ON public.work_type_required_certifications(work_type_id) WHERE wtrc_is_deleted=false;
CREATE INDEX idx_wtrc_certification ON public.work_type_required_certifications(certification_id) WHERE wtrc_is_deleted=false;
CREATE OR REPLACE FUNCTION public.set_wtrc_record_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.wtrc_record_number := generate_record_number('WTRC-', 'seq_work_type_required_certs'); RETURN NEW; END $$;
CREATE TRIGGER trg_wtrc_rn BEFORE INSERT ON public.work_type_required_certifications
  FOR EACH ROW EXECUTE FUNCTION set_wtrc_record_number();
CREATE TRIGGER trg_audit_wtrc AFTER INSERT OR UPDATE OR DELETE ON public.work_type_required_certifications
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_wtrc_no_hard_delete BEFORE DELETE ON public.work_type_required_certifications
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();
ALTER TABLE public.work_type_required_certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY wtrc_select ON public.work_type_required_certifications FOR SELECT TO authenticated USING (true);
CREATE POLICY wtrc_insert ON public.work_type_required_certifications FOR INSERT TO authenticated WITH CHECK (app_is_office_side());
CREATE POLICY wtrc_update ON public.work_type_required_certifications FOR UPDATE TO authenticated USING (app_is_office_side()) WITH CHECK (app_is_office_side());
CREATE POLICY wtrc_delete ON public.work_type_required_certifications FOR DELETE TO authenticated USING (app_is_office_side());

-- ── property_distances ──────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_property_distances;
CREATE TABLE public.property_distances (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pd_record_number                    text NOT NULL,
  pd_name                             text NOT NULL,
  pd_owner                            uuid NOT NULL REFERENCES users(id),
  pd_created_by                       uuid NOT NULL REFERENCES users(id),
  pd_created_at                       timestamptz NOT NULL DEFAULT now(),
  pd_updated_by                       uuid REFERENCES users(id),
  pd_updated_at                       timestamptz,
  pd_is_deleted                       boolean DEFAULT false,
  pd_deleted_at                       timestamptz,
  pd_deleted_by                       uuid REFERENCES users(id),
  pd_deletion_reason                  text,
  origin_property_id                  uuid NOT NULL REFERENCES properties(id),
  destination_property_id             uuid NOT NULL REFERENCES properties(id),
  pd_drive_minutes                    integer NOT NULL CHECK (pd_drive_minutes >= 0),
  pd_distance_miles                   numeric,
  pd_source                           text,
  pd_last_verified_at                 timestamptz,
  UNIQUE (origin_property_id, destination_property_id)
);
CREATE INDEX idx_pd_origin ON public.property_distances(origin_property_id) WHERE pd_is_deleted=false;
CREATE INDEX idx_pd_destination ON public.property_distances(destination_property_id) WHERE pd_is_deleted=false;
CREATE OR REPLACE FUNCTION public.set_pd_record_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.pd_record_number := generate_record_number('PD-', 'seq_property_distances'); RETURN NEW; END $$;
CREATE TRIGGER trg_pd_rn BEFORE INSERT ON public.property_distances
  FOR EACH ROW EXECUTE FUNCTION set_pd_record_number();
CREATE TRIGGER trg_audit_property_distances AFTER INSERT OR UPDATE OR DELETE ON public.property_distances
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_property_distances_no_hard_delete BEFORE DELETE ON public.property_distances
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();
ALTER TABLE public.property_distances ENABLE ROW LEVEL SECURITY;
CREATE POLICY pd_select ON public.property_distances FOR SELECT TO authenticated USING (true);
CREATE POLICY pd_insert ON public.property_distances FOR INSERT TO authenticated WITH CHECK (app_is_office_side());
CREATE POLICY pd_update ON public.property_distances FOR UPDATE TO authenticated USING (app_is_office_side()) WITH CHECK (app_is_office_side());
CREATE POLICY pd_delete ON public.property_distances FOR DELETE TO authenticated USING (app_is_office_side());
