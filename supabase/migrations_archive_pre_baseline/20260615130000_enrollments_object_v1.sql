-- Enrollment object. Standalone object, child of properties (required) and
-- opportunities. Holds the full field set the HUD multifamily income-
-- qualification tool produces. Single HUD contract per record (no child list).
CREATE SEQUENCE IF NOT EXISTS seq_enrollments;

CREATE TABLE public.enrollments (
  id                                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_record_number             text NOT NULL,
  enrollment_name                      text NOT NULL,
  enrollment_record_type               uuid REFERENCES picklist_values(id),
  enrollment_status                    uuid REFERENCES picklist_values(id),
  property_id                          uuid NOT NULL REFERENCES properties(id),
  opportunity_id                       uuid REFERENCES opportunities(id),
  enrollment_hud_property_id           text,
  enrollment_property_name             text,
  enrollment_site_address              text,
  enrollment_city                      text,
  enrollment_state                     text,
  enrollment_zip                       text,
  enrollment_county                    text,
  enrollment_total_units               integer,
  enrollment_assisted_units            integer,
  enrollment_subsidized_share_pct      numeric(5,2),
  enrollment_property_category         text,
  enrollment_is_202_811                boolean DEFAULT false,
  enrollment_is_opportunity_zone       boolean DEFAULT false,
  enrollment_owner_organization        text,
  enrollment_owner_type                text,
  enrollment_owner_address             text,
  enrollment_owner_phone               text,
  enrollment_owner_email               text,
  enrollment_owner_fein                text,
  enrollment_management_agent          text,
  enrollment_management_phone          text,
  enrollment_management_email          text,
  enrollment_contact_name              text,
  enrollment_contact_title             text,
  enrollment_contact_phone             text,
  enrollment_contact_email             text,
  enrollment_occupied_units            integer,
  enrollment_unoccupied_units          integer,
  enrollment_number_of_buildings       integer DEFAULT 1,
  enrollment_unit_numbering_scheme     text,
  enrollment_fifty_pct_lmi_declaration boolean DEFAULT false,
  enrollment_hud_contract_number       text,
  enrollment_hud_program               text,
  enrollment_hud_tracs_status          text,
  enrollment_hud_contract_expiration   date,
  enrollment_br_studio                 integer DEFAULT 0,
  enrollment_br_1                      integer DEFAULT 0,
  enrollment_br_2                      integer DEFAULT 0,
  enrollment_br_3                      integer DEFAULT 0,
  enrollment_br_4                      integer DEFAULT 0,
  enrollment_br_5plus                  integer DEFAULT 0,
  enrollment_qualifying_mode           text
    CHECK (enrollment_qualifying_mode IS NULL OR enrollment_qualifying_mode IN ('Entire Building','Individual Tenants')),
  enrollment_eligibility_pathways      text,
  enrollment_required_proof            text,
  enrollment_categorical_eligibility   text,
  enrollment_determination_date        date,
  enrollment_notes                     text,
  enrollment_owner                     uuid NOT NULL REFERENCES users(id),
  enrollment_created_by                uuid NOT NULL REFERENCES users(id),
  enrollment_created_at                timestamptz NOT NULL DEFAULT now(),
  enrollment_updated_by                uuid REFERENCES users(id),
  enrollment_updated_at                timestamptz,
  enrollment_is_deleted                boolean DEFAULT false,
  enrollment_deleted_at                timestamptz,
  enrollment_deleted_by                uuid REFERENCES users(id),
  enrollment_deletion_reason           text,
  is_seed_data                         boolean NOT NULL DEFAULT false
);

CREATE INDEX idx_enrollment_property ON public.enrollments(property_id) WHERE enrollment_is_deleted=false;
CREATE INDEX idx_enrollment_opportunity ON public.enrollments(opportunity_id) WHERE enrollment_is_deleted=false;
CREATE INDEX idx_enrollment_record_type ON public.enrollments(enrollment_record_type) WHERE enrollment_is_deleted=false;

CREATE OR REPLACE FUNCTION public.set_enrollment_record_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.enrollment_record_number := generate_record_number('ENR-', 'seq_enrollments'); RETURN NEW; END $$;
CREATE TRIGGER trg_enrollment_rn BEFORE INSERT ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION set_enrollment_record_number();
CREATE TRIGGER trg_audit_enrollments AFTER INSERT OR UPDATE OR DELETE ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_enrollments_no_hard_delete BEFORE DELETE ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();

ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY enrollment_select ON public.enrollments FOR SELECT TO authenticated USING (true);
CREATE POLICY enrollment_insert ON public.enrollments FOR INSERT TO authenticated WITH CHECK (app_is_office_side());
CREATE POLICY enrollment_update ON public.enrollments FOR UPDATE TO authenticated USING (app_is_office_side()) WITH CHECK (app_is_office_side());
CREATE POLICY enrollment_delete ON public.enrollments FOR DELETE TO authenticated USING (app_is_office_side());

NOTIFY pgrst, 'reload schema';
