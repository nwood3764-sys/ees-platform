-- ─── dispatcher_followup_requests ─────────────────────────────────────
-- Captures customer leads who couldn't auto-schedule on the public
-- /sa/<slug> pages. Four trigger reasons:
--   • out_of_territory          — address falls outside every active
--                                 service_territory polygon
--   • no_qualifying_resources   — no certified auditor with the work
--                                 type's skill requirements has any
--                                 capacity in the 14-day window
--   • no_availability           — qualifying resources exist but
--                                 every slot is booked or blocked
--   • general_inquiry           — placeholder for future contact-form
--                                 leads (work_type not yet known)

create sequence if not exists public.dispatcher_followup_requests_record_number_seq;

create table if not exists public.dispatcher_followup_requests (
  id                              uuid primary key default gen_random_uuid(),
  dfr_record_number               text not null default '',

  dfr_customer_first_name         text not null,
  dfr_customer_last_name          text not null,
  dfr_phone                       text,
  dfr_email                       text,

  dfr_address_street              text,
  dfr_address_city                text,
  dfr_address_state               text,
  dfr_address_zip                 text,

  work_type_id                    uuid references public.work_types(id),
  dfr_work_type_slug              text,
  dfr_preferred_start_at          timestamptz,

  dfr_reason                      uuid references public.picklist_values(id),
  dfr_status                      uuid references public.picklist_values(id),

  dfr_dispatcher_notes            text,
  dfr_resolution                  text,
  dfr_resolved_at                 timestamptz,
  dfr_resolved_by                 uuid references public.users(id),

  dfr_owner                       uuid references public.users(id),
  dfr_created_by                  uuid references public.users(id),
  dfr_created_at                  timestamptz default now(),
  dfr_updated_by                  uuid references public.users(id),
  dfr_updated_at                  timestamptz default now(),
  dfr_is_deleted                  boolean default false,
  dfr_deleted_at                  timestamptz,
  dfr_deleted_by                  uuid references public.users(id),
  dfr_deletion_reason             text
);

create index if not exists idx_dfr_status        on public.dispatcher_followup_requests (dfr_status) where not dfr_is_deleted;
create index if not exists idx_dfr_reason        on public.dispatcher_followup_requests (dfr_reason) where not dfr_is_deleted;
create index if not exists idx_dfr_created_at    on public.dispatcher_followup_requests (dfr_created_at desc) where not dfr_is_deleted;

create or replace function public.trg_dfr_record_number()
returns trigger
language plpgsql
as $$
begin
  if NEW.dfr_record_number is null or NEW.dfr_record_number = '' then
    NEW.dfr_record_number := generate_record_number('DFR-', 'dispatcher_followup_requests_record_number_seq');
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_dfr_set_record_number on public.dispatcher_followup_requests;
create trigger trg_dfr_set_record_number
  before insert on public.dispatcher_followup_requests
  for each row execute function public.trg_dfr_record_number();

create or replace function public.trg_dfr_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  NEW.dfr_updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists trg_dfr_touch_updated_at on public.dispatcher_followup_requests;
create trigger trg_dfr_touch_updated_at
  before update on public.dispatcher_followup_requests
  for each row execute function public.trg_dfr_touch_updated_at();

alter table public.dispatcher_followup_requests enable row level security;

create policy app_select_dispatcher_followup_requests on public.dispatcher_followup_requests
  for select using (app_user_can('dispatcher_followup_requests', 'read'));
create policy app_insert_dispatcher_followup_requests on public.dispatcher_followup_requests
  for insert with check (app_user_can('dispatcher_followup_requests', 'create'));
create policy app_update_dispatcher_followup_requests on public.dispatcher_followup_requests
  for update using (app_user_can('dispatcher_followup_requests', 'update'));
create policy app_delete_dispatcher_followup_requests on public.dispatcher_followup_requests
  for delete using (app_user_can('dispatcher_followup_requests', 'delete'));

insert into public.picklist_values (
  picklist_object, picklist_field, picklist_value, picklist_label,
  picklist_sort_order, picklist_is_active
) values
  ('dispatcher_followup_requests', 'dfr_status', 'Open',          'Open',           10, true),
  ('dispatcher_followup_requests', 'dfr_status', 'In Progress',   'In Progress',    20, true),
  ('dispatcher_followup_requests', 'dfr_status', 'Resolved',      'Resolved',       30, true),
  ('dispatcher_followup_requests', 'dfr_status', 'Closed',        'Closed',         40, true);

insert into public.picklist_values (
  picklist_object, picklist_field, picklist_value, picklist_label,
  picklist_sort_order, picklist_is_active
) values
  ('dispatcher_followup_requests', 'dfr_reason', 'out_of_territory',         'Out of Territory',          10, true),
  ('dispatcher_followup_requests', 'dfr_reason', 'no_qualifying_resources',  'No Qualifying Resources',   20, true),
  ('dispatcher_followup_requests', 'dfr_reason', 'no_availability',          'No Availability',           30, true),
  ('dispatcher_followup_requests', 'dfr_reason', 'general_inquiry',          'General Inquiry',           40, true);

insert into public.role_object_access (
  roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete
)
select r.id, 'dispatcher_followup_requests',
       true,
       case when r.role_name in ('Admin','Program Manager','Project Manager','Project Coordinator','Director of Field Services') then true else false end,
       case when r.role_name in ('Admin','Program Manager','Project Manager','Project Coordinator','Director of Field Services') then true else false end,
       case when r.role_name = 'Admin' then true else false end
from public.roles r
where r.role_is_active
  and r.role_name in ('Admin','Program Manager','Project Manager','Project Coordinator','Director of Field Services');
