ALTER TABLE public.incentives
  ADD COLUMN IF NOT EXISTS incentive_account                                       uuid,
  ADD COLUMN IF NOT EXISTS incentive_commission_amount                             numeric(18,2),
  ADD COLUMN IF NOT EXISTS incentive_date_commission_paid                          date,
  ADD COLUMN IF NOT EXISTS incentive_ee_measure                                    uuid,
  ADD COLUMN IF NOT EXISTS incentive_franklin_work_order_number                    text,
  ADD COLUMN IF NOT EXISTS incentive_incentive_amount                              numeric(18,2),
  ADD COLUMN IF NOT EXISTS incentive_incentive_cycle                               numeric(18,0),
  ADD COLUMN IF NOT EXISTS incentive_incentive_issue_date                          date,
  ADD COLUMN IF NOT EXISTS incentive_incentive_processing_time                     numeric(18,0),
  ADD COLUMN IF NOT EXISTS incentive_incentive_received_date                       date,
  ADD COLUMN IF NOT EXISTS incentive_incentive_submitted_date                      date,
  ADD COLUMN IF NOT EXISTS incentive_opportunity                                   uuid,
  ADD COLUMN IF NOT EXISTS incentive_project                                       uuid,
  ADD COLUMN IF NOT EXISTS incentive_projected_incentive_receive_date              date,
  ADD COLUMN IF NOT EXISTS incentive_solutions_advisor                             text,
  ADD COLUMN IF NOT EXISTS incentive_subcontractor_paid_date                       date;
COMMENT ON COLUMN public.incentives.incentive_commission_amount IS 'SF formula/rollup field. Populated by future trigger or view.';
COMMENT ON COLUMN public.incentives.incentive_incentive_cycle IS 'SF formula/rollup field. Populated by future trigger or view.';
COMMENT ON COLUMN public.incentives.incentive_incentive_processing_time IS 'SF formula/rollup field. Populated by future trigger or view.';
COMMENT ON COLUMN public.incentives.incentive_projected_incentive_receive_date IS 'SF formula/rollup field. Populated by future trigger or view.';
COMMENT ON COLUMN public.incentives.incentive_solutions_advisor IS 'SF formula/rollup field. Populated by future trigger or view.';
