-- ============================================================================
-- Service Provider intake redesign — multi-trade + Certificate of Insurance.
--
-- Contractors do more than one kind of work, so a single trade picklist would
-- eliminate them. This adds a purpose-built trades junction so an applicant can
-- declare several trades, while the single account_service_provider_type /
-- spa_service_provider_type columns are kept as the PRIMARY trade (first
-- selected) for the existing pickers/displays.
--
-- Insurance is now captured as an uploaded Certificate of Insurance (COI)
-- document rather than typed carrier fields — new account_coi_document_id /
-- spa_coi_document_id, mirroring the W-9 pattern.
--
-- create_service_provider_application() is rewritten to accept a
-- service_provider_types[] array and a coi file, additively (the single
-- service_provider_type and w9 paths are unchanged).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. COI document columns (mirror the W-9 columns)
-- ----------------------------------------------------------------------------
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS account_coi_document_id uuid REFERENCES public.documents(id);
ALTER TABLE public.service_provider_applications
  ADD COLUMN IF NOT EXISTS spa_coi_document_id uuid REFERENCES public.documents(id);

-- ----------------------------------------------------------------------------
-- 2. Object: service_provider_trades (SPT-) — one row per declared trade
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.seq_service_provider_trades;
GRANT USAGE ON SEQUENCE public.seq_service_provider_trades TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.service_provider_trades (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spt_record_number         text NOT NULL DEFAULT '',
  spt_name                  text NOT NULL DEFAULT '',
  spt_account_id            uuid NOT NULL REFERENCES public.accounts(id),
  spt_application_id        uuid REFERENCES public.service_provider_applications(id),
  spt_service_provider_type uuid NOT NULL REFERENCES public.picklist_values(id),
  spt_is_primary            boolean NOT NULL DEFAULT false,
  spt_owner                 uuid NOT NULL REFERENCES public.users(id),
  spt_created_by            uuid REFERENCES public.users(id),
  spt_created_at            timestamptz NOT NULL DEFAULT now(),
  spt_updated_by            uuid REFERENCES public.users(id),
  spt_updated_at            timestamptz NOT NULL DEFAULT now(),
  spt_is_deleted            boolean NOT NULL DEFAULT false,
  spt_deleted_at            timestamptz,
  spt_deleted_by            uuid REFERENCES public.users(id),
  spt_deletion_reason       text,
  is_seed_data              boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_spt_account     ON public.service_provider_trades (spt_account_id);
CREATE INDEX IF NOT EXISTS idx_spt_application ON public.service_provider_trades (spt_application_id);
CREATE INDEX IF NOT EXISTS idx_spt_type        ON public.service_provider_trades (spt_service_provider_type);
-- One active row per (account, trade).
CREATE UNIQUE INDEX IF NOT EXISTS uq_spt_account_type_active
  ON public.service_provider_trades (spt_account_id, spt_service_provider_type)
  WHERE spt_is_deleted IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.set_spt_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.spt_record_number IS NULL OR NEW.spt_record_number = '' THEN
    NEW.spt_record_number := public.generate_record_number('SPT-', 'seq_service_provider_trades');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_service_provider_trades_rn ON public.service_provider_trades;
CREATE TRIGGER trg_service_provider_trades_rn BEFORE INSERT ON public.service_provider_trades
  FOR EACH ROW EXECUTE FUNCTION public.set_spt_record_number();
CREATE TRIGGER trg_audit_service_provider_trades AFTER INSERT OR DELETE OR UPDATE ON public.service_provider_trades
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_service_provider_trades_no_hard_delete BEFORE DELETE ON public.service_provider_trades
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();

ALTER TABLE public.service_provider_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_select_service_provider_trades ON public.service_provider_trades
  FOR SELECT TO authenticated USING ((SELECT app_user_can('service_provider_trades','read')));
CREATE POLICY app_insert_service_provider_trades ON public.service_provider_trades
  FOR INSERT TO authenticated WITH CHECK ((SELECT app_user_can('service_provider_trades','create')));
CREATE POLICY app_update_service_provider_trades ON public.service_provider_trades
  FOR UPDATE TO authenticated USING ((SELECT app_user_can('service_provider_trades','update')))
  WITH CHECK ((SELECT app_user_can('service_provider_trades','update')));
CREATE POLICY app_delete_service_provider_trades ON public.service_provider_trades
  FOR DELETE TO authenticated USING ((SELECT app_user_can('service_provider_trades','delete')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_provider_trades TO authenticated, service_role;

INSERT INTO public.role_object_access (id, roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete)
SELECT gen_random_uuid(), roa.roa_role_id, 'service_provider_trades', roa.roa_read, roa.roa_create, roa.roa_update, false
FROM public.role_object_access roa
JOIN public.roles r ON r.id = roa.roa_role_id
WHERE roa.roa_object_name = 'accounts'
  AND r.role_name NOT IN ('Property Owner', 'Property Manager', 'Service Provider Partner')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_object_access x
    WHERE x.roa_role_id = roa.roa_role_id AND x.roa_object_name = 'service_provider_trades'
  );

-- ----------------------------------------------------------------------------
-- 3. Rewrite create_service_provider_application — multi-trade + COI (additive)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_service_provider_application(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_owner   uuid;
  v_rt uuid; v_status uuid; v_stage uuid; v_trade uuid;
  v_account uuid; v_contact uuid; v_app uuid; v_doc uuid; v_coi_doc uuid;
  v_company text; v_norm text; v_state text; v_trade_val text;
  v_first text; v_last text; v_cname text; v_app_number text;
BEGIN
  SELECT u.id INTO v_owner FROM public.users u JOIN public.roles r ON r.id = u.role_id
   WHERE r.role_name = 'Project Coordinator' AND u.user_is_active IS TRUE AND u.user_is_deleted IS NOT TRUE
   ORDER BY u.user_created_at LIMIT 1;
  IF v_owner IS NULL THEN
    SELECT u.id INTO v_owner FROM public.users u JOIN public.roles r ON r.id = u.role_id
     WHERE r.role_name = 'Admin' AND u.user_is_active IS TRUE ORDER BY u.user_created_at LIMIT 1;
  END IF;
  IF v_owner IS NULL THEN v_owner := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'; END IF;

  v_company   := COALESCE(NULLIF(trim(p_payload->>'company_legal_name'), ''), 'Service Provider Applicant');
  v_state     := upper(COALESCE(NULLIF(trim(p_payload->>'home_state'), ''), 'NC'));
  -- Primary trade = first of the array, else the single value.
  v_trade_val := COALESCE(
    NULLIF(trim(p_payload->'service_provider_types'->>0), ''),
    NULLIF(trim(p_payload->>'service_provider_type'), ''));
  v_first     := NULLIF(trim(p_payload->>'contact_first_name'), '');
  v_last      := NULLIF(trim(p_payload->>'contact_last_name'), '');
  v_cname     := COALESCE(NULLIF(trim(COALESCE(v_first,'') || ' ' || COALESCE(v_last,'')), ''), v_company);

  SELECT id INTO v_rt     FROM picklist_values WHERE picklist_object='accounts' AND picklist_field='record_type' AND picklist_value='SERVICE-PROVIDER';
  SELECT id INTO v_status FROM picklist_values WHERE picklist_object='accounts' AND picklist_field='service_provider_status' AND picklist_value='Service Provider Applicant';
  SELECT id INTO v_stage  FROM picklist_values WHERE picklist_object='service_provider_applications' AND picklist_field='stage' AND picklist_value='Application Submitted';
  IF v_trade_val IS NOT NULL THEN
    SELECT id INTO v_trade FROM picklist_values WHERE picklist_object='accounts' AND picklist_field='service_provider_type' AND picklist_value=v_trade_val;
  END IF;

  v_norm := regexp_replace(lower(v_company), '[^a-z0-9]', '', 'g');
  SELECT id INTO v_account FROM public.accounts
   WHERE account_record_type = v_rt AND account_is_deleted IS NOT TRUE
     AND regexp_replace(lower(account_name), '[^a-z0-9]', '', 'g') = v_norm
     AND upper(COALESCE(account_service_provider_home_state, '')) = v_state
   LIMIT 1;

  IF v_account IS NULL THEN
    INSERT INTO public.accounts (
      account_record_number, account_name, account_record_type,
      account_phone, account_email, account_website, billing_state,
      account_service_provider_type, account_service_provider_status, account_service_provider_is_active,
      account_service_provider_home_state, account_service_provider_dba_name, account_service_provider_entity_type,
      account_license_number, account_license_type, account_license_state, account_license_expiration_date,
      account_general_liability_carrier, account_general_liability_policy_number, account_general_liability_expiration_date,
      account_workers_comp_carrier, account_workers_comp_policy_number, account_workers_comp_expiration_date,
      account_owner, account_created_by, account_updated_by)
    VALUES (
      '', v_company, v_rt,
      NULLIF(trim(p_payload->>'business_phone'),''), NULLIF(trim(p_payload->>'business_email'),''), NULLIF(trim(p_payload->>'website'),''), v_state,
      v_trade, v_status, false,
      v_state, NULLIF(trim(p_payload->>'dba_name'),''), NULLIF(trim(p_payload->>'entity_type'),''),
      NULLIF(trim(p_payload->>'license_number'),''), NULLIF(trim(p_payload->>'license_type'),''), NULLIF(trim(p_payload->>'license_state'),''), NULLIF(trim(p_payload->>'license_expiration_date'),'')::date,
      NULLIF(trim(p_payload->>'gl_carrier'),''), NULLIF(trim(p_payload->>'gl_policy_number'),''), NULLIF(trim(p_payload->>'gl_expiration_date'),'')::date,
      NULLIF(trim(p_payload->>'wc_carrier'),''), NULLIF(trim(p_payload->>'wc_policy_number'),''), NULLIF(trim(p_payload->>'wc_expiration_date'),'')::date,
      v_owner, v_owner, v_owner)
    RETURNING id INTO v_account;
  END IF;

  -- W-9 document
  IF NULLIF(p_payload->'w9'->>'storage_path', '') IS NOT NULL THEN
    INSERT INTO public.documents (
      name, document_type, category, related_object, related_id,
      storage_bucket, storage_path, mime_type, file_size_bytes, uploaded_by)
    VALUES (
      left('W-9 — ' || v_company, 250), 'w9', 'Service Provider W-9', 'accounts', v_account,
      p_payload->'w9'->>'storage_bucket', p_payload->'w9'->>'storage_path',
      p_payload->'w9'->>'mime_type', NULLIF(p_payload->'w9'->>'file_size_bytes','')::bigint, v_owner)
    RETURNING id INTO v_doc;
    UPDATE public.accounts SET account_w9_document_id = v_doc WHERE id = v_account AND account_w9_document_id IS NULL;
  END IF;

  -- Certificate of Insurance document
  IF NULLIF(p_payload->'coi'->>'storage_path', '') IS NOT NULL THEN
    INSERT INTO public.documents (
      name, document_type, category, related_object, related_id,
      storage_bucket, storage_path, mime_type, file_size_bytes, uploaded_by)
    VALUES (
      left('COI — ' || v_company, 250), 'coi', 'Service Provider Certificate of Insurance', 'accounts', v_account,
      p_payload->'coi'->>'storage_bucket', p_payload->'coi'->>'storage_path',
      p_payload->'coi'->>'mime_type', NULLIF(p_payload->'coi'->>'file_size_bytes','')::bigint, v_owner)
    RETURNING id INTO v_coi_doc;
    UPDATE public.accounts SET account_coi_document_id = v_coi_doc WHERE id = v_account AND account_coi_document_id IS NULL;
  END IF;

  INSERT INTO public.contacts (
    contact_record_number, contact_name, contact_first_name, contact_last_name,
    contact_title, contact_email, contact_phone, contact_account_id,
    contact_owner, contact_created_by, contact_updated_by, contact_created_at, contact_updated_at)
  VALUES (
    '', v_cname, COALESCE(v_first, 'Unknown'), COALESCE(v_last, 'Unknown'),
    NULLIF(trim(p_payload->>'contact_title'),''), NULLIF(trim(p_payload->>'contact_email'),''), NULLIF(trim(p_payload->>'contact_phone'),''), v_account,
    v_owner, v_owner, v_owner, now(), now())
  RETURNING id INTO v_contact;

  INSERT INTO public.service_provider_applications (
    spa_record_number, spa_name, spa_account_id, spa_primary_contact_id,
    spa_stage, spa_source, spa_submitted_at,
    spa_company_legal_name, spa_dba_name, spa_service_provider_type, spa_entity_type, spa_home_state,
    spa_business_phone, spa_business_email, spa_website,
    spa_address_street, spa_address_city, spa_address_state, spa_address_zip, spa_number_of_employees,
    spa_contact_first_name, spa_contact_last_name, spa_contact_title, spa_contact_email, spa_contact_phone,
    spa_license_number, spa_license_type, spa_license_state, spa_license_expiration_date,
    spa_general_liability_carrier, spa_general_liability_policy_number, spa_general_liability_expiration_date,
    spa_workers_comp_carrier, spa_workers_comp_policy_number, spa_workers_comp_expiration_date,
    spa_w9_document_id, spa_coi_document_id, spa_notes, spa_owner, spa_created_by, spa_updated_by)
  VALUES (
    '', left(v_company, 250), v_account, v_contact,
    v_stage, COALESCE(NULLIF(trim(p_payload->>'source'),''), 'Public Intake Site'), now(),
    v_company, NULLIF(trim(p_payload->>'dba_name'),''), v_trade, NULLIF(trim(p_payload->>'entity_type'),''), v_state,
    NULLIF(trim(p_payload->>'business_phone'),''), NULLIF(trim(p_payload->>'business_email'),''), NULLIF(trim(p_payload->>'website'),''),
    NULLIF(trim(p_payload->>'address_street'),''), NULLIF(trim(p_payload->>'address_city'),''), NULLIF(trim(p_payload->>'address_state'),''), NULLIF(trim(p_payload->>'address_zip'),''), NULLIF(trim(p_payload->>'number_of_employees'),'')::int,
    v_first, v_last, NULLIF(trim(p_payload->>'contact_title'),''), NULLIF(trim(p_payload->>'contact_email'),''), NULLIF(trim(p_payload->>'contact_phone'),''),
    NULLIF(trim(p_payload->>'license_number'),''), NULLIF(trim(p_payload->>'license_type'),''), NULLIF(trim(p_payload->>'license_state'),''), NULLIF(trim(p_payload->>'license_expiration_date'),'')::date,
    NULLIF(trim(p_payload->>'gl_carrier'),''), NULLIF(trim(p_payload->>'gl_policy_number'),''), NULLIF(trim(p_payload->>'gl_expiration_date'),'')::date,
    NULLIF(trim(p_payload->>'wc_carrier'),''), NULLIF(trim(p_payload->>'wc_policy_number'),''), NULLIF(trim(p_payload->>'wc_expiration_date'),'')::date,
    v_doc, v_coi_doc, NULLIF(trim(p_payload->>'notes'),''), v_owner, v_owner, v_owner)
  RETURNING id, spa_record_number INTO v_app, v_app_number;

  -- Trades (multi-select): insert every declared trade, mark the primary.
  INSERT INTO public.service_provider_trades (
    spt_record_number, spt_name, spt_account_id, spt_application_id,
    spt_service_provider_type, spt_is_primary, spt_owner, spt_created_by, spt_updated_by)
  SELECT '', pv.picklist_label, v_account, v_app, pv.id,
         (pv.picklist_value = v_trade_val), v_owner, v_owner, v_owner
  FROM (
    SELECT DISTINCT trim(tv) AS tv FROM (
      SELECT jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(p_payload->'service_provider_types')='array'
                    THEN p_payload->'service_provider_types' ELSE '[]'::jsonb END) AS tv
      UNION
      SELECT v_trade_val WHERE v_trade_val IS NOT NULL
    ) s WHERE NULLIF(trim(tv),'') IS NOT NULL
  ) d
  JOIN picklist_values pv
    ON pv.picklist_object='accounts' AND pv.picklist_field='service_provider_type' AND pv.picklist_value = d.tv
  WHERE NOT EXISTS (
    SELECT 1 FROM public.service_provider_trades x
    WHERE x.spt_account_id = v_account AND x.spt_service_provider_type = pv.id AND x.spt_is_deleted IS NOT TRUE);

  IF jsonb_typeof(p_payload->'zip_codes') = 'array' THEN
    INSERT INTO public.service_provider_service_areas (
      spsa_record_number, spsa_name, spsa_account_id, spsa_application_id, spsa_zip_code, spsa_state,
      spsa_owner, spsa_created_by, spsa_updated_by)
    SELECT '', d.zc, v_account, v_app, d.zc, v_state, v_owner, v_owner, v_owner
    FROM (SELECT DISTINCT trim(z) AS zc
          FROM jsonb_array_elements_text(p_payload->'zip_codes') AS z
          WHERE NULLIF(trim(z), '') IS NOT NULL) d
    WHERE NOT EXISTS (
        SELECT 1 FROM public.service_provider_service_areas s
        WHERE s.spsa_account_id = v_account AND s.spsa_zip_code = d.zc AND s.spsa_is_deleted IS NOT TRUE);
  END IF;

  RETURN jsonb_build_object('ok', true, 'application_number', v_app_number, 'account_id', v_account);
END $function$;

REVOKE ALL ON FUNCTION public.create_service_provider_application(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_service_provider_application(jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
