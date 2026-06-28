-- Restore schema-level grants on public to match production.
-- The squashed baseline (20260412000000_leap_baseline_schema.sql) captured
-- object-level grants (tables/sequences/functions) but not the schema-level
-- USAGE/CREATE grants. Without them, anon/authenticated cannot access the
-- schema at all -> "permission denied for schema public" after a from-scratch
-- rebuild (e.g. the staging refresh). These match production exactly.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, postgres, pg_database_owner;
GRANT USAGE ON SCHEMA public TO PUBLIC;
GRANT CREATE ON SCHEMA public TO pg_database_owner;
