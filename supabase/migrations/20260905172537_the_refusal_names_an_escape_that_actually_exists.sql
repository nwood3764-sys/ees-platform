-- The first refusal told the admin to "clear the equipment on these line items
-- first" — and that is impossible. While the measure still requires equipment,
-- enforce_line_item_equipment_selection refuses to set the line's equipment
-- back to NULL. Clear it and you are blocked; unflag it and you are blocked.
-- The instruction was a dead end, found by RUNNING the probe rather than
-- reading it back: the migration and its message both read correctly.
--
-- The escape that does exist is to remove the line items. So that is what the
-- message says, and the probe now asserts that escape works. It also names the
-- opportunities, because the admin editing a product catalogue has no other way
-- to find out which quoted work is in the way.

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
        '"%" cannot stop requiring equipment: equipment is already recorded against quoted work. Remove these line items first, or leave the measure as it is — %.',
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
