ALTER TABLE public.time_sheets
  ADD COLUMN IF NOT EXISTS ts_employee                                             uuid,
  ADD COLUMN IF NOT EXISTS ts_technician                                           uuid,
  ADD COLUMN IF NOT EXISTS ts_time_sheet_end_date                                  date,
  ADD COLUMN IF NOT EXISTS ts_time_sheet_entries                                   numeric(18,2),
  ADD COLUMN IF NOT EXISTS ts_time_sheet_start_date                                date;
COMMENT ON COLUMN public.time_sheets.ts_time_sheet_entries IS 'SF formula/rollup field. Populated by future trigger or view.';
