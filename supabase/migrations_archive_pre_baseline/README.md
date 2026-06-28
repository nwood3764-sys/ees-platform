# Pre-baseline migration archive

These are the original incremental migration files (April–June 2026) that
predate the schema **baseline**. They are kept here **for historical reference
only** and are intentionally **outside** `supabase/migrations/`, so the Supabase
CLI and branching do not replay them.

## Why they were archived

The project's migration history had drifted: the live database carried ~870
applied migrations, but only ~189 were ever committed as files, and the history
no longer replayed cleanly from scratch (it had no baseline that created the
core schema). That made Supabase branching / fresh sandbox databases impossible.

On 2026-06-28 the history was **squashed into a single baseline**
(`supabase/migrations/20260412000000_leap_baseline_schema.sql`) generated from
the live production schema and **verified** by rebuilding it on a throwaway
Supabase branch and confirming an exact fingerprint match against production
(every table, column, function, policy, and constraint identical).

The production migration registry (`supabase_migrations.schema_migrations`) was
correspondingly replaced with the single baseline row; the full 870-row history
was backed up to `supabase_migrations.schema_migrations_backup_20260628` before
the change.

## Going forward

- The baseline is the new starting point. Every new schema change is a **new**
  migration file added to `supabase/migrations/` *after* the baseline.
- Do not move these files back into `supabase/migrations/` — their net effect is
  already contained in the baseline, and replaying them would conflict.
- See `docs/leap-dev-workflow.md` for the full sandbox → production workflow.
