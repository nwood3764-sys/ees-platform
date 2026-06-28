-- bulk_schedule_work_orders v5: skills enforcement + property travel buffer
--
-- Two new behaviors on top of v4:
--
-- 1. SKILLS GATE (hard error). For each WO in the batch, look up the
--    work_type_required_certifications rows. The selected Team Lead must
--    hold every required certification, with cc_expires_date NULL or
--    >= p_start_date. If any required cert is missing for any WO in the
--    batch, raise P0001 listing the missing certs.
--
-- 2. PROPERTY TRAVEL BUFFER. When the engine plans WO_i and WO_{i+1}
--    spans two different properties, the buffer between them comes from:
--      a) property_distances(origin=property[i], destination=property[i+1])
--         if a row exists, OR
--      b) p_inter_property_buffer_minutes (new param, default 15)
--    Same-property cross-unit transitions still use the work_type post
--    buffer; same-unit still uses zero.

CREATE OR REPLACE FUNCTION public.bulk_schedule_work_orders(
  p_project_id                       uuid,
  p_work_order_ids                   uuid[],
  p_team_lead_contact_id             uuid,
  p_start_date                       date,
  p_end_date                         date,
  p_daily_start_time                 time      DEFAULT '07:00'::time,
  p_daily_end_time                   time      DEFAULT '15:30'::time,
  p_lunch_start                      time      DEFAULT '11:30'::time,
  p_lunch_end                        time      DEFAULT '12:00'::time,
  p_inter_wo_buffer_minutes          integer   DEFAULT 5,
  p_timezone                         text      DEFAULT 'America/Chicago',
  p_commit                           boolean   DEFAULT false,
  p_pinned_placements                jsonb     DEFAULT '[]'::jsonb,
  p_inter_property_buffer_minutes    integer   DEFAULT 15
)
RETURNS TABLE (
  work_order_id                       uuid,
  work_order_record_number            text,
  work_order_name                     text,
  work_type_name                      text,
  building_name                       text,
  unit_name                           text,
  duration_minutes                    numeric,
  placed                              boolean,
  scheduled_start_iso                 text,
  scheduled_end_iso                   text,
  service_appointment_id              uuid,
  service_appointment_record_number   text,
  placement_error                     text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_caller_id              uuid;
  v_lead_title             text;
  v_sa_scheduled_id        uuid;
  v_sa_canceled_id         uuid;
  v_wo_scheduled_id        uuid;
  v_wo_to_be_scheduled_id  uuid;
  v_day                    date;
  v_period_starts          timestamptz[];
  v_period_ends            timestamptz[];
  v_placed_starts          timestamptz[];
  v_placed_ends            timestamptz[];
  v_placed_sa_ids          uuid[];
  v_placed_sa_record_nums  text[];
  v_placement_errors       text[];
  v_wo_unit_ids            uuid[];
  v_wo_property_ids        uuid[];
  v_wo_post_buffers        integer[];
  v_wo_count               integer;
  v_wo_is_pinned           boolean[];
  v_wo_pin_forced          boolean[];
  v_pin                    record;
  v_pin_idx                integer;
  v_pin_start              timestamptz;
  v_pin_end                timestamptz;
  v_pin_duration           numeric;
  v_pin_day_local          date;
  v_pin_local_start        time;
  v_pin_local_end          time;
  v_pin_overlaps           boolean;
  v_other_idx              integer;
  i                        integer;
  m                        integer;
  v_duration               numeric;
  v_duration_interval      interval;
  v_buffer_after_interval  interval;
  v_buffer_after_minutes   integer;
  v_next_unit_id           uuid;
  v_next_property_id       uuid;
  v_property_drive_minutes integer;
  v_fit_idx                integer;
  v_placement_start        timestamptz;
  v_placement_end          timestamptz;
  v_period_count           integer;
  k                        integer;
  v_conflict               record;
  v_new_starts             timestamptz[];
  v_new_ends               timestamptz[];
  j                        integer;
  v_ps                     timestamptz;
  v_pe                     timestamptz;
  v_new_sa_id              uuid;
  v_new_sa_rn              text;
  v_wo_row                 record;
  v_sa_name                text;
  v_missing_certs          text;
BEGIN
  v_caller_id := public.current_app_user_id();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'bulk_schedule_work_orders: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_sa_scheduled_id FROM picklist_values
   WHERE picklist_object='service_appointments' AND picklist_field='sa_status'
     AND picklist_value='Scheduled' AND picklist_is_active=true;
  SELECT id INTO v_sa_canceled_id FROM picklist_values
   WHERE picklist_object='service_appointments' AND picklist_field='sa_status'
     AND picklist_value='Canceled' AND picklist_is_active=true;
  SELECT id INTO v_wo_scheduled_id FROM picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='work_order_status'
     AND picklist_value='Scheduled' AND picklist_is_active=true;
  SELECT id INTO v_wo_to_be_scheduled_id FROM picklist_values
   WHERE picklist_object='work_orders' AND picklist_field='work_order_status'
     AND picklist_value='To Be Scheduled' AND picklist_is_active=true;

  IF v_sa_scheduled_id IS NULL OR v_wo_scheduled_id IS NULL OR v_wo_to_be_scheduled_id IS NULL THEN
    RAISE EXCEPTION 'required picklist value(s) missing' USING ERRCODE = 'P0001';
  END IF;
  IF p_project_id IS NULL THEN RAISE EXCEPTION 'p_project_id is required' USING ERRCODE='22023'; END IF;
  IF p_work_order_ids IS NULL OR array_length(p_work_order_ids,1) IS NULL THEN
    RAISE EXCEPTION 'p_work_order_ids must contain at least one work order' USING ERRCODE='22023';
  END IF;
  IF p_team_lead_contact_id IS NULL THEN RAISE EXCEPTION 'p_team_lead_contact_id is required' USING ERRCODE='22023'; END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'p_start_date must be <= p_end_date' USING ERRCODE='22023';
  END IF;
  IF p_daily_start_time >= p_lunch_start OR p_lunch_start > p_lunch_end OR p_lunch_end >= p_daily_end_time THEN
    RAISE EXCEPTION 'daily/lunch boundary order invalid' USING ERRCODE='22023';
  END IF;
  IF p_inter_wo_buffer_minutes < 0 THEN RAISE EXCEPTION 'p_inter_wo_buffer_minutes must be >= 0' USING ERRCODE='22023'; END IF;
  IF p_inter_property_buffer_minutes < 0 THEN RAISE EXCEPTION 'p_inter_property_buffer_minutes must be >= 0' USING ERRCODE='22023'; END IF;

  PERFORM 1 FROM projects WHERE id=p_project_id AND project_is_deleted=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'project % not found or deleted', p_project_id USING ERRCODE='P0002'; END IF;

  SELECT contact_title INTO v_lead_title FROM contacts
   WHERE id=p_team_lead_contact_id AND contact_is_deleted=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'team lead contact % not found or deleted', p_team_lead_contact_id USING ERRCODE='P0002'; END IF;
  IF v_lead_title IS NULL OR v_lead_title NOT ILIKE '%team lead%' THEN
    RAISE EXCEPTION 'contact % is not a Team Lead (title: %)', p_team_lead_contact_id, COALESCE(v_lead_title,'(null)') USING ERRCODE='P0001';
  END IF;

  -- SKILLS GATE
  SELECT string_agg(DISTINCT cert.certification_name, ', ' ORDER BY cert.certification_name)
    INTO v_missing_certs
    FROM unnest(p_work_order_ids) AS uw(wo_id)
    JOIN work_orders wo ON wo.id = uw.wo_id
    JOIN work_type_required_certifications wtrc
      ON wtrc.work_type_id = wo.work_type_id AND wtrc.wtrc_is_deleted = false
    JOIN certifications cert
      ON cert.id = wtrc.certification_id
     AND COALESCE(cert.certification_is_active, true) = true
     AND COALESCE(cert.certification_is_deleted, false) = false
    WHERE NOT EXISTS (
      SELECT 1 FROM contact_certifications cc
       WHERE cc.contact_id = p_team_lead_contact_id
         AND cc.certification_id = cert.id
         AND COALESCE(cc.cc_is_deleted, false) = false
         AND (cc.cc_expires_date IS NULL OR cc.cc_expires_date >= p_start_date)
    );
  IF v_missing_certs IS NOT NULL AND v_missing_certs <> '' THEN
    RAISE EXCEPTION 'team lead is missing required certification(s) for one or more work types in this batch: %', v_missing_certs
      USING ERRCODE='P0001';
  END IF;

  PERFORM 1 FROM unnest(p_work_order_ids) AS x(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM work_orders wo
       WHERE wo.id = x.id AND wo.project_id = p_project_id
         AND wo.work_order_is_deleted = false
         AND wo.work_order_status = v_wo_to_be_scheduled_id
    );
  IF FOUND THEN
    RAISE EXCEPTION 'one or more work orders are missing, deleted, on a different project, or not in ''To Be Scheduled'' status' USING ERRCODE='P0001';
  END IF;

  v_wo_count := array_length(p_work_order_ids, 1);
  v_placed_starts         := array_fill(NULL::timestamptz, ARRAY[v_wo_count]);
  v_placed_ends           := array_fill(NULL::timestamptz, ARRAY[v_wo_count]);
  v_placed_sa_ids         := array_fill(NULL::uuid,        ARRAY[v_wo_count]);
  v_placed_sa_record_nums := array_fill(NULL::text,        ARRAY[v_wo_count]);
  v_placement_errors      := array_fill(NULL::text,        ARRAY[v_wo_count]);
  v_wo_is_pinned          := array_fill(false,             ARRAY[v_wo_count]);
  v_wo_pin_forced         := array_fill(false,             ARRAY[v_wo_count]);

  SELECT array_agg(unit_id     ORDER BY idx),
         array_agg(property_id ORDER BY idx),
         array_agg(pb           ORDER BY idx)
    INTO v_wo_unit_ids, v_wo_property_ids, v_wo_post_buffers
    FROM (
      SELECT gs.idx, wo.unit_id, b.property_id,
             COALESCE(wt.work_type_post_buffer_minutes, p_inter_wo_buffer_minutes) AS pb
        FROM generate_subscripts(p_work_order_ids, 1) AS gs(idx)
        JOIN work_orders wo ON wo.id = p_work_order_ids[gs.idx]
        JOIN buildings   b  ON b.id  = wo.building_id
        JOIN work_types  wt ON wt.id = wo.work_type_id
    ) s;

  IF jsonb_array_length(p_pinned_placements) > 0 THEN
    FOR v_pin IN
      SELECT (pin->>'work_order_id')::uuid AS wo_id,
             (pin->>'start_ts')::timestamptz AS start_ts,
             COALESCE((pin->>'force')::boolean, false) AS forced
        FROM jsonb_array_elements(p_pinned_placements) AS pin
    LOOP
      v_pin_idx := NULL;
      FOR i IN 1..v_wo_count LOOP
        IF p_work_order_ids[i] = v_pin.wo_id THEN v_pin_idx := i; EXIT; END IF;
      END LOOP;
      IF v_pin_idx IS NULL THEN CONTINUE; END IF;

      SELECT COALESCE(wo.work_order_duration_minutes, wt.work_type_duration_minutes)
        INTO v_pin_duration
        FROM work_orders wo JOIN work_types wt ON wt.id = wo.work_type_id
       WHERE wo.id = v_pin.wo_id;
      IF v_pin_duration IS NULL OR v_pin_duration <= 0 THEN
        v_placement_errors[v_pin_idx] := 'duration_not_set';
        v_wo_is_pinned[v_pin_idx] := true; CONTINUE;
      END IF;

      v_pin_start := v_pin.start_ts;
      v_pin_end   := v_pin_start + make_interval(mins => v_pin_duration::integer);
      v_pin_day_local := (v_pin_start AT TIME ZONE p_timezone)::date;
      v_pin_local_start := (v_pin_start AT TIME ZONE p_timezone)::time;
      v_pin_local_end   := (v_pin_end   AT TIME ZONE p_timezone)::time;

      IF NOT v_pin.forced THEN
        IF v_pin_day_local < p_start_date OR v_pin_day_local > p_end_date
           OR EXTRACT(DOW FROM v_pin_day_local) IN (0, 6)
           OR v_pin_local_start < p_daily_start_time
           OR v_pin_local_end   > p_daily_end_time
           OR (v_pin_local_start < p_lunch_end AND v_pin_local_end > p_lunch_start)
           OR (v_pin_start AT TIME ZONE p_timezone)::date <> ((v_pin_end - interval '1 second') AT TIME ZONE p_timezone)::date
        THEN
          v_placement_errors[v_pin_idx] := 'pin_outside_working_hours';
          v_wo_is_pinned[v_pin_idx] := true; CONTINUE;
        END IF;
      END IF;

      v_pin_overlaps := false;
      FOR v_other_idx IN 1..v_wo_count LOOP
        IF v_wo_is_pinned[v_other_idx] AND v_placed_starts[v_other_idx] IS NOT NULL
           AND v_placed_ends[v_other_idx] > v_pin_start AND v_placed_starts[v_other_idx] < v_pin_end
        THEN v_pin_overlaps := true; EXIT; END IF;
      END LOOP;
      IF v_pin_overlaps THEN
        v_placement_errors[v_pin_idx] := 'pin_overlaps_existing';
        v_wo_is_pinned[v_pin_idx] := true; CONTINUE;
      END IF;

      v_placed_starts[v_pin_idx] := v_pin_start;
      v_placed_ends[v_pin_idx]   := v_pin_end;
      v_wo_is_pinned[v_pin_idx]  := true;
      v_wo_pin_forced[v_pin_idx] := v_pin.forced;
    END LOOP;
  END IF;

  IF p_commit THEN PERFORM pg_advisory_xact_lock(hashtextextended(p_team_lead_contact_id::text, 0)); END IF;

  v_day := p_start_date;
  WHILE v_day <= p_end_date LOOP
    IF EXTRACT(DOW FROM v_day) NOT IN (0, 6) THEN
      v_period_starts := ARRAY[
        (v_day::text || ' ' || p_daily_start_time::text)::timestamp AT TIME ZONE p_timezone,
        (v_day::text || ' ' || p_lunch_end::text)::timestamp        AT TIME ZONE p_timezone
      ];
      v_period_ends := ARRAY[
        (v_day::text || ' ' || p_lunch_start::text)::timestamp      AT TIME ZONE p_timezone,
        (v_day::text || ' ' || p_daily_end_time::text)::timestamp   AT TIME ZONE p_timezone
      ];

      FOR v_conflict IN
        SELECT sa.sa_scheduled_start_time AS conflict_start, sa.sa_scheduled_end_time AS conflict_end
          FROM service_appointments sa
          JOIN service_appointment_assignments saa
            ON saa.service_appointment_id = sa.id AND saa.saa_is_deleted = false
         WHERE saa.contact_id = p_team_lead_contact_id
           AND sa.sa_is_deleted = false
           AND sa.sa_scheduled_start_time IS NOT NULL
           AND sa.sa_scheduled_end_time   IS NOT NULL
           AND sa.sa_scheduled_end_time   > v_period_starts[1]
           AND sa.sa_scheduled_start_time < v_period_ends[2]
           AND (v_sa_canceled_id IS NULL OR sa.sa_status IS DISTINCT FROM v_sa_canceled_id)
        UNION ALL
        SELECT ra.ra_start_datetime, ra.ra_end_datetime
          FROM resource_absences ra
         WHERE ra.contact_id = p_team_lead_contact_id
           AND COALESCE(ra.ra_is_deleted, false) = false
           AND ra.ra_end_datetime   > v_period_starts[1]
           AND ra.ra_start_datetime < v_period_ends[2]
        UNION ALL
        SELECT v_placed_starts[gs.i], v_placed_ends[gs.i]
          FROM generate_subscripts(v_placed_starts, 1) AS gs(i)
         WHERE v_wo_is_pinned[gs.i] = true
           AND v_placed_starts[gs.i] IS NOT NULL
           AND v_placed_ends[gs.i]   > v_period_starts[1]
           AND v_placed_starts[gs.i] < v_period_ends[2]
        ORDER BY 1
      LOOP
        v_new_starts := ARRAY[]::timestamptz[];
        v_new_ends   := ARRAY[]::timestamptz[];
        FOR j IN 1..COALESCE(array_length(v_period_starts,1),0) LOOP
          v_ps := v_period_starts[j]; v_pe := v_period_ends[j];
          IF v_conflict.conflict_end <= v_ps OR v_conflict.conflict_start >= v_pe THEN
            v_new_starts := v_new_starts || v_ps; v_new_ends := v_new_ends || v_pe;
          ELSE
            IF v_conflict.conflict_start > v_ps THEN
              v_new_starts := v_new_starts || v_ps; v_new_ends := v_new_ends || v_conflict.conflict_start;
            END IF;
            IF v_conflict.conflict_end < v_pe THEN
              v_new_starts := v_new_starts || v_conflict.conflict_end; v_new_ends := v_new_ends || v_pe;
            END IF;
          END IF;
        END LOOP;
        v_period_starts := v_new_starts; v_period_ends := v_new_ends;
        EXIT WHEN COALESCE(array_length(v_period_starts,1),0) = 0;
      END LOOP;

      FOR i IN 1..v_wo_count LOOP
        CONTINUE WHEN v_placed_starts[i]    IS NOT NULL;
        CONTINUE WHEN v_placement_errors[i] IS NOT NULL;

        SELECT COALESCE(wo.work_order_duration_minutes, wt.work_type_duration_minutes)
          INTO v_duration
          FROM work_orders wo JOIN work_types wt ON wt.id = wo.work_type_id
         WHERE wo.id = p_work_order_ids[i];
        IF v_duration IS NULL OR v_duration <= 0 THEN
          v_placement_errors[i] := 'duration_not_set'; CONTINUE;
        END IF;
        v_duration_interval := make_interval(mins => v_duration::integer);

        v_fit_idx := NULL;
        v_period_count := COALESCE(array_length(v_period_starts,1), 0);
        FOR k IN 1..v_period_count LOOP
          IF (v_period_ends[k] - v_period_starts[k]) >= v_duration_interval THEN
            v_fit_idx := k; EXIT;
          END IF;
        END LOOP;

        IF v_fit_idx IS NOT NULL THEN
          v_placement_start := v_period_starts[v_fit_idx];
          v_placement_end   := v_placement_start + v_duration_interval;
          v_placed_starts[i] := v_placement_start;
          v_placed_ends[i]   := v_placement_end;

          v_next_unit_id := NULL;
          v_next_property_id := NULL;
          FOR m IN i+1..v_wo_count LOOP
            IF v_placed_starts[m] IS NULL AND v_placement_errors[m] IS NULL AND NOT v_wo_is_pinned[m] THEN
              v_next_unit_id := v_wo_unit_ids[m];
              v_next_property_id := v_wo_property_ids[m];
              EXIT;
            END IF;
          END LOOP;

          IF v_next_unit_id IS NULL THEN
            v_buffer_after_minutes := 0;
          ELSIF v_next_unit_id = v_wo_unit_ids[i] THEN
            v_buffer_after_minutes := 0;
          ELSIF v_next_property_id IS NOT NULL
                AND v_wo_property_ids[i] IS NOT NULL
                AND v_next_property_id <> v_wo_property_ids[i] THEN
            v_property_drive_minutes := NULL;
            SELECT pd_drive_minutes INTO v_property_drive_minutes
              FROM property_distances
             WHERE origin_property_id = v_wo_property_ids[i]
               AND destination_property_id = v_next_property_id
               AND pd_is_deleted = false
             LIMIT 1;
            v_buffer_after_minutes := COALESCE(v_property_drive_minutes, p_inter_property_buffer_minutes);
          ELSE
            v_buffer_after_minutes := COALESCE(v_wo_post_buffers[i], p_inter_wo_buffer_minutes);
          END IF;
          v_buffer_after_interval := make_interval(mins => v_buffer_after_minutes);

          v_period_starts[v_fit_idx] := v_placement_end + v_buffer_after_interval;
          IF v_period_starts[v_fit_idx] >= v_period_ends[v_fit_idx] THEN
            v_period_starts := v_period_starts[1:v_fit_idx-1] || v_period_starts[v_fit_idx+1:array_length(v_period_starts,1)];
            v_period_ends   := v_period_ends[1:v_fit_idx-1]   || v_period_ends[v_fit_idx+1:array_length(v_period_ends,1)];
          END IF;
        END IF;
      END LOOP;
    END IF;
    v_day := v_day + 1;
  END LOOP;

  FOR i IN 1..v_wo_count LOOP
    IF v_placed_starts[i] IS NULL AND v_placement_errors[i] IS NULL THEN
      v_placement_errors[i] := 'no_capacity_in_window';
    END IF;
  END LOOP;

  IF p_commit THEN
    FOR i IN 1..v_wo_count LOOP
      CONTINUE WHEN v_placed_starts[i] IS NULL;
      CONTINUE WHEN v_placement_errors[i] IS NOT NULL;
      SELECT wo.id AS wo_id, wo.opportunity_id, wo.work_type_id AS wt_id,
             wt.work_type_name AS wt_name, b.building_name AS b_name, u.unit_name AS u_name
        INTO v_wo_row
        FROM work_orders wo
        JOIN work_types wt ON wt.id = wo.work_type_id
        JOIN buildings  b  ON b.id  = wo.building_id
        JOIN units      u  ON u.id  = wo.unit_id
       WHERE wo.id = p_work_order_ids[i];

      v_sa_name := COALESCE(v_wo_row.wt_name,'Work') || ' — ' || COALESCE(v_wo_row.b_name,'') ||
                   CASE WHEN v_wo_row.u_name IS NOT NULL THEN ' / ' || v_wo_row.u_name ELSE '' END;

      INSERT INTO service_appointments (
        sa_record_number, sa_name, sa_owner, sa_created_by,
        work_order_id, work_type_id, opportunity_id, project_id,
        sa_status, sa_scheduled_start_time, sa_scheduled_end_time, sa_duration_minutes
      ) VALUES (
        '', v_sa_name, v_caller_id, v_caller_id,
        p_work_order_ids[i], v_wo_row.wt_id, v_wo_row.opportunity_id, p_project_id,
        v_sa_scheduled_id, v_placed_starts[i], v_placed_ends[i],
        EXTRACT(EPOCH FROM (v_placed_ends[i] - v_placed_starts[i])) / 60.0
      )
      RETURNING id, sa_record_number INTO v_new_sa_id, v_new_sa_rn;

      INSERT INTO service_appointment_assignments (
        saa_record_number, saa_name, saa_created_by, service_appointment_id, contact_id
      ) VALUES (
        '', v_sa_name || ' — Team Lead', v_caller_id, v_new_sa_id, p_team_lead_contact_id
      );

      UPDATE work_orders SET
        work_order_status = v_wo_scheduled_id,
        work_order_scheduled_start_date = (v_placed_starts[i] AT TIME ZONE p_timezone)::date,
        work_order_scheduled_start_time = (v_placed_starts[i] AT TIME ZONE p_timezone)::time,
        work_order_updated_by = v_caller_id, work_order_updated_at = now()
       WHERE id = p_work_order_ids[i];

      v_placed_sa_ids[i]         := v_new_sa_id;
      v_placed_sa_record_nums[i] := v_new_sa_rn;
    END LOOP;
  END IF;

  RETURN QUERY
    SELECT p_work_order_ids[gs.idx], wo.work_order_record_number, wo.work_order_name,
           wt.work_type_name, b.building_name, u.unit_name,
           COALESCE(wo.work_order_duration_minutes, wt.work_type_duration_minutes),
           (v_placed_starts[gs.idx] IS NOT NULL AND v_placement_errors[gs.idx] IS NULL),
           CASE WHEN v_placed_starts[gs.idx] IS NOT NULL AND v_placement_errors[gs.idx] IS NULL
                THEN to_char(v_placed_starts[gs.idx] AT TIME ZONE p_timezone, 'YYYY-MM-DD"T"HH24:MI:SS') END,
           CASE WHEN v_placed_ends[gs.idx] IS NOT NULL AND v_placement_errors[gs.idx] IS NULL
                THEN to_char(v_placed_ends[gs.idx]   AT TIME ZONE p_timezone, 'YYYY-MM-DD"T"HH24:MI:SS') END,
           v_placed_sa_ids[gs.idx], v_placed_sa_record_nums[gs.idx], v_placement_errors[gs.idx]
      FROM generate_subscripts(p_work_order_ids, 1) AS gs(idx)
      JOIN work_orders wo ON wo.id = p_work_order_ids[gs.idx]
      JOIN work_types  wt ON wt.id = wo.work_type_id
      JOIN buildings   b  ON b.id  = wo.building_id
      JOIN units       u  ON u.id  = wo.unit_id
     ORDER BY gs.idx;
END;
$function$;

REVOKE ALL ON FUNCTION public.bulk_schedule_work_orders FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_schedule_work_orders TO authenticated;

COMMENT ON FUNCTION public.bulk_schedule_work_orders IS
'Project Scheduler engine v5. Adds skills enforcement (lead must hold every required cert non-expired on p_start_date) and property travel buffer (different-property transitions get p_inter_property_buffer_minutes or a property_distances matrix lookup). All prior behaviors preserved.';
