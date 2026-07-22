-- ============================================================================
-- Service Provider Portal + Intake — Phase 4b: application approval / decline
-- ----------------------------------------------------------------------------
-- Internal review actions that close the loop between intake and the portal.
--   approve_service_provider_application: stage -> Approved, activate the
--     account, and provision (or find) the provider's portal_users login
--     (status 'Portal User Pending'). The edge function then auto-sends the
--     auth invite (redirect /provider-portal).
--   decline_service_provider_application: stage -> Declined, account status
--     -> 'Service Provider Declined' (kept inactive), reason recorded.
-- Both permission-gated via app_user_can('service_provider_applications',...).
-- See docs/leap-service-provider-portal.md.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_service_provider_application(
  p_application_id uuid, p_portal_role text DEFAULT 'service_provider_admin')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_caller uuid; v_account uuid; v_contact uuid; v_company text;
  v_email text; v_name text; v_phone text;
  v_role uuid; v_active_status uuid; v_stage_appr uuid;
  v_pu uuid; v_pu_auth uuid;
BEGIN
  IF NOT public.app_user_can('service_provider_applications','update') THEN
    RAISE EXCEPTION 'Not authorized to approve service provider applications' USING errcode='42501';
  END IF;
  v_caller := public.current_app_user_id();

  SELECT spa_account_id, spa_primary_contact_id, COALESCE(spa_company_legal_name, spa_name),
         COALESCE(NULLIF(trim(spa_contact_email),''), NULLIF(trim(spa_business_email),'')),
         NULLIF(trim(COALESCE(spa_contact_first_name,'') || ' ' || COALESCE(spa_contact_last_name,'')), ''),
         NULLIF(trim(spa_contact_phone),'')
    INTO v_account, v_contact, v_company, v_email, v_name, v_phone
  FROM public.service_provider_applications
  WHERE id = p_application_id AND spa_is_deleted IS NOT TRUE;
  IF v_account IS NULL THEN RETURN jsonb_build_object('error','application_not_found'); END IF;

  IF v_email IS NULL AND v_contact IS NOT NULL THEN
    SELECT NULLIF(trim(contact_email),'') INTO v_email FROM public.contacts WHERE id = v_contact;
  END IF;
  IF v_name IS NULL THEN
    v_name := COALESCE((SELECT NULLIF(trim(contact_name),'') FROM public.contacts WHERE id = v_contact), v_company);
  END IF;

  SELECT id INTO v_active_status FROM picklist_values WHERE picklist_object='accounts' AND picklist_field='service_provider_status' AND picklist_value='Service Provider Active';
  SELECT id INTO v_stage_appr    FROM picklist_values WHERE picklist_object='service_provider_applications' AND picklist_field='stage' AND picklist_value='Application Approved';
  SELECT id INTO v_role          FROM picklist_values WHERE picklist_object='portal_users' AND picklist_field='portal_role' AND picklist_value=p_portal_role;
  IF v_role IS NULL THEN
    SELECT id INTO v_role FROM picklist_values WHERE picklist_object='portal_users' AND picklist_field='portal_role' AND picklist_value='service_provider_admin';
  END IF;

  UPDATE public.service_provider_applications
     SET spa_stage = v_stage_appr, spa_reviewer_user_id = v_caller, spa_reviewed_at = now(),
         spa_updated_by = v_caller, spa_updated_at = now()
   WHERE id = p_application_id;

  UPDATE public.accounts
     SET account_service_provider_is_active = true, account_service_provider_status = v_active_status,
         account_updated_by = v_caller, account_updated_at = now()
   WHERE id = v_account;

  -- Provision (or find) the provider portal login for this account + email.
  SELECT id, auth_user_id INTO v_pu, v_pu_auth FROM public.portal_users
   WHERE portal_user_account_id = v_account AND record_type = 'Provider User' AND is_deleted = false
     AND (v_email IS NULL OR lower(email) = lower(v_email))
   ORDER BY created_at LIMIT 1;

  IF v_pu IS NULL THEN
    INSERT INTO public.portal_users (
      record_type, full_name, email, phone, portal_role, status,
      portal_user_account_id, assigned_internal_user_id, created_by, updated_by)
    VALUES (
      'Provider User', COALESCE(v_name, v_company), v_email, v_phone, v_role, 'Portal User Pending',
      v_account, v_caller, v_caller, v_caller)
    RETURNING id INTO v_pu;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'portal_user_id', v_pu, 'email', v_email,
    'full_name', COALESCE(v_name, v_company), 'account_id', v_account,
    'already_invited', (v_pu_auth IS NOT NULL));
END $$;

REVOKE ALL ON FUNCTION public.approve_service_provider_application(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_service_provider_application(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.decline_service_provider_application(p_application_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE v_caller uuid; v_account uuid; v_stage_dec uuid; v_status_dec uuid;
BEGIN
  IF NOT public.app_user_can('service_provider_applications','update') THEN
    RAISE EXCEPTION 'Not authorized to decline service provider applications' USING errcode='42501';
  END IF;
  v_caller := public.current_app_user_id();
  SELECT spa_account_id INTO v_account FROM public.service_provider_applications
   WHERE id = p_application_id AND spa_is_deleted IS NOT TRUE;
  IF v_account IS NULL THEN RETURN jsonb_build_object('error','application_not_found'); END IF;

  SELECT id INTO v_stage_dec  FROM picklist_values WHERE picklist_object='service_provider_applications' AND picklist_field='stage' AND picklist_value='Application Declined';
  SELECT id INTO v_status_dec FROM picklist_values WHERE picklist_object='accounts' AND picklist_field='service_provider_status' AND picklist_value='Service Provider Declined';

  UPDATE public.service_provider_applications
     SET spa_stage = v_stage_dec, spa_declined_reason = p_reason, spa_reviewer_user_id = v_caller,
         spa_reviewed_at = now(), spa_updated_by = v_caller, spa_updated_at = now()
   WHERE id = p_application_id;
  UPDATE public.accounts
     SET account_service_provider_status = v_status_dec, account_service_provider_is_active = false,
         account_updated_by = v_caller, account_updated_at = now()
   WHERE id = v_account;

  RETURN jsonb_build_object('ok', true, 'status', 'Application Declined');
END $$;

REVOKE ALL ON FUNCTION public.decline_service_provider_application(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_service_provider_application(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
