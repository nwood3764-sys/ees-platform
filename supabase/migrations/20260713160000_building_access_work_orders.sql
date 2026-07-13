-- =====================================================================
-- Building access chain-of-custody work orders (Nicholas, 2026-07-13).
-- Technicians document key checkout from the lockbox, who is on-site,
-- door unlocked/locked, and key check-in — all photo-timestamped. The
-- technician creates this work order themselves in the field from the
-- work order they are on-site for (same project/opportunity/building
-- chain). Unit-level access logging is a planned follow-on.
--
-- DDL only — the work type WT-00080 / plan template / step templates
-- are config data created separately (branch DBs replay this file
-- without data; the RPC reports 'not configured' until the work type
-- exists).
--
--   1. work_step_template_fields.wstf_field_type gains
--      'user_multiselect' (renders as a checkbox list of active users
--      in LEAP Pad; stored as comma-separated names in the text value).
--   2. create_building_access_work_order(p_source_work_order_id) —
--      technician RPC: clones the parent chain from the work order the
--      tech is on-site for, owner = the calling technician, plus a
--      same-day service appointment + assignment so it appears on
--      their Today view. The instantiate trigger builds the plan.
--
-- Applied to production 2026-07-13 via MCP; verified in a rolled-back
-- probe (RPC created the WO, 5 steps instantiated, assigned to caller,
-- user_multiselect field present).
-- =====================================================================

-- 1. Field type ---------------------------------------------------------------
ALTER TABLE public.work_step_template_fields
  DROP CONSTRAINT IF EXISTS work_step_template_fields_wstf_field_type_check;
ALTER TABLE public.work_step_template_fields
  ADD CONSTRAINT work_step_template_fields_wstf_field_type_check
  CHECK (wstf_field_type = ANY (ARRAY['number'::text, 'text'::text, 'user_multiselect'::text]));

-- 2. Technician-facing creation RPC ---------------------------------------------
CREATE OR REPLACE FUNCTION public.create_building_access_work_order(p_source_work_order_id uuid)
 RETURNS TABLE(work_order_id uuid, record_number text, outcome text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor  uuid := public.current_app_user_id();
  v_src    public.work_orders;
  v_wt     uuid;
  v_wo_rt  uuid;
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

  SELECT wt.id INTO v_wt FROM public.work_types wt
   WHERE wt.work_type_name = 'Building Access - Unlock and Lock'
     AND wt.work_type_is_deleted IS NOT TRUE AND wt.work_type_is_active IS TRUE;
  IF v_wt IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error',
      'The Building Access work type is not configured.'; RETURN;
  END IF;

  SELECT id INTO v_wo_rt FROM public.picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='record_type'
     AND picklist_value='building_access' AND picklist_is_active LIMIT 1;
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
    '', 'Building Access - ' || coalesce(nullif(v_src.work_order_building,''), nullif(v_src.work_order_property_name,''), 'Unlock and Lock'),
    v_actor, v_actor,
    v_src.project_id, v_src.opportunity_id, v_src.property_id, v_src.building_id, v_src.work_order_account_id,
    v_wt, v_wo_rt, v_status,
    'Building Access - Unlock and Lock',
    format('Chain-of-custody building access log, created in the field from %s. Key checkout, technicians on-site, door unlocked/locked, key check-in — photo timestamps document each event.', v_src.work_order_record_number)
  ) RETURNING id, work_orders.work_order_record_number INTO v_new, v_rn;

  -- Same-day appointment + assignment so the access log sits on the
  -- creating technician's Today view (they close it out at day end).
  INSERT INTO public.service_appointments (
    sa_record_number, sa_name, sa_owner, sa_created_by,
    work_order_id, work_type_id, opportunity_id, project_id,
    sa_subject, sa_status, sa_scheduled_start_time, sa_scheduled_end_time
  ) VALUES (
    '', 'Building Access - ' || coalesce(nullif(v_src.work_order_building,''), 'Unlock and Lock'),
    v_actor, v_actor, v_new, v_wt, v_src.opportunity_id, v_src.project_id,
    'Building Access - Unlock and Lock', v_sa_status, now(), now() + interval '8 hours'
  ) RETURNING id INTO v_sa;

  INSERT INTO public.service_appointment_assignments (
    saa_record_number, saa_name, saa_created_by, service_appointment_id, saa_user_id
  ) VALUES (
    '', 'Building access — ' || coalesce(nullif(v_src.work_order_building,''), 'building'),
    v_actor, v_sa, v_actor
  );

  RETURN QUERY SELECT v_new, v_rn, 'success',
    format('Building access work order %s created', v_rn);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_building_access_work_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_building_access_work_order(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
