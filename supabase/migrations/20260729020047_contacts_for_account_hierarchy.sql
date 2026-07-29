-- =============================================================================
-- Contact pickers scope to the whole account ownership tree (self + ancestors)
-- =============================================================================
-- Context (Nicholas, 2026-07-29): on an opportunity, the Property Site Contact
-- picker showed "No matches" for a real contact (e.g. Josiah Brazle) because it
-- was scoped ONLY to the opportunity's own account (LSS HOUSING, INC.), which
-- carries no contacts. Properties are owned through multiple layers of LLCs, and
-- a contact is never duplicated across a family tree — the decision-maker /
-- site contact lives on the parent or grandparent account (Lutheran Social
-- Services of Wisconsin and Upper Michigan, Inc.). The picker must therefore
-- span the account plus every ancestor via parent_account_id, and stay a real
-- scoped lookup rather than an open pick list.
--
-- This migration:
--   1. Adds list_contacts_for_account_hierarchy() — contacts on the given
--      account(s) plus all ancestors (cycle-guarded, depth-capped).
--   2. Repoints the opportunity Property Site Contact field (all layouts) from
--      contacts_for_accounts to the hierarchy-aware kind.
--   3. Scopes the account's own Account Contact field (open lookup today) to the
--      same hierarchy — this account + its ancestors.
--   4. Makes the Authorized Signer picker's account-contacts tier
--      hierarchy-aware for the same reason.

