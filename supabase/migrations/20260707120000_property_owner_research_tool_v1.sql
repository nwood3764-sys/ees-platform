-- =====================================================================
-- Property Owner Research tool — v1
--
-- Finds decision makers (CEO, asset manager, facilities director, ...)
-- for property owner groups (accounts) and specific properties, via a
-- tiered flow: free AI web research first, then Lusha prospecting
-- search (free), then Lusha enrich (paid credits) only on explicitly
-- selected candidates.
--
--   * owner_research_requests    — one row per research run (ORQ-)
--   * owner_research_candidates  — decision-maker candidates found (ORC-)
--   * picklist seeds             — statuses + default target job titles
--   * role_object_access seeds   — internal roles mirror `accounts` access
--   * get_integration_secret()   — service-role-only Vault reader used by
--                                  the property-owner-research edge function
-- =====================================================================

-- --- Sequences ---------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.seq_owner_research_requests;
CREATE SEQUENCE IF NOT EXISTS public.seq_owner_research_candidates;
GRANT USAGE ON SEQUENCE public.seq_owner_research_requests TO authenticated, service_role;
GRANT USAGE ON SEQUENCE public.seq_owner_research_candidates TO authenticated, service_role;

-- --- owner_research_requests -------------------------------------------
CREATE TABLE IF NOT EXISTS public.owner_research_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orq_record_number     text NOT NULL DEFAULT '',
  -- Research target: an owner group (account), a specific property, or a
  -- free-text organization. At least one is required.
  orq_account_id        uuid REFERENCES public.accounts(id),
  orq_property_id       uuid REFERENCES public.properties(id),
  orq_company_name      text,
  orq_company_domain    text,
  orq_target_job_titles text[],
  -- 'Web Research' (free, AI web search) | 'Lusha Prospecting Search' (no credits)
  orq_research_method   text NOT NULL DEFAULT 'Web Research',
  orq_status            text NOT NULL DEFAULT 'Research Request Submitted',
  orq_provider_request_id text,           -- Lusha requestId (needed for enrich)
  orq_total_results     integer,
  orq_error_message     text,
  orq_raw_response      jsonb,
  orq_completed_at      timestamptz,
  orq_owner             uuid NOT NULL REFERENCES public.users(id),
  orq_created_by        uuid,
  orq_created_at        timestamptz NOT NULL DEFAULT now(),
  orq_updated_by        uuid,
  orq_updated_at        timestamptz NOT NULL DEFAULT now(),
  orq_is_deleted        boolean NOT NULL DEFAULT false,
  orq_deleted_at        timestamptz,
  orq_deleted_by        uuid,
  orq_deletion_reason   text,
  is_seed_data          boolean NOT NULL DEFAULT false,
  CONSTRAINT owner_research_requests_target_present CHECK (
    orq_account_id IS NOT NULL OR orq_property_id IS NOT NULL
    OR COALESCE(orq_company_name, '') <> ''
  )
);

CREATE INDEX IF NOT EXISTS idx_orq_account  ON public.owner_research_requests (orq_account_id);
CREATE INDEX IF NOT EXISTS idx_orq_property ON public.owner_research_requests (orq_property_id);
CREATE INDEX IF NOT EXISTS idx_orq_status   ON public.owner_research_requests (orq_status);

CREATE OR REPLACE FUNCTION public.set_orq_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.orq_record_number IS NULL OR NEW.orq_record_number = '' THEN
    NEW.orq_record_number := public.generate_record_number('ORQ-', 'seq_owner_research_requests');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_owner_research_requests_rn ON public.owner_research_requests;
CREATE TRIGGER trg_owner_research_requests_rn BEFORE INSERT ON public.owner_research_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_orq_record_number();
CREATE TRIGGER trg_audit_owner_research_requests AFTER INSERT OR DELETE OR UPDATE ON public.owner_research_requests
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_enforce_soft_delete_audit BEFORE UPDATE ON public.owner_research_requests
  FOR EACH ROW EXECUTE FUNCTION enforce_soft_delete_audit();
CREATE TRIGGER trg_owner_research_requests_no_hard_delete BEFORE DELETE ON public.owner_research_requests
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();

