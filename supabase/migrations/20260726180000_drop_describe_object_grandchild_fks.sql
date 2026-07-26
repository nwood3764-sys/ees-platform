-- The Add Related List object browser now discovers related records at any
-- depth by walking describe_object_incoming_fks one level at a time (lazily,
-- per drill-down), so the fixed two-hop describe_object_grandchild_fks RPC
-- (added earlier today in 20260726150000) has no callers. Drop it rather
-- than leave a dead SECURITY DEFINER function exposed.

DROP FUNCTION IF EXISTS public.describe_object_grandchild_fks(text);

NOTIFY pgrst, 'reload schema';
