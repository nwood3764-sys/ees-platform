-- The Field module's Technicians tab was the CONTACTS list wearing the word
-- "Technicians". It carried no filter, so it showed every contact in LEAP --
-- property owner contacts, program contacts, test rows -- and it could never
-- have shown a technician, because a technician is not a contact.
--
-- Every other part of the platform already knows this. work_orders
-- .assigned_technician_id is an FK to USERS. LEAP Pad signs in as a user. The
-- Technician Setup Wizard provisions a user. Only this one tab disagreed
-- (Nicholas, 2026-09-02: "Where's Logan? Where's Roman? ... if it's on the
-- field module, it can only show the technicians. That's it.").
--
-- So the question "who is a technician" needs an answer stored on the user.
-- It is deliberately NOT read from the role: a role is an access-control
-- grant, and doing field work is a job fact. Nicholas is an Admin AND carries
-- a work order; Operations Manager and Program Manager are staff roles whose
-- holders are not on a crew. Conflating the two would mean you cannot put
-- somebody on the crew list without also changing what they can see.

alter table public.users
  add column if not exists user_is_field_technician boolean not null default false;

comment on column public.users.user_is_field_technician is
  'This person does field work and appears on Field > Technicians. Seeded from the field roles and from work actually assigned; maintained per user, never derived from the role, because a role is an access grant and being on a crew is a job fact.';

-- Seed from what the data already says, not from a guess:
--   (a) the roles that ARE field roles by definition, and
--   (b) anyone a work order has actually been assigned to, whatever their role.
update public.users u
   set user_is_field_technician = true
 where u.user_is_deleted is not true
   and (
     exists (
       select 1 from public.roles r
        where r.id = u.role_id
          and r.role_name in (
            'Team Lead', 'Lead Technician', 'Technician in Training',
            'Project Site Lead', 'Shop Steward', 'Director of Field Services'
          )
     )
     or exists (
       select 1 from public.work_orders w
        where w.assigned_technician_id = u.id
          and w.work_order_is_deleted is not true
     )
   );

-- Put the flag on the user record so it is maintained where the user lives,
-- rather than being a database-only fact nobody can change.
update public.page_layout_widgets w
   set widget_config = jsonb_set(
         w.widget_config,
         '{fields}',
         (w.widget_config -> 'fields') || jsonb_build_array(
           jsonb_build_object(
             'name',  'user_is_field_technician',
             'type',  'checkbox',
             'label', 'Field Technician'
           )
         )
       )
 where w.section_id = '94837551-ce06-4ae6-82cf-c89e9e812990'
   and w.widget_type = 'field_group'
   and w.is_deleted is not true
   and not (w.widget_config -> 'fields' @> '[{"name":"user_is_field_technician"}]'::jsonb);

-- Prove the seed against the people Nicholas named, rather than assuming it.
do $verify$
declare
  v_missing text;
  v_count   integer;
begin
  select string_agg(u.user_name, ', ')
    into v_missing
    from public.users u
   where u.user_name in ('Roman Rufino', 'Logan Wood', 'Javier Martinez',
                         'Kenji Chen', 'Alexis Williams', 'Frog Wood',
                         'Daniel Okonkwo')
     and u.user_is_active
     and u.user_is_field_technician is not true;

  if v_missing is not null then
    raise exception 'These field-role users were not seeded as technicians: %', v_missing;
  end if;

  -- The negative control: if EVERY active user came back true the flag is
  -- meaningless and the tab would be just as wrong as the contacts list was.
  select count(*) into v_count
    from public.users u
   where u.user_is_active and u.user_is_deleted is not true
     and u.user_is_field_technician is not true;

  if v_count = 0 then
    raise exception 'Every active user was flagged a field technician, which cannot be right';
  end if;

  -- And the flag must be on the user page layout, or nobody can maintain it.
  if not exists (
    select 1 from public.page_layout_widgets w
     where w.section_id = '94837551-ce06-4ae6-82cf-c89e9e812990'
       and w.is_deleted is not true
       and w.widget_config -> 'fields' @> '[{"name":"user_is_field_technician"}]'::jsonb
  ) then
    raise exception 'user_is_field_technician was not placed on the Standard Users Layout';
  end if;
end
$verify$;

notify pgrst, 'reload schema';
