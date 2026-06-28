-- ─── message_attachments ──────────────────────────────────────────────
-- One row per file attached to a message (outbound or inbound). Files live
-- in Supabase Storage at communications/{conversation_id}/{message_id}/{filename};
-- this table holds the metadata + virus-scan status + delivery method.
-- Delivery method 'inline' means standard email attachment (≤25 MB);
-- 'signed_link' means LEAP Large File Transfer (signed URL in email body).

create table public.message_attachments (
  id                                          uuid primary key default gen_random_uuid(),
  ma_message_id                               uuid not null references public.messages(id) on delete cascade,
  ma_storage_path                             text not null,
  ma_file_name                                text not null,
  ma_file_size_bytes                          bigint not null,
  ma_mime_type                                text,
  ma_delivery_method                          text not null check (ma_delivery_method in ('inline','signed_link')),
  ma_virus_scan_status                        text not null default 'pending'
                                                check (ma_virus_scan_status in ('pending','clean','infected','scan_failed')),
  ma_virus_scan_completed_at                  timestamptz,
  ma_signed_link_expires_at                   timestamptz,
  ma_created_by                               uuid references public.users(id),
  ma_created_at                               timestamptz not null default now(),
  ma_updated_by                               uuid references public.users(id),
  ma_updated_at                               timestamptz not null default now(),
  ma_is_deleted                               boolean not null default false,
  ma_deleted_at                               timestamptz,
  ma_deleted_by                               uuid references public.users(id),
  ma_deletion_reason                          text
);
create index ix_message_attachments_message on public.message_attachments(ma_message_id) where not ma_is_deleted;

alter table public.message_attachments enable row level security;
create policy app_select_message_attachments on public.message_attachments
  for select using (app_user_can('message_attachments', 'read'));
create policy app_insert_message_attachments on public.message_attachments
  for insert with check (app_user_can('message_attachments', 'create'));
create policy app_update_message_attachments on public.message_attachments
  for update using (app_user_can('message_attachments', 'update'));
create policy app_delete_message_attachments on public.message_attachments
  for delete using (app_user_can('message_attachments', 'delete'));

-- ─── message_ai_transcripts ───────────────────────────────────────────
-- Per-iteration audit of the AI compose assistant. One row per round of
-- (user prompt → AI proposal → accept/reject). Enables full traceability
-- if a customer disputes what they were told.
--
-- This table holds candid framing ("Britton's been stressed about the
-- timeline — soften this") that isn't appropriate for general thread
-- visibility. Visibility is stricter than the message itself: only the
-- composer, the record owner, communications:view_all holders, and admin.
-- That stricter check is enforced by the RLS policy added in a later
-- migration; the role_object_access layer here gates the object existence.

create sequence if not exists public.seq_message_ai_transcripts;

create table public.message_ai_transcripts (
  id                                          uuid primary key default gen_random_uuid(),
  mat_record_number                           text not null default '',
  mat_message_id                              uuid not null references public.messages(id) on delete cascade,
  mat_iteration_order                         integer not null,
  mat_user_prompt                             text not null,
  mat_ai_response                             text not null,
  mat_user_accepted                           boolean not null default false,
  mat_draft_snapshot                          jsonb not null default '{}'::jsonb,
  mat_owner                                   uuid not null references public.users(id),
  mat_created_by                              uuid references public.users(id),
  mat_created_at                              timestamptz not null default now(),
  mat_updated_by                              uuid references public.users(id),
  mat_updated_at                              timestamptz not null default now(),
  mat_is_deleted                              boolean not null default false,
  mat_deleted_at                              timestamptz,
  mat_deleted_by                              uuid references public.users(id),
  mat_deletion_reason                         text,
  constraint mat_unique_iteration_per_message unique (mat_message_id, mat_iteration_order)
);
create index ix_mat_message on public.message_ai_transcripts(mat_message_id) where not mat_is_deleted;
create index ix_mat_owner   on public.message_ai_transcripts(mat_owner)      where not mat_is_deleted;

create or replace function public.set_mat_record_number()
returns trigger language plpgsql as $$
begin
  if new.mat_record_number is null or new.mat_record_number = '' then
    new.mat_record_number := generate_record_number('MAT-', 'seq_message_ai_transcripts');
  end if;
  return new;
end $$;

drop trigger if exists trg_mat_record_number on public.message_ai_transcripts;
create trigger trg_mat_record_number
  before insert on public.message_ai_transcripts
  for each row execute function public.set_mat_record_number();

alter table public.message_ai_transcripts enable row level security;
create policy app_select_message_ai_transcripts on public.message_ai_transcripts
  for select using (app_user_can('message_ai_transcripts', 'read'));
create policy app_insert_message_ai_transcripts on public.message_ai_transcripts
  for insert with check (app_user_can('message_ai_transcripts', 'create'));
create policy app_update_message_ai_transcripts on public.message_ai_transcripts
  for update using (app_user_can('message_ai_transcripts', 'update'));
create policy app_delete_message_ai_transcripts on public.message_ai_transcripts
  for delete using (app_user_can('message_ai_transcripts', 'delete'));

insert into role_object_access (roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete)
select r.id, 'message_attachments', true, true, true,
       case when r.role_name = 'Admin' then true else false end
from roles r
where r.role_is_active
  and r.role_name in ('Admin','Program Manager','Project Manager','Project Coordinator','Director of Field Services');

insert into role_object_access (roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete)
select r.id, 'message_ai_transcripts',
       true, true, false,
       case when r.role_name = 'Admin' then true else false end
from roles r
where r.role_is_active
  and r.role_name in ('Admin','Program Manager','Project Manager','Project Coordinator','Director of Field Services');
