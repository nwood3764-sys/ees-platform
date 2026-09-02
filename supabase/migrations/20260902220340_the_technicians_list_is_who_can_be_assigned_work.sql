-- Nicholas, 2026-09-02: "Nicholas, Lucas, and Brittin should be able to sign
-- work orders, even though they're users," and "I only want to see technicians
-- and people that are able to be assigned work orders. That's it."
--
-- That is the definition of the Field > Technicians list, stated outright: not
-- "people whose ROLE is a technician role", but everyone who can be handed a
-- work order. Lucas and Brittin run work orders and carry an Admin role
-- because they run the company; the seed rule (field roles + work already
-- assigned) could not know that, which is exactly why the flag is maintained
-- per user rather than derived from the role.

-- Matched on the work email, not the record number: USR-00001 is a LEGACY
-- Nicholas Wood (nicholas@anuraenergy.com) with no auth link that cannot sign
-- in, and putting a dead duplicate on the crew list would be a defect. The
-- live Nicholas (USR-00007) was already flagged by the work order he carries.
update public.users
   set user_is_field_technician = true
 where user_email in ('lucas.wood@ees-wi.org', 'brittin.wood@ees-wi.org')
   and user_is_deleted is not true;

-- The tab's saved views. Scoped to the field module (list_view_module), which
-- has existed since the baseline and which nothing read until now -- without
-- that, "Crew Leads" would also appear in Setup > Users, where it means
-- nothing because that list is every user.
--
-- No view filters on "is a technician": the tab is SCOPED to them at the
-- fetch, so a view that re-stated it would imply there is a view that does
-- not -- and there must not be one.
--
-- Record number is passed as '' so trg_list_view_record_number fills it, and
-- every record carries a named owner (the live Nicholas), per LEAP's rule that
-- an owner is never a team or a pool.
insert into public.saved_list_views (
  list_view_record_number, list_view_name, list_view_object, list_view_module,
  list_view_filters, list_view_sort_field, list_view_sort_direction,
  list_view_visible_columns, list_view_is_shared,
  list_view_owner, list_view_created_by, is_deleted
)
select '', v.name, 'users', 'field',
       v.filters::jsonb, 'user_name', 'asc',
       '["user_name","role_id__rel__role_name","user_title","user_email","user_phone"]'::jsonb,
       true,
       nw.id, nw.id,
       false
from (values
  ('All Technicians', '[]'),
  ('Crew Leads',
   '[{"field":"role_id__rel__role_name","label":"Role","op":"equals","value":["Team Lead","Lead Technician","Project Site Lead"]}]'),
  ('Technicians in Training',
   '[{"field":"role_id__rel__role_name","label":"Role","op":"equals","value":["Technician in Training"]}]')
) as v(name, filters)
cross join lateral (
  select id from public.users
   where user_email = 'nicholas.wood@ees-wi.org' and user_is_deleted is not true
   limit 1
) nw
where not exists (
  select 1 from public.saved_list_views x
   where x.list_view_object = 'users'
     and x.list_view_module = 'field'
     and x.list_view_name = v.name
     and x.is_deleted is not true
);

do $verify$
declare
  v_missing text;
  v_views   integer;
  v_total   integer;
begin
  -- Everyone Nicholas named must now be on the list.
  select string_agg(u.user_name || ' (' || u.user_email || ')', ', ')
    into v_missing
    from public.users u
   where u.user_email in ('nicholas.wood@ees-wi.org', 'lucas.wood@ees-wi.org',
                          'brittin.wood@ees-wi.org')
     and u.user_is_field_technician is not true;

  if v_missing is not null then
    raise exception 'Not flagged as field technicians: %', v_missing;
  end if;

  -- The legacy duplicate must NOT have been swept in.
  if exists (
    select 1 from public.users
     where user_email = 'nicholas@anuraenergy.com' and user_is_field_technician
  ) then
    raise exception 'The legacy Nicholas Wood (nicholas@anuraenergy.com) was flagged a field technician';
  end if;

  -- The negative control, again: a list everyone is on is not a list.
  select count(*) into v_total
    from public.users
   where user_is_active and user_is_deleted is not true
     and user_is_field_technician is not true;
  if v_total = 0 then
    raise exception 'Every active user is now a field technician, which cannot be right';
  end if;

  select count(*) into v_views
    from public.saved_list_views
   where list_view_object = 'users' and list_view_module = 'field'
     and is_deleted is not true;
  if v_views <> 3 then
    raise exception 'Expected 3 field-module technician views, found %', v_views;
  end if;

  -- And they must be scoped, or they leak into Setup > Users.
  if exists (
    select 1 from public.saved_list_views
     where list_view_object = 'users' and is_deleted is not true
       and list_view_module is distinct from 'field'
  ) then
    raise exception 'A users list view exists that is not scoped to the field module';
  end if;
end
$verify$;
