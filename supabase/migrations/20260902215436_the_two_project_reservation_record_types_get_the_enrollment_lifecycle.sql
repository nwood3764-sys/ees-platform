-- WI-IRA-MF-HOMES-Project-Reservation and WI-IRA-MF-HEAR-Project-Reservation
-- had ZERO enrollment_status values selected, while the other seven enrollment
-- record types each carry all eight. So a reservation's Status dropdown offered
-- only its own current value and nothing to move to -- correct behaviour for an
-- unconfigured lifecycle (20260902, show_none), and exactly the gap that
-- record_types_missing_status_configuration() was built to report.
--
-- The eight statuses are a SHARED lifecycle -- an enrollment is prepared,
-- verified, submitted, approved or denied whatever programme it belongs to --
-- unlike opportunity stages, which are 1:1 per record type and never shared.
-- So these two record types take the same set the other seven use, in the same
-- order, copied from an existing record type rather than retyped: same values,
-- same sequence, and the order cannot drift from the set it was copied from.

INSERT INTO public.picklist_value_record_type_assignments
  (pvrta_record_number, pvrta_picklist_value_id, pvrta_record_type_id, pvrta_sort_order,
   pvrta_owner, pvrta_created_by)
SELECT '', src.pvrta_picklist_value_id, target.id, src.pvrta_sort_order, u.id, u.id
FROM public.picklist_value_record_type_assignments src
JOIN public.picklist_values srt ON srt.id = src.pvrta_record_type_id
JOIN public.picklist_values pv  ON pv.id  = src.pvrta_picklist_value_id
CROSS JOIN (SELECT id FROM public.users WHERE id='c5a01ec8-960f-42ab-8a9e-a49822de89af') u
JOIN public.picklist_values target
  ON target.picklist_object = 'enrollments' AND target.picklist_field = 'record_type'
 AND target.picklist_value IN ('WI-IRA-MF-HOMES-Project-Reservation',
                               'WI-IRA-MF-HEAR-Project-Reservation')
WHERE srt.picklist_object = 'enrollments' AND srt.picklist_field = 'record_type'
  AND srt.picklist_value = 'WI-IRA-MF-HOMES-Assessment-Preapproval'
  AND pv.picklist_object = 'enrollments' AND pv.picklist_field = 'enrollment_status'
  AND src.pvrta_is_deleted IS NOT TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.picklist_value_record_type_assignments x
     WHERE x.pvrta_picklist_value_id = src.pvrta_picklist_value_id
       AND x.pvrta_record_type_id = target.id
       AND x.pvrta_is_deleted IS NOT TRUE);

DO $$
DECLARE r record; v_bad text := '';
BEGIN
  FOR r IN
    SELECT rt.picklist_value AS record_type, count(*) AS n
    FROM public.picklist_value_record_type_assignments a
    JOIN public.picklist_values pv ON pv.id = a.pvrta_picklist_value_id
    JOIN public.picklist_values rt ON rt.id = a.pvrta_record_type_id
    WHERE pv.picklist_object='enrollments' AND pv.picklist_field='enrollment_status'
      AND a.pvrta_is_deleted IS NOT TRUE
      AND rt.picklist_value IN ('WI-IRA-MF-HOMES-Project-Reservation',
                                'WI-IRA-MF-HEAR-Project-Reservation')
    GROUP BY rt.picklist_value
  LOOP
    IF r.n <> 8 THEN v_bad := v_bad || r.record_type || '=' || r.n || ' '; END IF;
  END LOOP;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'expected 8 statuses on each reservation record type, got: %', v_bad;
  END IF;
  IF (SELECT count(DISTINCT rt.picklist_value)
        FROM public.picklist_value_record_type_assignments a
        JOIN public.picklist_values pv ON pv.id = a.pvrta_picklist_value_id
        JOIN public.picklist_values rt ON rt.id = a.pvrta_record_type_id
       WHERE pv.picklist_object='enrollments' AND pv.picklist_field='enrollment_status'
         AND a.pvrta_is_deleted IS NOT TRUE
         AND rt.picklist_value LIKE '%Project-Reservation') <> 2
  THEN
    RAISE EXCEPTION 'one of the two Project-Reservation record types was not configured';
  END IF;
END $$;
