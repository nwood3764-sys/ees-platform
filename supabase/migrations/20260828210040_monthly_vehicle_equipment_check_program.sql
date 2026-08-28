-- Turns the Vehicle Inspection work order into a monthly PROGRAM.
--
-- Nicholas: "This is more of a monthly check."
--
-- A daily pre-trip triggers itself -- you are about to drive the truck. A
-- monthly check happens only if something opens it, puts a name on it, and
-- shows which trucks are outstanding. That chase is the whole deliverable;
-- the checklist already shipped.
--
-- 1. Named for its cadence, which also ends the collision with the Fleet
--    pre-trip inspection (vehicle_inspection_item_templates / the LEAP Pad
--    Vehicle Inspection screen). Two artifacts, two names.
-- 2. work_orders.vehicle_id -- a real foreign key, so "every check of
--    VEH-00002" is a join and the vehicle record carries its own history.
-- 3. The opener and the chase list.
--
-- A work order is about a PLACE or about a VEHICLE. The three parent columns
-- were NOT NULL, which is why a fleet check had to borrow whatever job site
-- the technician happened to be standing on. They are nullable now, with a
-- CHECK that a work order always has one subject or the other -- the honest
-- structure, rather than inventing a placeholder property to satisfy a column.

-- 1. Name it for its cadence.
UPDATE public.work_types
   SET work_type_name = 'Monthly Vehicle Equipment and Documents Check',
       work_type_description = 'Monthly check that a company vehicle carries its required equipment and documents: first aid kit, fuel card, registration, insurance, trunk cables, cell phone holder and charger, radio charger and holder, door wedge, booties, disposable gloves, fire extinguisher, and umbrella. Opened automatically for every active vehicle on the first of the month, and creatable by a technician in the field.'
 WHERE work_type_record_number = 'WT-00093';

UPDATE public.work_plan_templates
   SET wpt_name = 'Monthly Vehicle Equipment and Documents Check - Standard'
 WHERE wpt_record_number = 'WPT-00025';

UPDATE public.picklist_values
   SET picklist_value = 'MONTHLY-VEHICLE-EQUIPMENT-CHECK',
       picklist_label = 'Monthly Vehicle Equipment and Documents Check'
 WHERE picklist_object = 'work_orders' AND picklist_field = 'record_type'
   AND picklist_value = 'VEHICLE-INSPECTION';

-- 2. The vehicle is a real parent, not a string in a field value.
ALTER TABLE public.work_orders
  ADD COLUMN vehicle_id uuid REFERENCES public.vehicles(id);
CREATE INDEX idx_work_orders_vehicle_id ON public.work_orders(vehicle_id)
  WHERE vehicle_id IS NOT NULL;
COMMENT ON COLUMN public.work_orders.vehicle_id IS
  'The vehicle this work order is about. Set for fleet work (the monthly equipment and documents check); NULL for property work. A work order has a property or a vehicle -- see work_orders_subject_check.';

-- 3. A work order is about a place or about a vehicle.
ALTER TABLE public.work_orders ALTER COLUMN project_id     DROP NOT NULL;
ALTER TABLE public.work_orders ALTER COLUMN opportunity_id DROP NOT NULL;
ALTER TABLE public.work_orders ALTER COLUMN property_id    DROP NOT NULL;
ALTER TABLE public.work_orders
  ADD CONSTRAINT work_orders_subject_check
  CHECK (property_id IS NOT NULL OR vehicle_id IS NOT NULL);

-- 4. State scoping: register the vehicle route in the REGISTRY so the engine
--    generates it. Hand-patching the policy would be silently undone the next
--    time install_record_state_scoping('work_orders') runs.
--
--    `vehicles` is registered platform_configuration -- the fleet is company
--    data, visible to every internal user regardless of state grants -- so the
--    generated path is "this work order names a real vehicle". Naming the key
--    column explicitly is what makes the builder emit that EXISTS form instead
--    of calling a vehicles resolver that does not exist.
INSERT INTO public.record_state_scope_sources
  (rsss_record_number, rsss_object_name, rsss_resolution_kind,
   rsss_parent_object_name, rsss_parent_fk_column, rsss_parent_key_column,
   rsss_path_order, rsss_owner, rsss_notes)
