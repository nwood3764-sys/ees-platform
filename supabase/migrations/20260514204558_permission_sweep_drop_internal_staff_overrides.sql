-- Permission sweep — Phase B
-- Drop the permissive `internal_staff_*` override policies from all 51 tables
-- that currently bypass role-based RLS. After this, role-based RLS is enforced
-- on every business table.

DO $$
DECLARE
  pol_record RECORD;
  drop_sql text;
  drop_count integer := 0;
BEGIN
  FOR pol_record IN
    SELECT pol.polname, cls.relname AS tablename
    FROM pg_policy pol
    JOIN pg_class cls ON cls.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = cls.relnamespace
    WHERE n.nspname = 'public'
      AND pol.polname LIKE 'internal_staff_%'
  LOOP
    drop_sql := format('DROP POLICY %I ON public.%I', pol_record.polname, pol_record.tablename);
    EXECUTE drop_sql;
    drop_count := drop_count + 1;
  END LOOP;
  RAISE NOTICE 'Dropped % internal_staff override policies', drop_count;
END $$;
