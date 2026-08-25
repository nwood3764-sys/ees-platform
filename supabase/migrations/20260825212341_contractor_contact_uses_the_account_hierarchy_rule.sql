-- One definition of "a contact of this contractor account", and it is LEAP's
-- existing one.
--
-- The rule shipped moments earlier tested contacts.contact_account_id directly.
-- That is a THIRD definition, stricter than either lookup already in the
-- platform, and it is wrong here: Energy Efficiency Services of Wisconsin
-- (ACC-07590) is a child of Energy Efficiency Services (ACC-07589), its Account
-- Contact is Brittin Wood on the PARENT account, and the Account Contact field
-- itself offers exactly that through contacts_for_account_hierarchy. Under the
-- strict test that valid, deliberate selection resolved to nobody and blanked
-- ENR-00012's primary contractor contact.
--
-- So the resolver now asks list_contacts_for_account_hierarchy -- the same
-- function the picker calls -- whether a contact belongs to the account: the
-- account, every ancestor via parent_account_id, and anyone linked through
-- account_contact_relations. A contact from an unrelated company (Tyler Wallace
-- of Sealed Inc under Energy Efficiency Services of Wisconsin) is still refused.
--
-- The contractor contact lookups move to the same kind in the same change, so
-- the field can never offer a contact the rule rejects, or reject one it offers.
--
-- The triggers also stop treating a blank as a deliberate clear. A program form
-- has to name a person for the contractor, so the contact simply resolves on
-- every write: the selected contact when it is valid, otherwise the account's
-- own Account Contact, otherwise blank because the account names nobody. That
-- makes the stored value and the rule the same thing, which is what lets the
-- assertion at the bottom be an equality rather than a weaker "close enough".

CREATE OR REPLACE FUNCTION public.contractor_contact_for_account(
  p_account_id uuid,
  p_current_contact_id uuid
) RETURNS uuid
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_catalog'
AS $fn$
  SELECT CASE
    WHEN p_account_id IS NULL THEN NULL
    WHEN p_current_contact_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.list_contacts_for_account_hierarchy(ARRAY[p_account_id]) h
       WHERE h.id = p_current_contact_id
    ) THEN p_current_contact_id
    ELSE (
      SELECT a.account_contact_id
        FROM public.accounts a
       WHERE a.id = p_account_id
         AND a.account_is_deleted IS NOT TRUE
         AND a.account_contact_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public.list_contacts_for_account_hierarchy(ARRAY[p_account_id]) h
            WHERE h.id = a.account_contact_id
         )
    )
  END;
$fn$;

COMMENT ON FUNCTION public.contractor_contact_for_account(uuid, uuid) IS
  'The contact that represents a contractor account on a program form: the selected contact when list_contacts_for_account_hierarchy offers it for that account, else the account''s own Account Contact, else NULL. Never a contact from an unrelated company.';

CREATE OR REPLACE FUNCTION public.sync_enrollment_contractor_contacts()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $fn$
BEGIN
  NEW.enrollment_contractor_contact_id := public.contractor_contact_for_account(
    NEW.enrollment_contractor_account_id, NEW.enrollment_contractor_contact_id);
  NEW.enrollment_support_contractor_contact_id := public.contractor_contact_for_account(
    NEW.enrollment_support_contractor_account_id, NEW.enrollment_support_contractor_contact_id);
  RETURN NEW;
END; $fn$;

CREATE OR REPLACE FUNCTION public.sync_incentive_application_contractor_contacts()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $fn$
BEGIN
  NEW.ia_contractor_contact_id := public.contractor_contact_for_account(
    NEW.ia_contractor_account_id, NEW.ia_contractor_contact_id);
  NEW.ia_support_contractor_contact_id := public.contractor_contact_for_account(
    NEW.ia_support_contractor_account_id, NEW.ia_support_contractor_contact_id);
  RETURN NEW;
END; $fn$;

