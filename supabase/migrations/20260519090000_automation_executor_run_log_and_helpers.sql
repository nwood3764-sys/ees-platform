-- Run log table for automation_rules firings.
--
-- Records every automation rule firing for observability + audit. A row is
-- inserted whether the rule succeeds, errors, or is skipped due to a missed
-- condition. The dispatcher itself (`execute_automation_rules`) also writes
-- an error row when it crashes outright (rule_id = NULL, action_type =
-- 'dispatcher'). Indexed for the two most common reads: by trigger record
-- (showing all firings related to one source record) and by rule (showing
-- the firing history of one rule).

CREATE TABLE IF NOT EXISTS public.automation_run_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arl_record_number     text NOT NULL DEFAULT '',
  arl_rule_id           uuid REFERENCES public.automation_rules(id),
  arl_rule_name         text,
  arl_trigger_object    text NOT NULL,
  arl_trigger_record_id uuid NOT NULL,
  arl_trigger_event     text NOT NULL,
  arl_trigger_status    text,
  arl_action_type       text NOT NULL,
  arl_outcome           text NOT NULL CHECK (arl_outcome IN ('success','error','skipped')),
  arl_outcome_message   text,
  arl_created_target_id uuid,  -- task / work_order / notification_log row created by the action
  arl_fired_at          timestamptz NOT NULL DEFAULT now(),
  arl_fired_by          uuid REFERENCES public.users(id),
  arl_created_at        timestamptz NOT NULL DEFAULT now(),
  arl_is_deleted        boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_arl_trigger_record
  ON public.automation_run_log (arl_trigger_object, arl_trigger_record_id);
CREATE INDEX IF NOT EXISTS idx_arl_rule
  ON public.automation_run_log (arl_rule_id);
CREATE INDEX IF NOT EXISTS idx_arl_fired_at
  ON public.automation_run_log (arl_fired_at DESC);

-- Auto-numbering trigger so arl_record_number gets ARL-#### on insert.
CREATE OR REPLACE FUNCTION public.trg_automation_run_log_number()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_seq integer;
BEGIN
  IF NEW.arl_record_number IS NULL OR NEW.arl_record_number = '' THEN
    SELECT count(*) + 1 INTO v_seq FROM public.automation_run_log;
    NEW.arl_record_number := 'ARL-' || lpad(v_seq::text, 6, '0');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS automation_run_log_number ON public.automation_run_log;
CREATE TRIGGER automation_run_log_number
BEFORE INSERT ON public.automation_run_log
FOR EACH ROW EXECUTE FUNCTION public.trg_automation_run_log_number();
