-- =============================================================================
-- Daily Building Access work orders (Nicholas, 2026-07-16).
--
-- Rule: any day a technician has a scheduled stop at a building, the day must
-- START with a "Building Access - Unlock and Lock" work order at that
-- building. The office never has to remember it: the moment a technician is
-- assigned to a scheduled appointment whose work order sits on a building,
-- LEAP checks whether that building already has a building-access work order
-- scheduled that day — and creates + schedules + assigns one to that
-- technician if not. Technicians can still create additional building-access
-- work orders ad hoc during the day through the existing Create Work Order
-- menu (WT-00080 is technician-creatable).
--
-- Nothing hardcoded: the access work type is flagged by the new
-- work_types.work_type_is_daily_building_access column (admin-manageable);
-- the work order record type and work plan come from that work type's own
-- defaults; the Scheduled statuses are resolved from picklist_values.
--
-- Recursion safety: the auto-created access appointment's own assignment
-- re-fires this trigger, which exits immediately because the work order's
-- work type IS the access type. Race safety: a per-building-per-day advisory
-- transaction lock serializes concurrent assignments so exactly one access
-- work order is created.
-- =============================================================================

ALTER TABLE public.work_types
  ADD COLUMN work_type_is_daily_building_access boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.work_types.work_type_is_daily_building_access IS
  'When true, this is the building-access work type that must exist at the start of every scheduled day on a building. Exactly one active work type should carry this flag.';

UPDATE public.work_types
SET    work_type_is_daily_building_access = true
WHERE  work_type_record_number = 'WT-00080'
  AND  work_type_is_deleted IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.ensure_daily_building_access_work_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_sa           public.service_appointments%ROWTYPE;
  v_wo           public.work_orders%ROWTYPE;
  v_access_type  public.work_types%ROWTYPE;
  v_day          date;
  v_wo_status    uuid;
  v_sa_status    uuid;
  v_prop_name    text;
  v_new_wo_id    uuid;
  v_new_sa_id    uuid;
BEGIN
  IF NEW.saa_is_deleted IS TRUE OR NEW.saa_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_sa FROM public.service_appointments
  WHERE id = NEW.service_appointment_id AND sa_is_deleted IS NOT TRUE;
  IF NOT FOUND OR v_sa.work_order_id IS NULL OR v_sa.sa_scheduled_start_time IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_wo FROM public.work_orders
  WHERE id = v_sa.work_order_id AND work_order_is_deleted IS NOT TRUE;
  IF NOT FOUND OR v_wo.building_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_access_type FROM public.work_types
  WHERE work_type_is_daily_building_access IS TRUE
    AND work_type_is_deleted IS NOT TRUE
    AND work_type_is_active IS TRUE
  ORDER BY work_type_record_number
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NEW; -- no access type configured; rule is dormant
  END IF;

  -- The access stop itself never needs another access stop.
  IF v_wo.work_type_id = v_access_type.id THEN
    RETURN NEW;
  END IF;

  v_day := (v_sa.sa_scheduled_start_time AT TIME ZONE 'America/Chicago')::date;

  -- Serialize per building + day so concurrent assignments create exactly one.
  PERFORM pg_advisory_xact_lock(
    hashtext('daily_building_access:' || v_wo.building_id::text || ':' || v_day::text)
  );

  IF EXISTS (
    SELECT 1
    FROM public.service_appointments sa2
    JOIN public.work_orders wo2
      ON wo2.id = sa2.work_order_id AND wo2.work_order_is_deleted IS NOT TRUE
    WHERE sa2.sa_is_deleted IS NOT TRUE
      AND wo2.building_id = v_wo.building_id
      AND wo2.work_type_id = v_access_type.id
      AND (sa2.sa_scheduled_start_time AT TIME ZONE 'America/Chicago')::date = v_day
  ) THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_wo_status FROM public.picklist_values
  WHERE picklist_object = 'work_orders' AND picklist_field = 'work_order_status'
    AND picklist_value = 'Scheduled' AND picklist_is_active IS TRUE
  LIMIT 1;

  SELECT id INTO v_sa_status FROM public.picklist_values
  WHERE picklist_object = 'service_appointments' AND picklist_field = 'sa_status'
    AND picklist_value = 'Scheduled' AND picklist_is_active IS TRUE
  LIMIT 1;

  SELECT p.property_name INTO v_prop_name
  FROM public.properties p WHERE p.id = v_wo.property_id;

  INSERT INTO public.work_orders (
    work_order_record_number, work_order_name, work_order_record_type,
    work_order_owner, work_order_created_by,
    project_id, opportunity_id, property_id, building_id, unit_id,
    work_type_id, work_order_account_id,
    project_coordinator_id, project_site_lead_user_id,
    work_order_status, work_order_subject, work_order_description,
    work_order_start_datetime, work_order_end_datetime,
    work_order_scheduled_start_date, work_order_scheduled_start_time
  ) VALUES (
    '',
    v_access_type.work_type_name || COALESCE(' - ' || v_prop_name, ''),
    v_access_type.work_type_default_work_order_record_type,
    v_wo.work_order_owner, COALESCE(NEW.saa_created_by, v_wo.work_order_owner),
    v_wo.project_id, v_wo.opportunity_id, v_wo.property_id, v_wo.building_id, v_wo.unit_id,
    v_access_type.id, v_wo.work_order_account_id,
    v_wo.project_coordinator_id, v_wo.project_site_lead_user_id,
    v_wo_status,
    v_access_type.work_type_name,
    'Auto-created: every scheduled day on a building starts with a building-access work order. Created when '
      || v_wo.work_order_record_number || ' was scheduled and assigned for '
      || to_char(v_day, 'YYYY-MM-DD') || '.',
    v_sa.sa_scheduled_start_time, v_sa.sa_scheduled_end_time,
    v_day, (v_sa.sa_scheduled_start_time AT TIME ZONE 'America/Chicago')::time
  )
  RETURNING id INTO v_new_wo_id;

  INSERT INTO public.service_appointments (
    sa_record_number, sa_name, sa_owner, sa_created_by,
    work_order_id, work_type_id, opportunity_id, project_id,
    sa_subject, sa_status,
    sa_scheduled_start_time, sa_scheduled_end_time
  ) VALUES (
    '',
    v_access_type.work_type_name || COALESCE(' - ' || v_prop_name, ''),
    v_wo.work_order_owner, COALESCE(NEW.saa_created_by, v_wo.work_order_owner),
    v_new_wo_id, v_access_type.id, v_wo.opportunity_id, v_wo.project_id,
    v_access_type.work_type_name, v_sa_status,
    v_sa.sa_scheduled_start_time, v_sa.sa_scheduled_end_time
  )
  RETURNING id INTO v_new_sa_id;

  INSERT INTO public.service_appointment_assignments (
    saa_record_number, saa_name, saa_created_by, service_appointment_id, saa_user_id
  ) VALUES (
    '',
    v_access_type.work_type_name || COALESCE(' - ' || v_prop_name, ''),
    COALESCE(NEW.saa_created_by, v_wo.work_order_owner),
    v_new_sa_id, NEW.saa_user_id
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_daily_building_access_work_order() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_saa_daily_building_access
AFTER INSERT ON public.service_appointment_assignments
FOR EACH ROW EXECUTE FUNCTION public.ensure_daily_building_access_work_order();

NOTIFY pgrst, 'reload schema';
