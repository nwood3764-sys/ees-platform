-- Authorized Signer picker: scope by the account at opportunity CREATE time
-- =============================================================================
-- Context (Nicholas, 2026-07-28): on /opportunities/new the Authorized Signer
-- picker was always empty — searching a contact returned "No matches" — even
-- though the account (e.g. Lutheran Social Services) was already filled in.
--
-- Root cause: the field's dependent lookup was scoped ONLY by the opportunity's
-- own id (depends_on: ["id"]). At create time no opportunity id exists yet, so
-- the id-scoped RPC was never given an input and the option pool stayed empty.
-- The account, which the opportunity always inherits from its property, is the
-- correct scope before the opportunity is saved.
--
-- This adds the account fields to depends_on so (1) the picker fetches account
-- contacts as soon as the account is present on the draft, (2) it refreshes if
-- the account changes, and (3) the empty-state hint / quick-create seed both
-- reference the account. The client handler (fetchDependentLookupOptions,
-- signer_contacts_for_opportunity) prefers the opportunity id when it exists
-- and falls back to list_contacts_for_accounts when it doesn't, so the edit-mode
-- Decision-Maker / contact-role tiers are unchanged.

UPDATE public.page_layout_widgets pw
SET widget_config = jsonb_set(
      pw.widget_config,
      '{fields}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN f->>'name' = 'opportunity_authorized_signer_id'
             AND f->'lookup_dependency'->>'kind' = 'signer_contacts_for_opportunity'
            THEN jsonb_set(
                   f,
                   '{lookup_dependency,depends_on}',
                   '["id","opportunity_account_id","opportunity_managing_account_id","opportunity_property_management_company"]'::jsonb
                 )
            ELSE f
          END
        )
        FROM jsonb_array_elements(pw.widget_config->'fields') f
      )
    )
WHERE pw.is_deleted = false
  AND pw.widget_config->'fields' @> '[{"name":"opportunity_authorized_signer_id","lookup_dependency":{"kind":"signer_contacts_for_opportunity"}}]'::jsonb;
