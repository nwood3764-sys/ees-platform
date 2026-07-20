-- =============================================================================
-- Work order status lifecycle cleanup
--
-- Two changes requested for the work order status chevron (StatusPathWidget):
--
--   1. "Closed" is not a real work order status — a verified work order is the
--      terminal state ("it's just verified"). Deactivate the Closed picklist
--      value (soft-remove via picklist_is_active) and the now-dead
--      Verified -> Closed transition. No work order uses Closed today.
--
--   2. "Unable to Complete" stays a valid status (used short-term on the
--      verification side) but should NOT appear in the chevron path. Introduce
--      a data-driven `picklist_show_in_path` flag so any picklist value can be
--      kept selectable while being hidden from the Path strip, controlled from
--      LEAP Admin — nothing hardcoded. Mark Unable to Complete hidden.
--
-- The flag defaults to TRUE so every existing value keeps rendering exactly as
-- before. Only the StatusPathWidget's RPC (picklist_values_for_record_type)
-- honors the flag; status-change dropdowns use a different path and continue to
-- offer every active value (so a work order can still be moved to Unable to
-- Complete).
-- =============================================================================

-- 1. Path-visibility flag (additive, default preserves current behavior).
ALTER TABLE public.picklist_values
  ADD COLUMN IF NOT EXISTS picklist_show_in_path boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.picklist_values.picklist_show_in_path IS
  'When false, the value is hidden from the Salesforce-style status Path chevron (StatusPathWidget) but remains a selectable status everywhere else. Managed in LEAP Admin.';

-- 2. Path RPC now excludes values flagged off-path, in addition to inactive
--    values and record-type scoping. Verbatim from the baseline plus the single
--    new WHERE predicate.
CREATE OR REPLACE FUNCTION public.picklist_values_for_record_type(p_object text, p_field text, p_record_type uuid)
 RETURNS TABLE(id uuid, picklist_value text, picklist_label text, picklist_sort_order integer, picklist_description text, scope_mode text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    pv.id,
    pv.picklist_value,
    pv.picklist_label,
    -- Effective order: per-record-type position when set, else global.
    COALESCE(a.pvrta_sort_order, pv.picklist_sort_order) AS picklist_sort_order,
    pv.picklist_description,
    CASE WHEN EXISTS (
      SELECT 1 FROM public.picklist_value_record_type_assignments x
       WHERE x.pvrta_picklist_value_id = pv.id
         AND x.pvrta_is_deleted = false
    ) THEN 'scoped' ELSE 'universal' END AS scope_mode
  FROM public.picklist_values pv
  LEFT JOIN public.picklist_value_record_type_assignments a
    ON a.pvrta_picklist_value_id = pv.id
   AND a.pvrta_record_type_id    = p_record_type
   AND a.pvrta_is_deleted        = false
  WHERE pv.picklist_object = p_object
    AND pv.picklist_field  = p_field
    AND pv.picklist_is_active = true
    AND COALESCE(pv.picklist_show_in_path, true) = true
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.picklist_value_record_type_assignments x
         WHERE x.pvrta_picklist_value_id = pv.id
           AND x.pvrta_is_deleted = false
      )
      OR (
        p_record_type IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.picklist_value_record_type_assignments x
           WHERE x.pvrta_picklist_value_id = pv.id
             AND x.pvrta_record_type_id    = p_record_type
             AND x.pvrta_is_deleted = false
        )
      )
    )
  ORDER BY COALESCE(a.pvrta_sort_order, pv.picklist_sort_order) NULLS LAST, pv.picklist_value;
$function$;

REVOKE ALL ON FUNCTION public.picklist_values_for_record_type(p_object text, p_field text, p_record_type uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.picklist_values_for_record_type(p_object text, p_field text, p_record_type uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.picklist_values_for_record_type(p_object text, p_field text, p_record_type uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.picklist_values_for_record_type(p_object text, p_field text, p_record_type uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.picklist_values_for_record_type(p_object text, p_field text, p_record_type uuid) TO service_role;

-- 3a. "Closed" is no longer a work order status — deactivate it.
UPDATE public.picklist_values
   SET picklist_is_active = false
 WHERE picklist_object = 'work_orders'
   AND picklist_field  = 'work_order_status'
   AND picklist_value  = 'Closed';

-- 3b. Deactivate the now-dead Verified -> Closed transition.
UPDATE public.status_transitions
   SET st_is_active = false
 WHERE st_object = 'work_orders'
   AND st_status_field = 'work_order_status'
   AND st_to_status_id = (
     SELECT id FROM public.picklist_values
      WHERE picklist_object='work_orders' AND picklist_field='work_order_status'
        AND picklist_value='Closed' LIMIT 1
   );

-- 3c. "Unable to Complete" stays selectable but is hidden from the Path chevron.
UPDATE public.picklist_values
   SET picklist_show_in_path = false
 WHERE picklist_object = 'work_orders'
   AND picklist_field  = 'work_order_status'
   AND picklist_value  = 'Unable to Complete';

NOTIFY pgrst, 'reload schema';
