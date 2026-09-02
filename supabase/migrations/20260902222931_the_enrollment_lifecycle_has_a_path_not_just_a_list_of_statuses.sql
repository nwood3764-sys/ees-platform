-- Enrollments had EIGHT statuses and ONE transition: (new) -> Enrollment To Be
-- Prepared. Nothing said what follows what, so the status path had no path and
-- the record offered no Move-to buttons -- a status could only be picked out of
-- a dropdown, with nothing to stop it going from Approved back to To Be
-- Prepared, or straight from Prepared to Approved without ever being verified.
--
-- Nicholas, 2026-09-02, on the statuses arriving with no order: "in the next
-- stages or statuses, aren't they?"
--
-- THE ORDER IS READ FROM THE NAMES, because LEAP names a status [Object]
-- [State] and every one of these states implies its successor: prepared, then
-- verified by a second person, then submitted to the programme, then the
-- programme answers -- approved, corrections needed, or denied.
--
--   To Be Prepared -> To Be Verified -> Verified -> Submitted
--                                                     |
--                          Approved <-----------------+-----> Denied
--                                                     |
--                                          Corrections Needed
--
-- The rework edges matter as much as the forward ones: a verifier who finds a
-- problem must be able to send it back, and Corrections Needed must lead
-- somewhere or a rejected submission is stranded. Withdrawn is reachable from
-- every state that is not already an outcome, because a project can be pulled
-- at any point before the programme has answered.
--
-- NOT reachable: anything out of Approved or Denied. Those are the programme's
-- answer, not ours to edit. Reopening one is a new enrollment.

INSERT INTO public.status_transitions
  (st_record_number, st_object, st_status_field, st_from_status_id, st_to_status_id,
   st_transition_label, st_description, st_sort_order, st_is_active, st_owner, st_created_by)
SELECT '', 'enrollments', 'enrollment_status', f.id, t.id, s.label, s.descr, s.ord, true, u.id, u.id
FROM (VALUES
  ('Enrollment To Be Prepared', 'Enrollment To Be Verified',
   'Ready for Verification', 'The packet is assembled and ready for a second set of eyes.', 10),
  ('Enrollment To Be Verified', 'Enrollment Verified',
   'Mark Verified', 'The verifier has checked the packet and it is correct.', 20),
  ('Enrollment To Be Verified', 'Enrollment To Be Prepared',
   'Send Back for Rework', 'The verifier found a problem; it returns to preparation.', 30),
  ('Enrollment Verified', 'Enrollment Submitted — Awaiting Program Response',
   'Mark Submitted', 'Filed with the program administrator.', 40),
  ('Enrollment Verified', 'Enrollment To Be Prepared',
   'Reopen for Rework', 'Something needs changing before it is filed.', 50),
  ('Enrollment Submitted — Awaiting Program Response', 'Enrollment Approved',
   'Mark Approved', 'The program administrator approved the enrollment.', 60),
  ('Enrollment Submitted — Awaiting Program Response', 'Enrollment Corrections Needed',
   'Corrections Requested', 'The program administrator asked for changes.', 70),
  ('Enrollment Submitted — Awaiting Program Response', 'Enrollment Denied',
   'Mark Denied', 'The program administrator denied the enrollment.', 80),
  ('Enrollment Corrections Needed', 'Enrollment To Be Prepared',
   'Rework the Packet', 'Take the corrections back through preparation.', 90),
  ('Enrollment Corrections Needed', 'Enrollment Submitted — Awaiting Program Response',
   'Resubmit', 'Corrections made and refiled without a full rework.', 100),
  ('Enrollment To Be Prepared', 'Enrollment Withdrawn',
   'Withdraw', 'The enrollment will not be pursued.', 110),
  ('Enrollment To Be Verified', 'Enrollment Withdrawn',
   'Withdraw', 'The enrollment will not be pursued.', 120),
  ('Enrollment Verified', 'Enrollment Withdrawn',
   'Withdraw', 'The enrollment will not be pursued.', 130),
  ('Enrollment Submitted — Awaiting Program Response', 'Enrollment Withdrawn',
   'Withdraw', 'Pulled before the program answered.', 140),
  ('Enrollment Corrections Needed', 'Enrollment Withdrawn',
   'Withdraw', 'The enrollment will not be pursued.', 150)
) AS s(from_value, to_value, label, descr, ord)
JOIN public.picklist_values f
  ON f.picklist_object='enrollments' AND f.picklist_field='enrollment_status'
 AND f.picklist_value = s.from_value
JOIN public.picklist_values t
  ON t.picklist_object='enrollments' AND t.picklist_field='enrollment_status'
 AND t.picklist_value = s.to_value
CROSS JOIN (SELECT id FROM public.users WHERE id='c5a01ec8-960f-42ab-8a9e-a49822de89af') u
WHERE NOT EXISTS (
  SELECT 1 FROM public.status_transitions x
   WHERE x.st_object='enrollments' AND x.st_status_field='enrollment_status'
     AND x.st_from_status_id = f.id AND x.st_to_status_id = t.id
     AND x.st_is_deleted IS NOT TRUE);

DO $$
DECLARE n int; v_stranded text;
BEGIN
  SELECT count(*) INTO n FROM public.status_transitions
   WHERE st_object='enrollments' AND st_is_deleted IS NOT TRUE AND st_from_status_id IS NOT NULL;
  IF n <> 15 THEN RAISE EXCEPTION 'expected 15 enrollment transitions, found %', n; END IF;

  -- Every status a record can sit in must be reachable, or it is a value
  -- nothing can ever get to.
  SELECT string_agg(pv.picklist_value, ', ') INTO v_stranded
  FROM public.picklist_values pv
  WHERE pv.picklist_object='enrollments' AND pv.picklist_field='enrollment_status'
    AND pv.picklist_is_active
    AND NOT EXISTS (SELECT 1 FROM public.status_transitions st
                     WHERE st.st_to_status_id = pv.id AND st.st_is_deleted IS NOT TRUE);
  IF v_stranded IS NOT NULL THEN
    RAISE EXCEPTION 'these statuses cannot be reached from anywhere: %', v_stranded;
  END IF;

  -- And nothing leads out of an outcome the programme gave us.
  IF EXISTS (
    SELECT 1 FROM public.status_transitions st
    JOIN public.picklist_values f ON f.id = st.st_from_status_id
    WHERE st.st_object='enrollments' AND st.st_is_deleted IS NOT TRUE
      AND f.picklist_value IN ('Enrollment Approved','Enrollment Denied','Enrollment Withdrawn'))
  THEN
    RAISE EXCEPTION 'a transition leads out of a final outcome';
  END IF;
END $$;
