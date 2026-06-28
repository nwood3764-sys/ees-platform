-- Income-qualification milestones move from yes/no booleans to dates.
-- Per Nicholas: the opportunity layout needs dates, not yes/no, for the
-- income-qualification lifecycle (submitted, approved, analysis start/complete).

-- 1. New date columns, matching the existing _date naming already on this
--    object (opportunity_qualification_disqualified_date, ..._on_hold_date).
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS opportunity_income_qualification_submitted_date date,
  ADD COLUMN IF NOT EXISTS opportunity_income_qualification_approved_date  date,
  ADD COLUMN IF NOT EXISTS opportunity_qualification_analysis_start_date     date,
  ADD COLUMN IF NOT EXISTS opportunity_qualification_analysis_completed_date date;

COMMENT ON COLUMN public.opportunities.opportunity_income_qualification_submitted_date IS 'Date the income qualification application was submitted.';
COMMENT ON COLUMN public.opportunities.opportunity_income_qualification_approved_date  IS 'Date income qualification was approved.';
COMMENT ON COLUMN public.opportunities.opportunity_qualification_analysis_start_date     IS 'Date the qualification analysis was started.';
COMMENT ON COLUMN public.opportunities.opportunity_qualification_analysis_completed_date IS 'Date the qualification analysis was completed.';

-- 2. Deprecate the superseded boolean flags using the established _del rename
--    convention (cf. opportunity_stage_notes_del). Data preserved, never
--    hard-dropped. Only one record had a single flag set true and there is no
--    real date behind it, so the new date fields correctly start empty.
ALTER TABLE public.opportunities
  RENAME COLUMN opportunity_income_qualification_submitted TO opportunity_income_qualification_submitted_del;
ALTER TABLE public.opportunities
  RENAME COLUMN opportunity_income_qualification_approved TO opportunity_income_qualification_approved_del;
ALTER TABLE public.opportunities
  RENAME COLUMN opportunity_qualification_analysis_start TO opportunity_qualification_analysis_start_del;
ALTER TABLE public.opportunities
  RENAME COLUMN opportunity_qualification_analysis_completed TO opportunity_qualification_analysis_completed_del;

-- 3. Register the new date milestones for field history tracking, consistent
--    with opportunity_close_date.
INSERT INTO public.field_history_tracked_fields (fhtf_table_name, fhtf_column_name, fhtf_is_active, fhtf_description, fhtf_created_by)
VALUES
  ('opportunities', 'opportunity_income_qualification_submitted_date', true, 'Date income qualification application submitted.', 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('opportunities', 'opportunity_income_qualification_approved_date',  true, 'Date income qualification approved.',             'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('opportunities', 'opportunity_qualification_analysis_start_date',    true, 'Date qualification analysis started.',           'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('opportunities', 'opportunity_qualification_analysis_completed_date', true, 'Date qualification analysis completed.',        'c5a01ec8-960f-42ab-8a9e-a49822de89af');
