-- Financial visibility tiers, enforced instead of merely declared.
--
-- CLAUDE.md has described three tiers since the platform's first week — Tier 1
-- everyone, Tier 2 Project Managers and above (contract values, incentive
-- amounts, invoice totals), Tier 3 Admin only (margin, labour cost, overhead,
-- revenue) — and nothing anywhere enforced them. field_metadata.fm_financial_tier
-- existed with all 96 populated rows set to tier 1, and no read path consulted
-- it at all. A Lead Technician could put the agreed subcontractor payout on a
-- report.
--
-- Two facts, each stored where it belongs:
--   * what tier a FIELD is  → field_metadata.fm_financial_tier
--     (a property of the field, one row per column — the same table that already
--     holds fm_display_type, for the same reason)
--   * what tier a ROLE sees → roles.role_max_financial_tier
--
-- and one place that decides. Nothing is hardcoded in app logic; both halves are
-- editable through LEAP Admin.

alter table public.roles
  add column if not exists role_max_financial_tier smallint not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'roles_max_financial_tier_check') then
    alter table public.roles
      add constraint roles_max_financial_tier_check check (role_max_financial_tier between 1 and 3);
  end if;
end $$;

comment on column public.roles.role_max_financial_tier is
  'Highest financial tier this role may see: 1 = operational only, 2 = contract/incentive/invoice values, 3 = margin, cost, overhead, revenue. Default 1 — a new role sees no financial data until someone says otherwise.';

comment on column public.field_metadata.fm_financial_tier is
  'The tier this column belongs to (2 or 3). NULL or 1 means visible to every internal user. Compared against roles.role_max_financial_tier by app_user_financial_tier().';

-- Tier 3 is Admin. Tier 2 is "Project Managers and above" — the four roles that
-- own commercial outcomes. Everything else stays at the default 1, including
-- every externally-facing role (Property Manager, Property Owner, Service
-- Provider Partner), which is the point.
update public.roles set role_max_financial_tier = 3 where role_name = 'Admin';
update public.roles set role_max_financial_tier = 2
 where role_name in ('Project Manager', 'Program Manager', 'Operations Manager', 'Director of Field Services');

-- The caller's ceiling. SECURITY DEFINER because it reads roles and users, which
-- a restricted caller may not select directly; EXECUTE is revoked and it is
-- called only from the granted entry points, per the 2026-08-31 rule that a
-- definer function nothing external calls should not be executable.
create or replace function public.app_user_financial_tier()
returns smallint
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  -- A caller with no LEAP user row (an unauthenticated or portal identity) gets
  -- tier 1, never a default of "see everything".
  select coalesce(max(r.role_max_financial_tier), 1)::smallint
  from public.users u
  join public.roles r on r.id = u.role_id
  where u.auth_user_id = auth.uid()
    and u.user_is_active = true
$$;

revoke all on function public.app_user_financial_tier() from public, anon, authenticated;

-- The columns of one object the CALLER may not see.
--
-- This is the single question every read path asks — the report field picker,
-- the report runner, the list-view column picker, the dashboard widget
-- inspector. One definition, so a field cannot be hidden on the record page and
-- exposed in a report, which is exactly the shape of the gap this closes.
create or replace function public.app_user_restricted_fields(p_object text)
returns setof text
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select fm.fm_column
  from public.field_metadata fm
  where fm.fm_object = p_object
    and fm.fm_is_deleted is not true
    and fm.fm_financial_tier is not null
    and fm.fm_financial_tier > public.app_user_financial_tier()
$$;

revoke all on function public.app_user_restricted_fields(text) from public, anon;
grant execute on function public.app_user_restricted_fields(text) to authenticated, service_role;

notify pgrst, 'reload schema';
