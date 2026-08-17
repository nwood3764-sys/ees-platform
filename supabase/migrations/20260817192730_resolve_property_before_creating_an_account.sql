-- Field creation reuses the account, property and building that already exist.
--
-- Two duplicate sources, the second found by testing the first fix.
--
-- 1. create_mf_building_assessment_work_order looked up the property scoped to
--    the account it had just created, so the lookup could never match an
--    existing address and a duplicate property was always created; the building
--    was then INSERTed unconditionally. Both now go through the matchers from
--    20260817192519 (find_existing_property_at_address /
--    find_existing_building_on_property / find_existing_account_by_name).
--
-- 2. The account was created BEFORE the property was resolved. When the address
--    already existed, the property's own account won and the account just
--    created was orphaned - that is how junk owner records like "lucas Wood"
--    and "adfz" ended up attached to the 15008 Statesville Road duplicates. An
--    existing property already knows who owns it, so the typed owner name is not
--    needed at all in that case. The property is now resolved FIRST and an
--    account is only created when a genuinely new property is being created.
--
-- Also: normalize_duplicate_match_name() stripped "LLC" but not "L.L.C." - it
-- replaced every non-alphanumeric character with a space first, so the dotted
-- form became "L L C" and no longer matched the entity-suffix list. Dots are now
-- removed BEFORE other punctuation becomes whitespace, so "L.L.C.", "U.S.A." and
-- "A.B.C." collapse to single tokens ("St. Francis Housing Corp" still yields
-- "ST FRANCIS HOUSING", unmangled). This is the shared matcher behind
-- find_duplicate_candidates and the account near-miss report, so the manual
-- create-time duplicate warning gains the same coverage - it makes 153
-- duplicate account pairs detectable that were invisible before.
-- accounts_normalized_dup_name_idx is a functional index over it, so it is
-- reindexed.
CREATE OR REPLACE FUNCTION public.normalize_duplicate_match_name(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT NULLIF(trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        -- Dots go first so "L.L.C." becomes "LLC" rather than "L L C".
        replace(upper(coalesce(p_name, '')), '.', ''),
        '[^A-Z0-9 ]', ' ', 'g'),
      '\m(LLC|INC|INCORPORATED|LP|LLP|LTD|LIMITED PARTNERSHIP|LIMITED|CORP|CORPORATION|CO|COMPANY|THE)\M', '', 'g'),
    '\s+', ' ', 'g')), '')
$function$;

REINDEX INDEX public.accounts_normalized_dup_name_idx;

