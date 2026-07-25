-- =====================================================================
-- create_assessment_work_order: property dedup goes GLOBAL + normalized
-- (Nicholas, 2026-07-22). A property is a physical place — when the
-- entered address matches an existing property by normalized street +
-- ZIP5 (regardless of account, case, or abbreviation), REUSE it instead
-- of creating a twin. The per-account check let "400 s Tryon St" slip in
-- next to "400 S Tryon St" under a different account.
-- Only the property-resolution block changes; everything else is
-- byte-identical to the prior version.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_assessment_work_order(
  p_account_id        uuid DEFAULT NULL,
  p_new_account_name  text DEFAULT NULL,
  p_property_id       uuid DEFAULT NULL,
  p_new_street        text DEFAULT NULL,
  p_new_city          text DEFAULT NULL,
  p_new_state         text DEFAULT NULL,
  p_new_zip           text DEFAULT NULL,
  p_building_id       uuid DEFAULT NULL,
  p_new_building_type text DEFAULT NULL,
  p_unit_id           uuid DEFAULT NULL,
  p_new_unit_name     text DEFAULT NULL
)
RETURNS TABLE(work_order_id uuid, record_number text, outcome text, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor   uuid := public.current_app_user_id();
  v_wt      public.work_types;
  v_acct    uuid := p_account_id;
  v_prop    public.properties;
  v_bld     uuid := p_building_id;
  v_bld_rt  text;
  v_unit    uuid := p_unit_id;
  v_unit_label text;
  v_opp     uuid;
  v_proj    public.projects;
  v_status  uuid;
  v_sa_status uuid;
  v_new     uuid;
  v_rn      text;
  v_sa      uuid;
  v_created text[] := ARRAY[]::text[];
  v_pc      uuid := public._resolve_field_review_coordinator();
BEGIN
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Not authenticated.'; RETURN;
  END IF;

  SELECT * INTO v_wt FROM public.work_types
   WHERE work_type_name = 'Single-Family Energy Assessment'
     AND work_type_is_deleted IS NOT TRUE AND work_type_is_active IS TRUE
   ORDER BY work_type_created_at LIMIT 1;
  IF v_wt.id IS NULL OR v_wt.work_type_default_work_plan_template_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'The Single-Family Energy Assessment work type is not configured.'; RETURN;
  END IF;

  IF v_acct IS NOT NULL THEN
    PERFORM 1 FROM public.accounts WHERE id = v_acct AND account_is_deleted IS NOT TRUE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Account not found.'; RETURN;
    END IF;
  ELSIF nullif(trim(coalesce(p_new_account_name,'')), '') IS NOT NULL THEN
    NULL; -- created below only if the address is genuinely new
  ELSIF p_property_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Select the account, or enter a new account name.'; RETURN;
  END IF;

  IF p_property_id IS NOT NULL THEN
    SELECT * INTO v_prop FROM public.properties WHERE id = p_property_id AND property_is_deleted IS NOT TRUE;
    IF v_prop.id IS NULL THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Property not found.'; RETURN;
    END IF;
  ELSE
    IF nullif(trim(coalesce(p_new_street,'')),'') IS NULL OR nullif(trim(coalesce(p_new_city,'')),'') IS NULL
       OR nullif(trim(coalesce(p_new_state,'')),'') IS NULL OR nullif(trim(coalesce(p_new_zip,'')),'') IS NULL THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Enter the full address — street, city, state, and ZIP.'; RETURN;
    END IF;
    -- GLOBAL dedup: a physical address exists once, regardless of account,
    -- letter case, or abbreviation ("400 s Tryon St" == "400 South Tryon Street").
    SELECT * INTO v_prop FROM public.properties
     WHERE property_is_deleted IS NOT TRUE
       AND public.normalize_street_address(property_street) = public.normalize_street_address(trim(p_new_street))
       AND left(trim(property_zip),5) = left(trim(p_new_zip),5)
     ORDER BY is_seed_data ASC, property_created_at ASC
     LIMIT 1;
    IF v_prop.id IS NULL THEN
      -- Genuinely new address — now the account matters: create it if needed.
      IF v_acct IS NULL THEN
        INSERT INTO public.accounts (account_record_number, account_name, account_owner, account_created_by, account_record_type)
        VALUES ('', trim(p_new_account_name), v_actor, v_actor,
                (SELECT id FROM public.picklist_values WHERE picklist_object='accounts' AND picklist_field='record_type' AND picklist_value='property_owner'))
        RETURNING id INTO v_acct;
        v_created := array_append(v_created, format('account "%s"', trim(p_new_account_name)));
      END IF;
      INSERT INTO public.properties (property_record_number, property_name, property_owner, property_created_by,
                                     property_account_id, property_street, property_city, property_state, property_zip)
      VALUES ('', trim(p_new_street), v_actor, v_actor, v_acct,
              trim(p_new_street), trim(p_new_city), upper(trim(p_new_state)), trim(p_new_zip))
      RETURNING * INTO v_prop;
      v_created := array_append(v_created, format('property "%s"', v_prop.property_name));
    END IF;
  END IF;
  v_acct := v_prop.property_account_id;

  IF v_bld IS NOT NULL THEN
    PERFORM 1 FROM public.buildings WHERE id = v_bld AND property_id = v_prop.id AND building_is_deleted IS NOT TRUE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Building does not belong to this property.'; RETURN;
    END IF;
  ELSE
    IF p_new_building_type NOT IN ('single_family_detached','single_family_attached') THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Choose the building type — Single Family Detached or Single Family Attached.'; RETURN;
    END IF;
    INSERT INTO public.buildings (building_record_number, building_name, building_owner, building_created_by,
                                  property_id, building_number_or_name, building_record_type)
    VALUES ('', 'Building', v_actor, v_actor, v_prop.id,
            coalesce(nullif(split_part(coalesce(v_prop.property_street,''), ' ', 1), ''), '1'),
            (SELECT id FROM public.picklist_values WHERE picklist_object='buildings' AND picklist_field='record_type' AND picklist_value=p_new_building_type))
    RETURNING id INTO v_bld;
    v_created := array_append(v_created, 'a building');
  END IF;

  SELECT pv.picklist_value INTO v_bld_rt
  FROM public.buildings b LEFT JOIN public.picklist_values pv ON pv.id = b.building_record_type
  WHERE b.id = v_bld;

  IF v_bld_rt = 'single_family_detached' THEN
    v_unit := NULL; v_unit_label := NULL;
  ELSIF v_unit IS NOT NULL THEN
    SELECT u.unit_number INTO v_unit_label FROM public.units u
     WHERE u.id = v_unit AND u.building_id = v_bld AND u.unit_is_deleted IS NOT TRUE;
    IF v_unit_label IS NULL THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Unit does not belong to this building.'; RETURN;
    END IF;
  ELSIF nullif(trim(coalesce(p_new_unit_name,'')), '') IS NOT NULL THEN
    v_unit_label := trim(p_new_unit_name);
    INSERT INTO public.units (unit_record_number, unit_name, unit_owner, unit_created_by, building_id, unit_number)
    VALUES ('', v_unit_label, v_actor, v_actor, v_bld, v_unit_label)
    RETURNING id INTO v_unit;
    v_created := array_append(v_created, format('unit "%s"', v_unit_label));
  ELSIF v_bld_rt = 'single_family_attached' THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Select or enter the unit — each attached home is a unit.'; RETURN;
  END IF;

  SELECT o.id INTO v_opp FROM public.opportunities o
   WHERE o.property_id = v_prop.id AND o.opportunity_is_deleted IS NOT TRUE
     AND o.opportunity_record_type = (SELECT id FROM public.picklist_values
           WHERE picklist_object='opportunities' AND picklist_field='record_type' AND picklist_value='single_family_energy_assessment')
   ORDER BY o.opportunity_created_at DESC LIMIT 1;
  IF v_opp IS NULL THEN
    INSERT INTO public.opportunities (
      opportunity_record_number, opportunity_name, opportunity_owner, opportunity_created_by,
      property_id, building_id, opportunity_account_id, opportunity_record_type, opportunity_stage
    ) VALUES (
      '', coalesce(nullif(v_prop.property_name,''), v_prop.property_record_number) || ' - Single-Family Energy Assessment',
      v_actor, v_actor, v_prop.id, v_bld, v_acct,
      (SELECT id FROM public.picklist_values WHERE picklist_object='opportunities' AND picklist_field='record_type' AND picklist_value='single_family_energy_assessment'),
      (SELECT id FROM public.picklist_values WHERE picklist_object='opportunities' AND picklist_field='opportunity_stage' AND picklist_value='Opportunity — Single-Family Assessment Open')
    ) RETURNING id INTO v_opp;
    v_created := array_append(v_created, 'an assessment opportunity');
  END IF;

  SELECT * INTO v_proj FROM public.projects
   WHERE property_id = v_prop.id AND project_is_deleted IS NOT TRUE
     AND project_record_type = (SELECT id FROM public.picklist_values
           WHERE picklist_object='projects' AND picklist_field='record_type' AND picklist_value='single_family_energy_assessment')
   ORDER BY project_created_at DESC LIMIT 1;
  IF v_proj.id IS NULL THEN
    INSERT INTO public.projects (
      project_record_number, project_name, project_owner, project_created_by,
      opportunity_id, property_id, building_id, project_account_id,
      project_record_type, project_status, project_description
    ) VALUES (
      '', coalesce(nullif(v_prop.property_name,''), v_prop.property_record_number) || ' - Single-Family Energy Assessment',
      v_actor, v_actor, v_opp, v_prop.id, v_bld, v_acct,
      (SELECT id FROM public.picklist_values WHERE picklist_object='projects' AND picklist_field='record_type' AND picklist_value='single_family_energy_assessment'),
      (SELECT id FROM public.picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Project Underway' AND picklist_is_active LIMIT 1),
      'Single-family energy assessment project created from LEAP Pad.'
    ) RETURNING * INTO v_proj;
    v_created := array_append(v_created, format('project %s', v_proj.project_record_number));
  END IF;

  SELECT id INTO v_status FROM public.picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='work_order_status'
     AND picklist_value='New' AND picklist_is_active LIMIT 1;
  SELECT id INTO v_sa_status FROM public.picklist_values
   WHERE picklist_object='service_appointments' AND picklist_field='sa_status'
     AND picklist_value='Scheduled' AND picklist_is_active LIMIT 1;

  INSERT INTO public.work_orders (
    work_order_record_number, work_order_name, work_order_owner, work_order_created_by,
    project_id, opportunity_id, property_id, building_id, unit_id, work_order_account_id,
    work_type_id, work_order_record_type, work_order_status, project_coordinator_id,
    work_order_subject, work_order_description, work_order_unit
  ) VALUES (
    '', v_wt.work_type_name || ' - ' || coalesce(nullif(v_prop.property_name,''), v_prop.property_record_number),
    v_actor, v_actor,
    v_proj.id, v_opp, v_prop.id, v_bld, v_unit, v_acct,
    v_wt.id, v_wt.work_type_default_work_order_record_type, v_status, v_pc,
    v_wt.work_type_name,
    'Single-family energy assessment created in the field from LEAP Pad.',
    v_unit_label
  ) RETURNING id, work_orders.work_order_record_number INTO v_new, v_rn;

  INSERT INTO public.service_appointments (
    sa_record_number, sa_name, sa_owner, sa_created_by,
    work_order_id, work_type_id, opportunity_id, project_id,
    sa_subject, sa_status, sa_scheduled_start_time, sa_scheduled_end_time
  ) VALUES (
    '', v_wt.work_type_name || ' - ' || coalesce(nullif(v_prop.property_name,''), 'new property'),
    v_actor, v_actor, v_new, v_wt.id, v_opp, v_proj.id,
    v_wt.work_type_name, v_sa_status, now(), now() + interval '3 hours'
  ) RETURNING id INTO v_sa;

  INSERT INTO public.service_appointment_assignments (
    saa_record_number, saa_name, saa_created_by, service_appointment_id, saa_user_id
  ) VALUES (
    '', v_wt.work_type_name || ' — field created', v_actor, v_sa, v_actor
  );

  IF array_length(v_created, 1) > 0 THEN
    PERFORM public._create_field_data_review_task(
      v_new, v_rn, v_prop.property_name, v_actor, array_to_string(v_created, ', '));
  END IF;

  RETURN QUERY SELECT v_new, v_rn, 'success',
    format('%s %s created at %s', v_wt.work_type_name, v_rn, coalesce(v_prop.property_name, 'property'));
END;
$function$;

REVOKE ALL ON FUNCTION public.create_assessment_work_order(uuid,text,uuid,text,text,text,text,uuid,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_assessment_work_order(uuid,text,uuid,text,text,text,text,uuid,text,uuid,text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
