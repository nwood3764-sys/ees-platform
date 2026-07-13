-- =====================================================================
-- Work order status automation (Nicholas, 2026-07-13):
-- a work order stays Scheduled until its work steps are actually
-- started, then flips to In Progress automatically on the FIRST step
-- activity — a photo captured on a step, a video attached to a step,
-- or a step status leaving New. Nothing else moves it.
--
-- Only transitions New/Scheduled → In Progress. Later statuses
-- (To Be Verified, Verified, Closed, Unable to Complete) are never
-- touched by this automation. Without this, nothing moved a work order
-- into In Progress and submit_work_order_for_verification (which
-- requires In Progress) could never be reached.
--
-- Applied to production 2026-07-13 via MCP; live-fire verified in a
-- rolled-back transaction (step start flipped Scheduled → In Progress).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.mark_work_order_in_progress_from_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  -- work order status ids
  s_new         uuid := 'd7863107-4c8a-40da-b34e-88debf4bc39a';  -- New
  s_sched       uuid := '5df84bfd-f2fa-4a1d-9c15-dddf43341771';  -- Scheduled
  s_in_progress uuid := '827dd144-e8e8-47eb-9786-d876a1d8198f';  -- In Progress
  v_wo uuid;
BEGIN
  -- Resolve the parent work order per invoking table.
  IF TG_TABLE_NAME = 'work_steps' THEN
    v_wo := NEW.work_order_id;
  ELSIF TG_TABLE_NAME = 'photos' THEN
    SELECT ws.work_order_id INTO v_wo FROM public.work_steps ws WHERE ws.id = NEW.work_step_id;
  ELSIF TG_TABLE_NAME = 'documents' THEN
    SELECT ws.work_order_id INTO v_wo FROM public.work_steps ws WHERE ws.id = NEW.related_id;
  END IF;

  IF v_wo IS NULL THEN RETURN NULL; END IF;

  UPDATE public.work_orders
     SET work_order_status = s_in_progress,
         work_order_updated_at = now()
   WHERE id = v_wo
     AND work_order_is_deleted IS NOT TRUE
     AND work_order_status IN (s_new, s_sched);

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_work_order_in_progress_from_activity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_work_order_in_progress_from_activity() TO authenticated, service_role;

-- A step's status leaving New = work has started.
DROP TRIGGER IF EXISTS trg_work_steps_start_wo ON public.work_steps;
CREATE TRIGGER trg_work_steps_start_wo
  AFTER UPDATE OF work_step_status ON public.work_steps
  FOR EACH ROW
  WHEN (OLD.work_step_status IS DISTINCT FROM NEW.work_step_status
        AND NEW.work_step_status <> 'e83b77fa-9902-4329-bd2c-a0b73df782ba'  -- not (back to) New
        AND NEW.work_step_is_deleted IS NOT TRUE)
  EXECUTE FUNCTION public.mark_work_order_in_progress_from_activity();

-- First evidence photo on a step = work has started.
DROP TRIGGER IF EXISTS trg_photos_start_wo ON public.photos;
CREATE TRIGGER trg_photos_start_wo
  AFTER INSERT ON public.photos
  FOR EACH ROW
  WHEN (NEW.work_step_id IS NOT NULL AND NEW.is_deleted = false)
  EXECUTE FUNCTION public.mark_work_order_in_progress_from_activity();

-- First evidence video (step-scoped document) = work has started.
DROP TRIGGER IF EXISTS trg_documents_start_wo ON public.documents;
CREATE TRIGGER trg_documents_start_wo
  AFTER INSERT ON public.documents
  FOR EACH ROW
  WHEN (NEW.related_object = 'work_steps' AND NEW.is_deleted = false)
  EXECUTE FUNCTION public.mark_work_order_in_progress_from_activity();

NOTIFY pgrst, 'reload schema';
