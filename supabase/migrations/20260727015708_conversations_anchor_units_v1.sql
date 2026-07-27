-- =============================================================================
-- Enable two-way email Conversations on units.
--
-- Units are the leaf of the property hierarchy (property -> building -> unit),
-- and multifamily field work is per-unit, so a conversation must be able to
-- anchor to a specific unit — the same way it already can to a property,
-- building, work order, etc. Conversations are FK-anchored (not polymorphic),
-- so enabling units means: (1) a unit_id anchor column on conversations,
-- (2) find_or_create_conversation accepting p_unit_id, and (3) the outbound
-- mailbox resolver knowing how to walk a unit -> its state.
--
-- All additive and backward compatible: the new column is nullable, the RPC
-- gains a trailing defaulted param (every runtime caller uses named args), and
-- the resolver gains one new anchor branch.
-- =============================================================================

-- 1. Anchor column on conversations -------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES public.units(id);

CREATE INDEX IF NOT EXISTS idx_conversations_unit_id
  ON public.conversations(unit_id)
  WHERE unit_id IS NOT NULL;

-- 2. find_or_create_conversation gains p_unit_id ------------------------------
-- Signature change (new param) => DROP the old overload, then recreate. The
-- only runtime caller (send-email-v1) invokes it with named parameters, so
-- appending p_unit_id ahead of p_force_new does not affect any caller.
DROP FUNCTION IF EXISTS public.find_or_create_conversation(
  text, text, text, uuid, uuid, uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, boolean);

