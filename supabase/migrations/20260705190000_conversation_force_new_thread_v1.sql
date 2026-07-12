-- =====================================================================
-- Per-thread email conversations (v1)
--
-- find_or_create_conversation deduped by (channel, our_address,
-- customer_address), so every new email to the same customer stacked into
-- one eternal thread. Email should thread like email: a fresh compose is a
-- NEW conversation; replies join their own thread (in-app replies pass the
-- conversation explicitly, customer replies route by the plus-address
-- token). p_force_new (appended, default false) skips the reuse lookup so
-- SMS/back-compat callers are unchanged.
-- =====================================================================

DROP FUNCTION IF EXISTS public.find_or_create_conversation(text, text, text, uuid, uuid, uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.find_or_create_conversation(
  p_channel                 text,
  p_our_address             text,
  p_customer_address        text,
  p_contact_id              uuid DEFAULT NULL,
  p_account_id              uuid DEFAULT NULL,
  p_project_id              uuid DEFAULT NULL,
  p_service_appointment_id  uuid DEFAULT NULL,
  p_subject                 text DEFAULT NULL,
  p_opportunity_id          uuid DEFAULT NULL,
  p_property_id             uuid DEFAULT NULL,
  p_building_id             uuid DEFAULT NULL,
  p_incentive_application_id uuid DEFAULT NULL,
  p_work_order_id           uuid DEFAULT NULL,
  p_assessment_id           uuid DEFAULT NULL,
  p_force_new               boolean DEFAULT false
)
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
    opportunity_id, property_id, building_id, incentive_application_id,
    work_order_id, assessment_id
  ) values (
    '', p_channel, p_our_address, p_customer_address,
    'open', p_subject,
    p_contact_id, p_account_id, p_project_id, p_service_appointment_id,
    p_opportunity_id, p_property_id, p_building_id, p_incentive_application_id,
    p_work_order_id, p_assessment_id
  )
  returning id into v_conv_id;

  return v_conv_id;
end $function$;

NOTIFY pgrst, 'reload schema';
