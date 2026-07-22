-- ============================================================================
-- Service Provider Portal + Intake — Phase 1: identity + application object
-- ----------------------------------------------------------------------------
-- Adds the "Service Provider" account record type, a trade picklist and a
-- provider-status lifecycle on accounts, provider-profile columns, and two new
-- purpose-built objects:
--   * service_provider_applications (SPA-)  — intake application + stage lifecycle
--   * service_provider_service_areas (SPSA-) — ZIP-code areas of operation
--
-- A provider account may have MANY applications over time (repeat applicants),
-- so the canonical link is application -> account (spa_account_id), never a
-- single application pointer on the account.
--
-- Additive only. New record type, columns, tables, RLS. Nothing existing
-- changes behavior. Follows the LEAP new-object conventions (record-number
-- sequence + BEFORE INSERT trigger, standard audit columns, block_hard_delete,
-- 4-policy RLS via app_user_can, role_object_access seeding).
-- See docs/leap-service-provider-portal.md.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Picklists: account record type, trade type, provider status, app stage
-- ----------------------------------------------------------------------------

-- Account record type: "Service Provider"
INSERT INTO public.picklist_values
  (id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order)
SELECT gen_random_uuid(), 'accounts', 'record_type', 'service_provider', 'Service Provider', true, 25
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
  WHERE p.picklist_object='accounts' AND p.picklist_field='record_type' AND p.picklist_value='service_provider'
);

-- Trade / service-provider type (choice list). Seeded under BOTH the accounts
-- field (account_service_provider_type) and the application field
-- (spa_service_provider_type) so each object's generic UI resolves its options.
INSERT INTO public.picklist_values
  (id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order)
SELECT gen_random_uuid(), v.obj, v.fld, v.val, v.lbl, true, v.ord
FROM (VALUES
  ('accounts','service_provider_type','hvac','HVAC',10),
  ('accounts','service_provider_type','electrical','Electrical',20),
  ('accounts','service_provider_type','weatherization','Weatherization',30),
  ('accounts','service_provider_type','plumbing','Plumbing',40),
  ('accounts','service_provider_type','general_contractor','General Contractor',50),
  ('service_provider_applications','service_provider_type','hvac','HVAC',10),
  ('service_provider_applications','service_provider_type','electrical','Electrical',20),
  ('service_provider_applications','service_provider_type','weatherization','Weatherization',30),
  ('service_provider_applications','service_provider_type','plumbing','Plumbing',40),
  ('service_provider_applications','service_provider_type','general_contractor','General Contractor',50)
) AS v(obj,fld,val,lbl,ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
  WHERE p.picklist_object=v.obj AND p.picklist_field=v.fld AND p.picklist_value=v.val
);

-- Provider status lifecycle on accounts (account_service_provider_status).
INSERT INTO public.picklist_values
  (id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order)
SELECT gen_random_uuid(), 'accounts', 'service_provider_status', v.val, v.val, true, v.ord
FROM (VALUES
  ('Service Provider Applicant',  10),
  ('Service Provider Active',     20),
  ('Service Provider Suspended',  30),
  ('Service Provider Inactive',   40),
  ('Service Provider Declined',   50)
) AS v(val,ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
  WHERE p.picklist_object='accounts' AND p.picklist_field='service_provider_status' AND p.picklist_value=v.val
);

-- Application stage lifecycle (service_provider_applications.spa_stage -> stage).
INSERT INTO public.picklist_values
  (id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order)
SELECT gen_random_uuid(), 'service_provider_applications', 'stage', v.val, v.val, true, v.ord
FROM (VALUES
  ('Application Submitted',               10),
  ('Application Under Review',            20),
  ('Application Additional Info Requested',30),
  ('Application Approved',                40),
  ('Application Declined',                50)
) AS v(val,ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
  WHERE p.picklist_object='service_provider_applications' AND p.picklist_field='stage' AND p.picklist_value=v.val
);

-- ----------------------------------------------------------------------------
-- 2. Provider-profile columns on accounts (clean, purpose-named, additive)
-- ----------------------------------------------------------------------------
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS account_service_provider_type              uuid REFERENCES public.picklist_values(id),
  ADD COLUMN IF NOT EXISTS account_service_provider_status            uuid REFERENCES public.picklist_values(id),
  ADD COLUMN IF NOT EXISTS account_service_provider_is_active         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS account_service_provider_home_state        text,
  ADD COLUMN IF NOT EXISTS account_service_provider_dba_name          text,
  ADD COLUMN IF NOT EXISTS account_service_provider_entity_type       text,
  ADD COLUMN IF NOT EXISTS account_license_number                     text,
  ADD COLUMN IF NOT EXISTS account_license_type                       text,
  ADD COLUMN IF NOT EXISTS account_license_state                      text,
  ADD COLUMN IF NOT EXISTS account_license_expiration_date            date,
  ADD COLUMN IF NOT EXISTS account_w9_document_id                     uuid REFERENCES public.documents(id),
  ADD COLUMN IF NOT EXISTS account_general_liability_carrier          text,
  ADD COLUMN IF NOT EXISTS account_general_liability_policy_number    text,
  ADD COLUMN IF NOT EXISTS account_general_liability_expiration_date  date,
  ADD COLUMN IF NOT EXISTS account_workers_comp_carrier               text,
  ADD COLUMN IF NOT EXISTS account_workers_comp_policy_number         text,
  ADD COLUMN IF NOT EXISTS account_workers_comp_expiration_date       date;