-- --- owner_research_candidates -----------------------------------------
CREATE TABLE IF NOT EXISTS public.owner_research_candidates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orc_record_number     text NOT NULL DEFAULT '',
  orc_request_id        uuid NOT NULL REFERENCES public.owner_research_requests(id),
  orc_account_id        uuid REFERENCES public.accounts(id),
  orc_property_id       uuid REFERENCES public.properties(id),
  -- 'Web Research' | 'Lusha' | 'Manual'
  orc_source            text NOT NULL DEFAULT 'Lusha',
  orc_provider_contact_id text,          -- Lusha contactId (needed for enrich)
  orc_full_name         text NOT NULL,
  orc_first_name        text,
  orc_last_name         text,
  orc_job_title         text,
  orc_seniority         text,
  orc_department        text,
  orc_company_name      text,
  orc_company_domain    text,
  orc_location          text,
  orc_linkedin_url      text,
  orc_has_emails        boolean,
  orc_has_phones        boolean,
  orc_emails            jsonb,           -- revealed on enrich (paid) or found via web research
  orc_phones            jsonb,
  orc_source_urls       jsonb,           -- web-research evidence links
  orc_notes             text,
  orc_status            text NOT NULL DEFAULT 'Research Candidate Found',
  orc_enriched_at       timestamptz,
  orc_promoted_contact_id uuid REFERENCES public.contacts(id),
  orc_raw_payload       jsonb,
  orc_owner             uuid NOT NULL REFERENCES public.users(id),
  orc_created_by        uuid,
  orc_created_at        timestamptz NOT NULL DEFAULT now(),
  orc_updated_by        uuid,
  orc_updated_at        timestamptz NOT NULL DEFAULT now(),
  orc_is_deleted        boolean NOT NULL DEFAULT false,
  orc_deleted_at        timestamptz,
  orc_deleted_by        uuid,
  orc_deletion_reason   text,
  is_seed_data          boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_orc_request  ON public.owner_research_candidates (orc_request_id);
CREATE INDEX IF NOT EXISTS idx_orc_account  ON public.owner_research_candidates (orc_account_id);
CREATE INDEX IF NOT EXISTS idx_orc_property ON public.owner_research_candidates (orc_property_id);
CREATE INDEX IF NOT EXISTS idx_orc_status   ON public.owner_research_candidates (orc_status);

CREATE OR REPLACE FUNCTION public.set_orc_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.orc_record_number IS NULL OR NEW.orc_record_number = '' THEN
    NEW.orc_record_number := public.generate_record_number('ORC-', 'seq_owner_research_candidates');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_owner_research_candidates_rn ON public.owner_research_candidates;
CREATE TRIGGER trg_owner_research_candidates_rn BEFORE INSERT ON public.owner_research_candidates
  FOR EACH ROW EXECUTE FUNCTION public.set_orc_record_number();
CREATE TRIGGER trg_audit_owner_research_candidates AFTER INSERT OR DELETE OR UPDATE ON public.owner_research_candidates
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_enforce_soft_delete_audit BEFORE UPDATE ON public.owner_research_candidates
  FOR EACH ROW EXECUTE FUNCTION enforce_soft_delete_audit();
CREATE TRIGGER trg_owner_research_candidates_no_hard_delete BEFORE DELETE ON public.owner_research_candidates
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();

-- --- RLS ---------------------------------------------------------------
ALTER TABLE public.owner_research_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_research_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_select_owner_research_requests ON public.owner_research_requests
  FOR SELECT TO authenticated USING ((SELECT app_user_can('owner_research_requests','read')));
CREATE POLICY app_insert_owner_research_requests ON public.owner_research_requests
  FOR INSERT TO authenticated WITH CHECK ((SELECT app_user_can('owner_research_requests','create')));
CREATE POLICY app_update_owner_research_requests ON public.owner_research_requests
  FOR UPDATE TO authenticated USING ((SELECT app_user_can('owner_research_requests','update')))
  WITH CHECK ((SELECT app_user_can('owner_research_requests','update')));
CREATE POLICY app_delete_owner_research_requests ON public.owner_research_requests
  FOR DELETE TO authenticated USING ((SELECT app_user_can('owner_research_requests','delete')));

CREATE POLICY app_select_owner_research_candidates ON public.owner_research_candidates
  FOR SELECT TO authenticated USING ((SELECT app_user_can('owner_research_candidates','read')));
CREATE POLICY app_insert_owner_research_candidates ON public.owner_research_candidates
  FOR INSERT TO authenticated WITH CHECK ((SELECT app_user_can('owner_research_candidates','create')));
