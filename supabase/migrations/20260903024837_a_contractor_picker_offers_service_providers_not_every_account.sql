-- A contractor picker offers service providers, not every account.
--
-- Nicholas: "when we're picking contractors and supporting contractors, only
-- contractors that are service providers (account record types) can be in the
-- pick list ... this way we don't have every account in our database
-- available."
--
-- It offered every account: 6,536 of them, against 10 accounts whose record
-- type is SERVICE-PROVIDER. Finding Sealed in that list is luck, and choosing a
-- property owner by mistake is a filing that names the wrong company as the
-- installer.
--
-- He also asked that Energy Efficiency Services of Wisconsin and North Carolina
-- always appear. They already do: BOTH are record type SERVICE-PROVIDER
-- (ACC-07590, ACC-07591), as are Sealed Inc, Energy Efficiency Services and
-- Energy Efficiency Services — Field Resources. So the rule needs no exception
-- list, and no exception list is built: a hand-kept "always include these"
-- would be a second thing to maintain saying what the record type already says.
-- If an EES account is ever retyped, the fix is its record type.
--
-- ONE ACCOUNT DROPS OUT AND IT IS DELIBERATE. Johnson Controls, Inc.
-- (ACC-07587) is record type CONTRACTOR, not SERVICE-PROVIDER, and is the
-- contractor on live enrollments. Those records keep showing it -- the RPC
-- always returns the currently-saved account whatever its type, so a saved
-- value never renders blank -- but it can no longer be chosen afresh. Widening
-- the rule to include CONTRACTOR would be deciding a question Nicholas
-- answered; retyping the account is a one-row data edit and is his call.
--
-- THE CONTACT PICKERS ARE SCOPED IN THE SAME PASS, to the chosen contractor's
-- own contacts, through the contacts_for_accounts kind that already exists.
-- Same defect one field along: picking a contractor and then being offered
-- every contact in the database is how a filing names the right company and
-- the wrong person.
--
-- Both are applied by COLUMN NAME SUFFIX across every layout rather than to a
-- list of layouts, so a placement anywhere -- including the incentive
-- application layouts, which carry the same fields -- is covered, and
-- unscoped_contractor_lookups() reports any that appear later.

CREATE OR REPLACE FUNCTION public.list_service_provider_accounts(p_include_account_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, account_name text)
LANGUAGE sql STABLE
SET search_path TO 'public','pg_catalog'
AS $fn$
  SELECT a.id, a.account_name
    FROM public.accounts a
    JOIN public.picklist_values rt ON rt.id = a.account_record_type
   WHERE a.account_is_deleted IS NOT TRUE
     AND rt.picklist_object = 'accounts'
     AND rt.picklist_field = 'record_type'
     AND rt.picklist_value = 'SERVICE-PROVIDER'
  UNION
  -- The value already on the record, whatever its record type. Without this a
  -- saved contractor that no longer qualifies renders as an empty dropdown,
  -- which reads as "this record has no contractor" and invites somebody to
  -- pick a new one.
  SELECT a.id, a.account_name
    FROM public.accounts a
   WHERE p_include_account_id IS NOT NULL
     AND a.id = p_include_account_id
     AND a.account_is_deleted IS NOT TRUE
   ORDER BY 2;
$fn$;

-- SECURITY INVOKER (the default): the picker must show the caller only the
-- accounts the caller may read, so state scoping still applies.
REVOKE ALL ON FUNCTION public.list_service_provider_accounts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_service_provider_accounts(uuid) TO authenticated, service_role;

UPDATE public.page_layout_widgets w
   SET widget_config = jsonb_set(w.widget_config, '{fields}', (
         SELECT jsonb_agg(
           CASE
             WHEN f->>'name' LIKE '%\_contractor\_account\_id'
               THEN f || jsonb_build_object(
                      'lookup_dependency',
                      jsonb_build_object('kind','service_provider_accounts','depends_on','[]'::jsonb))
             WHEN f->>'name' LIKE '%\_contractor\_contact\_id'
               THEN f || jsonb_build_object(
                      'lookup_dependency',
                      jsonb_build_object(
                        'kind','contacts_for_accounts',
                        'depends_on', jsonb_build_array(
                          replace(f->>'name', '_contact_id', '_account_id'))))
             ELSE f
           END ORDER BY ord)
         FROM jsonb_array_elements(w.widget_config->'fields') WITH ORDINALITY AS t(f, ord)))
 WHERE w.widget_config ? 'fields'
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(w.widget_config->'fields') f
      WHERE f->>'name' LIKE '%\_contractor\_account\_id'
         OR f->>'name' LIKE '%\_contractor\_contact\_id');

-- Anything that slips through later. A picker with no scope is invisible until
-- somebody files the wrong company, so it is reported rather than assumed.
CREATE OR REPLACE FUNCTION public.unscoped_contractor_lookups()
RETURNS TABLE (page_layout_object text, record_type text, field_name text)
LANGUAGE sql STABLE SET search_path TO 'public','pg_catalog'
AS $fn$
  SELECT DISTINCT pl.page_layout_object, COALESCE(rt.picklist_value,'(none)'), f->>'name'
    FROM public.page_layouts pl
    LEFT JOIN public.picklist_values rt ON rt.id = pl.record_type_id
    JOIN public.page_layout_sections s ON s.page_layout_id = pl.id
    JOIN public.page_layout_widgets w ON w.section_id = s.id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
   WHERE (f->>'name' LIKE '%\_contractor\_account\_id' OR f->>'name' LIKE '%\_contractor\_contact\_id')
     AND (f->'lookup_dependency'->>'kind') IS NULL
   ORDER BY 1,2,3;
$fn$;
REVOKE ALL ON FUNCTION public.unscoped_contractor_lookups() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unscoped_contractor_lookups() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

DO $assert$
DECLARE v_left text; v_offered int; v_has_ees int; v_saved int;
BEGIN
  SELECT string_agg(page_layout_object || '.' || field_name, ', ')
    INTO v_left FROM public.unscoped_contractor_lookups();
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'These contractor lookups are still unscoped: %', v_left;
  END IF;

  -- The list is small enough to be a list, and still contains the accounts
  -- that actually file.
  SELECT count(*) INTO v_offered FROM public.list_service_provider_accounts(NULL);
  IF v_offered > 50 THEN
    RAISE EXCEPTION 'The contractor picker still offers % accounts', v_offered;
  END IF;

  SELECT count(*) INTO v_has_ees FROM public.list_service_provider_accounts(NULL)
   WHERE account_name IN ('Energy Efficiency Services of Wisconsin',
                          'Energy Efficiency Services of North Carolina',
                          'Sealed Inc');
  IF v_has_ees <> 3 THEN
    RAISE EXCEPTION 'Sealed and the two EES accounts must all be offered; % of 3 are', v_has_ees;
  END IF;

  -- A saved account that no longer qualifies still comes back, or the record
  -- would read as having no contractor at all.
  SELECT count(*) INTO v_saved
    FROM public.accounts a,
         LATERAL public.list_service_provider_accounts(a.id) l
   WHERE a.account_name = 'Johnson Controls, Inc.' AND a.account_is_deleted IS NOT TRUE
     AND l.id = a.id;
  IF v_saved <> 1 THEN
    RAISE EXCEPTION 'A saved non-service-provider contractor is no longer returned for its own record.';
  END IF;
END $assert$;
