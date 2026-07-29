-- Opportunity Contact Roles: scope the contact picker + rename the owner role
-- ===========================================================================
-- Context (Nicholas, 2026-07-29):
--   (1) When adding an Opportunity Contact Role, only people associated with the
--       opportunity's account and its property/building may be eligible in the
--       Contact dropdown — "No one else should be able to be added." Today the
--       contact_id lookup on the Standard Opportunity Contact Roles Layout is an
--       open picker over every contact.
--   (2) The "Property Owner" contact role should read "Property Owner's Primary
--       Contact Person" — the role is the PERSON we deal with for the owner, not
--       the owning entity.
--
-- A contact is associated with a property/building through the accounts that own or
-- manage it (buildings/properties carry no contacts directly). Ownership runs
-- through layers of LLCs and a contact is never duplicated across a family tree, so
-- the eligible set is the contacts on the opportunity's accounts PLUS the property's
-- owner / management accounts, walked up the parent_account_id chain — matching the
-- account-hierarchy rule already used by the Property Site Contact / Authorized
-- Signer pickers.

-- ---------------------------------------------------------------------------
-- 1) Rename the owner role on both role picklists (opportunity_contact_roles and
--    contacts). Value + label are kept in lock-step across the two objects because
--    the seed_opportunity_contact_roles trigger maps a contact's role onto the
--    opportunity role BY LABEL. The value has zero usage on either object today, so
--    this is a clean rename (ocr_role / contact_role are UUID FKs to picklist_values,
--    so no stored data changes).
-- ---------------------------------------------------------------------------
UPDATE public.picklist_values
   SET picklist_value = 'Property Owner''s Primary Contact Person',
       picklist_label = 'Property Owner''s Primary Contact Person'
 WHERE picklist_field = 'role'
   AND picklist_object IN ('opportunity_contact_roles', 'contacts')
   AND picklist_value = 'Property Owner';

-- ---------------------------------------------------------------------------
-- 2) Purpose-built scoped picker: contacts eligible to be an Opportunity Contact
--    Role on a given opportunity. Returns contacts associated (directly via
--    contact_account_id, or via an active account_contact_relations link) with any
--    account in the opportunity + property account tree:
--      • opportunity_account_id, opportunity_managing_account_id,
--        opportunity_property_management_company
--      • the property's property_account_id, property_management_company_id
--      • every ancestor of those accounts (parent_account_id, cycle-guarded)
--    SECURITY INVOKER so the caller's RLS still applies. p_include_contact_id is the
--    standard escape hatch so an already-selected contact still renders even if it
--    no longer matches the filter.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_contacts_for_opportunity_roles(
  p_opportunity_id uuid,
  p_include_contact_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(id uuid, contact_name text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH RECURSIVE base_accounts AS (
    SELECT unnest(ARRAY_REMOVE(ARRAY[
             o.opportunity_account_id,
             o.opportunity_managing_account_id,
             o.opportunity_property_management_company,
             p.property_account_id,
             p.property_management_company_id
           ], NULL)) AS account_id
      FROM public.opportunities o
      LEFT JOIN public.properties p
        ON p.id = o.property_id AND NOT p.property_is_deleted
     WHERE o.id = p_opportunity_id
  ),
  seed AS (
    SELECT a.id, a.parent_account_id, 0 AS depth
      FROM public.accounts a
      JOIN base_accounts b ON b.account_id = a.id
     WHERE NOT a.account_is_deleted
    UNION ALL
    SELECT parent.id, parent.parent_account_id, chain.depth + 1
      FROM seed chain
      JOIN public.accounts parent ON parent.id = chain.parent_account_id
     WHERE NOT parent.account_is_deleted
       AND chain.depth < 20                 -- depth cap guards against cycles
  ),
  tree AS (SELECT DISTINCT id FROM seed)
  SELECT DISTINCT c.id, c.contact_name
    FROM public.contacts c
   WHERE NOT c.contact_is_deleted
     AND (
       c.contact_account_id IN (SELECT id FROM tree)
       OR EXISTS (
         SELECT 1
           FROM public.account_contact_relations acr
          WHERE acr.contact_id = c.id
            AND acr.account_id IN (SELECT id FROM tree)
            AND acr.acr_is_active = true
            AND NOT acr.acr_is_deleted
       )
       OR (p_include_contact_id IS NOT NULL AND c.id = p_include_contact_id)
     )
   ORDER BY 2;
$function$;

REVOKE ALL ON FUNCTION public.list_contacts_for_opportunity_roles(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_contacts_for_opportunity_roles(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Point the Contact lookup on the Opportunity Contact Roles create layout at the
--    scoped picker. The record is created from an opportunity's related list, so the
--    draft always carries opportunity_id — depends_on:["opportunity_id"] resolves the
--    scope. The client (fetchDependentLookupOptions) no longer falls back to an
--    unscoped search for dependent lookups, so this closes the picker to only the
--    associated people. lookup_table / lookup_field are kept for display resolution.
-- ---------------------------------------------------------------------------
UPDATE public.page_layout_widgets pw
SET widget_config = jsonb_set(
      pw.widget_config,
      '{fields}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN f->>'name' = 'contact_id'
             AND NOT (f ? 'lookup_dependency')
            THEN f || jsonb_build_object(
                   'lookup_dependency',
                   jsonb_build_object(
                     'kind', 'contacts_for_opportunity_roles',
                     'depends_on', jsonb_build_array('opportunity_id')
                   )
                 )
            ELSE f
          END
        )
        FROM jsonb_array_elements(pw.widget_config->'fields') f
      )
    )
WHERE pw.is_deleted = false
  AND pw.page_layout_id IN (
        SELECT id FROM public.page_layouts
        WHERE page_layout_object = 'opportunity_contact_roles' AND is_deleted = false
      )
  AND pw.widget_config ? 'fields'
  AND pw.widget_config->'fields' @> '[{"name":"contact_id"}]'::jsonb
  AND NOT (pw.widget_config->'fields'
           @> '[{"name":"contact_id","lookup_dependency":{"kind":"contacts_for_opportunity_roles"}}]'::jsonb);

NOTIFY pgrst, 'reload schema';
