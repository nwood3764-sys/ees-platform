-- Drop the two leftover Salesforce-import relationship columns on assessments.
--
-- `assessment_opportunity` and `assessment_building_del` are duplicate copies of
-- `opportunity_id` and `building_id` — plain uuid columns with no foreign key,
-- so nothing kept them honest. Migration 20260816174500 repointed every
-- assessment layout onto the real FK columns and the create-prefill stopped
-- writing the copies, leaving these two doing nothing. Approved for removal by
-- Nicholas, 2026-08-16.
--
-- Verified before dropping (live prod):
--   • 13 assessments; 0 rows where the legacy column holds a value the real FK
--     is missing, and 0 rows where the two disagree — nothing unique is lost.
--   • No view, function, trigger, index, constraint, or RLS policy references
--     either column.
--   • No live page-layout widget references them (2 soft-deleted widget rows on
--     the IQ Assessment Layout still name assessment_opportunity in their JSON;
--     those are dead config the renderer never reads).
--   • No report, list view, dashboard, permission, or field-metadata row
--     references them; no application code reads or writes them.
--
-- Row data is untouched: this removes two columns, not any assessment.
ALTER TABLE public.assessments DROP COLUMN assessment_opportunity;
ALTER TABLE public.assessments DROP COLUMN assessment_building_del;

NOTIFY pgrst, 'reload schema';
