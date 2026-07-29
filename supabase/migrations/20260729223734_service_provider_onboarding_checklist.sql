-- ============================================================================
-- Service Provider onboarding checklist — make the multi-step onboarding
-- process (read documents, initial interview, onboarding session, training)
-- explicit and gate the portal invite on it.
--
-- Two purpose-built objects, mirroring the work_step_templates → work_steps
-- pattern:
--   * service_provider_onboarding_step_templates (SPOT-) — the configurable
--     default set of onboarding steps (Admin-manageable; nothing hardcoded).
--   * service_provider_onboarding_steps (SPOS-) — per-application instances,
--     completed with a name/date/notes trail.
--
-- RPCs:
--   * ensure_service_provider_onboarding_steps(app) — idempotently instantiate
--     the active templates for an application and return the current steps.
--   * set_service_provider_onboarding_step(step, complete, notes) — mark a
--     step complete/incomplete with an audited who/when.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Templates (SPOT-) — the default onboarding steps
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.seq_sp_onboarding_step_templates;
GRANT USAGE ON SEQUENCE public.seq_sp_onboarding_step_templates TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.service_provider_onboarding_step_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_record_number    text NOT NULL DEFAULT '',
  spot_name             text NOT NULL DEFAULT '',
  spot_step_key         text NOT NULL,
  spot_sequence         int  NOT NULL DEFAULT 0,
  spot_is_required      boolean NOT NULL DEFAULT true,
  spot_is_active        boolean NOT NULL DEFAULT true,
  spot_description      text,
  spot_owner            uuid NOT NULL REFERENCES public.users(id),
  spot_created_by       uuid REFERENCES public.users(id),
  spot_created_at       timestamptz NOT NULL DEFAULT now(),
  spot_updated_by       uuid REFERENCES public.users(id),
  spot_updated_at       timestamptz NOT NULL DEFAULT now(),
  spot_is_deleted       boolean NOT NULL DEFAULT false,
  spot_deleted_at       timestamptz,
  spot_deleted_by       uuid REFERENCES public.users(id),
  spot_deletion_reason  text,
  is_seed_data          boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_spot_step_key_active
  ON public.service_provider_onboarding_step_templates (spot_step_key)
  WHERE spot_is_deleted IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.set_spot_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.spot_record_number IS NULL OR NEW.spot_record_number = '' THEN
    NEW.spot_record_number := public.generate_record_number('SPOT-', 'seq_sp_onboarding_step_templates');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sp_onboarding_step_templates_rn ON public.service_provider_onboarding_step_templates;
CREATE TRIGGER trg_sp_onboarding_step_templates_rn BEFORE INSERT ON public.service_provider_onboarding_step_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_spot_record_number();
CREATE TRIGGER trg_audit_sp_onboarding_step_templates AFTER INSERT OR DELETE OR UPDATE ON public.service_provider_onboarding_step_templates
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_sp_onboarding_step_templates_no_hard_delete BEFORE DELETE ON public.service_provider_onboarding_step_templates
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();

