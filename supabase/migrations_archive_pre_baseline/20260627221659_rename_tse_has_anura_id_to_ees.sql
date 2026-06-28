-- Naming hard rule: the company is Energy Efficiency Services (EES), never "Anura".
-- Rename the time-sheet pre-shift checklist flag accordingly. Safe: boolean,
-- default false, table currently empty, no functions/metadata/app code reference it.
ALTER TABLE public.time_sheet_entries
  RENAME COLUMN tse_has_anura_id TO tse_has_ees_id;
