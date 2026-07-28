-- Authorized Signer picker: fall back to account contacts so it is never empty
-- =============================================================================
-- Context (Nicholas, 2026-07-28): list_signer_contacts_for_opportunity() (added in
-- 20260728163337) offered Decision Makers, then any contact linked as an Opportunity
-- Contact Role, "so the picker is never empty." But it never fell back past the linked
-- roles — so an opportunity with no roles at all (created before the seeding trigger, or
-- whose account gained contacts AFTER the opportunity was created) had an empty picker
-- even though the account clearly has contacts. That is the "can't select the signer"
-- report on OPP-00067.
--
-- This adds the missing final tier: when no Opportunity Contact Roles are linked, offer
-- every active contact on the opportunity's owner account, managing account, or property
-- management company. Decision-Maker priority and the role-based tiers are unchanged, so
-- the intended "signer = Decision Maker" behavior still wins whenever roles exist; the
-- account fallback only engages when there are no linked roles to choose from. The
-- currently-selected contact is always included so it renders even if its role changes.

CREATE OR REPLACE FUNCTION public.list_signer_contacts_for_opportunity(
  p_opportunity_id uuid,
  p_include_contact_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(id uuid, contact_name text)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH dm AS (
    SELECT DISTINCT c.id, c.contact_name
      FROM public.opportunity_contact_roles ocr
      JOIN public.contacts c        ON c.id = ocr.contact_id
      JOIN public.picklist_values pv ON pv.id = ocr.ocr_role
     WHERE ocr.opportunity_id = p_opportunity_id
       AND NOT COALESCE(ocr.ocr_is_deleted, false)
       AND NOT c.contact_is_deleted
       AND pv.picklist_label = 'Decision Maker'
  ),
  linked AS (
    SELECT DISTINCT c.id, c.contact_name
      FROM public.opportunity_contact_roles ocr
      JOIN public.contacts c ON c.id = ocr.contact_id
     WHERE ocr.opportunity_id = p_opportunity_id
       AND NOT COALESCE(ocr.ocr_is_deleted, false)
       AND NOT c.contact_is_deleted
  ),
  account_contacts AS (
    SELECT DISTINCT c.id, c.contact_name
      FROM public.opportunities o
      JOIN public.contacts c
        ON NOT c.contact_is_deleted
       AND c.contact_account_id IN (
             o.opportunity_account_id,
             o.opportunity_managing_account_id,
             o.opportunity_property_management_company
           )
     WHERE o.id = p_opportunity_id
  )
  -- Tier 1: Decision Makers linked as Opportunity Contact Roles.
  SELECT id, contact_name FROM dm
  -- Tier 2: any linked contact, when no Decision Maker is linked.
  UNION
  SELECT id, contact_name FROM linked WHERE NOT EXISTS (SELECT 1 FROM dm)
  -- Tier 3: any account contact, when no Opportunity Contact Roles are linked at all.
  UNION
  SELECT id, contact_name FROM account_contacts WHERE NOT EXISTS (SELECT 1 FROM linked)
  -- Always keep the currently-selected contact visible.
  UNION
  SELECT c.id, c.contact_name
    FROM public.contacts c
   WHERE p_include_contact_id IS NOT NULL
     AND c.id = p_include_contact_id
     AND NOT c.contact_is_deleted
  ORDER BY contact_name;
$function$;

GRANT EXECUTE ON FUNCTION public.list_signer_contacts_for_opportunity(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
