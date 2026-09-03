-- The enrollments that predate the completion-date default get one.
--
-- 20260903003438 made "Friday three weeks out" the default for a NEW
-- enrollment, deliberately on INSERT only: an estimate that silently slides
-- forward every time the record is saved is worse than no estimate, because it
-- always looks three weeks away.
--
-- That left every enrollment created before it with no date at all -- which did
-- not matter until the date became a mapped, REQUIRED answer on the HEAR form.
-- Now it does: the completeness gate refuses to open the form for a required
-- answer that is blank, so 4 of the 5 live HEAR reservations were blocked on a
-- field LEAP is supposed to fill by itself. A gate that fires on the platform's
-- own omission teaches people to distrust the gate.
--
-- So the blanks are filled with what the rule would have given them. This is
-- the same shape as the Low-Income backfill: a blank taking the only answer it
-- could have had, never an existing date being rewritten. Under replica, so the
-- audit log does not record edits nobody made.
--
-- It stays insert-only afterwards. This is a one-time catch-up for records that
-- existed before the rule, not a recurring sweep -- a sweep is exactly the
-- always-three-weeks-away behaviour the original migration refused to build.

SET LOCAL session_replication_role = replica;

UPDATE public.enrollments
   SET enrollment_estimated_completion_date = public.friday_three_weeks_out(CURRENT_DATE)
 WHERE enrollment_is_deleted IS NOT TRUE
   AND enrollment_estimated_completion_date IS NULL;

SET LOCAL session_replication_role = origin;

DO $assert$
DECLARE v_blank int; v_not_friday int;
BEGIN
  SELECT count(*) INTO v_blank FROM public.enrollments
   WHERE enrollment_is_deleted IS NOT TRUE AND enrollment_estimated_completion_date IS NULL;
  IF v_blank <> 0 THEN
    RAISE EXCEPTION '% live enrollments still have no estimated completion date', v_blank;
  END IF;

  -- Every date on the platform must be a Friday, backfilled or defaulted. A
  -- mid-week date reads as a precision the estimate does not have.
  SELECT count(*) INTO v_not_friday FROM public.enrollments
   WHERE enrollment_is_deleted IS NOT TRUE
     AND EXTRACT(ISODOW FROM enrollment_estimated_completion_date) <> 5;
  IF v_not_friday <> 0 THEN
    RAISE EXCEPTION '% enrollments carry a completion date that is not a Friday', v_not_friday;
  END IF;
END $assert$;
