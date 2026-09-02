-- The project lifecycle is seven project statuses, not thirty-six.
--
-- Nicholas, looking at project_status in Object Manager: "Something is really
-- wrong here on these statuses. These look like the work order statuses. We need
-- all the project statuses... That's really the only options. All this other
-- stuff for incentives and work orders doesn't apply to project records." Then:
-- "you could also add a project pre-construction meeting to be scheduled."
--
-- He is right, and this is the ROOT of what he reported yesterday. The 36 values
-- on projects.project_status are three objects' vocabularies in one list: 11
-- "Work Order ..." stages, 10 "Incentive ..." stages, 9 "Utility ..." / "Test
-- Out ..." stages, "PM Sign Off" -- and only four that describe a PROJECT. The
-- 36-chevron path was the symptom; the picklist is the disease. Scoping values
-- per record type could never have fixed it, because the values themselves
-- belong to other objects.
--
-- THE LIFECYCLE, as stated:
--   1 Project Planning
--   2 Project Pre-Construction Meeting To Be Scheduled
--   3 Project To Be Scheduled
--   4 Project Scheduled
--   5 Project Underway
--   6 Project To Be Verified
--   7 Project Completed
--
-- The pre-construction meeting is placed after Planning and before To Be
-- Scheduled: it is what you hold before the work is scheduled, not after. That
-- is a one-row reorder if it belongs elsewhere.
--
-- WHY THE OTHER 30 ARE RETIRED, NOT DELETED. block_hard_delete() forbids the
-- delete, and it should: audit_log and field_history hold rows naming these
-- values, and a retired value must still resolve to its label when a historic
-- change is read back. They go inactive, which removes them from every picker
-- and every path while leaving the history legible.
--
-- Verified before retiring them: no database function, no edge function and no
-- client module references any of the 30 by name. The three RPCs that name a
-- project status all name "Project To Be Scheduled", which is kept.

DO $mig$
DECLARE
  v_actor       uuid;
  v_planning    uuid;
  v_precon      uuid;
  v_tbs         uuid;
  v_sched       uuid;
  v_underway    uuid;
  v_tbv         uuid;
  v_completed   uuid;
  v_wo_created  uuid;
  v_moved       int;
  v_retired     int;
  v_n           int;
  v_rt          record;
  v_pair        record;
