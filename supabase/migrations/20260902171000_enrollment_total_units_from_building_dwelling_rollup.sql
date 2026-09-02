-- "Total number of units in the building" on an enrollment must be the
-- building's DWELLING-UNIT count (recompute_building_rollups already counts
-- dwelling-only), refreshed on every insert AND update -- not a create-time
-- snapshot. Occupied units are genuine occupancy (often < total), so they are
-- only filled when blank and capped at the total, never blanket-overwritten.
--
-- Already applied to prod via the Supabase MCP; this file mirrors it for branch
-- replays. The backfill only touches rows that are actually wrong.

CREATE OR REPLACE FUNCTION public.sync_enrollment_unit_counts_from_building()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_catalog' AS $fn$
DECLARE v_total integer;
BEGIN
  IF NEW.building_id IS NULL THEN RETURN NEW; END IF;
  SELECT building_total_units INTO v_total FROM public.buildings WHERE id = NEW.building_id;
  IF v_total IS NULL THEN RETURN NEW; END IF;
  NEW.enrollment_units_per_building := v_total;   -- derived, dwelling-only, always current
  IF NEW.enrollment_occupied_units IS NULL THEN
    NEW.enrollment_occupied_units := v_total;
  ELSIF NEW.enrollment_occupied_units > v_total THEN
    NEW.enrollment_occupied_units := v_total;      -- occupied can never exceed total
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_1_enrollment_unit_counts ON public.enrollments;
CREATE TRIGGER trg_1_enrollment_unit_counts
  BEFORE INSERT OR UPDATE ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.sync_enrollment_unit_counts_from_building();

UPDATE public.enrollments e SET
  enrollment_units_per_building = b.building_total_units,
  enrollment_occupied_units = CASE
    WHEN e.enrollment_occupied_units IS NULL THEN b.building_total_units
    WHEN e.enrollment_occupied_units > b.building_total_units THEN b.building_total_units
    ELSE e.enrollment_occupied_units END
FROM public.buildings b
WHERE b.id = e.building_id
  AND e.enrollment_is_deleted IS NOT TRUE
  AND b.building_total_units IS NOT NULL
  AND (e.enrollment_units_per_building IS DISTINCT FROM b.building_total_units
       OR e.enrollment_occupied_units > b.building_total_units);
