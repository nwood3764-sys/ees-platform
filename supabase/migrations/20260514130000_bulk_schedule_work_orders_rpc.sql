-- ─────────────────────────────────────────────────────────────────────────────
-- bulk_schedule_work_orders — Project Scheduler engine
--
-- Phase 1 of the dispatcher console: lays out a batch of unscheduled Work
-- Orders for one Project across a date range, assigned to one Team Lead.
-- Models the Salesforce FSL "Schedule" action on a Service Resource +
-- multi-WO batch.
--
-- Single function, dual-mode via p_commit:
--   p_commit = false  → preview-only: returns the placement plan, writes nothing
--   p_commit = true   → commit: re-runs the algorithm under an advisory lock,
--                       INSERTs SA + SAA per placed WO, UPDATEs WO status
--
-- Algorithm: for each working day in [p_start_date, p_end_date] (excludes
-- weekends), the day's available periods are
--   [p_daily_start_time, p_lunch_start] ∪ [p_lunch_end, p_daily_end_time]
-- minus any existing service_appointments and resource_absences for the
-- team lead. WOs are placed greedily in input order, earliest fitting
-- period first, with p_inter_wo_buffer_minutes between consecutive WOs.
--
-- Effective WO duration =
--   COALESCE(work_orders.work_order_duration_minutes,
--            work_types.work_type_duration_minutes)
-- NULL → WO returned as unplaced with placement_error='duration_not_set'.
--
-- Validation: project exists & not deleted; every WO belongs to project,
-- isn't deleted, is in status 'To Be Scheduled'; team lead exists,
-- isn't deleted, has 'Team Lead' in contact_title; date order valid;
-- daily/lunch boundary order valid.
--
-- Concurrency: on commit, pg_advisory_xact_lock on the team lead's contact
-- id. Two dispatchers can schedule different team leads in parallel; the
-- same team lead serializes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.bulk_schedule_work_orders(
  p_project_id                uuid,
  p_work_order_ids            uuid[],
  p_team_lead_contact_id      uuid,
  p_start_date                date,
  p_end_date                  date,
  p_daily_start_time          time      DEFAULT '07:00'::time,
  p_daily_end_time            time      DEFAULT '15:30'::time,
  p_lunch_start               time      DEFAULT '11:30'::time,
  p_lunch_end                 time      DEFAULT '12:00'::time,
  p_inter_wo_buffer_minutes   integer   DEFAULT 15,
  p_timezone                  text      DEFAULT 'America/Chicago',
  p_commit                    boolean   DEFAULT false
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Parallel arrays sized to length(p_work_order_ids)
  v_placed_starts          timestamptz[];
  v_placed_ends            timestamptz[];
  v_placed_sa_ids          uuid[];
  v_placed_sa_record_nums  text[];
  v_placement_errors       text[];

  v_wo_count               integer;
  i                        integer;
  v_duration               numeric;
  v_duration_interval      interval;
  v_buffer_interval        interval;
  v_fit_idx                integer;
  v_placement_start        timestamptz;
  v_placement_end          timestamptz;
  v_period_count           integer;
  k                        integer;

  -- Per-day conflict-carve locals
  v_conflict               record;
  v_new_starts             timestamptz[];
  v_new_ends               timestamptz[];
  j                        integer;
  v_ps                     timestamptz;
  v_pe                     timestamptz;

  -- Commit-phase locals
  v_new_sa_id              uuid;
  v_new_sa_rn              text;
  v_wo_row                 record;
  v_sa_name                text;
BEGIN
  -- ─── Resolve caller and required picklist ids ─────────────────────────────
  v_caller_id := public.current_app_user_id();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'bulk_schedule_work_orders: caller not authenticated'
      USING ERRCODE = '28000';
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

  IF v_sa_scheduled_id IS NULL OR v_wo_scheduled_id IS NULL
     OR v_wo_to_be_scheduled_id IS NULL THEN
    RAISE EXCEPTION 'required picklist value(s) missing (sa.Scheduled, wo.Scheduled, wo.To Be Scheduled)'
      USING ERRCODE = 'P0001';
  END IF;

  -- ─── Input validation ─────────────────────────────────────────────────────
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'p_project_id is required' USING ERRCODE='22023';
  END IF;
  IF p_work_order_ids IS NULL OR array_length(p_work_order_ids,1) IS NULL THEN
    RAISE EXCEPTION 'p_work_order_ids must contain at least one work order'
      USING ERRCODE='22023';
  END IF;
  IF p_team_lead_contact_id IS NULL THEN
    RAISE EXCEPTION 'p_team_lead_contact_id is required' USING ERRCODE='22023';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'p_start_date must be ≤ p_end_date' USING ERRCODE='22023';
  END IF;
  IF p_daily_start_time >= p_lunch_start
     OR p_lunch_start > p_lunch_end
     OR p_lunch_end >= p_daily_end_time THEN
    RAISE EXCEPTION 'daily/lunch boundary order invalid' USING ERRCODE='22023';
  END IF;
  IF p_inter_wo_buffer_minutes < 0 THEN
    RAISE EXCEPTION 'p_inter_wo_buffer_minutes must be ≥ 0' USING ERRCODE='22023';
  END IF;

  -- Project must exist
  PERFORM 1 FROM projects WHERE id=p_project_id AND project_is_deleted=false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project % not found or deleted', p_project_id
      USING ERRCODE='P0002';
  END IF;

  -- Team lead must exist with a Team Lead title
  SELECT contact_title INTO v_lead_title
    FROM contacts
   WHERE id=p_team_lead_contact_id AND contact_is_deleted=false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'team lead contact % not found or deleted', p_team_lead_contact_id
      USING ERRCODE='P0002';
  END IF;
  IF v_lead_title IS NULL OR v_lead_title NOT ILIKE '%team lead%' THEN
    RAISE EXCEPTION 'contact % is not a Team Lead (title: %)',
      p_team_lead_contact_id, COALESCE(v_lead_title,'(null)')
      USING ERRCODE='P0001';
  END IF;

  -- All WO ids must belong to project, be in To Be Scheduled, and not deleted
  PERFORM 1 FROM unnest(p_work_order_ids) AS x(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM work_orders wo
       WHERE wo.id = x.id
         AND wo.project_id = p_project_id
         AND wo.work_order_is_deleted = false
         AND wo.work_order_status = v_wo_to_be_scheduled_id
    );
  IF FOUND THEN
    RAISE EXCEPTION 'one or more work orders are missing, deleted, on a different project, or not in ''To Be Scheduled'' status'
      USING ERRCODE='P0001';
  END IF;

  v_wo_count := array_length(p_work_order_ids, 1);
  v_buffer_interval := make_interval(mins => p_inter_wo_buffer_minutes);

  v_placed_starts         := array_fill(NULL::timestamptz, ARRAY[v_wo_count]);
  v_placed_ends           := array_fill(NULL::timestamptz, ARRAY[v_wo_count]);
  v_placed_sa_ids         := array_fill(NULL::uuid,        ARRAY[v_wo_count]);
  v_placed_sa_record_nums := array_fill(NULL::text,        ARRAY[v_wo_count]);
  v_placement_errors      := array_fill(NULL::text,        ARRAY[v_wo_count]);

  -- ─── Take advisory lock if committing (serialise per team lead) ───────────
  IF p_commit THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_team_lead_contact_id::text, 0));
  END IF;

  -- ─── Walk days in window; place WOs greedily ──────────────────────────────
  v_day := p_start_date;
  WHILE v_day <= p_end_date LOOP
    -- Skip weekends (DOW: Sun=0, Sat=6)
    IF EXTRACT(DOW FROM v_day) NOT IN (0, 6) THEN
      -- Build today's initial available periods (morning, afternoon)
      v_period_starts := ARRAY[
        (v_day::text || ' ' || p_daily_start_time::text)::timestamp AT TIME ZONE p_timezone,
        (v_day::text || ' ' || p_lunch_end::text)::timestamp        AT TIME ZONE p_timezone
      ];
      v_period_ends := ARRAY[
        (v_day::text || ' ' || p_lunch_start::text)::timestamp      AT TIME ZONE p_timezone,
        (v_day::text || ' ' || p_daily_end_time::text)::timestamp   AT TIME ZONE p_timezone
      ];

      -- Carve out conflicts: existing SAs on this team lead + absences
      FOR v_conflict IN
        SELECT sa.sa_scheduled_start_time AS conflict_start,
               sa.sa_scheduled_end_time   AS conflict_end
          FROM service_appointments sa
          JOIN service_appointment_assignments saa
            ON saa.service_appointment_id = sa.id
           AND saa.saa_is_deleted = false
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
        ORDER BY 1
      LOOP
        v_new_starts := ARRAY[]::timestamptz[];
        v_new_ends   := ARRAY[]::timestamptz[];
        FOR j IN 1..COALESCE(array_length(v_period_starts,1),0) LOOP
          v_ps := v_period_starts[j];
          v_pe := v_period_ends[j];
          IF v_conflict.conflict_end <= v_ps OR v_conflict.conflict_start >= v_pe THEN
            -- no overlap; keep period intact
            v_new_starts := v_new_starts || v_ps;
            v_new_ends   := v_new_ends   || v_pe;
          ELSE
            -- pre-conflict remainder
            IF v_conflict.conflict_start > v_ps THEN
              v_new_starts := v_new_starts || v_ps;
              v_new_ends   := v_new_ends   || v_conflict.conflict_start;
            END IF;
            -- post-conflict remainder
            IF v_conflict.conflict_end < v_pe THEN
              v_new_starts := v_new_starts || v_conflict.conflict_end;
              v_new_ends   := v_new_ends   || v_pe;
            END IF;
            -- otherwise the conflict fully eats this period → drop it
          END IF;
        END LOOP;
        v_period_starts := v_new_starts;
        v_period_ends   := v_new_ends;
        EXIT WHEN COALESCE(array_length(v_period_starts,1),0) = 0;
      END LOOP;

      -- Place WOs into remaining periods, in input order
      FOR i IN 1..v_wo_count LOOP
        CONTINUE WHEN v_placed_starts[i]    IS NOT NULL;
        CONTINUE WHEN v_placement_errors[i] IS NOT NULL;

        SELECT COALESCE(wo.work_order_duration_minutes, wt.work_type_duration_minutes)
          INTO v_duration
          FROM work_orders wo
          JOIN work_types  wt ON wt.id = wo.work_type_id
         WHERE wo.id = p_work_order_ids[i];
        IF v_duration IS NULL OR v_duration <= 0 THEN
          v_placement_errors[i] := 'duration_not_set';
          CONTINUE;
        END IF;
        v_duration_interval := make_interval(mins => v_duration::integer);

        v_fit_idx := NULL;
        v_period_count := COALESCE(array_length(v_period_starts,1), 0);
        FOR k IN 1..v_period_count LOOP
          IF (v_period_ends[k] - v_period_starts[k]) >= v_duration_interval THEN
            v_fit_idx := k;
            EXIT;
          END IF;
        END LOOP;

        IF v_fit_idx IS NOT NULL THEN
          v_placement_start := v_period_starts[v_fit_idx];
          v_placement_end   := v_placement_start + v_duration_interval;
          v_placed_starts[i] := v_placement_start;
          v_placed_ends[i]   := v_placement_end;
          v_period_starts[v_fit_idx] := v_placement_end + v_buffer_interval;
          IF v_period_starts[v_fit_idx] >= v_period_ends[v_fit_idx] THEN
            v_period_starts := v_period_starts[1:v_fit_idx-1] || v_period_starts[v_fit_idx+1:array_length(v_period_starts,1)];
            v_period_ends   := v_period_ends[1:v_fit_idx-1]   || v_period_ends[v_fit_idx+1:array_length(v_period_ends,1)];
          END IF;
        END IF;
      END LOOP;
    END IF; -- weekday

    v_day := v_day + 1;
  END LOOP;

  -- Fill placement_error for anything still unplaced
  FOR i IN 1..v_wo_count LOOP
    IF v_placed_starts[i] IS NULL AND v_placement_errors[i] IS NULL THEN
      v_placement_errors[i] := 'no_capacity_in_window';
    END IF;
  END LOOP;

  -- ─── Commit phase: insert SAs + SAAs, flip WO status ──────────────────────
  IF p_commit THEN
    FOR i IN 1..v_wo_count LOOP
      CONTINUE WHEN v_placed_starts[i] IS NULL;

      SELECT wo.id              AS wo_id,
             wo.opportunity_id  AS opportunity_id,
             wo.work_type_id    AS wt_id,
             wt.work_type_name  AS wt_name,
             b.building_name    AS b_name,
             u.unit_name        AS u_name
        INTO v_wo_row
        FROM work_orders wo
        JOIN work_types  wt ON wt.id = wo.work_type_id
        JOIN buildings   b  ON b.id  = wo.building_id
        JOIN units       u  ON u.id  = wo.unit_id
       WHERE wo.id = p_work_order_ids[i];

      v_sa_name := COALESCE(v_wo_row.wt_name,'Work') || ' — ' ||
                   COALESCE(v_wo_row.b_name,'') ||
                   CASE WHEN v_wo_row.u_name IS NOT NULL
                        THEN ' / ' || v_wo_row.u_name ELSE '' END;

      INSERT INTO service_appointments (
        sa_record_number, sa_name, sa_owner, sa_created_by,
        work_order_id, work_type_id, opportunity_id, project_id,
        sa_status,
        sa_scheduled_start_time, sa_scheduled_end_time, sa_duration_minutes
      ) VALUES (
        '', v_sa_name, v_caller_id, v_caller_id,
        p_work_order_ids[i], v_wo_row.wt_id, v_wo_row.opportunity_id, p_project_id,
        v_sa_scheduled_id,
        v_placed_starts[i], v_placed_ends[i],
        EXTRACT(EPOCH FROM (v_placed_ends[i] - v_placed_starts[i])) / 60.0
      )
      RETURNING id, sa_record_number INTO v_new_sa_id, v_new_sa_rn;

      INSERT INTO service_appointment_assignments (
        saa_record_number, saa_name, saa_created_by,
        service_appointment_id, contact_id
      ) VALUES (
        '',
        v_sa_name || ' — Team Lead',
        v_caller_id,
        v_new_sa_id,
        p_team_lead_contact_id
      );

      UPDATE work_orders SET
        work_order_status               = v_wo_scheduled_id,
        work_order_scheduled_start_date = (v_placed_starts[i] AT TIME ZONE p_timezone)::date,
        work_order_scheduled_start_time = (v_placed_starts[i] AT TIME ZONE p_timezone)::time,
        work_order_updated_by           = v_caller_id,
        work_order_updated_at           = now()
       WHERE id = p_work_order_ids[i];

      v_placed_sa_ids[i]         := v_new_sa_id;
      v_placed_sa_record_nums[i] := v_new_sa_rn;
    END LOOP;
  END IF;

  -- ─── Return placement plan (same shape for preview and commit) ────────────
  RETURN QUERY
    SELECT
      p_work_order_ids[gs.i]                                         AS work_order_id,
      wo.work_order_record_number                                    AS work_order_record_number,
      wo.work_order_name                                             AS work_order_name,
      wt.work_type_name                                              AS work_type_name,
      b.building_name                                                AS building_name,
      u.unit_name                                                    AS unit_name,
      COALESCE(wo.work_order_duration_minutes,
               wt.work_type_duration_minutes)                        AS duration_minutes,
      (v_placed_starts[gs.i] IS NOT NULL)                            AS placed,
      CASE WHEN v_placed_starts[gs.i] IS NOT NULL
           THEN to_char(v_placed_starts[gs.i] AT TIME ZONE p_timezone,
                        'YYYY-MM-DD"T"HH24:MI:SS') END               AS scheduled_start_iso,
      CASE WHEN v_placed_ends[gs.i] IS NOT NULL
           THEN to_char(v_placed_ends[gs.i] AT TIME ZONE p_timezone,
                        'YYYY-MM-DD"T"HH24:MI:SS') END               AS scheduled_end_iso,
      v_placed_sa_ids[gs.i]                                          AS service_appointment_id,
      v_placed_sa_record_nums[gs.i]                                  AS service_appointment_record_number,
      v_placement_errors[gs.i]                                       AS placement_error
    FROM generate_subscripts(p_work_order_ids, 1) AS gs(i)
    JOIN work_orders wo ON wo.id = p_work_order_ids[gs.i]
    JOIN work_types  wt ON wt.id = wo.work_type_id
    JOIN buildings   b  ON b.id  = wo.building_id
    JOIN units       u  ON u.id  = wo.unit_id
    ORDER BY gs.i;
END;
$function$;

REVOKE ALL ON FUNCTION public.bulk_schedule_work_orders FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_schedule_work_orders TO authenticated;

COMMENT ON FUNCTION public.bulk_schedule_work_orders IS
'Project Scheduler engine. Lays out a batch of unscheduled work orders for one project across a date range, assigned to one Team Lead. p_commit=false returns a preview plan; p_commit=true writes SAs/SAAs/WO status under an advisory lock on the team lead.';
