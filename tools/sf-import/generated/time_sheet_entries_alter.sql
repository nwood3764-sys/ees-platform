ALTER TABLE public.time_sheet_entries
  ADD COLUMN IF NOT EXISTS tse_anura_time_sheet                                    uuid,
  ADD COLUMN IF NOT EXISTS tse_check_in_screening_passed                           boolean,
  ADD COLUMN IF NOT EXISTS tse_check_out_screening_passed                          boolean,
  ADD COLUMN IF NOT EXISTS tse_crew_exposure                                       text,
  ADD COLUMN IF NOT EXISTS tse_duration_in_hours                                   numeric(18,2),
  ADD COLUMN IF NOT EXISTS tse_employee                                            uuid,
  ADD COLUMN IF NOT EXISTS tse_exposed_to_other_crews                              boolean,
  ADD COLUMN IF NOT EXISTS tse_has_camel_bak                                       boolean,
  ADD COLUMN IF NOT EXISTS tse_lunch_duration_in_hours                             numeric(18,2),
  ADD COLUMN IF NOT EXISTS tse_lunch_end                                           timestamp with time zone,
  ADD COLUMN IF NOT EXISTS tse_lunch_start                                         timestamp with time zone,
  ADD COLUMN IF NOT EXISTS tse_project                                             uuid,
  ADD COLUMN IF NOT EXISTS tse_technician                                          uuid,
  ADD COLUMN IF NOT EXISTS tse_temperature_check_complete                          boolean,
  ADD COLUMN IF NOT EXISTS tse_time_sheet_date                                     date,
  ADD COLUMN IF NOT EXISTS tse_work_day_total_duration                             numeric(18,2);
COMMENT ON COLUMN public.time_sheet_entries.tse_duration_in_hours IS 'SF formula/rollup field. Populated by future trigger or view.';
COMMENT ON COLUMN public.time_sheet_entries.tse_lunch_duration_in_hours IS 'SF formula/rollup field. Populated by future trigger or view.';
COMMENT ON COLUMN public.time_sheet_entries.tse_work_day_total_duration IS 'SF formula/rollup field. Populated by future trigger or view.';