CREATE POLICY app_update_owner_research_candidates ON public.owner_research_candidates
  FOR UPDATE TO authenticated USING ((SELECT app_user_can('owner_research_candidates','update')))
  WITH CHECK ((SELECT app_user_can('owner_research_candidates','update')));
CREATE POLICY app_delete_owner_research_candidates ON public.owner_research_candidates
  FOR DELETE TO authenticated USING ((SELECT app_user_can('owner_research_candidates','delete')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_research_requests   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_research_candidates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_research_requests   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_research_candidates TO service_role;

-- --- Role access: internal roles mirror their `accounts` access ---------
-- Portal / external roles are explicitly excluded — owner research is
-- internal prospecting data and must never be visible to portal users.
INSERT INTO public.role_object_access (id, roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete)
SELECT gen_random_uuid(), roa.roa_role_id, obj.new_object, roa.roa_read, roa.roa_create, roa.roa_update, false
FROM public.role_object_access roa
JOIN public.roles r ON r.id = roa.roa_role_id
CROSS JOIN (VALUES ('owner_research_requests'), ('owner_research_candidates')) AS obj(new_object)
WHERE roa.roa_object_name = 'accounts'
  AND r.role_name NOT IN ('Property Owner', 'Property Manager', 'Service Provider Partner')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_object_access x
    WHERE x.roa_role_id = roa.roa_role_id AND x.roa_object_name = obj.new_object
  );

-- --- Picklist seeds ------------------------------------------------------
-- Statuses (explicit, "[Object] [State]" convention)
INSERT INTO public.picklist_values (id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order)
SELECT gen_random_uuid(), v.obj, v.fld, v.val, v.val, true, v.ord
FROM (VALUES
  ('owner_research_requests','orq_status','Research Request Submitted',        10),
  ('owner_research_requests','orq_status','Research Request Completed',        20),
  ('owner_research_requests','orq_status','Research Request No Results',       30),
  ('owner_research_requests','orq_status','Research Request Failed',           40),
  ('owner_research_candidates','orc_status','Research Candidate Found',        10),
  ('owner_research_candidates','orc_status','Research Candidate Enriched',     20),
  ('owner_research_candidates','orc_status','Research Candidate Promoted to Contact', 30),
  ('owner_research_candidates','orc_status','Research Candidate Dismissed',    40)
) AS v(obj, fld, val, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
  WHERE p.picklist_object = v.obj AND p.picklist_field = v.fld AND p.picklist_value = v.val
);

-- Default decision-maker target job titles (admin-manageable — the tool
-- reads this list at runtime; nothing is hardcoded in app logic).
INSERT INTO public.picklist_values (id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order)
SELECT gen_random_uuid(), 'owner_research_requests', 'orq_target_job_title', v.val, v.val, true, v.ord
FROM (VALUES
  ('Chief Executive Officer', 10),
  ('CEO',                     20),
  ('President',               30),
  ('Owner',                   40),
  ('Principal',               50),
  ('Managing Partner',        60),
  ('Managing Director',       70),
  ('Executive Director',      80),
  ('Chief Operating Officer', 90),
  ('Asset Manager',          100),
  ('Director of Asset Management', 110),
  ('VP of Asset Management', 120),
  ('Facilities Director',    130),
  ('Director of Facilities', 140),
  ('VP of Facilities',       150),
  ('VP of Real Estate',      160),
  ('Director of Real Estate',170),
  ('Director of Capital Projects', 180)
) AS v(val, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
  WHERE p.picklist_object = 'owner_research_requests'
    AND p.picklist_field = 'orq_target_job_title' AND p.picklist_value = v.val
);

-- --- Vault-backed integration secret reader -----------------------------
-- Service-role-only accessor so edge functions can read integration API
-- keys stored in Supabase Vault (e.g. LUSHA_API_KEY) without the secret
-- living in code or in function env config.
CREATE OR REPLACE FUNCTION public.get_integration_secret(p_name text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT ds.decrypted_secret
  FROM vault.decrypted_secrets ds
  WHERE ds.name = p_name
  ORDER BY ds.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_integration_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_integration_secret(text) FROM anon;
REVOKE ALL ON FUNCTION public.get_integration_secret(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_integration_secret(text) TO service_role;

NOTIFY pgrst, 'reload schema';
