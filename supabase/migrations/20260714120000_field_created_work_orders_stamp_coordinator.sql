-- =====================================================================
-- Field-created work orders carry the resolved Project Coordinator
-- (Nicholas, 2026-07-14).
--
-- Both technician-create RPCs now stamp `project_coordinator_id` on the
-- new work order via `_resolve_field_review_coordinator()` (role holder
-- first, designated acting coordinator — Brittin Wood — second), so the
-- existing To Be Verified review-task trigger
-- (`create_work_order_review_task`, routes to project_coordinator_id
-- with fallback to the WO owner) reaches the coordinator instead of the
-- creating technician. The scheduled-stop clone path inherits the
-- source work order's coordinator first. Everything else in both
-- function bodies is unchanged from 20260714100000.
--
-- Applied to production 2026-07-14 via MCP; verified in a rolled-back
-- probe (ad hoc WO → project_coordinator_id = Brittin Wood, review task
-- + in-app notification to her).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_technician_work_order_for_property(
  p_work_type_id uuid,
  p_property_id uuid,
  p_building_id uuid DEFAULT NULL,
  p_unit_id uuid DEFAULT NULL,
  p_new_unit_name text DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_create_project boolean DEFAULT false
)
 RETURNS TABLE(work_order_id uuid, record_number text, outcome text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor  uuid := public.current_app_user_id();
  v_prop   public.properties;
  v_wt     public.work_types;
  v_bld    uuid := p_building_id;
  v_unit   uuid := p_unit_id;
  v_unit_label text;
  v_proj   public.projects;
  v_opp    uuid;
  v_status uuid;
  v_sa_status uuid;
  v_new    uuid;
  v_rn     text;
  v_sa     uuid;
  v_created text[] := ARRAY[]::text[];
  v_pc     uuid := public._resolve_field_review_coordinator();
BEGIN
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Not authenticated.'; RETURN;
  END IF;

  SELECT * INTO v_prop FROM public.properties
   WHERE id = p_property_id AND property_is_deleted IS NOT TRUE;
  IF v_prop.id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Property not found.'; RETURN;
  END IF;

  SELECT * INTO v_wt FROM public.work_types
   WHERE id = p_work_type_id AND work_type_is_deleted IS NOT TRUE;
  IF v_wt.id IS NULL OR v_wt.work_type_is_active IS NOT TRUE
     OR v_wt.work_type_is_technician_creatable IS NOT TRUE
     OR v_wt.work_type_default_work_plan_template_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Work type not available for field creation.'; RETURN;
  END IF;

  -- Building: explicit selection; when the property has none at all, one is
  -- created from the street number (building naming convention).
  IF v_bld IS NOT NULL THEN
    PERFORM 1 FROM public.buildings WHERE id = v_bld AND property_id = p_property_id AND building_is_deleted IS NOT TRUE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Building does not belong to this property.'; RETURN;
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.buildings WHERE property_id = p_property_id AND building_is_deleted IS NOT TRUE) THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Select the building.'; RETURN;
    END IF;
    INSERT INTO public.buildings (building_record_number, building_name, building_owner, building_created_by,
                                  property_id, building_number_or_name)
    VALUES ('', 'Building', v_actor, v_actor, p_property_id,
            coalesce(nullif(split_part(coalesce(v_prop.property_street,''), ' ', 1), ''), '1'))
    RETURNING id INTO v_bld;
    v_created := array_append(v_created, 'a building');
  END IF;

  -- Unit: required on every work order. Pick one, or type a new name and it
  -- is created on the building.
  IF v_unit IS NOT NULL THEN
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
  ELSE
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Select or enter the unit — every work order carries a unit.'; RETURN;
  END IF;

  -- Project: explicit selection, or Create New Project (Field Documentation
  -- under the property's Field Operations opportunity).
  IF p_project_id IS NOT NULL THEN
    SELECT * INTO v_proj FROM public.projects
     WHERE id = p_project_id AND property_id = p_property_id AND project_is_deleted IS NOT TRUE;
    IF v_proj.id IS NULL THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Project does not belong to this property.'; RETURN;
    END IF;
  ELSIF p_create_project THEN
    SELECT o.id INTO v_opp FROM public.opportunities o
     WHERE o.property_id = p_property_id AND o.opportunity_is_deleted IS NOT TRUE
       AND o.opportunity_record_type = (SELECT id FROM public.picklist_values
             WHERE picklist_object='opportunities' AND picklist_field='record_type' AND picklist_value='field_operations')
     ORDER BY o.opportunity_created_at DESC LIMIT 1;
    IF v_opp IS NULL THEN
      INSERT INTO public.opportunities (
        opportunity_record_number, opportunity_name, opportunity_owner, opportunity_created_by,
        property_id, building_id, opportunity_account_id, opportunity_record_type, opportunity_stage
      ) VALUES (
        '', coalesce(nullif(v_prop.property_name,''), v_prop.property_record_number) || ' - Field Operations',
        v_actor, v_actor, p_property_id, v_bld, v_prop.property_account_id,
        (SELECT id FROM public.picklist_values WHERE picklist_object='opportunities' AND picklist_field='record_type' AND picklist_value='field_operations'),
        (SELECT id FROM public.picklist_values WHERE picklist_object='opportunities' AND picklist_field='opportunity_stage' AND picklist_value='Opportunity — Field Operations Open')
      ) RETURNING id INTO v_opp;
      v_created := array_append(v_created, 'a Field Operations opportunity');
    END IF;
    INSERT INTO public.projects (
      project_record_number, project_name, project_owner, project_created_by,
      opportunity_id, property_id, building_id, project_account_id,
      project_record_type, project_status, project_description
    ) VALUES (
      '', coalesce(nullif(v_prop.property_name,''), v_prop.property_record_number) || ' - Field Documentation',
      v_actor, v_actor, v_opp, p_property_id, v_bld, v_prop.property_account_id,
      (SELECT id FROM public.picklist_values WHERE picklist_object='projects' AND picklist_field='record_type' AND picklist_value='field_documentation'),
      (SELECT id FROM public.picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Project Underway' AND picklist_is_active LIMIT 1),
      'Field documentation project created from LEAP Pad for ad hoc field-created work orders.'
    ) RETURNING * INTO v_proj;
    v_created := array_append(v_created, format('project %s', v_proj.project_record_number));
  ELSE
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Select the project, or choose Create New Project.'; RETURN;
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
    v_proj.id, v_proj.opportunity_id, p_property_id, v_bld, v_unit, v_prop.property_account_id,
    v_wt.id, v_wt.work_type_default_work_order_record_type, v_status, v_pc,
    v_wt.work_type_name,
    format('%s — created ad hoc in the field at %s.', v_wt.work_type_name, coalesce(v_prop.property_name, 'the property')),
    v_unit_label
  ) RETURNING id, work_orders.work_order_record_number INTO v_new, v_rn;

  INSERT INTO public.service_appointments (
    sa_record_number, sa_name, sa_owner, sa_created_by,
    work_order_id, work_type_id, opportunity_id, project_id,
    sa_subject, sa_status, sa_scheduled_start_time, sa_scheduled_end_time
  ) VALUES (
    '', v_wt.work_type_name || ' - ' || coalesce(nullif(v_prop.property_name,''), 'ad hoc'),
    v_actor, v_actor, v_new, v_wt.id, v_proj.opportunity_id, v_proj.id,
    v_wt.work_type_name, v_sa_status, now(), now() + interval '8 hours'
  ) RETURNING id INTO v_sa;

  INSERT INTO public.service_appointment_assignments (
    saa_record_number, saa_name, saa_created_by, service_appointment_id, saa_user_id
  ) VALUES (
    '', v_wt.work_type_name || ' — ad hoc field created', v_actor, v_sa, v_actor
  );

  IF array_length(v_created, 1) > 0 THEN
    PERFORM public._create_field_data_review_task(
      v_new, v_rn, v_prop.property_name, v_actor, array_to_string(v_created, ', '));
  END IF;

  RETURN QUERY SELECT v_new, v_rn, 'success',
    format('%s %s created at %s', v_wt.work_type_name, v_rn, coalesce(v_prop.property_name, 'property'));
END;
$function$;

REVOKE ALL ON FUNCTION public.create_technician_work_order_for_property(uuid, uuid, uuid, uuid, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_technician_work_order_for_property(uuid, uuid, uuid, uuid, text, uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_technician_work_order(p_source_work_order_id uuid, p_work_type_id uuid)
 RETURNS TABLE(work_order_id uuid, record_number text, outcome text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor  uuid := public.current_app_user_id();
  v_src    public.work_orders;
  v_wt     public.work_types;
  v_status uuid;
  v_sa_status uuid;
  v_new    uuid;
  v_rn     text;
  v_sa     uuid;
BEGIN
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Not authenticated.'; RETURN;
  END IF;

  SELECT * INTO v_src FROM public.work_orders
   WHERE id = p_source_work_order_id AND work_order_is_deleted IS NOT TRUE;
  IF v_src.id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Source work order not found.'; RETURN;
  END IF;

  SELECT * INTO v_wt FROM public.work_types
   WHERE id = p_work_type_id AND work_type_is_deleted IS NOT TRUE;
  IF v_wt.id IS NULL OR v_wt.work_type_is_active IS NOT TRUE THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Work type not found or inactive.'; RETURN;
  END IF;
  IF v_wt.work_type_is_technician_creatable IS NOT TRUE THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error',
      format('%s is not a technician-creatable work type.', v_wt.work_type_name); RETURN;
  END IF;
  IF v_wt.work_type_default_work_plan_template_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error',
      format('%s has no default work plan template — configure it in LEAP Admin first.', v_wt.work_type_name); RETURN;
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
    '', v_wt.work_type_name || ' - ' || coalesce(nullif(v_src.work_order_building,''), nullif(v_src.work_order_property_name,''), v_src.work_order_record_number),
    v_actor, v_actor,
    v_src.project_id, v_src.opportunity_id, v_src.property_id, v_src.building_id, v_src.unit_id, v_src.work_order_account_id,
    v_wt.id, v_wt.work_type_default_work_order_record_type, v_status,
    coalesce(v_src.project_coordinator_id, public._resolve_field_review_coordinator()),
    v_wt.work_type_name,
    format('%s — created in the field from %s.', v_wt.work_type_name, v_src.work_order_record_number),
    v_src.work_order_unit
  ) RETURNING id, work_orders.work_order_record_number INTO v_new, v_rn;

  INSERT INTO public.service_appointments (
    sa_record_number, sa_name, sa_owner, sa_created_by,
    work_order_id, work_type_id, opportunity_id, project_id,
    sa_subject, sa_status, sa_scheduled_start_time, sa_scheduled_end_time
  ) VALUES (
    '', v_wt.work_type_name || ' - ' || coalesce(nullif(v_src.work_order_building,''), 'field created'),
    v_actor, v_actor, v_new, v_wt.id, v_src.opportunity_id, v_src.project_id,
    v_wt.work_type_name, v_sa_status, now(), now() + interval '8 hours'
  ) RETURNING id INTO v_sa;

  INSERT INTO public.service_appointment_assignments (
    saa_record_number, saa_name, saa_created_by, service_appointment_id, saa_user_id
  ) VALUES (
    '', v_wt.work_type_name || ' — field created', v_actor, v_sa, v_actor
  );

  RETURN QUERY SELECT v_new, v_rn, 'success',
    format('%s %s created', v_wt.work_type_name, v_rn);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_technician_work_order(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_technician_work_order(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
