-- ============================================================================================
-- list_opportunity_evidence_photos(opportunity) — the data source for the Quality Install
-- Verification photo picker.
-- --------------------------------------------------------------------------------------------
-- The QI tool is opportunity-level: the Project Coordinator picks photos already captured on
-- ANY work order under the opportunity (across all of its projects), categorizes them, and
-- exports a ZIP + PDF. This RPC returns, in ONE round trip, every step-linked evidence photo
-- under the opportunity with the metadata the picker filters and groups on: work order, work
-- type, work step, category, capture time, and GPS. Signed thumbnail URLs are produced
-- client-side in batches (they can't be embedded in a stable migration).
--
-- SECURITY INVOKER: runs as the caller so photo/work-order RLS applies — no new definer lint.
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.list_opportunity_evidence_photos(p_opportunity_id uuid)
 RETURNS TABLE(
   photo_id uuid,
   storage_bucket text,
   storage_path_watermarked text,
   storage_path_original text,
   photo_number text,
   mime_type text,
   taken_at timestamptz,
   latitude double precision,
   longitude double precision,
   caption text,
   photo_type text,
   work_order_id uuid,
   work_order_record_number text,
   work_type_name text,
   work_step_id uuid,
   work_step_name text,
   work_step_category text,
   step_order integer
 )
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH wos AS (
    SELECT w.id, w.work_order_record_number, w.work_type_id
    FROM public.work_orders w
    WHERE w.work_order_is_deleted IS NOT TRUE
      AND (
        w.opportunity_id = p_opportunity_id
        OR w.project_id IN (
          SELECT p.id FROM public.projects p
          WHERE p.opportunity_id = p_opportunity_id AND p.project_is_deleted IS NOT TRUE
        )
      )
  )
  SELECT
    ph.id,
    ph.storage_bucket,
    ph.storage_path_watermarked,
    ph.storage_path_original,
    ph.photo_number::text,
    ph.mime_type,
    ph.taken_at,
    ph.latitude,
    ph.longitude,
    ph.caption,
    ph.photo_type,
    wos.id,
    wos.work_order_record_number,
    wt.work_type_name,
    s.id,
    s.work_step_name,
    s.work_step_category,
    COALESCE(s.work_step_execution_order, s.work_step_plan_execution_order, 2147483647)::integer
  FROM public.photos ph
  JOIN public.work_steps s ON s.id = ph.work_step_id AND s.work_step_is_deleted IS NOT TRUE
  JOIN wos ON wos.id = s.work_order_id
  LEFT JOIN public.work_types wt ON wt.id = wos.work_type_id
  WHERE ph.is_deleted = false
  ORDER BY wt.work_type_name NULLS LAST, wos.work_order_record_number,
           COALESCE(s.work_step_execution_order, s.work_step_plan_execution_order, 2147483647),
           ph.taken_at NULLS LAST;
$function$;

REVOKE ALL ON FUNCTION public.list_opportunity_evidence_photos(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_opportunity_evidence_photos(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