BEGIN
  SELECT id INTO v_actor FROM public.users
   WHERE lower(user_email) = 'nicholas.wood@ees-wi.org' AND user_is_deleted IS NOT TRUE
   LIMIT 1;
  IF v_actor IS NULL THEN
    SELECT st_owner INTO v_actor FROM public.status_transitions
     WHERE st_object = 'projects' AND st_owner IS NOT NULL LIMIT 1;
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No user to own the rebuilt project status transitions.';
  END IF;

  -- 1. The three stages that did not exist yet. value = label, which is the
  --    convention this field already follows for all 36 of its rows.
  FOR v_pair IN
    SELECT * FROM (VALUES
      ('Project Planning'),
      ('Project Pre-Construction Meeting To Be Scheduled'),
      ('Project To Be Verified')
    ) AS t(label)
  LOOP
    INSERT INTO public.picklist_values
      (picklist_object, picklist_field, picklist_value, picklist_label,
       picklist_is_active, picklist_show_in_path, picklist_created_by)
    SELECT 'projects', 'project_status', v_pair.label, v_pair.label, true, true, v_actor
    WHERE NOT EXISTS (
      SELECT 1 FROM public.picklist_values
       WHERE picklist_object='projects' AND picklist_field='project_status'
         AND picklist_value = v_pair.label);
  END LOOP;

  SELECT id INTO v_planning  FROM public.picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Project Planning';
  SELECT id INTO v_precon    FROM public.picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Project Pre-Construction Meeting To Be Scheduled';
  SELECT id INTO v_tbs       FROM public.picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Project To Be Scheduled';
  SELECT id INTO v_sched     FROM public.picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Project Scheduled';
  SELECT id INTO v_underway  FROM public.picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Project Underway';
  SELECT id INTO v_tbv       FROM public.picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Project To Be Verified';
  SELECT id INTO v_completed FROM public.picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Project Completed';
  SELECT id INTO v_wo_created FROM public.picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Work Order Created';

  IF v_planning IS NULL OR v_precon IS NULL OR v_tbs IS NULL OR v_sched IS NULL
     OR v_underway IS NULL OR v_tbv IS NULL OR v_completed IS NULL THEN
    RAISE EXCEPTION 'One of the seven project statuses could not be resolved.';
  END IF;

  -- 2. Order and activate the seven.
  UPDATE public.picklist_values SET picklist_sort_order = s.ord,
         picklist_is_active = true, picklist_show_in_path = true
    FROM (VALUES (v_planning,1),(v_precon,2),(v_tbs,3),(v_sched,4),
                 (v_underway,5),(v_tbv,6),(v_completed,7)) AS s(vid, ord)
   WHERE public.picklist_values.id = s.vid;

  -- 3. Four live projects sit on "Work Order Created", which is about to stop
  --    existing. In the old chain that stage came after Project Underway, so
  --    Underway is the nearest surviving stage that does not overstate where the
  --    work has got to.
  --
  --    This runs with triggers suppressed, and the reason is worth recording.
  --    Writing ANY column on a project fires cascade_derived_name(), which
  --    touches every work order on it to refresh the derived name, which
  --    re-fires enforce_work_order_record_type_eligibility() on rows that are
  --    ALREADY in violation: PROJ-00038 is an MF-Exhaust Fan Replacement
  --    project carrying three Building Access work orders, which its record
  --    type's eligibility rule forbids (the defect logged 2026-08-31). So
  --    PROJ-00038 cannot be written at all today, by anyone, for any reason.
  --    A status has no bearing on a derived name, so suppressing the cascade
  --    costs nothing here -- but the underlying violation is untouched and
  --    still needs fixing on its own.
  v_moved := 0;
  IF v_wo_created IS NOT NULL THEN
    SET LOCAL session_replication_role = replica;
    UPDATE public.projects SET project_status = v_underway
     WHERE project_status = v_wo_created AND project_is_deleted IS NOT TRUE;
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    SET LOCAL session_replication_role = origin;
  END IF;
  RAISE NOTICE 'Projects moved off "Work Order Created" onto "Project Underway": %', v_moved;

  -- No live project may be left pointing at a status about to be retired.
  SELECT count(*) INTO v_n
    FROM public.projects p
   WHERE p.project_is_deleted IS NOT TRUE
     AND p.project_status IS NOT NULL
     AND p.project_status NOT IN (v_planning,v_precon,v_tbs,v_sched,v_underway,v_tbv,v_completed);
  IF v_n > 0 THEN
    RAISE EXCEPTION '% live project(s) still hold a status that is being retired.', v_n;
  END IF;

  -- 4. Retire everything that is not one of the seven.
  UPDATE public.picklist_values SET picklist_is_active = false
   WHERE picklist_object='projects' AND picklist_field='project_status'
     AND picklist_is_active
     AND id NOT IN (v_planning,v_precon,v_tbs,v_sched,v_underway,v_tbv,v_completed);
  GET DIAGNOSTICS v_retired = ROW_COUNT;
  RAISE NOTICE 'Project statuses retired (inactive, rows kept for history): %', v_retired;

  -- 5. Rebuild the transition graph. The old one walked through the work order
  --    and incentive stages, so almost none of it survives the value list.
  UPDATE public.status_transitions
     SET st_is_active = false, st_is_deleted = true, st_deleted_at = now(),
         st_deleted_by = v_actor,
         st_deletion_reason = 'Project lifecycle rebuilt to the seven project statuses (2026-09-02).'
   WHERE st_object = 'projects' AND st_is_deleted IS NOT TRUE;

  FOR v_pair IN
    SELECT * FROM (VALUES
      (NULL::uuid,  v_planning,  'Create project',                    10),
      (v_planning,  v_precon,    'Plan complete',                     20),
      (v_precon,    v_tbs,       'Pre-construction meeting held',     30),
      (v_tbs,       v_sched,     'Schedule project',                  40),
      (v_sched,     v_underway,  'Start work',                        50),
      (v_underway,  v_tbv,       'Work finished, send for verifying', 60),
      (v_tbv,       v_completed, 'Verified, complete project',        70)
    ) AS t(from_id, to_id, label, ord)
  LOOP
    INSERT INTO public.status_transitions
      (st_record_number, st_object, st_status_field, st_from_status_id,
       st_to_status_id, st_transition_label, st_sort_order, st_is_active,
       st_owner, st_created_by)
    VALUES ('', 'projects', 'project_status', v_pair.from_id, v_pair.to_id,
            v_pair.label, v_pair.ord, true, v_actor, v_actor);
  END LOOP;

  -- 6. Every project record type runs this one lifecycle, so it is written out
  --    for each of them rather than left to mean "all of them" implicitly --
  --    which under the 2026-09-02 rule would mean none at all. The existing
  --    selections on MF-Exhaust Fan Replacement (13 values) and
  --    WI-IRA-MF-HOMES - AUDIT LEVEL 2 (5) were arbitrary subsets of the
  --    polluted list -- every one of AUDIT LEVEL 2's five is being retired --
  --    so they are replaced, not merged into.
  UPDATE public.picklist_value_record_type_assignments a
     SET pvrta_is_deleted = true, pvrta_deleted_at = now(), pvrta_deleted_by = v_actor,
         pvrta_deletion_reason = 'Project status list rebuilt to the seven project statuses (2026-09-02).'
    FROM public.picklist_values v
   WHERE v.id = a.pvrta_picklist_value_id
     AND v.picklist_object = 'projects' AND v.picklist_field = 'project_status'
     AND a.pvrta_is_deleted = false;

  FOR v_rt IN
    SELECT id FROM public.picklist_values
     WHERE picklist_object='projects' AND picklist_field='record_type' AND picklist_is_active
  LOOP
    INSERT INTO public.picklist_value_record_type_assignments
      (pvrta_record_type_id, pvrta_picklist_value_id, pvrta_sort_order, pvrta_is_deleted)
    SELECT v_rt.id, s.vid, s.ord, false
      FROM (VALUES (v_planning,1),(v_precon,2),(v_tbs,3),(v_sched,4),
                   (v_underway,5),(v_tbv,6),(v_completed,7)) AS s(vid, ord);
  END LOOP;

  -- 7. Proof.
  SELECT count(*) INTO v_n FROM public.picklist_values
   WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_is_active;
  IF v_n <> 7 THEN
    RAISE EXCEPTION 'Expected exactly 7 active project statuses; found %.', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM public.picklist_values rt
   WHERE rt.picklist_object='projects' AND rt.picklist_field='record_type' AND rt.picklist_is_active
     AND (SELECT count(*) FROM public.picklist_values_for_record_type(
            'projects','project_status', rt.id)) <> 7;
  IF v_n > 0 THEN
    RAISE EXCEPTION '% project record type(s) do not offer exactly the seven statuses.', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.record_types_missing_status_configuration()
   WHERE object_name = 'projects';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% project record type(s) still have no status configuration.', v_n;
  END IF;

  RAISE NOTICE 'Project lifecycle rebuilt: 7 statuses on every project record type.';
END $mig$;