-- ----------------------------------------------------------------------------
-- 2. Per-application steps (SPOS-)
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.seq_sp_onboarding_steps;
GRANT USAGE ON SEQUENCE public.seq_sp_onboarding_steps TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.service_provider_onboarding_steps (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spos_record_number    text NOT NULL DEFAULT '',
  spos_name             text NOT NULL DEFAULT '',
  spos_application_id   uuid NOT NULL REFERENCES public.service_provider_applications(id),
  spos_account_id       uuid REFERENCES public.accounts(id),
  spos_template_id      uuid REFERENCES public.service_provider_onboarding_step_templates(id),
  spos_step_key         text NOT NULL,
  spos_sequence         int  NOT NULL DEFAULT 0,
  spos_is_required      boolean NOT NULL DEFAULT true,
  spos_is_complete      boolean NOT NULL DEFAULT false,
  spos_completed_at     timestamptz,
  spos_completed_by     uuid REFERENCES public.users(id),
  spos_notes            text,
  spos_owner            uuid NOT NULL REFERENCES public.users(id),
  spos_created_by       uuid REFERENCES public.users(id),
  spos_created_at       timestamptz NOT NULL DEFAULT now(),
  spos_updated_by       uuid REFERENCES public.users(id),
  spos_updated_at       timestamptz NOT NULL DEFAULT now(),
  spos_is_deleted       boolean NOT NULL DEFAULT false,
  spos_deleted_at       timestamptz,
  spos_deleted_by       uuid REFERENCES public.users(id),
  spos_deletion_reason  text,
  is_seed_data          boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_spos_application ON public.service_provider_onboarding_steps (spos_application_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_spos_app_step_active
  ON public.service_provider_onboarding_steps (spos_application_id, spos_step_key)
  WHERE spos_is_deleted IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.set_spos_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.spos_record_number IS NULL OR NEW.spos_record_number = '' THEN
    NEW.spos_record_number := public.generate_record_number('SPOS-', 'seq_sp_onboarding_steps');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sp_onboarding_steps_rn ON public.service_provider_onboarding_steps;
CREATE TRIGGER trg_sp_onboarding_steps_rn BEFORE INSERT ON public.service_provider_onboarding_steps
  FOR EACH ROW EXECUTE FUNCTION public.set_spos_record_number();
CREATE TRIGGER trg_audit_sp_onboarding_steps AFTER INSERT OR DELETE OR UPDATE ON public.service_provider_onboarding_steps
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_sp_onboarding_steps_no_hard_delete BEFORE DELETE ON public.service_provider_onboarding_steps
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();

-- ----------------------------------------------------------------------------
-- 3. RLS + grants + role access
-- ----------------------------------------------------------------------------
ALTER TABLE public.service_provider_onboarding_step_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_provider_onboarding_steps          ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_select_spot ON public.service_provider_onboarding_step_templates
  FOR SELECT TO authenticated USING ((SELECT app_user_can('service_provider_onboarding_step_templates','read')));
CREATE POLICY app_insert_spot ON public.service_provider_onboarding_step_templates
  FOR INSERT TO authenticated WITH CHECK ((SELECT app_user_can('service_provider_onboarding_step_templates','create')));
CREATE POLICY app_update_spot ON public.service_provider_onboarding_step_templates
  FOR UPDATE TO authenticated USING ((SELECT app_user_can('service_provider_onboarding_step_templates','update')))
  WITH CHECK ((SELECT app_user_can('service_provider_onboarding_step_templates','update')));
CREATE POLICY app_delete_spot ON public.service_provider_onboarding_step_templates
  FOR DELETE TO authenticated USING ((SELECT app_user_can('service_provider_onboarding_step_templates','delete')));

CREATE POLICY app_select_spos ON public.service_provider_onboarding_steps
  FOR SELECT TO authenticated USING ((SELECT app_user_can('service_provider_onboarding_steps','read')));
CREATE POLICY app_insert_spos ON public.service_provider_onboarding_steps
  FOR INSERT TO authenticated WITH CHECK ((SELECT app_user_can('service_provider_onboarding_steps','create')));
CREATE POLICY app_update_spos ON public.service_provider_onboarding_steps
  FOR UPDATE TO authenticated USING ((SELECT app_user_can('service_provider_onboarding_steps','update')))
  WITH CHECK ((SELECT app_user_can('service_provider_onboarding_steps','update')));
CREATE POLICY app_delete_spos ON public.service_provider_onboarding_steps
  FOR DELETE TO authenticated USING ((SELECT app_user_can('service_provider_onboarding_steps','delete')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_provider_onboarding_step_templates TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_provider_onboarding_steps          TO authenticated, service_role;

INSERT INTO public.role_object_access (id, roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete)
SELECT gen_random_uuid(), roa.roa_role_id, obj.new_object, roa.roa_read, roa.roa_create, roa.roa_update, false
FROM public.role_object_access roa
JOIN public.roles r ON r.id = roa.roa_role_id
CROSS JOIN (VALUES ('service_provider_onboarding_step_templates'), ('service_provider_onboarding_steps')) AS obj(new_object)
WHERE roa.roa_object_name = 'service_provider_applications'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_object_access x
    WHERE x.roa_role_id = roa.roa_role_id AND x.roa_object_name = obj.new_object
  );

-- ----------------------------------------------------------------------------
-- 4. Seed the default onboarding steps
-- ----------------------------------------------------------------------------
INSERT INTO public.service_provider_onboarding_step_templates
  (spot_record_number, spot_name, spot_step_key, spot_sequence, spot_is_required, spot_description, spot_owner, spot_created_by, spot_updated_by, is_seed_data)
SELECT '', s.label, s.key, s.seq, s.req, s.descr, u.id, u.id, u.id, true
FROM (VALUES
  ('documents_reviewed', 'Documents reviewed',        10, true,  'W-9, Certificate of Insurance, and license reviewed and on file.'),
  ('initial_interview',  'Initial interview',         20, true,  'Initial phone or video interview completed with the applicant.'),
  ('onboarding_session', 'Onboarding session',        30, true,  'Onboarding session completed (expectations, portal walkthrough, paperwork).'),
  ('training_complete',  'Training completed',        40, true,  'Required training completed before portal access is granted.')
) AS s(key, label, seq, req, descr)
CROSS JOIN LATERAL (
  SELECT id FROM public.users WHERE user_is_active IS TRUE ORDER BY user_created_at LIMIT 1
) u
WHERE NOT EXISTS (
  SELECT 1 FROM public.service_provider_onboarding_step_templates t
  WHERE t.spot_step_key = s.key AND t.spot_is_deleted IS NOT TRUE);

-- ----------------------------------------------------------------------------
-- 5. RPC: instantiate + list an application's onboarding steps (idempotent)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_service_provider_onboarding_steps(p_application_id uuid)
 RETURNS TABLE(id uuid, step_key text, name text, sequence int, is_required boolean,
               is_complete boolean, completed_at timestamptz, completed_by_name text, notes text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_me uuid; v_acct uuid; v_appowner uuid;
BEGIN
  SELECT spa_account_id, spa_owner INTO v_acct, v_appowner
  FROM public.service_provider_applications WHERE service_provider_applications.id = p_application_id;
  v_me := COALESCE(current_app_user_id(), v_appowner,
                   (SELECT u.id FROM public.users u WHERE u.user_is_active IS TRUE ORDER BY u.user_created_at LIMIT 1));

  INSERT INTO public.service_provider_onboarding_steps (
    spos_record_number, spos_name, spos_application_id, spos_account_id, spos_template_id,
    spos_step_key, spos_sequence, spos_is_required, spos_owner, spos_created_by, spos_updated_by)
  SELECT '', t.spot_name, p_application_id, v_acct, t.id,
         t.spot_step_key, t.spot_sequence, t.spot_is_required, v_me, v_me, v_me
  FROM public.service_provider_onboarding_step_templates t
  WHERE t.spot_is_active IS TRUE AND t.spot_is_deleted IS NOT TRUE
    AND NOT EXISTS (
      SELECT 1 FROM public.service_provider_onboarding_steps s
      WHERE s.spos_application_id = p_application_id AND s.spos_step_key = t.spot_step_key AND s.spos_is_deleted IS NOT TRUE);

  RETURN QUERY
  SELECT s.id, s.spos_step_key, s.spos_name, s.spos_sequence, s.spos_is_required,
         s.spos_is_complete, s.spos_completed_at,
         COALESCE(NULLIF(TRIM(COALESCE(u.user_first_name,'') || ' ' || COALESCE(u.user_last_name,'')), ''), u.user_name),
         s.spos_notes
  FROM public.service_provider_onboarding_steps s
  LEFT JOIN public.users u ON u.id = s.spos_completed_by
  WHERE s.spos_application_id = p_application_id AND s.spos_is_deleted IS NOT TRUE
  ORDER BY s.spos_sequence, s.spos_created_at;
END $function$;

-- ----------------------------------------------------------------------------
-- 6. RPC: mark a step complete/incomplete
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_service_provider_onboarding_step(p_step_id uuid, p_complete boolean, p_notes text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_me uuid;
BEGIN
  v_me := current_app_user_id();
  UPDATE public.service_provider_onboarding_steps SET
    spos_is_complete = COALESCE(p_complete, false),
    spos_completed_at = CASE WHEN p_complete THEN now() ELSE NULL END,
    spos_completed_by = CASE WHEN p_complete THEN v_me ELSE NULL END,
    spos_notes = COALESCE(NULLIF(TRIM(p_notes), ''), spos_notes),
    spos_updated_by = v_me, spos_updated_at = now()
  WHERE id = p_step_id AND spos_is_deleted IS NOT TRUE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Step not found'); END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.ensure_service_provider_onboarding_steps(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_service_provider_onboarding_step(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_service_provider_onboarding_steps(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_service_provider_onboarding_step(uuid, boolean, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
