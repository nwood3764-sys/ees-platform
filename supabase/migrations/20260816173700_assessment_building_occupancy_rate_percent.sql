-- Assessment occupancy rate: hold a percentage, not a fraction.
--
-- Creating an Assessment from an opportunity failed with "numeric field
-- overflow" (Nicholas, 2026-08-16). The create prefill seeds the assessment's
-- occupancy from the property's occupancy percentage
-- (property_mf_raw_pct_occupied / property_ph_pct_occupied — live values run
-- 0..100, e.g. 94.09 on 5513 North Hopkins Street), but the column was declared
-- numeric(3,2), which cannot hold anything at or above 10.
--
-- Every occupancy figure in LEAP is a percentage, so the column is widened to
-- numeric(5,2) (0.00..999.99) to match its sources rather than the prefill
-- being changed to a fraction. Nothing is lost: zero assessment rows carry a
-- value today, and no other code reads this column.
ALTER TABLE public.assessments
  ALTER COLUMN assessment_building_occupancy_rate TYPE numeric(5,2);

COMMENT ON COLUMN public.assessments.assessment_building_occupancy_rate IS
  'Occupied share of the building as a percentage (0-100), inherited from the property''s occupancy percentage at create.';
