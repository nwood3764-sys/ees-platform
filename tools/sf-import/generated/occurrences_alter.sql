ALTER TABLE public.occurrences
  ADD COLUMN IF NOT EXISTS occurrence_absence_type                                 text,
  ADD COLUMN IF NOT EXISTS occurrence_committed                                    boolean,
  ADD COLUMN IF NOT EXISTS occurrence_date_and_time                                timestamp with time zone,
  ADD COLUMN IF NOT EXISTS occurrence_date_and_time_of_follow_up                   timestamp with time zone,
  ADD COLUMN IF NOT EXISTS occurrence_designated_follow_up_employee                uuid,
  ADD COLUMN IF NOT EXISTS occurrence_employee                                     uuid,
  ADD COLUMN IF NOT EXISTS occurrence_follow_up_employee                           uuid,
  ADD COLUMN IF NOT EXISTS occurrence_incident_type                                text,
  ADD COLUMN IF NOT EXISTS occurrence_integrity                                    boolean,
  ADD COLUMN IF NOT EXISTS occurrence_planned_follow_up_details                    text,
  ADD COLUMN IF NOT EXISTS occurrence_reliable                                     boolean,
  ADD COLUMN IF NOT EXISTS occurrence_reporting_employee                           uuid,
  ADD COLUMN IF NOT EXISTS occurrence_teachable                                    boolean,
  ADD COLUMN IF NOT EXISTS occurrence_trust                                        boolean;
COMMENT ON COLUMN public.occurrences.occurrence_absence_type IS 'SF formula/rollup field. Populated by future trigger or view.';
