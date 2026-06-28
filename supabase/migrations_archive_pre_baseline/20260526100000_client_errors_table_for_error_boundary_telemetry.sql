-- ─── client_errors ─────────────────────────────────────────────────────
-- Telemetry table for client-side runtime errors caught by the React
-- ErrorBoundary tree. Every uncaught render or import-time exception in
-- the SPA writes one row here before the fallback UI renders.
--
-- Why this exists:
--   Before this migration, an uncaught exception inside any lazy module
--   unmounted the entire React tree and left an empty <div id="root"> —
--   the "white screen" failure mode. There was no telemetry, no diagnostic,
--   no breadcrumb. The new ErrorBoundary catches the exception, isolates
--   it to the failing subtree, surfaces actionable info to the user, and
--   writes a row here so triage doesn't depend on the user describing
--   what they saw.
--
-- Append-only by design:
--   • All authenticated users can INSERT (so error reporting works for
--     every role)
--   • Read/update/delete restricted to Admin (triage workflow)
--   • Soft-delete only — preserves the audit trail even after resolution
-- ───────────────────────────────────────────────────────────────────────

create sequence if not exists public.client_errors_record_number_seq;

create table if not exists public.client_errors (
  id                              uuid primary key default gen_random_uuid(),
  ce_record_number                text not null default '',

  -- Error details captured from the browser at exception time
  ce_error_name                   text,                 -- e.g. 'TypeError', 'ReferenceError'
  ce_message                      text not null,        -- error.message
  ce_stack                        text,                 -- error.stack (full trace)
  ce_component_stack              text,                 -- React's componentStack from errorInfo

  -- Context — where in the app the error fired
  ce_module                       text,                 -- 'field', 'dispatch', 'admin', etc.
  ce_route                        text,                 -- window.location.pathname
  ce_url                          text,                 -- full window.location.href
  ce_record_table                 text,                 -- if a RecordDetail was open, the table name
  ce_record_id                    uuid,                 -- if a RecordDetail was open, the record id

  -- User context — best-effort, may be null on auth-edge errors
  ce_app_user_id                  uuid references public.users(id),
  ce_auth_user_id                 uuid,                 -- raw auth.uid() at error time
  ce_user_email                   text,                 -- denormalized for fast triage

  -- Browser / build context
  ce_user_agent                   text,
  ce_app_version                  text,                 -- VITE-injected build SHA when available
  ce_viewport_width               integer,
  ce_viewport_height              integer,
  ce_session_id                   text,                 -- groups errors from one browser session

  -- Triage workflow
  ce_severity                     text default 'error', -- 'error' | 'warning'
  ce_resolved                     boolean default false,
  ce_resolved_at                  timestamptz,
  ce_resolved_by                  uuid references public.users(id),
  ce_resolution_notes             text,

  -- Standard audit
  ce_owner                        uuid references public.users(id),
  ce_created_by                   uuid references public.users(id),
  ce_created_at                   timestamptz default now(),
  ce_updated_by                   uuid references public.users(id),
  ce_updated_at                   timestamptz default now(),
  ce_is_deleted                   boolean default false,
  ce_deleted_at                   timestamptz,
  ce_deleted_by                   uuid references public.users(id),
  ce_deletion_reason              text
);

create index if not exists idx_ce_created_at  on public.client_errors (ce_created_at desc) where not ce_is_deleted;
create index if not exists idx_ce_resolved    on public.client_errors (ce_resolved)        where not ce_is_deleted;
create index if not exists idx_ce_module      on public.client_errors (ce_module)          where not ce_is_deleted;
create index if not exists idx_ce_app_user_id on public.client_errors (ce_app_user_id)     where not ce_is_deleted;
create index if not exists idx_ce_session_id  on public.client_errors (ce_session_id)      where not ce_is_deleted;

-- ─── Auto-numbering trigger ─────────────────────────────────────────────
create or replace function public.trg_ce_record_number()
returns trigger
language plpgsql
as $$
begin
  if NEW.ce_record_number is null or NEW.ce_record_number = '' then
    NEW.ce_record_number := public.generate_record_number('CE-', 'client_errors_record_number_seq');
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_ce_set_record_number on public.client_errors;
create trigger trg_ce_set_record_number
  before insert on public.client_errors
  for each row execute function public.trg_ce_record_number();

create or replace function public.trg_ce_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  NEW.ce_updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists trg_ce_touch_updated_at on public.client_errors;
create trigger trg_ce_touch_updated_at
  before update on public.client_errors
  for each row execute function public.trg_ce_touch_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────
alter table public.client_errors enable row level security;

create policy app_select_client_errors on public.client_errors
  for select using (app_user_can('client_errors', 'read'));
create policy app_insert_client_errors on public.client_errors
  for insert with check (app_user_can('client_errors', 'create'));
create policy app_update_client_errors on public.client_errors
  for update using (app_user_can('client_errors', 'update'));
create policy app_delete_client_errors on public.client_errors
  for delete using (app_user_can('client_errors', 'delete'));

-- ─── Role grants ────────────────────────────────────────────────────────
-- Every authenticated role can CREATE client_errors rows. Reading and
-- triage stay with Admin so users don't see each other's exception data.
insert into public.role_object_access (
  roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete
)
select r.id, 'client_errors',
       case when r.role_name = 'Admin' then true else false end,  -- read
       true,                                                       -- create — everyone
       case when r.role_name = 'Admin' then true else false end,  -- update
       case when r.role_name = 'Admin' then true else false end   -- delete
from public.roles r
where r.role_is_active
on conflict do nothing;

-- ─── Picklists ──────────────────────────────────────────────────────────
insert into public.picklist_values (
  picklist_object, picklist_field, picklist_value, picklist_label,
  picklist_sort_order, picklist_is_active
) values
  ('client_errors', 'ce_severity', 'error',   'Error',   10, true),
  ('client_errors', 'ce_severity', 'warning', 'Warning', 20, true)
on conflict (picklist_object, picklist_field, picklist_value) do nothing;

comment on table  public.client_errors is
  'Append-only telemetry for client-side runtime errors caught by the React ErrorBoundary tree. Created 2026-05-26 to support diagnostic visibility on white-screen failures.';
comment on column public.client_errors.ce_session_id is
  'Random UUID assigned per browser session in sessionStorage. Groups errors that happened in the same tab/visit so cascading failures are triaged together.';
