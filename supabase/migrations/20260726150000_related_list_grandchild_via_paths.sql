-- Related lists can now reach GRANDCHILD records — records whose FK points at a
-- direct child of the layout's object rather than at the object itself
-- (e.g. Units on a Property page: units.building_id → buildings.property_id → properties).
--
-- This RPC feeds the "Target Table" picker in RelatedListCanvasModal with every
-- two-hop path: for each table X holding an FK to p_table (the "via" table), every
-- table Y holding an FK to X. The widget config stores the path as
--   { table: Y, fk: <Y's FK column to X>, via: { table: X, fk: <X's FK column to p_table> } }
-- and fetchRelatedRecords resolves it with a PostgREST inner-join embed filter.
-- Companion to describe_object_incoming_fks (one-hop), which stays untouched —
-- direct related lists keep their existing shape.

CREATE OR REPLACE FUNCTION public.describe_object_grandchild_fks(p_table text)
 RETURNS TABLE(via_table text, via_fk_column text, target_table text, target_fk_column text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH direct_children AS (
    SELECT
      rc.relname::text AS via_table,
      ra.attname::text AS via_fk_column,
      rc.oid           AS via_oid
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class     rc ON rc.oid = con.conrelid
    JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
    JOIN pg_catalog.pg_class     fc ON fc.oid = con.confrelid
    JOIN pg_catalog.pg_namespace fn ON fn.oid = fc.relnamespace
    JOIN pg_catalog.pg_attribute ra
      ON ra.attrelid = con.conrelid AND ra.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND fn.nspname  = 'public'
      AND rn.nspname  = 'public'
      AND fc.relname  = p_table
      AND array_length(con.conkey, 1) = 1
  )
  SELECT
    dc.via_table,
    dc.via_fk_column,
    gc.relname::text AS target_table,
    ga.attname::text AS target_fk_column
  FROM direct_children dc
  JOIN pg_catalog.pg_constraint gcon
    ON gcon.contype = 'f'
   AND gcon.confrelid = dc.via_oid
   AND array_length(gcon.conkey, 1) = 1
  JOIN pg_catalog.pg_class     gc ON gc.oid = gcon.conrelid
  JOIN pg_catalog.pg_namespace gn ON gn.oid = gc.relnamespace AND gn.nspname = 'public'
  JOIN pg_catalog.pg_attribute ga
    ON ga.attrelid = gcon.conrelid AND ga.attnum = gcon.conkey[1]
  -- A path landing back on the object itself is a loop, not a related list.
  WHERE gc.relname <> p_table
  ORDER BY dc.via_table, gc.relname, ga.attname;
$function$
;

REVOKE ALL ON FUNCTION public.describe_object_grandchild_fks(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.describe_object_grandchild_fks(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.describe_object_grandchild_fks(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.describe_object_grandchild_fks(text) TO service_role;

NOTIFY pgrst, 'reload schema';
