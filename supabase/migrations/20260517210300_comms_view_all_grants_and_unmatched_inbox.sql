-- ─── communications_view_all_grants ───────────────────────────────────
-- Tracks roles / permission_sets that confer cross-thread message visibility
-- (bypasses the contact-role + ownership checks). Reserved for Admin,
-- Program Managers, and senior staff. Exactly one of role_id / permission_set_id
-- is populated per row.

create table public.communications_view_all_grants (
  id                                          uuid primary key default gen_random_uuid(),
  cvag_role_id                                uuid references public.roles(id),
  cvag_permission_set_id                      uuid references public.permission_sets(id),
  cvag_created_by                             uuid references public.users(id),
  cvag_created_at                             timestamptz not null default now(),
  cvag_updated_by                             uuid references public.users(id),
  cvag_updated_at                             timestamptz not null default now(),
  cvag_is_deleted                             boolean not null default false,
  cvag_deleted_at                             timestamptz,
  cvag_deleted_by                             uuid references public.users(id),
  cvag_deletion_reason                        text,
  constraint cvag_exactly_one_grantee
    check ((cvag_role_id is not null)::int + (cvag_permission_set_id is not null)::int = 1)
);
create unique index uniq_cvag_role on public.communications_view_all_grants(cvag_role_id) where cvag_role_id is not null and not cvag_is_deleted;
create unique index uniq_cvag_pset on public.communications_view_all_grants(cvag_permission_set_id) where cvag_permission_set_id is not null and not cvag_is_deleted;

alter table public.communications_view_all_grants enable row level security;
create policy app_select_cvag on public.communications_view_all_grants
  for select using (app_user_can('communications_view_all_grants', 'read'));
create policy app_insert_cvag on public.communications_view_all_grants
  for insert with check (app_user_can('communications_view_all_grants', 'create'));
create policy app_update_cvag on public.communications_view_all_grants
  for update using (app_user_can('communications_view_all_grants', 'update'));
create policy app_delete_cvag on public.communications_view_all_grants
  for delete using (app_user_can('communications_view_all_grants', 'delete'));

-- Seed default grants: Admin + Program Manager get view-all by role.
insert into communications_view_all_grants (cvag_role_id)
select id from roles
where role_is_active and role_name in ('Admin','Program Manager');

insert into role_object_access (roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete)
select id, 'communications_view_all_grants', true,
       case when role_name='Admin' then true else false end,
       case when role_name='Admin' then true else false end,
       case when role_name='Admin' then true else false end
from roles
where role_is_active
  and role_name in ('Admin','Program Manager','Project Manager','Project Coordinator','Director of Field Services');

-- ─── unmatched_inbox ──────────────────────────────────────────────────
-- Inbound emails the threading webhook could not auto-link to a conversation.
-- A Project Coordinator manually triages these via the Communications UI;
-- once linked, the message attaches to the chosen conversation and future
-- inbounds from the same sender + domain auto-thread.

create sequence if not exists public.seq_unmatched_inbox;

create table public.unmatched_inbox (
  id                                          uuid primary key default gen_random_uuid(),
  ui_record_number                            text not null default '',
  ui_channel                                  text not null check (ui_channel in ('email','sms')),
  ui_received_at                              timestamptz not null,
  ui_from_address                             text not null,
  ui_to_address                               text,
  ui_subject                                  text,
  ui_body_preview                             text,
  ui_provider                                 text not null check (ui_provider in ('microsoft_graph','twilio')),
  ui_provider_message_id                      text not null,
  ui_in_reply_to_header                       text,
  ui_references_header                        text,
  ui_raw_payload                              jsonb not null default '{}'::jsonb,
  ui_status                                   text not null default 'awaiting_triage'
                                                check (ui_status in ('awaiting_triage','linked','dismissed')),
  ui_linked_conversation_id                   uuid references public.conversations(id),
  ui_linked_at                                timestamptz,
  ui_linked_by                                uuid references public.users(id),
  ui_dismissed_reason                         text,
  ui_owner                                    uuid references public.users(id),
  ui_created_by                               uuid references public.users(id),
  ui_created_at                               timestamptz not null default now(),
  ui_updated_by                               uuid references public.users(id),
  ui_updated_at                               timestamptz not null default now(),
  ui_is_deleted                               boolean not null default false,
  ui_deleted_at                               timestamptz,
  ui_deleted_by                               uuid references public.users(id),
  ui_deletion_reason                          text,
  constraint unmatched_inbox_provider_uid_unique unique (ui_provider, ui_provider_message_id)
);
create index ix_unmatched_inbox_status on public.unmatched_inbox(ui_status, ui_received_at desc) where not ui_is_deleted;

create or replace function public.set_ui_record_number()
returns trigger language plpgsql as $$
begin
  if new.ui_record_number is null or new.ui_record_number = '' then
    new.ui_record_number := generate_record_number('UI-', 'seq_unmatched_inbox');
  end if;
  return new;
end $$;

drop trigger if exists trg_ui_record_number on public.unmatched_inbox;
create trigger trg_ui_record_number
  before insert on public.unmatched_inbox
  for each row execute function public.set_ui_record_number();

alter table public.unmatched_inbox enable row level security;
create policy app_select_unmatched_inbox on public.unmatched_inbox
  for select using (app_user_can('unmatched_inbox', 'read'));
create policy app_insert_unmatched_inbox on public.unmatched_inbox
  for insert with check (app_user_can('unmatched_inbox', 'create'));
create policy app_update_unmatched_inbox on public.unmatched_inbox
  for update using (app_user_can('unmatched_inbox', 'update'));
create policy app_delete_unmatched_inbox on public.unmatched_inbox
  for delete using (app_user_can('unmatched_inbox', 'delete'));

insert into role_object_access (roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete)
select id, 'unmatched_inbox', true, true, true,
       case when role_name='Admin' then true else false end
from roles
where role_is_active
  and role_name in ('Admin','Program Manager','Project Manager','Project Coordinator','Director of Field Services');
