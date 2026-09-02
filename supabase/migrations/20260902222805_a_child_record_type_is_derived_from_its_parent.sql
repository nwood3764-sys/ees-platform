-- Nicholas, 2026-09-02: "when creating contacts, the record type for the
-- contact needs to be inherited from the parent, so if I'm creating a contact
-- on a property owner, it needs to be a property owner contact."
--
-- Today a contact created from an account gets whatever
-- default_record_type_for('contacts') returns, which is PROPERTY-OWNER-CONTACT
-- for everyone -- so a contact created on a Utility account is filed as a
-- Property Owner Contact, and the picker offers all five active types with no
-- hint which is right. That default is also why 20 of the 47 live contacts
-- carry Property Owner Contact whether or not they belong to a property owner.
--
-- DERIVATION IS NOT ELIGIBILITY, so this is not folded into
-- record_type_eligibility. That table answers "which child record types are
-- ALLOWED under this parent" and is a constraint; this answers "which ONE
-- should a new child be given" and is a default. One artifact, one purpose.

create sequence if not exists public.seq_record_type_derivation;

create table if not exists public.record_type_derivation (
  id                        uuid primary key default gen_random_uuid(),
  rtd_record_number         text not null,
  rtd_parent_object         text not null,
  rtd_parent_record_type_id uuid not null references public.picklist_values(id),
  rtd_child_object          text not null,
  rtd_child_record_type_id  uuid not null references public.picklist_values(id),
  rtd_is_active             boolean not null default true,
  rtd_created_at            timestamptz not null default now(),
  rtd_created_by            uuid references public.users(id),
  rtd_updated_at            timestamptz not null default now(),
  rtd_updated_by            uuid references public.users(id),
  rtd_is_deleted            boolean not null default false,
  rtd_deletion_reason       text,
  is_seed_data              boolean not null default false
);

comment on table public.record_type_derivation is
  'Which record type a NEW child record is given, from its parent record type. A default, not a constraint -- record_type_eligibility says which child types are allowed; this says which one to pick. One active rule per (parent object, parent record type, child object).';

create unique index if not exists record_type_derivation_unique_active
  on public.record_type_derivation (rtd_parent_object, rtd_parent_record_type_id, rtd_child_object)
  where rtd_is_active and not rtd_is_deleted;

-- Record number, the platform way.
create or replace function public.set_record_type_derivation_record_number()
returns trigger language plpgsql set search_path to 'public', 'pg_catalog' as $$
begin
  NEW.rtd_record_number := generate_record_number('RTD-', 'seq_record_type_derivation');
  return NEW;
end $$;

drop trigger if exists trg_rtd_rn on public.record_type_derivation;
create trigger trg_rtd_rn before insert on public.record_type_derivation
  for each row execute function public.set_record_type_derivation_record_number();

drop trigger if exists trg_rtd_no_hard_delete on public.record_type_derivation;
create trigger trg_rtd_no_hard_delete before delete on public.record_type_derivation
  for each row execute function public.block_hard_delete();

alter table public.record_type_derivation enable row level security;

drop policy if exists rtd_read on public.record_type_derivation;
create policy rtd_read on public.record_type_derivation
  for select using (current_app_user_id() is not null);

drop policy if exists rtd_write on public.record_type_derivation;
create policy rtd_write on public.record_type_derivation
  for all using (is_admin()) with check (is_admin());

-- ── The rule ───────────────────────────────────────────────────────────────
-- SECURITY DEFINER with EXECUTE revoked, per the 2026-08-31 lesson: a trigger
-- function that is INVOKER and calls a definer function makes every write hang
-- on an EXECUTE grant the advisors then tell the next session to take away.
-- PostgreSQL does not check EXECUTE when it FIRES a trigger, so revoking costs
-- nothing.
create or replace function public.derive_record_type_from_parent(
  p_child_object       text,
  p_parent_object      text,
  p_parent_record_type uuid
) returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select d.rtd_child_record_type_id
    from public.record_type_derivation d
   where d.rtd_child_object          = p_child_object
     and d.rtd_parent_object         = p_parent_object
     and d.rtd_parent_record_type_id = p_parent_record_type
     and d.rtd_is_active
     and not d.rtd_is_deleted
   limit 1;
$$;

revoke all on function public.derive_record_type_from_parent(text, text, uuid) from public;
revoke all on function public.derive_record_type_from_parent(text, text, uuid) from anon;
revoke all on function public.derive_record_type_from_parent(text, text, uuid) from authenticated;

-- Named trg_0_* so it sorts BEFORE trg_enforce_record_type, which stamps the
-- platform default on any contact inserted without one. Derivation has to win
-- that race or it never runs.
create or replace function public.derive_contact_record_type()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_parent_rt uuid;
begin
  -- Only ever FILLS a blank. A record type the caller supplied is the caller's
  -- decision and is never overwritten.
  if NEW.contact_record_type is not null or NEW.contact_account_id is null then
    return NEW;
  end if;

  select a.account_record_type into v_parent_rt
    from public.accounts a
   where a.id = NEW.contact_account_id;

  if v_parent_rt is null then
    return NEW;
  end if;

  NEW.contact_record_type := coalesce(
    public.derive_record_type_from_parent('contacts', 'accounts', v_parent_rt),
    NEW.contact_record_type
  );
  return NEW;
