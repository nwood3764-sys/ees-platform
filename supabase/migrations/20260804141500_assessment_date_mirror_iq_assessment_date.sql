-- The assessments table has a NOT NULL `assessment_date` (label "Date") that is
-- NOT on the page layout, so the create form's required-field check blocked
-- saves ("Required field missing: Date") even when the user filled "Date of IQ
-- Assessment" (assessment_date_of_iq_assessment). Across all existing
-- assessments, assessment_date already equals the IQ assessment date, so the
-- two are the same concept — the required column was simply hidden.
--
-- Fix (no layout change, no data change):
--   1. Give assessment_date a DEFAULT so ees_table_metadata stops listing it as
--      a hard required field on the create form.
--   2. Mirror it from the on-form date via a BEFORE INSERT/UPDATE trigger so the
--      NOT NULL constraint is always satisfied with the correct value.
ALTER TABLE public.assessments ALTER COLUMN assessment_date SET DEFAULT CURRENT_DATE;

CREATE OR REPLACE FUNCTION public.assessment_date_mirror_iq()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- The visible "Date of IQ Assessment" is authoritative; fall back to the
  -- generic assessment date fields, then today, so the required column is never
  -- null regardless of which date field the layout exposes.
  NEW.assessment_date := COALESCE(
    NEW.assessment_date_of_iq_assessment,
    NEW.assessment_date_of_assessment,
    NEW.assessment_date,
    CURRENT_DATE
  );
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_assessment_date_mirror ON public.assessments;
CREATE TRIGGER trg_assessment_date_mirror
  BEFORE INSERT OR UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.assessment_date_mirror_iq();
