-- A line item carries oli_is_equipment_line, a CACHED copy of the measure's
-- own products.product_requires_equipment_selection. The line's trigger
-- refreshes it on every write of the LINE — but nothing refreshed it when the
-- PRODUCT changed, so every line written before a measure was marked as
-- requiring equipment kept saying it needed none.
--
-- Two live heat pump lines (OLI-00035, OLI-00039) carry FALSE against a measure
-- flagged TRUE, and the Products grid reads the cached column: the Equipment
-- cell showed the same dash a line that installs nothing shows. Nicholas, on
-- exactly those lines: "It did not do that for the heat pump."
--
-- A copy needs a cascade or it lies. This backfills the drift and installs the
-- cascade; the grid is separately repointed at the product's own flag, so the
-- screen no longer depends on the copy being right.

-- 1. Backfill. session_replication_role = replica so the line's own triggers do
--    not fire: enforce_line_item_equipment_selection would REFUSE these very
--    rows (that is the defect being recorded, not one to introduce), and the
--    audit logger must not record a migration as a person editing 2 records.
SET LOCAL session_replication_role = replica;

UPDATE public.opportunity_line_items oli
   SET oli_is_equipment_line = COALESCE(p.product_requires_equipment_selection, false)
  FROM public.products p
 WHERE p.id = oli.product_id
   AND oli.oli_is_deleted IS NOT TRUE
   AND oli.oli_is_equipment_line IS DISTINCT FROM COALESCE(p.product_requires_equipment_selection, false);

SET LOCAL session_replication_role = origin;

-- 2. The cascade. When a measure starts or stops requiring equipment, its live
--    lines are re-stamped. Deliberately NOT clearing equipment when a measure
--    stops requiring it: the equipment that was recorded is a fact about work
--    that was quoted, and dropping it would be silent data loss.
CREATE OR REPLACE FUNCTION public.cascade_product_equipment_requirement_to_line_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.opportunity_line_items
     SET oli_is_equipment_line = COALESCE(NEW.product_requires_equipment_selection, false)
   WHERE product_id = NEW.id
     AND oli_is_deleted IS NOT TRUE
     AND oli_is_equipment_line IS DISTINCT FROM COALESCE(NEW.product_requires_equipment_selection, false);
  RETURN NEW;
END;
$$;

-- A trigger function promoted to SECURITY DEFINER must revoke EXECUTE in the
-- same migration: a plain CREATE FUNCTION leaves the default PUBLIC grant, and
-- PostgreSQL does not check EXECUTE when it FIRES a trigger (2026-08-31).
REVOKE EXECUTE ON FUNCTION public.cascade_product_equipment_requirement_to_line_items() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cascade_product_equipment_requirement_to_line_items() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cascade_product_equipment_requirement_to_line_items() FROM authenticated;

DROP TRIGGER IF EXISTS trg_product_equipment_requirement_cascade ON public.products;
CREATE TRIGGER trg_product_equipment_requirement_cascade
AFTER UPDATE OF product_requires_equipment_selection ON public.products
FOR EACH ROW
WHEN (OLD.product_requires_equipment_selection IS DISTINCT FROM NEW.product_requires_equipment_selection)
EXECUTE FUNCTION public.cascade_product_equipment_requirement_to_line_items();

-- 3. Assert. Zero live lines may disagree with their measure.
DO $$
DECLARE v_drift int;
BEGIN
  SELECT count(*) INTO v_drift
    FROM public.opportunity_line_items oli
    JOIN public.products p ON p.id = oli.product_id
   WHERE oli.oli_is_deleted IS NOT TRUE
     AND oli.oli_is_equipment_line IS DISTINCT FROM COALESCE(p.product_requires_equipment_selection, false);
  IF v_drift <> 0 THEN
    RAISE EXCEPTION 'Backfill left % line item(s) disagreeing with their measure.', v_drift;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.products'::regclass
       AND tgname = 'trg_product_equipment_requirement_cascade'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'The cascade trigger did not install.';
  END IF;
END $$;
