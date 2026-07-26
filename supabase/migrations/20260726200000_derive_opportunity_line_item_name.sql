-- Opportunity line item names are DERIVED, never typed (Nicholas,
-- 2026-07-26: "the name is always concatenated ... it should be a
-- blocked-out field"). Same contract as trg_opportunity_name /
-- trg_unit_name etc.: a BEFORE trigger overwrites oli_name on every
-- write, so user input is never required (and is discarded if sent).
--
-- Name = product name, plus " - <unit name>" when the line is tied to a
-- specific unit. product_id is NOT NULL on opportunity_line_items, so
-- the name is always derivable.

CREATE OR REPLACE FUNCTION public.derive_oli_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_product text;
  v_unit    text;
BEGIN
  SELECT p.product_name INTO v_product FROM products p WHERE p.id = NEW.product_id;
  SELECT u.unit_name INTO v_unit FROM units u WHERE u.id = NEW.unit_id;

  IF v_product IS NOT NULL THEN
    NEW.oli_name := v_product
      || CASE WHEN NULLIF(trim(coalesce(v_unit, '')), '') IS NOT NULL THEN ' - ' || v_unit ELSE '' END;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_oli_name ON public.opportunity_line_items;
CREATE TRIGGER trg_oli_name
  BEFORE INSERT OR UPDATE ON public.opportunity_line_items
  FOR EACH ROW EXECUTE FUNCTION public.derive_oli_name();

-- Backfill: recompute every active line item's name through the trigger.
UPDATE public.opportunity_line_items
SET oli_name = oli_name
WHERE oli_is_deleted IS NOT TRUE;

NOTIFY pgrst, 'reload schema';