-- The picker and the rule read the same function.
UPDATE public.page_layout_widgets w
SET widget_config = jsonb_set(w.widget_config, '{fields}', (
      SELECT jsonb_agg(
        CASE
          WHEN fld->>'type' = 'lookup'
           AND fld->>'name' LIKE '%contractor_contact_id'
           AND fld->'lookup_dependency'->>'kind' = 'contacts_for_accounts'
          THEN jsonb_set(fld, '{lookup_dependency}', jsonb_build_object(
                 'kind', 'contacts_for_account_hierarchy',
                 'depends_on', fld->'lookup_dependency'->'depends_on',
                 'create_seed', jsonb_build_object(
                   replace(fld->>'name','_contact_id','_account_id'), 'contact_account_id')))
          ELSE fld
        END ORDER BY ord)
      FROM jsonb_array_elements(w.widget_config->'fields') WITH ORDINALITY AS t(fld, ord)
    )),
    updated_at = now()
WHERE w.is_deleted IS NOT TRUE
  AND w.widget_config ? 'fields'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(w.widget_config->'fields') fld
     WHERE fld->>'type' = 'lookup'
       AND fld->>'name' LIKE '%contractor_contact_id'
       AND fld->'lookup_dependency'->>'kind' = 'contacts_for_accounts');

-- Bring every row onto the rule, including the ones the stricter version
-- blanked. Only rows that actually disagree are touched.
UPDATE public.enrollments e
   SET enrollment_contractor_account_id = e.enrollment_contractor_account_id
 WHERE e.enrollment_is_deleted IS NOT TRUE
   AND (
     public.contractor_contact_for_account(e.enrollment_contractor_account_id, e.enrollment_contractor_contact_id)
       IS DISTINCT FROM e.enrollment_contractor_contact_id
     OR
     public.contractor_contact_for_account(e.enrollment_support_contractor_account_id, e.enrollment_support_contractor_contact_id)
       IS DISTINCT FROM e.enrollment_support_contractor_contact_id);

UPDATE public.incentive_applications ia
   SET ia_contractor_account_id = ia.ia_contractor_account_id
 WHERE ia.ia_is_deleted IS NOT TRUE
   AND (
     public.contractor_contact_for_account(ia.ia_contractor_account_id, ia.ia_contractor_contact_id)
       IS DISTINCT FROM ia.ia_contractor_contact_id
     OR
     public.contractor_contact_for_account(ia.ia_support_contractor_account_id, ia.ia_support_contractor_contact_id)
       IS DISTINCT FROM ia.ia_support_contractor_contact_id);

DO $verify$
DECLARE v_bad integer; v_kind integer;
BEGIN
  SELECT count(*) INTO v_bad FROM public.enrollments e
   WHERE e.enrollment_is_deleted IS NOT TRUE
     AND (public.contractor_contact_for_account(e.enrollment_contractor_account_id, e.enrollment_contractor_contact_id)
            IS DISTINCT FROM e.enrollment_contractor_contact_id
       OR public.contractor_contact_for_account(e.enrollment_support_contractor_account_id, e.enrollment_support_contractor_contact_id)
            IS DISTINCT FROM e.enrollment_support_contractor_contact_id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% enrollment row(s) still disagree with the contractor contact rule', v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM public.incentive_applications ia
   WHERE ia.ia_is_deleted IS NOT TRUE
     AND (public.contractor_contact_for_account(ia.ia_contractor_account_id, ia.ia_contractor_contact_id)
            IS DISTINCT FROM ia.ia_contractor_contact_id
       OR public.contractor_contact_for_account(ia.ia_support_contractor_account_id, ia.ia_support_contractor_contact_id)
            IS DISTINCT FROM ia.ia_support_contractor_contact_id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% incentive application row(s) still disagree with the contractor contact rule', v_bad;
  END IF;

  SELECT count(*) INTO v_kind
    FROM public.page_layout_widgets w
    CROSS JOIN LATERAL jsonb_array_elements(w.widget_config->'fields') f
   WHERE w.is_deleted IS NOT TRUE
     AND f->>'name' LIKE '%contractor_contact_id'
     AND f->'lookup_dependency'->>'kind' IS DISTINCT FROM 'contacts_for_account_hierarchy';
  IF v_kind > 0 THEN
    RAISE EXCEPTION '% contractor contact lookup(s) still scope differently from the rule', v_kind;
  END IF;
END $verify$;

NOTIFY pgrst, 'reload schema';