CREATE OR REPLACE FUNCTION public.find_or_create_conversation(
  p_channel text,
  p_our_address text,
  p_customer_address text,
  p_contact_id uuid DEFAULT NULL::uuid,
  p_account_id uuid DEFAULT NULL::uuid,
  p_project_id uuid DEFAULT NULL::uuid,
  p_service_appointment_id uuid DEFAULT NULL::uuid,
  p_subject text DEFAULT NULL::text,
  p_opportunity_id uuid DEFAULT NULL::uuid,
  p_property_id uuid DEFAULT NULL::uuid,
  p_building_id uuid DEFAULT NULL::uuid,
  p_incentive_application_id uuid DEFAULT NULL::uuid,
  p_work_order_id uuid DEFAULT NULL::uuid,
  p_assessment_id uuid DEFAULT NULL::uuid,
  p_unit_id uuid DEFAULT NULL::uuid,
  p_force_new boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_conv_id uuid;
begin
  if p_channel is null or p_channel not in ('sms','email') then
    raise exception 'channel must be sms or email';
  end if;
  if p_our_address is null or p_customer_address is null then
    raise exception 'our_address and customer_address are required';
  end if;

  if not p_force_new then
    select id into v_conv_id
    from public.conversations
    where conv_channel = p_channel
      and conv_our_address = p_our_address
      and conv_customer_address = p_customer_address
      and conv_status = 'open'
      and conv_is_deleted = false
    limit 1;

    if v_conv_id is not null then
      update public.conversations
      set
        contact_id             = coalesce(contact_id, p_contact_id),
        account_id             = coalesce(account_id, p_account_id),
        project_id             = coalesce(project_id, p_project_id),
        service_appointment_id = coalesce(service_appointment_id, p_service_appointment_id),
        opportunity_id         = coalesce(opportunity_id, p_opportunity_id),
        property_id            = coalesce(property_id, p_property_id),
        building_id            = coalesce(building_id, p_building_id),
        unit_id                = coalesce(unit_id, p_unit_id),
        incentive_application_id = coalesce(incentive_application_id, p_incentive_application_id),
        work_order_id          = coalesce(work_order_id, p_work_order_id),
        assessment_id          = coalesce(assessment_id, p_assessment_id),
        conv_subject           = coalesce(conv_subject, p_subject),
        conv_updated_at        = now()
      where id = v_conv_id;
      return v_conv_id;
    end if;
  end if;

  insert into public.conversations (
    conv_record_number, conv_channel, conv_our_address, conv_customer_address,
    conv_status, conv_subject,
    contact_id, account_id, project_id, service_appointment_id,
    opportunity_id, property_id, building_id, unit_id, incentive_application_id,
    work_order_id, assessment_id
  ) values (
    '', p_channel, p_our_address, p_customer_address,
    'open', p_subject,
    p_contact_id, p_account_id, p_project_id, p_service_appointment_id,
    p_opportunity_id, p_property_id, p_building_id, p_unit_id, p_incentive_application_id,
    p_work_order_id, p_assessment_id
  )
  returning id into v_conv_id;

  return v_conv_id;
end $function$;

-- Restore the grants the dropped overload carried.
GRANT EXECUTE ON FUNCTION public.find_or_create_conversation(
  text, text, text, uuid, uuid, uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, boolean)
  TO public;

-- 3. Outbound mailbox resolver: add the units anchor branch -------------------
-- Same signature, so CREATE OR REPLACE preserves grants. A unit resolves its
-- state through its building (building_state), falling back to the building's
-- property (property_state) — mirroring the assessments/buildings branches.
CREATE OR REPLACE FUNCTION public.resolve_outbound_mailbox_for_anchor(p_anchor_object text, p_anchor_record_id uuid)
 RETURNS TABLE(outbound_mailbox_id uuid, obm_address text, obm_display_name text, obm_state text, resolution_path text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_state text;
  v_path  text;
  v_general_count int;
  v_active_count  int;
begin
  -- Walk anchor -> state. Each branch sets v_state and v_path on success.
  if p_anchor_object = 'projects' then
    select pr.property_state, 'projects -> properties.property_state'
      into v_state, v_path
      from projects p
      join properties pr on pr.id = p.property_id
     where p.id = p_anchor_record_id;

  elsif p_anchor_object = 'work_orders' then
    select pr.property_state, 'work_orders.property_id -> properties.property_state'
      into v_state, v_path
      from work_orders w
      join properties pr on pr.id = w.property_id
     where w.id = p_anchor_record_id;
    if v_state is null then
      select pr.property_state, 'work_orders.project_id -> projects.property_id -> properties.property_state'
        into v_state, v_path
        from work_orders w
        join projects p    on p.id = w.project_id
        join properties pr on pr.id = p.property_id
       where w.id = p_anchor_record_id;
    end if;

  elsif p_anchor_object = 'service_appointments' then
    select pr.property_state,
           'service_appointments.work_order_id -> work_orders -> properties.property_state'
      into v_state, v_path
      from service_appointments sa
      join work_orders w on w.id = sa.work_order_id
      join properties pr on pr.id = coalesce(w.property_id,
                                             (select property_id from projects where id = w.project_id))
     where sa.id = p_anchor_record_id;

  elsif p_anchor_object = 'accounts' then
    select coalesce(a.billing_state, a.mailing_state),
           'accounts -> billing_state (or mailing_state)'
      into v_state, v_path
      from accounts a
     where a.id = p_anchor_record_id;

  elsif p_anchor_object = 'contacts' then
    select c.contact_mailing_state, 'contacts.contact_mailing_state'
      into v_state, v_path
      from contacts c
     where c.id = p_anchor_record_id;
    if v_state is null then
      select coalesce(a.billing_state, a.mailing_state),
             'contacts.account_id -> accounts.billing_state'
        into v_state, v_path
        from contacts c
        join accounts a on a.id = c.account_id
       where c.id = p_anchor_record_id;
    end if;

  elsif p_anchor_object = 'opportunities' then
    select o.opportunity_state, 'opportunities.opportunity_state'
      into v_state, v_path
      from opportunities o
     where o.id = p_anchor_record_id;
    if v_state is null then
      select pr.property_state, 'opportunities.property_id -> properties.property_state'
        into v_state, v_path
        from opportunities o
        join properties pr on pr.id = o.property_id
       where o.id = p_anchor_record_id;
    end if;

  elsif p_anchor_object = 'incentive_applications' then
    select ia.ia_installation_address_state, 'incentive_applications.ia_installation_address_state'
      into v_state, v_path
      from incentive_applications ia
     where ia.id = p_anchor_record_id;
    if v_state is null then
      select pr.property_state, 'incentive_applications.property_id -> properties.property_state'
        into v_state, v_path
        from incentive_applications ia
        join properties pr on pr.id = ia.property_id
       where ia.id = p_anchor_record_id;
    end if;
    if v_state is null then
      select pr.property_state, 'incentive_applications.project_id -> projects.property_id -> properties.property_state'
        into v_state, v_path
        from incentive_applications ia
        join projects p    on p.id = ia.project_id
        join properties pr on pr.id = p.property_id
       where ia.id = p_anchor_record_id;
    end if;

  elsif p_anchor_object = 'assessments' then
    select pr.property_state, 'assessments.property_id -> properties.property_state'
      into v_state, v_path
      from assessments a
      join properties pr on pr.id = a.property_id
     where a.id = p_anchor_record_id;
    if v_state is null then
      select pr.property_state, 'assessments.project_id -> projects.property_id -> properties.property_state'
        into v_state, v_path
        from assessments a
        join projects p    on p.id = a.project_id
        join properties pr on pr.id = p.property_id
       where a.id = p_anchor_record_id;
    end if;
    if v_state is null then
      select b.building_state, 'assessments.building_id -> buildings.building_state'
        into v_state, v_path
        from assessments a
        join buildings b on b.id = a.building_id
       where a.id = p_anchor_record_id;
    end if;

  elsif p_anchor_object = 'buildings' then
    select b.building_state, 'buildings.building_state'
      into v_state, v_path
      from buildings b
     where b.id = p_anchor_record_id;
    if v_state is null then
      select pr.property_state, 'buildings.property_id -> properties.property_state'
        into v_state, v_path
        from buildings b
        join properties pr on pr.id = b.property_id
       where b.id = p_anchor_record_id;
    end if;

  elsif p_anchor_object = 'units' then
    select b.building_state, 'units.building_id -> buildings.building_state'
      into v_state, v_path
      from units u
      join buildings b on b.id = u.building_id
     where u.id = p_anchor_record_id;
    if v_state is null then
      select pr.property_state, 'units.building_id -> buildings.property_id -> properties.property_state'
        into v_state, v_path
        from units u
        join buildings b   on b.id = u.building_id
        join properties pr on pr.id = b.property_id
       where u.id = p_anchor_record_id;
    end if;

  elsif p_anchor_object = 'properties' then
    select pr.property_state, 'properties.property_state'
      into v_state, v_path
      from properties pr
     where pr.id = p_anchor_record_id;

  end if;

  if v_state is null then
    return;  -- empty result; caller surfaces "no state resolvable for anchor"
  end if;

  -- Purpose-aware pick: record-anchored correspondence goes to the state's
  -- General Correspondence mailbox. If the state has exactly one such box,
  -- use it. Otherwise fall back to the state's sole active mailbox of any
  -- purpose (single-mailbox states). Ambiguity still returns empty so the
  -- caller surfaces the configuration problem rather than picking blindly.
  select count(*) into v_general_count
    from outbound_mailboxes m
   where m.obm_state = v_state
     and m.obm_purpose = 'General Correspondence'
     and m.obm_is_active = true
     and m.obm_is_deleted = false;

  if v_general_count = 1 then
    return query
      select m.id, m.obm_address, m.obm_display_name, m.obm_state,
             v_path || ' -> general correspondence mailbox'
        from outbound_mailboxes m
       where m.obm_state = v_state
         and m.obm_purpose = 'General Correspondence'
         and m.obm_is_active = true
         and m.obm_is_deleted = false;
    return;
  end if;

  select count(*) into v_active_count
    from outbound_mailboxes m
   where m.obm_state = v_state
     and m.obm_is_active = true
     and m.obm_is_deleted = false;

  if v_active_count <> 1 then
    return;  -- zero or ambiguous; caller's error path tells the user to fix mailbox config
  end if;

  return query
    select m.id, m.obm_address, m.obm_display_name, m.obm_state,
           v_path || ' -> sole active mailbox'
      from outbound_mailboxes m
     where m.obm_state = v_state
       and m.obm_is_active = true
       and m.obm_is_deleted = false;
end$function$;

NOTIFY pgrst, 'reload schema';
