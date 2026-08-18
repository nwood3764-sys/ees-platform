-- A report does not need an owner (Nicholas, 2026-08-18: "we don't need owners
-- of reports, it should not be a required field"). A report is a shared
-- definition, not a record someone is accountable for working — provenance is
-- already carried by created_by / updated_by.
--
-- Reports RLS is role-based (app_user_can('reports', ...)), never owner-based,
-- so nothing reads this column for access. The list view renders a missing
-- owner as '—'. Existing owners are left exactly as they are.
alter table public.reports alter column rpt_owner_user_id drop not null;
