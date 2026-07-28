-- Primary contractor account lookup by program state.
--
-- Energy Efficiency Services is the primary contractor on every incentive
-- application. EES is modeled as a contractor-record-type account per state
-- (Energy Efficiency Services of Wisconsin / of North Carolina, children of the
-- "Energy Efficiency Services" umbrella account), each carrying its own phone,
-- email and address. This SECURITY INVOKER RPC returns the EES contractor
-- account licensed in a given program state so the application create form can
-- auto-fill ia_primary_contractor_* — WI programs draw the Wisconsin contractor,
-- NC programs the North Carolina one — without hardcoding any account id or name
-- in application code.
--
-- Match is data-driven: contractor record type (matched case-insensitively so it
-- survives record-type value standardization) + account_license_state = program
-- state. Subcontractors use the service_provider record type, so contractor is
-- reserved for the EES house contractor.

CREATE OR REPLACE FUNCTION public.get_primary_contractor_account_for_state(p_state text)
RETURNS TABLE (
  account_id        uuid,
  account_name      text,
  account_phone     text,
  account_email     text,
  contractor_street text,
  contractor_city   text,
  contractor_state  text,
  contractor_zip    text
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT a.id,
         a.account_name,
         a.account_phone,
         a.account_email,
         COALESCE(a.billing_street, a.mailing_street),
         COALESCE(a.billing_city,   a.mailing_city),
         COALESCE(a.billing_state,  a.mailing_state, a.account_license_state),
         COALESCE(a.billing_zip,    a.mailing_zip)
  FROM public.accounts a
  JOIN public.picklist_values pv
    ON pv.id = a.account_record_type
   AND pv.picklist_object = 'accounts'
   AND pv.picklist_field  = 'record_type'
  WHERE upper(pv.picklist_value) = 'CONTRACTOR'
    AND COALESCE(a.account_is_deleted, false) = false
    AND p_state IS NOT NULL
    AND btrim(p_state) <> ''
    AND upper(btrim(COALESCE(a.account_license_state, ''))) = upper(btrim(p_state))
  ORDER BY a.account_created_at ASC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_primary_contractor_account_for_state(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_primary_contractor_account_for_state(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