CREATE OR REPLACE FUNCTION public.create_mf_building_assessment_work_order(
  p_account_id uuid DEFAULT NULL::uuid, p_new_account_name text DEFAULT NULL::text,
  p_property_id uuid DEFAULT NULL::uuid, p_new_street text DEFAULT NULL::text,
  p_new_city text DEFAULT NULL::text, p_new_state text DEFAULT NULL::text,
  p_new_zip text DEFAULT NULL::text, p_building_id uuid DEFAULT NULL::uuid,
  p_new_building_name text DEFAULT NULL::text)
 RETURNS TABLE(work_order_id uuid, record_number text, outcome text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := public.current_app_user_id();
  v_wt    public.work_types;
  v_acct  uuid := p_account_id;
  v_prop  public.properties;
  v_found uuid;
  v_bld   uuid := p_building_id;
  v_bld_name text;
  v_opp   uuid;
  v_proj  public.projects;
  v_status uuid;
  v_sa_status uuid;
  v_new   uuid;
  v_rn    text;
  v_sa    uuid;
  v_created text[] := ARRAY[]::text[];
  v_reused  text[] := ARRAY[]::text[];
  v_pc    uuid := public._resolve_field_review_coordinator();
BEGIN
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Not authenticated.'; RETURN;
  END IF;

  SELECT * INTO v_wt FROM public.work_types
   WHERE work_type_name = 'Multifamily Energy Assessment'
     AND work_type_is_deleted IS NOT TRUE AND work_type_is_active IS TRUE
   ORDER BY work_type_created_at LIMIT 1;
  IF v_wt.id IS NULL OR v_wt.work_type_default_work_plan_template_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'The Multifamily Energy Assessment work type is not configured.'; RETURN;
  END IF;

  IF v_acct IS NOT NULL THEN
    PERFORM 1 FROM public.accounts WHERE id = v_acct AND account_is_deleted IS NOT TRUE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Account not found.'; RETURN;
    END IF;
  END IF;

  -- PROPERTY FIRST. Identified by its address, not by who was typed as owner.
  IF p_property_id IS NOT NULL THEN
    SELECT * INTO v_prop FROM public.properties WHERE id = p_property_id AND property_is_deleted IS NOT TRUE;
    IF v_prop.id IS NULL THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Property not found.'; RETURN;
    END IF;
  ELSE
    IF nullif(trim(coalesce(p_new_street,'')),'') IS NULL OR nullif(trim(coalesce(p_new_city,'')),'') IS NULL
       OR nullif(trim(coalesce(p_new_state,'')),'') IS NULL OR nullif(trim(coalesce(p_new_zip,'')),'') IS NULL THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Enter the full address - street, city, state, and ZIP.'; RETURN;
    END IF;
    v_found := public.find_existing_property_at_address(p_new_street, p_new_zip, p_new_city);
    IF v_found IS NOT NULL THEN
      SELECT * INTO v_prop FROM public.properties WHERE id = v_found;
      v_reused := array_append(v_reused, format('property %s', v_prop.property_record_number));
    ELSE
      -- Only NOW is an account needed: this really is a new property.
      IF v_acct IS NULL AND nullif(trim(coalesce(p_new_account_name,'')), '') IS NOT NULL THEN
        v_acct := public.find_existing_account_by_name(p_new_account_name);
        IF v_acct IS NOT NULL THEN
          v_reused := array_append(v_reused, format('account "%s"', trim(p_new_account_name)));
        ELSE
          INSERT INTO public.accounts (account_record_number, account_name, account_owner, account_created_by, account_record_type)
          VALUES ('', trim(p_new_account_name), v_actor, v_actor,
                  (SELECT id FROM public.picklist_values WHERE picklist_object='accounts' AND picklist_field='record_type' AND picklist_value='property_owner'))
          RETURNING id INTO v_acct;
          v_created := array_append(v_created, format('account "%s"', trim(p_new_account_name)));
        END IF;
      END IF;
      IF v_acct IS NULL THEN
        RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Select the building owner, or enter a new owner name.'; RETURN;
      END IF;
      INSERT INTO public.properties (property_record_number, property_name, property_owner, property_created_by,
                                     property_account_id, property_street, property_city, property_state, property_zip)
      VALUES ('', trim(p_new_street), v_actor, v_actor, v_acct,
              trim(p_new_street), trim(p_new_city), upper(trim(p_new_state)), trim(p_new_zip))
      RETURNING * INTO v_prop;
      v_created := array_append(v_created, format('property "%s"', v_prop.property_name));
    END IF;
  END IF;
  -- An existing property already knows its owner; that always wins.
  v_acct := coalesce(v_prop.property_account_id, v_acct);

  IF v_bld IS NOT NULL THEN
    PERFORM 1 FROM public.buildings WHERE id = v_bld AND property_id = v_prop.id AND building_is_deleted IS NOT TRUE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Building does not belong to this property.'; RETURN;
    END IF;
  ELSE
    v_bld_name := coalesce(nullif(trim(coalesce(p_new_building_name,'')),''),
                           nullif(split_part(coalesce(v_prop.property_street,''), ' ', 1), ''), 'Building');
    v_bld := public.find_existing_building_on_property(v_prop.id, v_bld_name);
    IF v_bld IS NOT NULL THEN
      v_reused := array_append(v_reused, format('building "%s"', v_bld_name));
    ELSE
      INSERT INTO public.buildings (building_record_number, building_name, building_owner, building_created_by,
                                    property_id, building_number_or_name, building_record_type)
      VALUES ('', v_bld_name, v_actor, v_actor, v_prop.id, v_bld_name,
              (SELECT id FROM public.picklist_values WHERE picklist_object='buildings' AND picklist_field='record_type' AND picklist_value='MULTIFAMILY'))
      RETURNING id INTO v_bld;
      v_created := array_append(v_created, format('building "%s"', v_bld_name));
    END IF;
  END IF;

  SELECT o.id INTO v_opp FROM public.opportunities o
   WHERE o.property_id = v_prop.id AND o.opportunity_is_deleted IS NOT TRUE
     AND o.opportunity_record_type = (SELECT id FROM public.picklist_values
           WHERE picklist_object='opportunities' AND picklist_field='record_type' AND picklist_value='MULTIFAMILY-ENERGY-ASSESSMENT')
   ORDER BY o.opportunity_created_at DESC LIMIT 1;
  IF v_opp IS NULL THEN
    INSERT INTO public.opportunities (
      opportunity_record_number, opportunity_name, opportunity_owner, opportunity_created_by,
      property_id, building_id, opportunity_account_id, opportunity_record_type, opportunity_stage
    ) VALUES (
      '', '', v_actor, v_actor, v_prop.id, v_bld, v_acct,
      (SELECT id FROM public.picklist_values WHERE picklist_object='opportunities' AND picklist_field='record_type' AND picklist_value='MULTIFAMILY-ENERGY-ASSESSMENT'),
      (SELECT id FROM public.picklist_values WHERE picklist_object='opportunities' AND picklist_field='opportunity_stage' AND picklist_value='Opportunity — Multifamily Assessment Open')
    ) RETURNING id INTO v_opp;
    v_created := array_append(v_created, 'an assessment opportunity');
  END IF;

  SELECT * INTO v_proj FROM public.projects
   WHERE property_id = v_prop.id AND project_is_deleted IS NOT TRUE
     AND project_record_type = (SELECT id FROM public.picklist_values
           WHERE picklist_object='projects' AND picklist_field='record_type' AND picklist_value='MULTIFAMILY-ENERGY-ASSESSMENT')
   ORDER BY project_created_at DESC LIMIT 1;
  IF v_proj.id IS NULL THEN
    INSERT INTO public.projects (
      project_record_number, project_name, project_owner, project_created_by,
      opportunity_id, property_id, building_id, project_account_id,
      project_record_type, project_status, project_description
    ) VALUES (
      '', '', v_actor, v_actor, v_opp, v_prop.id, v_bld, v_acct,
      (SELECT id FROM public.picklist_values WHERE picklist_object='projects' AND picklist_field='record_type' AND picklist_value='MULTIFAMILY-ENERGY-ASSESSMENT'),
      (SELECT id FROM public.picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Project Underway' AND picklist_is_active LIMIT 1),
      'Multifamily building energy assessment project created from LEAP Pad.'
    ) RETURNING * INTO v_proj;
    v_created := array_append(v_created, format('project %s', v_proj.project_record_number));
  END IF;

  SELECT id INTO v_status FROM public.picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='work_order_status' AND picklist_value='New' AND picklist_is_active LIMIT 1;
  SELECT id INTO v_sa_status FROM public.picklist_values
   WHERE picklist_object='service_appointments' AND picklist_field='sa_status' AND picklist_value='Scheduled' AND picklist_is_active LIMIT 1;

  INSERT INTO public.work_orders (
    work_order_record_number, work_order_name, work_order_owner, work_order_created_by,
    project_id, opportunity_id, property_id, building_id, unit_id, work_order_account_id,
    work_type_id, work_order_record_type, work_order_status, project_coordinator_id,
    work_order_subject, work_order_description
  ) VALUES (
    '', '', v_actor, v_actor,
    v_proj.id, v_opp, v_prop.id, v_bld, NULL, v_acct,
    v_wt.id, v_wt.work_type_default_work_order_record_type, v_status, v_pc,
    v_wt.work_type_name,
    'Multifamily building energy assessment created in the field from LEAP Pad.'
  ) RETURNING id, work_orders.work_order_record_number INTO v_new, v_rn;

  INSERT INTO public.service_appointments (
    sa_record_number, sa_name, sa_owner, sa_created_by,
    work_order_id, work_type_id, opportunity_id, project_id,
    sa_subject, sa_status, sa_scheduled_start_time, sa_scheduled_end_time
  ) VALUES (
    '', '', v_actor, v_actor, v_new, v_wt.id, v_opp, v_proj.id,
    v_wt.work_type_name, v_sa_status, now(), now() + interval '3 hours'
  ) RETURNING id INTO v_sa;

  INSERT INTO public.service_appointment_assignments (
    saa_record_number, saa_name, saa_created_by, service_appointment_id, saa_user_id
  ) VALUES ('', '', v_actor, v_sa, v_actor);

  IF array_length(v_created, 1) > 0 THEN
    PERFORM public._create_field_data_review_task(
      v_new, v_rn, v_prop.property_name, v_actor, array_to_string(v_created, ', '));
  END IF;

  RETURN QUERY SELECT v_new, v_rn, 'success',
    format('%s %s created at %s%s', v_wt.work_type_name, v_rn, coalesce(v_prop.property_name, 'property'),
           CASE WHEN array_length(v_reused,1) > 0
                THEN ' (reused existing ' || array_to_string(v_reused, ', ') || ')'
                ELSE '' END);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_mf_building_assessment_work_order(uuid, text, uuid, text, text, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_mf_building_assessment_work_order(uuid, text, uuid, text, text, text, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_mf_building_assessment_work_order(uuid, text, uuid, text, text, text, text, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
