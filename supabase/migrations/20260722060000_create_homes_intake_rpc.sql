-- Staff HOMES intake: create the CRM chain for a pre-qualified NC single-family
-- homeowner from pasted inquiry info, so staff can then email them a personalized
-- "Schedule Now" link. Creates Account/Contact (deduped by phone) → Property
-- (single-family) → Building (single-family) → Opportunity (NC single-family
-- HOMES audit, first stage, optional AMI tier) → Project (single-family energy
-- assessment). Returns the created ids plus the prefill fields the caller uses
-- to build the personalized scheduling link. All record types/stages resolved
-- by value (nothing hardcoded by UUID).

CREATE OR REPLACE FUNCTION public.create_homes_intake(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin_id uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_actor    uuid;
  v_first text; v_last text; v_phone_raw text; v_phone text; v_email text;
  v_street text; v_city text; v_state text; v_zip text;
  v_ami_tier_value text; v_notes text;
  v_property_rt uuid; v_building_rt uuid; v_project_rt uuid; v_opp_rt uuid;
  v_stage_id uuid; v_ami_tier_id uuid;
  v_account_id uuid; v_contact_id uuid; v_property_id uuid; v_building_id uuid;
  v_opportunity_id uuid; v_project_id uuid;
  v_opp_record_number text;
  v_created_account boolean := false;
BEGIN
  v_actor := coalesce(current_app_user_id(), v_admin_id);

  v_first := trim(payload->>'first_name');
  v_last  := trim(payload->>'last_name');
  v_phone_raw := payload->>'phone';
  v_email := lower(nullif(trim(payload->>'email'),''));
  v_street := trim(payload->>'street');
  v_city   := trim(payload->>'city');
  v_state  := upper(coalesce(nullif(trim(payload->>'state'),''),'NC'));
  v_zip    := substring(regexp_replace(coalesce(payload->>'zip',''), '\D','','g') from 1 for 5);
  v_ami_tier_value := nullif(trim(payload->>'ami_tier'),'');
  v_notes := nullif(trim(payload->>'notes'),'');

  IF v_first IS NULL OR v_first='' OR v_last IS NULL OR v_last='' THEN
    RETURN jsonb_build_object('status','error','message','First and last name are required.');
  END IF;
  v_phone := regexp_replace(coalesce(v_phone_raw,''), '\D','','g');
  IF length(v_phone)=11 AND left(v_phone,1)='1' THEN v_phone := substring(v_phone from 2); END IF;
  IF length(v_phone) <> 10 THEN RETURN jsonb_build_object('status','error','message','Phone must be a 10-digit US number.'); END IF;
  IF v_email IS NULL THEN RETURN jsonb_build_object('status','error','message','Email is required to send the scheduling link.'); END IF;
  IF v_street IS NULL OR v_street='' THEN RETURN jsonb_build_object('status','error','message','Street address is required.'); END IF;
  IF v_zip !~ '^\d{5}$' THEN RETURN jsonb_build_object('status','error','message','ZIP must be 5 digits.'); END IF;

  SELECT id INTO v_property_rt FROM picklist_values WHERE picklist_object='properties' AND picklist_field='record_type' AND picklist_value='single_family' AND picklist_is_active LIMIT 1;
  SELECT id INTO v_building_rt FROM picklist_values WHERE picklist_object='buildings' AND picklist_field='record_type' AND picklist_value='single_family' AND picklist_is_active LIMIT 1;
  SELECT id INTO v_project_rt FROM picklist_values WHERE picklist_object='projects' AND picklist_field='record_type' AND picklist_value='single_family_energy_assessment' AND picklist_is_active LIMIT 1;
  SELECT id INTO v_opp_rt FROM picklist_values WHERE picklist_object='opportunities' AND picklist_field='record_type' AND picklist_value='nc_ira_sf_homes_audit' AND picklist_is_active LIMIT 1;
  SELECT id INTO v_stage_id FROM picklist_values WHERE picklist_object='opportunities' AND picklist_field='opportunity_stage' AND picklist_value='Opportunity — NC SF HOMES Audit: Site Visit To Be Scheduled' AND picklist_is_active LIMIT 1;
  IF v_ami_tier_value IS NOT NULL THEN
    SELECT id INTO v_ami_tier_id FROM picklist_values WHERE picklist_object='opportunities' AND picklist_field='opportunity_ami_tier' AND picklist_value=v_ami_tier_value AND picklist_is_active LIMIT 1;
  END IF;

  -- Account/contact dedup by phone.
  SELECT id, contact_account_id INTO v_contact_id, v_account_id
    FROM contacts WHERE contact_phone=v_phone AND coalesce(contact_is_deleted,false)=false LIMIT 1;

  IF v_contact_id IS NULL THEN
    INSERT INTO accounts (account_record_number, account_name, account_phone, account_email, account_owner,
                          account_created_at, account_created_by, account_updated_at, account_updated_by)
    VALUES ('', trim(v_first || ' ' || v_last), v_phone, v_email, v_actor,
            now(), v_actor, now(), v_actor)
    RETURNING id INTO v_account_id;
    v_created_account := true;

    INSERT INTO contacts (contact_record_number, contact_name, contact_first_name, contact_last_name,
                          contact_phone, contact_email, contact_account_id, contact_mailing_state, contact_owner,
                          contact_created_at, contact_created_by, contact_updated_at, contact_updated_by)
    VALUES ('', trim(v_first || ' ' || v_last), v_first, v_last,
            v_phone, v_email, v_account_id, v_state, v_actor,
            now(), v_actor, now(), v_actor)
    RETURNING id INTO v_contact_id;
  END IF;

  -- Property (single-family), deduped by account + street + zip.
  SELECT id INTO v_property_id FROM properties
   WHERE property_account_id = v_account_id
     AND lower(coalesce(property_street,'')) = lower(v_street)
     AND coalesce(property_zip,'') = v_zip
     AND coalesce(property_is_deleted,false) = false
   ORDER BY property_created_at DESC LIMIT 1;
  IF v_property_id IS NULL THEN
    INSERT INTO properties (property_record_number, property_name, property_street, property_city,
                            property_state, property_zip, property_account_id, property_record_type, property_owner,
                            property_created_at, property_created_by, property_updated_at, property_updated_by)
    VALUES ('', v_street, v_street, v_city, v_state, v_zip, v_account_id, v_property_rt, v_actor,
            now(), v_actor, now(), v_actor)
    RETURNING id INTO v_property_id;
  END IF;

  -- Building (single-family) — one per property; created from the street number.
  SELECT id INTO v_building_id FROM buildings
   WHERE property_id = v_property_id AND coalesce(building_is_deleted,false)=false
   ORDER BY building_created_at ASC LIMIT 1;
  IF v_building_id IS NULL THEN
    INSERT INTO buildings (building_record_number, building_name, building_number_or_name,
                           property_id, building_record_type, building_owner,
                           building_created_at, building_created_by, building_updated_at, building_updated_by)
    VALUES ('', v_street, 'Main', v_property_id, v_building_rt, v_actor,
            now(), v_actor, now(), v_actor)
    RETURNING id INTO v_building_id;
  END IF;

  -- Opportunity: NC single-family HOMES audit, first stage, optional AMI tier.
  INSERT INTO opportunities (opportunity_record_number, opportunity_name,
                             opportunity_account_id, property_id, building_id,
                             opportunity_record_type, opportunity_stage, opportunity_ami_tier, opportunity_state,
                             opportunity_owner,
                             opportunity_created_at, opportunity_created_by, opportunity_updated_at, opportunity_updated_by)
  VALUES ('', trim(v_first || ' ' || v_last) || ' — ' || v_street,
          v_account_id, v_property_id, v_building_id,
          v_opp_rt, v_stage_id, v_ami_tier_id, v_state,
          v_actor,
          now(), v_actor, now(), v_actor)
  RETURNING id, opportunity_record_number INTO v_opportunity_id, v_opp_record_number;

  -- Project: single-family energy assessment.
  INSERT INTO projects (project_record_number, project_name,
                        project_account_id, opportunity_id, property_id, building_id, project_record_type, project_owner,
                        project_created_at, project_created_by, project_updated_at, project_updated_by)
  VALUES ('', trim(v_first || ' ' || v_last) || ' — assessment',
          v_account_id, v_opportunity_id, v_property_id, v_building_id, v_project_rt, v_actor,
          now(), v_actor, now(), v_actor)
  RETURNING id INTO v_project_id;

  RETURN jsonb_build_object(
    'status','ok',
    'created_account', v_created_account,
    'account_id', v_account_id,
    'contact_id', v_contact_id,
    'property_id', v_property_id,
    'building_id', v_building_id,
    'opportunity_id', v_opportunity_id,
    'project_id', v_project_id,
    'opportunity_record_number', v_opp_record_number,
    'prefill', jsonb_build_object(
      'first', v_first, 'last', v_last, 'email', v_email, 'phone', v_phone,
      'street', v_street, 'city', v_city, 'state', v_state, 'zip', v_zip
    )
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','error','message',SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_homes_intake(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_homes_intake(jsonb) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