-- ---------------------------------------------------------------------
-- RPC: list_contacts_for_account_hierarchy
--
-- Returns contacts associated with any of the given accounts OR any of their
-- ancestor accounts (walking up parent_account_id). A contact is associated
-- with an account when EITHER contacts.contact_account_id = account_id OR an
-- active account_contact_relations row links them.
--
-- p_include_contact_id is the standard escape hatch so a saved value that no
-- longer matches the filter still renders in the dropdown.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_contacts_for_account_hierarchy(
  p_account_ids uuid[],
  p_include_contact_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, contact_name text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $$
  WITH RECURSIVE seed AS (
    SELECT a.id, a.parent_account_id, 0 AS depth
      FROM accounts a
     WHERE p_account_ids IS NOT NULL
       AND a.id = ANY(p_account_ids)
       AND NOT a.account_is_deleted
    UNION ALL
    SELECT parent.id, parent.parent_account_id, chain.depth + 1
      FROM seed chain
      JOIN accounts parent ON parent.id = chain.parent_account_id
     WHERE NOT parent.account_is_deleted
       AND chain.depth < 20              -- depth cap guards against cycles
  ),
  tree AS (
    SELECT DISTINCT id FROM seed
  )
  SELECT c.id, c.contact_name
    FROM contacts c
   WHERE NOT c.contact_is_deleted
     AND (
       c.contact_account_id IN (SELECT id FROM tree)
       OR EXISTS (
         SELECT 1
           FROM account_contact_relations acr
          WHERE acr.contact_id = c.id
            AND acr.account_id IN (SELECT id FROM tree)
            AND acr.acr_is_active = true
            AND NOT acr.acr_is_deleted
       )
       OR (p_include_contact_id IS NOT NULL AND c.id = p_include_contact_id)
     )
   ORDER BY c.contact_name;
$$;

COMMENT ON FUNCTION list_contacts_for_account_hierarchy(uuid[], uuid)
IS 'Dependent-lookup helper. Returns contacts on the given account(s) OR any ancestor account reached via parent_account_id (self + ancestors, cycle-guarded). Used by the opportunity Property Site Contact and account Account Contact pickers so a contact placed once on a parent/grandparent account is offered to child-account records. p_include_contact_id forces a specific contact into the result so a saved value always renders.';

REVOKE ALL ON FUNCTION list_contacts_for_account_hierarchy(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_contacts_for_account_hierarchy(uuid[], uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- Authorized Signer picker: make its account-contacts tier hierarchy-aware.
-- Decision-Maker and Opportunity-Contact-Role tiers are unchanged; only the
-- fallback account tier now walks the ownership tree.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_signer_contacts_for_opportunity(
  p_opportunity_id uuid,
  p_include_contact_id uuid DEFAULT NULL
)
RETURNS TABLE(id uuid, contact_name text)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH RECURSIVE dm AS (
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
  seed AS (
    SELECT a.id, a.parent_account_id, 0 AS depth
      FROM public.opportunities o
      JOIN public.accounts a
        ON a.id IN (
             o.opportunity_account_id,
             o.opportunity_managing_account_id,
             o.opportunity_property_management_company
           )
     WHERE o.id = p_opportunity_id
       AND NOT a.account_is_deleted
    UNION ALL
    SELECT parent.id, parent.parent_account_id, chain.depth + 1
      FROM seed chain
      JOIN public.accounts parent ON parent.id = chain.parent_account_id
     WHERE NOT parent.account_is_deleted
       AND chain.depth < 20
  ),
  tree AS (
    SELECT DISTINCT id FROM seed
  ),
  account_contacts AS (
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
       )
  )
  SELECT id, contact_name FROM dm
  UNION
  SELECT id, contact_name FROM linked WHERE NOT EXISTS (SELECT 1 FROM dm)
  UNION
  SELECT id, contact_name FROM account_contacts WHERE NOT EXISTS (SELECT 1 FROM linked)
  UNION
  SELECT c.id, c.contact_name
    FROM public.contacts c
   WHERE p_include_contact_id IS NOT NULL
     AND c.id = p_include_contact_id
     AND NOT c.contact_is_deleted
  ORDER BY contact_name;
$function$;

REVOKE ALL ON FUNCTION public.list_signer_contacts_for_opportunity(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_signer_contacts_for_opportunity(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- Repoint the opportunity Property Site Contact field on every layout from
-- contacts_for_accounts to contacts_for_account_hierarchy. depends_on is
-- unchanged (opportunity_account_id + opportunity_managing_account_id) — the
-- RPC walks each of those accounts up to its ancestors.
-- ---------------------------------------------------------------------
UPDATE public.page_layout_widgets pw
SET widget_config = jsonb_set(
      pw.widget_config,
      '{fields}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN f->>'name' = 'opportunity_property_site_contact'
             AND f->'lookup_dependency'->>'kind' = 'contacts_for_accounts'
            THEN jsonb_set(f, '{lookup_dependency,kind}', '"contacts_for_account_hierarchy"'::jsonb)
            ELSE f
          END
        )
        FROM jsonb_array_elements(pw.widget_config->'fields') f
      )
    ),
    updated_at = now()
WHERE pw.is_deleted = false
  AND pw.widget_config->'fields' @> '[{"name":"opportunity_property_site_contact","lookup_dependency":{"kind":"contacts_for_accounts"}}]'::jsonb;

-- ---------------------------------------------------------------------
-- Scope the account's own Account Contact field. Today account_contact_id is an
-- open lookup (every contact in the system — demo records included). Make it a
-- dependent lookup scoped to this account plus its ancestors. depends_on carries
-- the record's own id and its parent so the picker works both after save (id)
-- and while creating a child account under a chosen parent (parent_account_id).
-- ---------------------------------------------------------------------
UPDATE public.page_layout_widgets pw
SET widget_config = jsonb_set(
      pw.widget_config,
      '{fields}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN f->>'name' = 'account_contact_id'
             AND (f->>'type') = 'lookup'
             AND NOT (f ? 'lookup_dependency')
            THEN f || jsonb_build_object(
                   'lookup_dependency', jsonb_build_object(
                     'kind', 'contacts_for_account_hierarchy',
                     'depends_on', jsonb_build_array('id', 'parent_account_id')
                   )
                 )
            ELSE f
          END
        )
        FROM jsonb_array_elements(pw.widget_config->'fields') f
      )
    ),
    updated_at = now()
WHERE pw.is_deleted = false
  AND pw.widget_config->'fields' @> '[{"name":"account_contact_id","type":"lookup"}]'::jsonb;

NOTIFY pgrst, 'reload schema';
