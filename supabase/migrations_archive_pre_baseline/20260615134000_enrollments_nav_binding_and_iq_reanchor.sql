-- Bind the existing Enrollment nav section to the new table.
UPDATE public.module_sections
SET ms_object_table='enrollments', ms_updated_at=now()
WHERE ms_label='Enrollment' AND ms_object_table IS NULL AND ms_is_deleted=false;

-- Income-qualification tool re-anchored from incentive_applications to
-- enrollments at the code layer (incomeQualificationService.js,
-- IncomeQualificationPanel.jsx, RecordDetail.jsx). The determination now
-- writes onto the enrollment record's own fields; the legacy
-- income_qualifications table is no longer used by the tool. program_id
-- NOT NULL was dropped on that table earlier this session.
ALTER TABLE public.income_qualifications ALTER COLUMN program_id DROP NOT NULL;
