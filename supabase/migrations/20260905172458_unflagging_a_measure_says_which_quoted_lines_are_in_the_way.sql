-- Two rules collided, and the first cut of the cascade lost to the older one.
--
-- enforce_line_item_equipment_selection refuses any line that carries equipment
-- for a measure which does not require it. So when the cascade installed in
-- 20260905172049 re-stamped the lines of a measure being UNFLAGGED, the line
-- guard threw — and the admin, who was editing a product, got a message about
-- a line item they had never seen. Un-flagging a measure with priced lines
-- became impossible for a reason nothing on screen explained.
--
-- The direction matters, so the cascade now distinguishes them:
--   gaining the requirement  — safe; the lines are simply stamped.
--   losing it, no equipment recorded — safe; the lines are stamped.
--   losing it WITH equipment recorded — refused, naming the lines.
--
-- Refused rather than cleared: that equipment is a fact about work already
-- quoted, and the supplemental data sheet reports it per unit. Deleting it as
-- a side effect of an unrelated product edit is silent data loss.
--
-- Superseded one statement later by 20260905172537, which fixes the escape the
-- message names; kept as its own file because it is what was applied to prod.

CREATE OR REPLACE FUNCTION public.cascade_product_equipment_requirement_to_line_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requires boolean := COALESCE(NEW.product_requires_equipment_selection, false);
  v_blocking text;
BEGIN
  IF NOT v_requires THEN
    SELECT string_agg(DISTINCT COALESCE(o.opportunity_record_number, '?') || ' / ' ||
                      COALESCE(oli.oli_record_number, '?'), ', ')
      INTO v_blocking
      FROM public.opportunity_line_items oli
      LEFT JOIN public.opportunities o ON o.id = oli.opportunity_id
     WHERE oli.product_id = NEW.id
       AND oli.oli_is_deleted IS NOT TRUE
       AND oli.oli_equipment_product_id IS NOT NULL;

    IF v_blocking IS NOT NULL THEN
      RAISE EXCEPTION
        '"%" cannot stop requiring equipment while equipment is recorded against it. Clear the equipment on these line items first: %.',
        COALESCE(NEW.product_name, 'This measure'), v_blocking;
    END IF;
  END IF;

  UPDATE public.opportunity_line_items
     SET oli_is_equipment_line = v_requires
   WHERE product_id = NEW.id
     AND oli_is_deleted IS NOT TRUE
     AND oli_is_equipment_line IS DISTINCT FROM v_requires;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cascade_product_equipment_requirement_to_line_items() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cascade_product_equipment_requirement_to_line_items() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cascade_product_equipment_requirement_to_line_items() FROM authenticated;