CREATE INDEX IF NOT EXISTS idx_account_service_provider_type   ON public.accounts (account_service_provider_type);
CREATE INDEX IF NOT EXISTS idx_account_service_provider_status ON public.accounts (account_service_provider_status);

-- ----------------------------------------------------------------------------
-- 3. Object: service_provider_applications (SPA-)
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.seq_service_provider_applications;
GRANT USAGE ON SEQUENCE public.seq_service_provider_applications TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.service_provider_applications (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spa_record_number               text NOT NULL DEFAULT '',
  spa_name                        text NOT NULL DEFAULT '',
  -- Links created at submission time
  spa_account_id                  uuid REFERENCES public.accounts(id),
  spa_primary_contact_id          uuid REFERENCES public.contacts(id),
  -- Lifecycle
  spa_stage                       uuid REFERENCES public.picklist_values(id),
  spa_source                      text,          -- 'Public Intake Site' | 'Manual Entry'
  spa_submitted_at                timestamptz,
  -- Company
  spa_company_legal_name          text,
  spa_dba_name                    text,
  spa_service_provider_type       uuid REFERENCES public.picklist_values(id),
  spa_entity_type                 text,          -- LLC, Sole Proprietor, Corporation, etc.
  spa_home_state                  text,          -- region: NC first, then WI
  spa_business_phone              text,
  spa_business_email              text,
  spa_website                     text,
  spa_address_street              text,
  spa_address_city                text,
  spa_address_state               text,
  spa_address_zip                 text,
  spa_number_of_employees         integer,
  -- Primary contact
  spa_contact_first_name          text,
  spa_contact_last_name           text,
  spa_contact_title               text,
  spa_contact_email               text,
  spa_contact_phone               text,
  -- License
  spa_license_number              text,
  spa_license_type                text,
  spa_license_state               text,
  spa_license_expiration_date     date,
  -- Insurance
  spa_general_liability_carrier            text,
  spa_general_liability_policy_number      text,
  spa_general_liability_expiration_date    date,
  spa_workers_comp_carrier                 text,
  spa_workers_comp_policy_number           text,
  spa_workers_comp_expiration_date         date,
  -- W-9 (uploaded document; no raw TIN captured)
  spa_w9_document_id              uuid REFERENCES public.documents(id),
  -- Review / decision
  spa_reviewer_user_id            uuid REFERENCES public.users(id),
  spa_reviewed_at                 timestamptz,
  spa_decision_notes              text,
  spa_declined_reason             text,
  spa_notes                       text,
  -- Standard audit
  spa_owner                       uuid NOT NULL REFERENCES public.users(id),
  spa_created_by                  uuid REFERENCES public.users(id),
  spa_created_at                  timestamptz NOT NULL DEFAULT now(),
  spa_updated_by                  uuid REFERENCES public.users(id),
  spa_updated_at                  timestamptz NOT NULL DEFAULT now(),
  spa_is_deleted                  boolean NOT NULL DEFAULT false,
  spa_deleted_at                  timestamptz,
  spa_deleted_by                  uuid REFERENCES public.users(id),
  spa_deletion_reason             text,
  is_seed_data                    boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_spa_account      ON public.service_provider_applications (spa_account_id);
CREATE INDEX IF NOT EXISTS idx_spa_stage        ON public.service_provider_applications (spa_stage);
CREATE INDEX IF NOT EXISTS idx_spa_type         ON public.service_provider_applications (spa_service_provider_type);
CREATE INDEX IF NOT EXISTS idx_spa_submitted_at ON public.service_provider_applications (spa_submitted_at);

CREATE OR REPLACE FUNCTION public.set_spa_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.spa_record_number IS NULL OR NEW.spa_record_number = '' THEN
    NEW.spa_record_number := public.generate_record_number('SPA-', 'seq_service_provider_applications');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_service_provider_applications_rn ON public.service_provider_applications;
CREATE TRIGGER trg_service_provider_applications_rn BEFORE INSERT ON public.service_provider_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_spa_record_number();
CREATE TRIGGER trg_audit_service_provider_applications AFTER INSERT OR DELETE OR UPDATE ON public.service_provider_applications
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_service_provider_applications_no_hard_delete BEFORE DELETE ON public.service_provider_applications
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();

-- ----------------------------------------------------------------------------
-- 4. Object: service_provider_service_areas (SPSA-) — ZIP areas of operation
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.seq_service_provider_service_areas;
GRANT USAGE ON SEQUENCE public.seq_service_provider_service_areas TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.service_provider_service_areas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spsa_record_number    text NOT NULL DEFAULT '',
  spsa_name             text NOT NULL DEFAULT '',
  spsa_account_id       uuid NOT NULL REFERENCES public.accounts(id),
  spsa_application_id   uuid REFERENCES public.service_provider_applications(id),
  spsa_zip_code         text NOT NULL,
  spsa_city             text,
  spsa_state            text,
  spsa_is_active        boolean NOT NULL DEFAULT true,
  spsa_owner            uuid NOT NULL REFERENCES public.users(id),
  spsa_created_by       uuid REFERENCES public.users(id),
  spsa_created_at       timestamptz NOT NULL DEFAULT now(),
  spsa_updated_by       uuid REFERENCES public.users(id),
  spsa_updated_at       timestamptz NOT NULL DEFAULT now(),
  spsa_is_deleted       boolean NOT NULL DEFAULT false,
  spsa_deleted_at       timestamptz,
  spsa_deleted_by       uuid REFERENCES public.users(id),
  spsa_deletion_reason  text,
  is_seed_data          boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_spsa_account     ON public.service_provider_service_areas (spsa_account_id);
CREATE INDEX IF NOT EXISTS idx_spsa_application ON public.service_provider_service_areas (spsa_application_id);
CREATE INDEX IF NOT EXISTS idx_spsa_zip         ON public.service_provider_service_areas (spsa_zip_code);
CREATE INDEX IF NOT EXISTS idx_spsa_state       ON public.service_provider_service_areas (spsa_state);

CREATE OR REPLACE FUNCTION public.set_spsa_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.spsa_record_number IS NULL OR NEW.spsa_record_number = '' THEN
    NEW.spsa_record_number := public.generate_record_number('SPSA-', 'seq_service_provider_service_areas');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_service_provider_service_areas_rn ON public.service_provider_service_areas;
CREATE TRIGGER trg_service_provider_service_areas_rn BEFORE INSERT ON public.service_provider_service_areas
  FOR EACH ROW EXECUTE FUNCTION public.set_spsa_record_number();
CREATE TRIGGER trg_audit_service_provider_service_areas AFTER INSERT OR DELETE OR UPDATE ON public.service_provider_service_areas
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_service_provider_service_areas_no_hard_delete BEFORE DELETE ON public.service_provider_service_areas
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();

-- ----------------------------------------------------------------------------
-- 5. RLS + grants
-- ----------------------------------------------------------------------------
ALTER TABLE public.service_provider_applications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_provider_service_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_select_service_provider_applications ON public.service_provider_applications
  FOR SELECT TO authenticated USING ((SELECT app_user_can('service_provider_applications','read')));
CREATE POLICY app_insert_service_provider_applications ON public.service_provider_applications
  FOR INSERT TO authenticated WITH CHECK ((SELECT app_user_can('service_provider_applications','create')));
CREATE POLICY app_update_service_provider_applications ON public.service_provider_applications
  FOR UPDATE TO authenticated USING ((SELECT app_user_can('service_provider_applications','update')))
  WITH CHECK ((SELECT app_user_can('service_provider_applications','update')));
CREATE POLICY app_delete_service_provider_applications ON public.service_provider_applications
  FOR DELETE TO authenticated USING ((SELECT app_user_can('service_provider_applications','delete')));

CREATE POLICY app_select_service_provider_service_areas ON public.service_provider_service_areas
  FOR SELECT TO authenticated USING ((SELECT app_user_can('service_provider_service_areas','read')));
CREATE POLICY app_insert_service_provider_service_areas ON public.service_provider_service_areas
  FOR INSERT TO authenticated WITH CHECK ((SELECT app_user_can('service_provider_service_areas','create')));
CREATE POLICY app_update_service_provider_service_areas ON public.service_provider_service_areas
  FOR UPDATE TO authenticated USING ((SELECT app_user_can('service_provider_service_areas','update')))
  WITH CHECK ((SELECT app_user_can('service_provider_service_areas','update')));
CREATE POLICY app_delete_service_provider_service_areas ON public.service_provider_service_areas
  FOR DELETE TO authenticated USING ((SELECT app_user_can('service_provider_service_areas','delete')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_provider_applications  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_provider_service_areas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_provider_applications  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_provider_service_areas TO service_role;

-- ----------------------------------------------------------------------------
-- 6. Role/object access — mirror internal-staff access to `accounts`
--    (exclude external portal roles; providers never read these directly)
-- ----------------------------------------------------------------------------
INSERT INTO public.role_object_access (id, roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete)
SELECT gen_random_uuid(), roa.roa_role_id, obj.new_object, roa.roa_read, roa.roa_create, roa.roa_update, false
FROM public.role_object_access roa
JOIN public.roles r ON r.id = roa.roa_role_id
CROSS JOIN (VALUES ('service_provider_applications'), ('service_provider_service_areas')) AS obj(new_object)
WHERE roa.roa_object_name = 'accounts'
  AND r.role_name NOT IN ('Property Owner', 'Property Manager', 'Service Provider Partner')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_object_access x
    WHERE x.roa_role_id = roa.roa_role_id AND x.roa_object_name = obj.new_object
  );

NOTIFY pgrst, 'reload schema';
