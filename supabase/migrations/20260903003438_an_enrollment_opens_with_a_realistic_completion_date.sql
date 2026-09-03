-- Estimated project completion date defaults to the FRIDAY THREE WEEKS OUT
-- (Nicholas, 2026-09-02), "unless manually entered".
--
-- Nothing populated it: zero of 49 live enrollments carry one, and no function
-- in the database referenced the column. So every submission either went out
-- without a completion date or somebody typed one under time pressure.
--
-- THE RULE, stated precisely because "three weeks out" alone is ambiguous:
-- take today, add 21 days, then land on the Friday of THAT week -- i.e. move
-- forward to Friday if the day is not already Friday. Work is scheduled and
-- handed over in weeks, and a week ends on a Friday, so a date mid-week reads
-- as a precision the estimate does not have. Created on a Friday, it stays
-- exactly three weeks out.
--
-- A DEFAULT IS NOT A LOCK. It applies on INSERT and only when the column is
-- blank, so a date somebody entered -- at creation or any time after -- is
-- never rewritten. It is deliberately NOT recomputed on update: an estimate
-- that silently slides forward every time the record is saved is worse than no
-- estimate, because it always looks three weeks away.

CREATE OR REPLACE FUNCTION public.friday_three_weeks_out(p_from date DEFAULT CURRENT_DATE)
RETURNS date
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  -- +21 days, then forward to Friday (ISO dow 5); already-Friday stays put.
  SELECT (p_from + 21) + ((5 - EXTRACT(ISODOW FROM (p_from + 21))::int + 7) % 7);
$function$;
REVOKE ALL ON FUNCTION public.friday_three_weeks_out(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.friday_three_weeks_out(date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.default_enrollment_completion_date()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.enrollment_estimated_completion_date IS NULL THEN
    NEW.enrollment_estimated_completion_date := public.friday_three_weeks_out(CURRENT_DATE);
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.default_enrollment_completion_date() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_1_enrollment_completion_date ON public.enrollments;
CREATE TRIGGER trg_1_enrollment_completion_date
  BEFORE INSERT ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.default_enrollment_completion_date();

DO $$
DECLARE d date; wrong text := '';
BEGIN
  -- Every weekday must land on a Friday, and never sooner than 21 days out.
  FOR i IN 0..13 LOOP
    d := public.friday_three_weeks_out(DATE '2026-09-02' + i);
    IF EXTRACT(ISODOW FROM d) <> 5 THEN
      wrong := wrong || (DATE '2026-09-02' + i)::text || '->' || d::text || ' (not a Friday) ';
    END IF;
    IF d < (DATE '2026-09-02' + i) + 21 THEN
      wrong := wrong || (DATE '2026-09-02' + i)::text || '->' || d::text || ' (less than 21 days) ';
    END IF;
    IF d > (DATE '2026-09-02' + i) + 27 THEN
      wrong := wrong || (DATE '2026-09-02' + i)::text || '->' || d::text || ' (more than 27 days) ';
    END IF;
  END LOOP;
  IF wrong <> '' THEN RAISE EXCEPTION 'friday_three_weeks_out is wrong: %', wrong; END IF;

  -- A Friday stays exactly three weeks out, not four.
  IF public.friday_three_weeks_out(DATE '2026-09-04') <> DATE '2026-09-25' THEN
    RAISE EXCEPTION 'a Friday must stay exactly 21 days out, got %',
      public.friday_three_weeks_out(DATE '2026-09-04');
  END IF;
  -- Today (a Wednesday) -> 2026-09-23 is a Wednesday -> forward to 2026-09-25.
  IF public.friday_three_weeks_out(DATE '2026-09-02') <> DATE '2026-09-25' THEN
    RAISE EXCEPTION 'expected 2026-09-25 from 2026-09-02, got %',
      public.friday_three_weeks_out(DATE '2026-09-02');
  END IF;
END $$;
