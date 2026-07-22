-- ============================================================================
-- Service Provider Portal + Intake — Phase 4: public intake
-- ----------------------------------------------------------------------------
-- Backend for the public (anonymous) provider signup form. A private W-9
-- document bucket + one transactional SECURITY DEFINER RPC that lands a
-- submission as: an inactive Service Provider account + a primary contact +
-- a service_provider_applications row (stage 'Application Submitted', source
-- 'Public Intake Site') + one service_provider_service_areas row per ZIP.
--
-- The anonymous edge function `service-provider-intake` uploads the W-9 (service
-- role) then calls this RPC (service_role only). Every applicant gets a tracked
-- record — repeat applicants (same normalized legal name + state) reuse their
-- existing account so their history stays together. See
-- docs/leap-service-provider-portal.md.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Private W-9 / document bucket (sensitive tax docs — isolated from other
-- buckets; readable only by authenticated staff, uploads via service role).
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('service-provider-documents', 'service-provider-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS sp_documents_authenticated_read   ON storage.objects;
DROP POLICY IF EXISTS sp_documents_authenticated_insert ON storage.objects;
DROP POLICY IF EXISTS sp_documents_authenticated_update ON storage.objects;
DROP POLICY IF EXISTS sp_documents_authenticated_delete ON storage.objects;
CREATE POLICY sp_documents_authenticated_read   ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'service-provider-documents');
CREATE POLICY sp_documents_authenticated_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'service-provider-documents');
CREATE POLICY sp_documents_authenticated_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'service-provider-documents') WITH CHECK (bucket_id = 'service-provider-documents');
CREATE POLICY sp_documents_authenticated_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'service-provider-documents');

-- ----------------------------------------------------------------------------
-- create_service_provider_application(p_payload jsonb)
--   Transactional intake cascade. Called by the anon edge function (service
--   role). Returns { ok, application_number, account_id }.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_service_provider_application(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_owner   uuid;
  v_rt uuid; v_status uuid; v_stage uuid; v_trade uuid;
  v_account uuid; v_contact uuid; v_app uuid; v_doc uuid;
  v_company text; v_norm text; v_state text; v_trade_val text;
  v_first text; v_last text; v_cname text; v_app_number text;
BEGIN
  -- System owner for anonymously-created records: first active Project
  -- Coordinator, then any active Admin, then the standing system user.
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
  v_trade_val := NULLIF(trim(p_payload->>'service_provider_type'), '');
  v_first     := NULLIF(trim(p_payload->>'contact_first_name'), '');
  v_last      := NULLIF(trim(p_payload->>'contact_last_name'), '');
  v_cname     := COALESCE(NULLIF(trim(COALESCE(v_first,'') || ' ' || COALESCE(v_last,'')), ''), v_company);

  SELECT id INTO v_rt     FROM picklist_values WHERE picklist_object='accounts' AND picklist_field='record_type' AND picklist_value='service_provider';
  SELECT id INTO v_status FROM picklist_values WHERE picklist_object='accounts' AND picklist_field='service_provider_status' AND picklist_value='Service Provider Applicant';
  SELECT id INTO v_stage  FROM picklist_values WHERE picklist_object='service_provider_applications' AND picklist_field='stage' AND picklist_value='Application Submitted';
  IF v_trade_val IS NOT NULL THEN
    SELECT id INTO v_trade FROM picklist_values WHERE picklist_object='accounts' AND picklist_field='service_provider_type' AND picklist_value=v_trade_val;
  END IF;

  -- Match an existing Service Provider account (repeat applicant) by normalized
  -- legal name + home state; otherwise create a new inactive account.
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

  -- W-9 (already uploaded to storage by the edge function) -> documents row
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

  -- Primary contact
  INSERT INTO public.contacts (
    contact_record_number, contact_name, contact_first_name, contact_last_name,
    contact_title, contact_email, contact_phone, contact_account_id,
    contact_owner, contact_created_by, contact_updated_by, contact_created_at, contact_updated_at)
  VALUES (
    '', v_cname, COALESCE(v_first, 'Unknown'), COALESCE(v_last, 'Unknown'),
    NULLIF(trim(p_payload->>'contact_title'),''), NULLIF(trim(p_payload->>'contact_email'),''), NULLIF(trim(p_payload->>'contact_phone'),''), v_account,
    v_owner, v_owner, v_owner, now(), now())
  RETURNING id INTO v_contact;

  -- Application
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
    spa_w9_document_id, spa_notes, spa_owner, spa_created_by, spa_updated_by)
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
    v_doc, NULLIF(trim(p_payload->>'notes'),''), v_owner, v_owner, v_owner)
  RETURNING id, spa_record_number INTO v_app, v_app_number;

  -- Areas of operation (ZIP codes) — one row per new ZIP for the account
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
END $$;

REVOKE ALL ON FUNCTION public.create_service_provider_application(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_service_provider_application(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
