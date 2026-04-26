ALTER TABLE public.work_steps
  ADD COLUMN IF NOT EXISTS work_step_completed_building                            text;
