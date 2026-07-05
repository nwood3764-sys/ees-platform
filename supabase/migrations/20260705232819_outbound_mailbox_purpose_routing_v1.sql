-- =====================================================================
-- Purpose-aware outbound mailbox routing (v1)
--
-- States run more than one shared mailbox (WI: ira@ = general
-- correspondence, assessments.wi@ = assessment mail). The resolver
-- previously demanded exactly ONE active mailbox per state and keyed on
-- state alone. Mailboxes now carry a managed-picklist purpose and the
-- resolver picks the state's General Correspondence mailbox for
-- record-anchored sends, falling back to a state's sole active mailbox
-- where only one exists.
-- =====================================================================

-- --- Purpose column + managed picklist --------------------------------
ALTER TABLE public.outbound_mailboxes
  ADD COLUMN IF NOT EXISTS obm_purpose text NOT NULL DEFAULT 'General Correspondence';

INSERT INTO public.picklist_values
  (id, picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_is_active, picklist_sort_order, picklist_created_at)
SELECT gen_random_uuid(), 'outbound_mailboxes', 'obm_purpose', v.value, v.label, true, v.sort_order, now()
FROM (VALUES
  ('General Correspondence', 'General Correspondence', 10),
  ('Assessments',            'Assessments',            20)
) AS v(value, label, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
  WHERE p.picklist_object='outbound_mailboxes' AND p.picklist_field='obm_purpose' AND p.picklist_value=v.value
);

-- --- Classify existing mailboxes ---------------------------------------
UPDATE public.outbound_mailboxes SET obm_purpose='Assessments'
WHERE lower(obm_address) LIKE 'assessments%';

-- ncira and any future ira@/general boxes keep the default 'General Correspondence'.

-- --- Register + activate WI general correspondence mailbox -------------
INSERT INTO public.outbound_mailboxes
  (obm_record_number, obm_address, obm_display_name, obm_state, obm_purpose, obm_is_active, obm_created_by)
SELECT '', 'ira@ees-wi.org', 'WI IRA Correspondence', 'WI', 'General Correspondence', true,
       (select id from users where user_email='nicholas.wood@ees-wi.org' limit 1)
WHERE NOT EXISTS (
  SELECT 1 FROM public.outbound_mailboxes WHERE lower(obm_address)='ira@ees-wi.org' AND obm_is_deleted=false
);

-- --- Resolver v2: prefer the state's General Correspondence mailbox ----
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
