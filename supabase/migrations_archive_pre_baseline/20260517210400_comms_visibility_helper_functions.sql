-- ─── Visibility helper functions ─────────────────────────────────────
-- Six functions used by the message + conversation + AI-transcript RLS
-- visibility policies in the next migration. SECURITY DEFINER + STABLE so
-- they bypass the caller's direct table RLS where they need to walk the
-- contact-role chain, and so they can inline into the policy quals.

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    join public.roles r on r.id = u.role_id
    where u.auth_user_id = auth.uid()
      and r.role_name = 'Admin'
      and r.role_is_active
  );
$$;

create or replace function public.has_communications_view_all()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    join public.communications_view_all_grants g on g.cvag_role_id = u.role_id
    where u.auth_user_id = auth.uid()
      and not g.cvag_is_deleted
  );
$$;

create or replace function public.resolve_anchor_opportunity(p_conversation_id uuid)
returns setof uuid
language sql stable security definer set search_path = public
as $$
  with conv as (
    select contact_id, account_id, project_id, service_appointment_id
    from public.conversations
    where id = p_conversation_id and not conv_is_deleted
  )
  select distinct opp_id from (
    select ocr.opportunity_id as opp_id
    from conv c
    join public.opportunity_contact_roles ocr on ocr.contact_id = c.contact_id
    where c.contact_id is not null and not ocr.ocr_is_deleted

    union

    select o.id as opp_id
    from conv c
    join public.opportunities o on o.opportunity_account_id = c.account_id
    where c.account_id is not null and not o.opportunity_is_deleted

    union

    select o.id as opp_id
    from conv c
    join public.projects p on p.id = c.project_id
    join public.opportunities o on o.property_id = p.property_id
    where c.project_id is not null and not p.project_is_deleted and not o.opportunity_is_deleted

    union

    select coalesce(sa.opportunity_id, o.id) as opp_id
    from conv c
    join public.service_appointments sa on sa.id = c.service_appointment_id
    left join public.projects p on p.id = sa.project_id
    left join public.opportunities o on o.property_id = p.property_id and not o.opportunity_is_deleted
    where c.service_appointment_id is not null and not sa.sa_is_deleted
  ) anchors
  where opp_id is not null;
$$;

create or replace function public.is_on_anchor_opportunity_contact_roles(p_conversation_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    join public.contacts c on c.contact_user_id = u.id
    join public.opportunity_contact_roles ocr on ocr.contact_id = c.id
    where u.auth_user_id = auth.uid()
      and ocr.ocr_includes_communications = true
      and not ocr.ocr_is_deleted
      and ocr.opportunity_id in (select * from resolve_anchor_opportunity(p_conversation_id))
  );
$$;

create or replace function public.is_recipient(p_conversation_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    join public.contacts c on c.contact_user_id = u.id
    join public.messages m on m.conversation_id = p_conversation_id
    where u.auth_user_id = auth.uid()
      and not m.msg_is_deleted
      and (
        m.msg_to_address    in (c.contact_email, c.contact_phone, c.contact_mobile_phone)
        or m.msg_from_address in (c.contact_email, c.contact_phone, c.contact_mobile_phone)
      )
  );
$$;

create or replace function public.is_record_owner_in_chain(p_conversation_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  with me as (
    select id as user_id from public.users where auth_user_id = auth.uid()
  ), conv as (
    select c.contact_id, c.account_id, c.project_id, c.service_appointment_id
    from public.conversations c
    where c.id = p_conversation_id and not c.conv_is_deleted
  )
  select exists (
    select 1 from conv c, me
    where (c.contact_id is not null
           and exists (select 1 from public.contacts x where x.id = c.contact_id and x.contact_owner = me.user_id))
       or (c.account_id is not null
           and exists (select 1 from public.accounts x where x.id = c.account_id and x.account_owner = me.user_id))
       or (c.project_id is not null
           and exists (select 1 from public.projects x where x.id = c.project_id and x.project_owner = me.user_id))
       or (c.service_appointment_id is not null
           and exists (select 1 from public.service_appointments x where x.id = c.service_appointment_id and x.sa_owner = me.user_id))
       or exists (
         select 1 from public.opportunities o
         where o.id in (select * from resolve_anchor_opportunity(p_conversation_id))
           and o.opportunity_owner = me.user_id
       )
  );
$$;

grant execute on function public.is_admin()                                        to authenticated;
grant execute on function public.has_communications_view_all()                     to authenticated;
grant execute on function public.resolve_anchor_opportunity(uuid)                  to authenticated;
grant execute on function public.is_on_anchor_opportunity_contact_roles(uuid)      to authenticated;
grant execute on function public.is_recipient(uuid)                                to authenticated;
grant execute on function public.is_record_owner_in_chain(uuid)                    to authenticated;
