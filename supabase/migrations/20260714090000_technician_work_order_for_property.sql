-- =====================================================================
-- Ad hoc field-created work orders on an unscheduled property
-- (Nicholas, 2026-07-14). Some field events happen outside any
-- scheduled stop. The Create Work Order flow gains a property search;
-- the new work order attaches to the property's MOST RECENT project
-- (and that project's opportunity/building/account). If the property
-- has no project in LEAP, creation is refused with a clear message —
-- field technicians do not fabricate CRM chains.
--
-- Applied to production 2026-07-14 via MCP.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_technician_work_order_for_property(p_property_id uuid, p_work_type_id uuid)
 RETURNS TABLE(work_order_id uuid, record_number text, outcome text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor  uuid := public.current_app_user_id();
  v_prop   public.properties;
  v_proj   public.projects;
  v_wt     public.work_types;
  v_status uuid;
  v_sa_status uuid;
  v_bld_name text;
  v_new    uuid;
  v_rn     text;
  v_sa     uuid;
BEGIN
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Not authenticated.'; RETURN;
  END IF;

  SELECT * INTO v_prop FROM public.properties
   WHERE id = p_property_id AND property_is_deleted IS NOT TRUE;
  IF v_prop.id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error', 'Property not found.'; RETURN;
  END IF;

  SELECT * INTO v_proj FROM public.projects
   WHERE property_id = p_property_id AND project_is_deleted IS NOT TRUE
   ORDER BY project_created_at DESC LIMIT 1;
  IF v_proj.id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error',
      'This property has no project in LEAP yet. Contact the office to set one up before logging field records here.';
    RETURN;
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

  SELECT b.building_name INTO v_bld_name FROM public.buildings b WHERE b.id = v_proj.building_id;

  SELECT id INTO v_status FROM public.picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='work_order_status'
     AND picklist_value='New' AND picklist_is_active LIMIT 1;
  SELECT id INTO v_sa_status FROM public.picklist_values
   WHERE picklist_object='service_appointments' AND picklist_field='sa_status'
     AND picklist_value='Scheduled' AND picklist_is_active LIMIT 1;

  INSERT INTO public.work_orders (
    work_order_record_number, work_order_name, work_order_owner, work_order_created_by,
    project_id, opportunity_id, property_id, building_id, work_order_account_id,
    work_type_id, work_order_record_type, work_order_status,
    work_order_subject, work_order_description
  ) VALUES (
    '', v_wt.work_type_name || ' - ' || coalesce(nullif(v_prop.property_name,''), v_prop.property_record_number),
    v_actor, v_actor,
    v_proj.id, v_proj.opportunity_id, v_prop.id, v_proj.building_id, v_prop.property_account_id,
    v_wt.id, v_wt.work_type_default_work_order_record_type, v_status,
    v_wt.work_type_name,
    format('%s — created ad hoc in the field at %s (attached to project %s).',
           v_wt.work_type_name, coalesce(v_prop.property_name, 'the property'), v_proj.project_record_number)
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

  RETURN QUERY SELECT v_new, v_rn, 'success',
    format('%s %s created at %s', v_wt.work_type_name, v_rn, coalesce(v_prop.property_name, 'property'));
END;
$function$;

REVOKE ALL ON FUNCTION public.create_technician_work_order_for_property(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_technician_work_order_for_property(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