VALUES ('', 'work_orders', 'parent_lookup', 'vehicles', 'vehicle_id', 'id', 2,
        'c5a01ec8-960f-42ab-8a9e-a49822de89af',
        'Fleet work orders have no property. Vehicles are platform configuration (not state-scoped), so a work order that names a real vehicle is visible to every internal user, exactly as the vehicle itself is.');

SELECT public.install_record_state_scoping('work_orders');

-- 5. Saving the vehicle sets BOTH the readable field value and the foreign key
--    from the same authoritative source -- no parsing a record number back out
--    of display text.
CREATE OR REPLACE FUNCTION public.save_work_step_vehicle(
  p_step_id uuid, p_template_field_id uuid, p_vehicle_id uuid)
RETURNS TABLE(step_id uuid, status text, outcome text, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor   uuid := public.current_app_user_id();
  v_step    public.work_steps;
  v_field   public.work_step_template_fields;
  v_veh     public.vehicles;
  v_cur     text;
  v_text    text;
  v_existing uuid;
  v_locked  boolean := false;
BEGIN
  SELECT * INTO v_step FROM public.work_steps
   WHERE id = p_step_id AND work_step_is_deleted IS NOT TRUE;
  IF v_step.id IS NULL THEN
    RETURN QUERY SELECT p_step_id, NULL::text, 'error', 'Work step not found or deleted'; RETURN;
  END IF;
  v_actor := COALESCE(v_actor, v_step.work_step_owner, v_step.work_step_created_by);

  SELECT * INTO v_field FROM public.work_step_template_fields
   WHERE id = p_template_field_id AND wstf_is_deleted IS NOT TRUE AND wstf_is_active IS TRUE
     AND work_step_template_id = v_step.work_step_template_id;
  IF v_field.id IS NULL THEN
    RETURN QUERY SELECT p_step_id, NULL::text, 'error', 'Field does not belong to this work step'; RETURN;
  END IF;
  IF v_field.wstf_field_type <> 'vehicle' THEN
    RETURN QUERY SELECT p_step_id, NULL::text, 'error',
      format('"%s" is not a vehicle field', v_field.wstf_field_label); RETURN;
  END IF;

  SELECT picklist_value INTO v_cur FROM public.picklist_values WHERE id = v_step.work_step_status;
  IF v_cur IN ('Completed','Verified','Not Applicable') THEN
    RETURN QUERY SELECT p_step_id, v_cur, 'blocked',
      format('Step is %s - its values are locked', v_cur); RETURN;
  END IF;

  SELECT * INTO v_veh FROM public.vehicles
   WHERE id = p_vehicle_id AND vehicle_is_deleted IS NOT TRUE;
  IF v_veh.id IS NULL THEN
    RETURN QUERY SELECT p_step_id, v_cur, 'blocked', 'That vehicle was not found.'; RETURN;
  END IF;

  -- Readable, and composed here so the stored text and the foreign key can
  -- never disagree.
  v_text := v_veh.vehicle_record_number || ' · ' || v_veh.vehicle_name
            || COALESCE(' (' || nullif(btrim(coalesce(v_veh.vehicle_license_plate,'')),'') || ')', '');

  SELECT id INTO v_existing FROM public.work_step_field_values
   WHERE work_step_id = p_step_id AND work_step_template_field_id = p_template_field_id
     AND wsfv_is_deleted IS NOT TRUE
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.work_step_field_values
       SET wsfv_numeric_value = NULL, wsfv_text_value = v_text,
           wsfv_updated_by = v_actor, wsfv_updated_at = now()
     WHERE id = v_existing;
  ELSE
    INSERT INTO public.work_step_field_values
      (wsfv_record_number, wsfv_owner, wsfv_created_by,
       work_step_id, work_step_template_field_id, wsfv_numeric_value, wsfv_text_value)
    VALUES ('', v_actor, v_actor, p_step_id, p_template_field_id, NULL, v_text);
  END IF;

  -- Stamp the work order. A work order locked by its status is a real refusal,
  -- not a reason to lose the answer the technician just gave.
  BEGIN
    UPDATE public.work_orders SET vehicle_id = p_vehicle_id
     WHERE id = v_step.work_order_id
       AND (vehicle_id IS DISTINCT FROM p_vehicle_id);
  EXCEPTION WHEN others THEN
    v_locked := true;
  END;

  RETURN QUERY SELECT p_step_id, v_cur, 'success',
    CASE WHEN v_locked
      THEN format('"%s" saved (the work order is locked, so its Vehicle field was left as it was)', v_field.wstf_field_label)
      ELSE format('"%s" saved', v_field.wstf_field_label) END;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_work_step_vehicle(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_work_step_vehicle(uuid, uuid, uuid) TO authenticated;

-- 6. The opener. One work order per active vehicle per month, owned by the
--    person the vehicle is assigned to, on their Today list. Idempotent: run
--    it twice in a month and the second run creates nothing.
CREATE OR REPLACE FUNCTION public.open_monthly_vehicle_equipment_checks(p_month date DEFAULT NULL)
RETURNS TABLE(vehicle_record_number text, work_order_record_number text, outcome text, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_month     date;
  v_wt        public.work_types;
  v_status    uuid;
  v_sa_status uuid;
  v_retired   uuid;
  v_fallback  uuid;
  v_v         record;
  v_owner     uuid;
  v_new       uuid;
  v_rn        text;
  v_sa        uuid;
  v_start     timestamptz;
BEGIN
  v_month := COALESCE(p_month, date_trunc('month', (now() AT TIME ZONE 'America/Chicago'))::date);

  SELECT * INTO v_wt FROM public.work_types
   WHERE work_type_name = 'Monthly Vehicle Equipment and Documents Check'
     AND work_type_is_deleted IS NOT TRUE;
  IF v_wt.id IS NULL OR v_wt.work_type_default_work_plan_template_id IS NULL THEN
    RETURN QUERY SELECT NULL::text, NULL::text, 'error',
      'The Monthly Vehicle Equipment and Documents Check work type is missing or has no work plan template.';
    RETURN;
  END IF;

  SELECT id INTO v_status FROM public.picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='work_order_status'
     AND picklist_value='New' AND picklist_is_active LIMIT 1;
  SELECT id INTO v_sa_status FROM public.picklist_values
   WHERE picklist_object='service_appointments' AND picklist_field='sa_status'
     AND picklist_value='Scheduled' AND picklist_is_active LIMIT 1;
  SELECT id INTO v_retired FROM public.picklist_values
   WHERE picklist_object='vehicles' AND picklist_field='vehicle_status'
     AND picklist_value='Retired' LIMIT 1;

  -- Nobody holds Shop Steward today, so an unassigned vehicle falls to a
  -- Project Site Lead -- the role that verifies the step anyway. Never to
  -- nobody: an unowned check is a check that does not happen.
  SELECT u.id INTO v_fallback
    FROM public.users u JOIN public.roles r ON r.id = u.role_id
   WHERE r.role_name IN ('Shop Steward','Project Site Lead')
     AND u.user_is_active = true AND u.user_is_deleted IS NOT TRUE
   ORDER BY CASE r.role_name WHEN 'Shop Steward' THEN 0 ELSE 1 END, u.user_name
   LIMIT 1;
  v_fallback := COALESCE(v_fallback, v_wt.work_type_owner);

  v_start := (v_month::timestamp + interval '8 hours') AT TIME ZONE 'America/Chicago';

  FOR v_v IN
    SELECT v.* FROM public.vehicles v
     WHERE v.vehicle_is_deleted IS NOT TRUE
       AND (v.vehicle_status IS NULL OR v.vehicle_status <> v_retired)
     ORDER BY v.vehicle_record_number
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.work_orders wo
       WHERE wo.vehicle_id = v_v.id
         AND wo.work_type_id = v_wt.id
         AND wo.work_order_is_deleted IS NOT TRUE
         AND date_trunc('month', wo.work_order_created_at AT TIME ZONE 'America/Chicago')::date = v_month
    ) THEN
      RETURN QUERY SELECT v_v.vehicle_record_number, NULL::text, 'skipped',
        format('%s already has a check for %s', v_v.vehicle_name, to_char(v_month,'Mon YYYY'));
      CONTINUE;
    END IF;

    v_owner := COALESCE(v_v.assigned_to_id, v_fallback);

    INSERT INTO public.work_orders (
      work_order_record_number, work_order_name, work_order_owner, work_order_created_by,
      vehicle_id, work_type_id, work_order_record_type, work_order_status,
      work_order_subject, work_order_description
    ) VALUES (
      '',
      v_wt.work_type_name || ' - ' || v_v.vehicle_name || ' - ' || to_char(v_month,'Mon YYYY'),
      v_owner, v_owner,
      v_v.id, v_wt.id, v_wt.work_type_default_work_order_record_type, v_status,
      v_wt.work_type_name,
      format('Monthly equipment and documents check for %s (%s). Opened automatically for %s.',
             v_v.vehicle_name, COALESCE(v_v.vehicle_license_plate,'no plate on file'),
             to_char(v_month,'Mon YYYY'))
    ) RETURNING id, work_orders.work_order_record_number INTO v_new, v_rn;

    INSERT INTO public.service_appointments (
      sa_record_number, sa_name, sa_owner, sa_created_by,
      work_order_id, work_type_id, sa_subject, sa_status,
      sa_scheduled_start_time, sa_scheduled_end_time
    ) VALUES (
      '', v_wt.work_type_name || ' - ' || v_v.vehicle_name, v_owner, v_owner,
      v_new, v_wt.id, v_wt.work_type_name, v_sa_status,
      v_start, v_start + interval '15 minutes'
    ) RETURNING id INTO v_sa;

    INSERT INTO public.service_appointment_assignments (
      saa_record_number, saa_name, saa_created_by, service_appointment_id, saa_user_id
    ) VALUES ('', v_wt.work_type_name || ' - ' || v_v.vehicle_name, v_owner, v_sa, v_owner);

    RETURN QUERY SELECT v_v.vehicle_record_number, v_rn, 'created',
      format('%s opened for %s', v_rn, v_v.vehicle_name);
  END LOOP;
END;
$function$;

-- Run by pg_cron as the table owner. No client ever calls it, so EXECUTE stays
-- revoked and it adds no advisor finding.
--
-- The schedule itself is prod-only configuration, deliberately NOT in this
-- migration (the same rule the attachment-scanner and subscription-renewal
-- jobs follow):
--   select cron.schedule('open-monthly-vehicle-equipment-checks', '0 13 1 * *',
--     $$ select public.open_monthly_vehicle_equipment_checks(); $$);
REVOKE ALL ON FUNCTION public.open_monthly_vehicle_equipment_checks(date) FROM PUBLIC, anon, authenticated;

-- 7. The vehicle record carries its own check history.
INSERT INTO public.page_layout_widgets
  (page_layout_widget_record_number, page_layout_id, section_id, widget_type, widget_title,
   widget_column, widget_position, widget_config, created_by)
SELECT '', 'fb47eb6f-65f3-40f5-9294-dd9b848bbb45',
       'a0ac2f28-a9be-404a-be98-2b937024844f', 'related_list',
       'Monthly Equipment Checks', 1, 3,
       jsonb_build_object(
         'table', 'work_orders',
         'fk', 'vehicle_id',
         'is_deleted_col', 'work_order_is_deleted',
         'sort_field', 'work_order_created_at',
         'sort_dir', 'desc',
         'columns', jsonb_build_array(
           jsonb_build_object('name','work_order_record_number','label','Work Order #'),
           jsonb_build_object('name','work_order_name','label','Check'),
           jsonb_build_object('name','work_order_status','type','picklist','label','Status')
         )),
       'c5a01ec8-960f-42ab-8a9e-a49822de89af';

-- 8. The chase list. Every monthly check that is not finished -- including one
--    left over from a previous month, which is exactly what overdue means.
WITH new_report AS (
  INSERT INTO public.reports
    (rpt_record_number, rpt_name, rpt_description, rpt_format, rpt_primary_object,
     rpt_selected_fields, rpt_filter_logic, rpt_sort_config, rpt_column_groupings,
     rpt_runtime_prompts, rpt_charts, rpt_owner_user_id, created_by)
  VALUES (
    '', 'Vehicles Not Yet Checked This Month Report',
    'Every monthly vehicle equipment and documents check that has not reached Verified or Closed, oldest first. A row left from a previous month is overdue.',
    'tabular', 'work_orders',
    '[{"name":"vehicle_id","type":"uuid","label":"Vehicle","table":"work_orders","via_path":null},
      {"name":"work_order_record_number","type":"text","label":"Work Order #","table":"work_orders","via_path":null},
      {"name":"work_order_status","type":"uuid","label":"Status","table":"work_orders","via_path":null},
      {"name":"work_order_owner","type":"uuid","label":"Owner","table":"work_orders","via_path":null},
      {"name":"work_order_created_at","type":"timestamptz","label":"Opened","table":"work_orders","via_path":null}]'::jsonb,
    'all',
    '[{"name":"work_order_created_at","direction":"asc"}]'::jsonb,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af')
  RETURNING id
)
INSERT INTO public.report_filters
  (rfilt_report_id, rfilt_filter_index, rfilt_field_name, rfilt_field_table,
   rfilt_operator, rfilt_value, created_by)
SELECT new_report.id, f.idx, f.fname, 'work_orders', f.op, f.val,
       'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM new_report, (VALUES
  (1, 'work_order_record_type', 'equals',
     to_jsonb((SELECT id::text FROM public.picklist_values
                WHERE picklist_object='work_orders' AND picklist_field='record_type'
                  AND picklist_value='MONTHLY-VEHICLE-EQUIPMENT-CHECK'))),
  (2, 'work_order_status', 'not_equals',
     (SELECT jsonb_agg(id::text) FROM public.picklist_values
       WHERE picklist_object='work_orders' AND picklist_field='work_order_status'
         AND picklist_value IN ('Verified','Closed')))
) AS f(idx, fname, op, val);

-- 9. Assert it, do not assume it.
DO $$
DECLARE v_n integer; v_pred text; v_rt uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.work_types
                  WHERE work_type_name='Monthly Vehicle Equipment and Documents Check'
                    AND work_type_is_technician_creatable IS TRUE) THEN
    RAISE EXCEPTION 'The renamed work type is missing or no longer technician-creatable.';
  END IF;

  SELECT id INTO v_rt FROM public.picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='record_type'
     AND picklist_value='MONTHLY-VEHICLE-EQUIPMENT-CHECK';
  IF v_rt IS NULL THEN RAISE EXCEPTION 'The work order record type was not renamed.'; END IF;

  -- No work order may exist without a subject.
  SELECT count(*) INTO v_n FROM public.work_orders
   WHERE property_id IS NULL AND vehicle_id IS NULL AND work_order_is_deleted IS NOT TRUE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% work order(s) have neither a property nor a vehicle.', v_n;
  END IF;

  -- The state-scope policy must carry BOTH routes, or fleet work orders
  -- vanish for a state-restricted user and property work orders stop being
  -- scoped at all.
  SELECT pg_get_expr(polqual, polrelid) INTO v_pred
    FROM pg_policy WHERE polrelid='public.work_orders'::regclass
     AND polname='state_scope_work_orders';
  IF v_pred IS NULL OR v_pred NOT LIKE '%properties%' OR v_pred NOT LIKE '%vehicles%' THEN
    RAISE EXCEPTION 'work_orders state-scope policy does not carry both the property and vehicle routes: %',
      COALESCE(v_pred, '(no policy)');
  END IF;

  -- Existing property work orders must be untouched by the new route.
  SELECT count(*) INTO v_n FROM public.work_orders
   WHERE work_order_is_deleted IS NOT TRUE AND property_id IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Expected every pre-existing work order to keep its property; % lost one.', v_n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.reports
                  WHERE rpt_name='Vehicles Not Yet Checked This Month Report' AND is_deleted = false) THEN
    RAISE EXCEPTION 'The chase report was not created.';
  END IF;
  SELECT count(*) INTO v_n FROM public.report_filters rf JOIN public.reports r ON r.id = rf.rfilt_report_id
   WHERE r.rpt_name='Vehicles Not Yet Checked This Month Report' AND rf.is_deleted = false
     AND rf.rfilt_value IS NOT NULL;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'Expected 2 populated report filters, found % (a null filter value silently matches everything).', v_n;
  END IF;
END $$;
