-- Enrollments are building-specific: an assessment pre-approval enrollment is
-- for ONE building, so "Number of Buildings" on the form is always 1 — it must
-- come from the enrollment/building, never the parent property's total building
-- count. Give enrollments their own building-specific column, defaulting to 1.
ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS enrollment_number_of_buildings integer NOT NULL DEFAULT 1;

-- Every existing enrollment is one building.
UPDATE public.enrollments
SET enrollment_number_of_buildings = 1
WHERE enrollment_number_of_buildings IS DISTINCT FROM 1;
