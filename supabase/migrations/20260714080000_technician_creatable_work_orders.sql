-- =====================================================================
-- Technician-creatable work orders (Nicholas, 2026-07-13/14).
-- Technicians create certain work order types themselves in the field —
-- Building Access today; Post Notice of Entry, Incident Report, Vehicle
-- Inspection, Damaged Equipment, Material Delivery etc. to follow. The
-- list is DATA, not code: flag the work type in LEAP Admin and it
-- appears in LEAP Pad's Create Work Order menu.
--
--   1. work_types.work_type_is_technician_creatable — menu flag.
--   2. work_types.work_type_default_work_order_record_type — the WO
--      record type stamped on field-created work orders of this type.
--   3. create_technician_work_order(p_source_work_order_id,
--      p_work_type_id) — generalized creation RPC: validates the type
--      is flagged + active + has a default work plan template, clones
--      the parent chain from the work order the tech is on-site for,
--      owner/assignment = the calling technician, same-day appointment
--      so it lands on their Today view.
--   4. create_building_access_work_order becomes a thin wrapper so the
--      two paths cannot drift.
--
-- Applied to production 2026-07-14 via MCP. WT-00080 (Building Access)
-- flagged technician-creatable as config data.
-- =====================================================================

ALTER TABLE public.work_types
  ADD COLUMN IF NOT EXISTS work_type_is_technician_creatable boolean NOT NULL DEFAULT false;
ALTER TABLE public.work_types
  ADD COLUMN IF NOT EXISTS work_type_default_work_order_record_type uuid REFERENCES public.picklist_values(id);

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
    project_id, opportunity_id, property_id, building_id, work_order_account_id,
    work_type_id, work_order_record_type, work_order_status,
    work_order_subject, work_order_description
  ) VALUES (
    '', v_wt.work_type_name || ' - ' || coalesce(nullif(v_src.work_order_building,''), nullif(v_src.work_order_property_name,''), v_src.work_order_record_number),
    v_actor, v_actor,
    v_src.project_id, v_src.opportunity_id, v_src.property_id, v_src.building_id, v_src.work_order_account_id,
    v_wt.id, v_wt.work_type_default_work_order_record_type, v_status,
    v_wt.work_type_name,
    format('%s — created in the field from %s.', v_wt.work_type_name, v_src.work_order_record_number)
  ) RETURNING id, work_orders.work_order_record_number INTO v_new, v_rn;

  -- Same-day appointment + assignment so the new work order sits on the
  -- creating technician's Today view.
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

-- Building access creation delegates to the generalized RPC (no drift).
CREATE OR REPLACE FUNCTION public.create_building_access_work_order(p_source_work_order_id uuid)
 RETURNS TABLE(work_order_id uuid, record_number text, outcome text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_wt uuid;
BEGIN
  SELECT wt.id INTO v_wt FROM public.work_types wt
   WHERE wt.work_type_name = 'Building Access - Unlock and Lock'
     AND wt.work_type_is_deleted IS NOT TRUE AND wt.work_type_is_active IS TRUE;
  IF v_wt IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'error',
      'The Building Access work type is not configured.'; RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public.create_technician_work_order(p_source_work_order_id, v_wt);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_building_access_work_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_building_access_work_order(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
