-- Account-hierarchy roll-up support for related lists.
--
-- Purpose: let an account's related lists (e.g. Lutheran Services' "Properties
-- Owned" / "Properties Managed") include rows attached to the account AND all of
-- its descendant accounts, resolved through accounts.parent_account_id. Pairs
-- with fetchRelatedRecords() honoring widget_config.roll_up_hierarchy + row_limit.
--
-- Security invoker so RLS is respected (the caller only ever sees accounts they
-- are permitted to see).

CREATE OR REPLACE FUNCTION public.account_descendant_ids(root_account_id uuid)
RETURNS TABLE(id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH RECURSIVE tree AS (
    SELECT a.id
    FROM accounts a
    WHERE a.id = root_account_id
      AND a.account_is_deleted IS NOT TRUE
    UNION
    SELECT c.id
    FROM accounts c
    JOIN tree t ON c.parent_account_id = t.id
    WHERE c.account_is_deleted IS NOT TRUE
  )
  SELECT id FROM tree;
$$;

REVOKE ALL ON FUNCTION public.account_descendant_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_descendant_ids(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
