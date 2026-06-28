-- ─── outbound_mailboxes ────────────────────────────────────────────────
-- Shared mailbox configuration for record-anchored outbound email. One row
-- per EES-WI shared mailbox (e.g. wi-homes@ees-wi.org, nc-homes@ees-wi.org),
-- mapped to program + state so send-email-v1 can pick the right sender at
-- compose time from the anchoring record's context.
--
-- Per LEAP Communications spec. Adjacent to notification_templates (which
-- drives system-generated triggers) — outbound_mailboxes is the human-
-- composed correspondence side.

create sequence if not exists public.seq_outbound_mailboxes;

create table public.outbound_mailboxes (
  id                                          uuid primary key default gen_random_uuid(),
  obm_record_number                           text not null default '',
  obm_address                                 text not null,
  obm_display_name                            text not null,
  obm_program_id                              uuid references public.programs(id),
  obm_state                                   text check (obm_state in ('WI','NC','CO','MI','IN') or obm_state is null),
  obm_default_signature_template_id           uuid references public.email_templates(id),
  obm_is_active                               boolean not null default true,
  obm_owner                                   uuid references public.users(id),
  obm_created_by                              uuid references public.users(id),
  obm_created_at                              timestamptz not null default now(),
  obm_updated_by                              uuid references public.users(id),
  obm_updated_at                              timestamptz not null default now(),
  obm_is_deleted                              boolean not null default false,
  obm_deleted_at                              timestamptz,
  obm_deleted_by                              uuid references public.users(id),
  obm_deletion_reason                         text,
  constraint outbound_mailboxes_address_unique unique (obm_address)
);

create or replace function public.set_obm_record_number()
returns trigger language plpgsql as $$
begin
  if new.obm_record_number is null or new.obm_record_number = '' then
    new.obm_record_number := generate_record_number('OBM-', 'seq_outbound_mailboxes');
  end if;
  return new;
end $$;

drop trigger if exists trg_obm_record_number on public.outbound_mailboxes;
create trigger trg_obm_record_number
  before insert on public.outbound_mailboxes
  for each row execute function public.set_obm_record_number();

alter table public.outbound_mailboxes enable row level security;

create policy app_select_outbound_mailboxes on public.outbound_mailboxes
  for select using (app_user_can('outbound_mailboxes', 'read'));
create policy app_insert_outbound_mailboxes on public.outbound_mailboxes
  for insert with check (app_user_can('outbound_mailboxes', 'create'));
create policy app_update_outbound_mailboxes on public.outbound_mailboxes
  for update using (app_user_can('outbound_mailboxes', 'update'));
create policy app_delete_outbound_mailboxes on public.outbound_mailboxes
  for delete using (app_user_can('outbound_mailboxes', 'delete'));

insert into role_object_access (roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete)
select id, 'outbound_mailboxes', true,
       case when role_name in ('Admin','Program Manager') then true else false end,
       case when role_name in ('Admin','Program Manager') then true else false end,
       case when role_name = 'Admin' then true else false end
from roles
where role_is_active
  and role_name in ('Admin','Program Manager','Project Manager','Project Coordinator','Director of Field Services');