end $$;

revoke all on function public.derive_contact_record_type() from public;
revoke all on function public.derive_contact_record_type() from anon;
revoke all on function public.derive_contact_record_type() from authenticated;

drop trigger if exists trg_0_derive_contact_record_type on public.contacts;
create trigger trg_0_derive_contact_record_type
  before insert on public.contacts
  for each row execute function public.derive_contact_record_type();

-- ── The mapping ────────────────────────────────────────────────────────────
-- Every ACTIVE account record type is mapped, so no live parent falls through
-- to the platform default. PROPERTY-MANAGEMENT-COMPANY is retired but 19
-- accounts still carry it, and under LEAP's one-account-per-company rule the
-- Property Owner account is primary -- so its contacts are property-side too.
insert into public.record_type_derivation (
  rtd_record_number, rtd_parent_object, rtd_parent_record_type_id,
  rtd_child_object, rtd_child_record_type_id, is_seed_data
)
select '', 'accounts', pa.id, 'contacts', pc.id, true
from (values
  ('PROPERTY-OWNER',              'PROPERTY-OWNER-CONTACT'),
  ('PROPERTY-MANAGEMENT-COMPANY', 'PROPERTY-OWNER-CONTACT'),
  ('PROPERTY',                    'PROPERTY-OWNER-CONTACT'),
  ('SINGLE-FAMILY',               'PROPERTY-OWNER-CONTACT'),
  ('SERVICE-PROVIDER',            'SERVICE-PROVIDER-CONTACT'),
  ('CONTRACTOR',                  'SERVICE-PROVIDER-CONTACT'),
  ('VENDOR',                      'SERVICE-PROVIDER-CONTACT'),
  ('PROGRAM-IMPLEMENTER',         'PROGRAM-CONTACT'),
  ('COMMUNITY-ACTION-AGENCY',     'PROGRAM-CONTACT'),
  ('UTILITY',                     'UTILITY-CONTACT'),
  ('GENERAL',                     'STANDARD-CONTACT')
) as m(parent_value, child_value)
join public.picklist_values pa
  on pa.picklist_object = 'accounts' and pa.picklist_field = 'record_type'
 and pa.picklist_value = m.parent_value
join public.picklist_values pc
  on pc.picklist_object = 'contacts' and pc.picklist_field = 'record_type'
 and pc.picklist_value = m.child_value
where not exists (
  select 1 from public.record_type_derivation d
   where d.rtd_parent_object = 'accounts' and d.rtd_child_object = 'contacts'
     and d.rtd_parent_record_type_id = pa.id and not d.rtd_is_deleted
);

do $verify$
declare
  v_unmapped text;
  v_owner_rt uuid;
  v_utility_rt uuid;
begin
  -- Every ACTIVE account record type must resolve, or a contact created under
  -- it silently takes the platform default (Property Owner Contact) and is
  -- filed wrong -- the exact defect this fixes.
  select string_agg(pa.picklist_value, ', ')
    into v_unmapped
    from public.picklist_values pa
   where pa.picklist_object = 'accounts' and pa.picklist_field = 'record_type'
     and pa.picklist_is_active
     and not exists (
       select 1 from public.record_type_derivation d
        where d.rtd_parent_object = 'accounts' and d.rtd_child_object = 'contacts'
          and d.rtd_parent_record_type_id = pa.id
          and d.rtd_is_active and not d.rtd_is_deleted
     );
  if v_unmapped is not null then
    raise exception 'Active account record types with no contact derivation rule: %', v_unmapped;
  end if;

  -- The reported case, and a case that must NOT resolve the same way, or the
  -- rule is just the old blanket default wearing a table.
  select id into v_owner_rt from public.picklist_values
   where picklist_object='accounts' and picklist_field='record_type' and picklist_value='PROPERTY-OWNER';
  select id into v_utility_rt from public.picklist_values
   where picklist_object='accounts' and picklist_field='record_type' and picklist_value='UTILITY';

  if (select picklist_value from public.picklist_values
       where id = public.derive_record_type_from_parent('contacts','accounts',v_owner_rt))
     is distinct from 'PROPERTY-OWNER-CONTACT' then
    raise exception 'A Property Owner account does not derive Property Owner Contact';
  end if;

  if (select picklist_value from public.picklist_values
       where id = public.derive_record_type_from_parent('contacts','accounts',v_utility_rt))
     is distinct from 'UTILITY-CONTACT' then
    raise exception 'A Utility account does not derive Utility Contact';
  end if;

  -- And the trigger must sort before the default-stamping one.
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.contacts'::regclass
       and t.tgname = 'trg_0_derive_contact_record_type'
       and t.tgname < 'trg_enforce_record_type'
  ) then
    raise exception 'The derivation trigger does not sort before trg_enforce_record_type';
  end if;
end
$verify$;

notify pgrst, 'reload schema';
