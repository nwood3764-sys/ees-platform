-- Two things on the HEAR reservation's Application section.
--
-- 1. OCCUPIED UNITS IS DERIVED, NOT A DEFAULT.
--
-- Nicholas, 2026-09-02, on an 8-unit building reading 7: "The occupied units
-- are always 100% of the units. This is an eight-unit building. It should be
-- eight. Why would you put seven?"
--
-- Both functions that touched the column only ever set it WHEN NULL --
-- set_enrollment_reservation_defaults and sync_enrollment_unit_counts_from_
-- building. So a 7 entered once, or seeded while the building held 7 units,
-- survived every later save even after the building became an 8. A default
-- cannot express "always equal to"; only a derivation can.
--
-- It now follows the building's dwelling-unit count the same way
-- enrollment_units_per_building already does -- forced on insert and on every
-- update, always current. That is a deliberate REMOVAL of a manual override:
-- the rule is 100%, so a different number is not a preference, it is wrong.
--
-- 2. THE ROWS LINE UP.
--
-- "You need to align these. You shouldn't have rows that are cocked like this."
--
-- Not a mis-assigned column -- the eleven fields already alternate 1,2,1,2. The
-- section carried NO full_width field, and the renderer honours `column` only
-- in row-major layout, which it enters when at least one field spans the row.
-- Without one it falls back to column-fill: every column-1 field down the left,
-- then every column-2 field down the right, so the pairs drift out of step by
-- half a row as labels wrap.
--
-- The last field is the one with no partner (eleven fields, five pairs and a
-- remainder), so it takes the full width -- which both anchors row-major layout
-- and stops a lone field sitting in a half-empty row.

CREATE OR REPLACE FUNCTION public.sync_enrollment_unit_counts_from_building()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_total integer;
BEGIN
  IF NEW.building_id IS NULL THEN RETURN NEW; END IF;
  SELECT building_total_units INTO v_total FROM public.buildings WHERE id = NEW.building_id;
  IF v_total IS NULL THEN RETURN NEW; END IF;
  NEW.enrollment_units_per_building := v_total;   -- derived, dwelling-only, always current
  -- Every unit is occupied for programme purposes (Nicholas, 2026-09-02), so
  -- this is derived too -- not defaulted when blank, which is what let a stale
  -- 7 sit on an 8-unit building.
  NEW.enrollment_occupied_units := v_total;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.sync_enrollment_unit_counts_from_building() FROM PUBLIC, anon, authenticated;

SET LOCAL session_replication_role = replica;
UPDATE public.enrollments e
   SET enrollment_occupied_units = b.building_total_units,
       enrollment_units_per_building = b.building_total_units
  FROM public.buildings b
 WHERE b.id = e.building_id
   AND e.enrollment_is_deleted IS NOT TRUE
   AND b.building_total_units IS NOT NULL
   AND (e.enrollment_occupied_units IS DISTINCT FROM b.building_total_units
     OR e.enrollment_units_per_building IS DISTINCT FROM b.building_total_units);
SET LOCAL session_replication_role = origin;

UPDATE public.page_layout_widgets w
   SET widget_config = jsonb_set(
         w.widget_config, '{fields}',
         (SELECT jsonb_agg(
            CASE WHEN f->>'name' = 'building_id.building_number_of_bedrooms'
                 THEN jsonb_set(f, '{full_width}', 'true'::jsonb)
                 ELSE f END
            ORDER BY ord)
          FROM jsonb_array_elements(w.widget_config->'fields') WITH ORDINALITY AS t(f, ord)))
  FROM public.page_layout_sections s, public.page_layouts pl
 WHERE s.id = w.section_id AND pl.id = s.page_layout_id
   AND pl.page_layout_record_number = 'PL-00404'
   AND s.section_label = 'Application'
   AND w.is_deleted IS NOT TRUE AND s.is_deleted IS NOT TRUE AND pl.is_deleted IS NOT TRUE;

DO $$
DECLARE v_bad text; v_full int;
BEGIN
  SELECT string_agg(e.enrollment_record_number || ' (' || e.enrollment_occupied_units ||
                    ' of ' || b.building_total_units || ')', ', ') INTO v_bad
  FROM public.enrollments e
  JOIN public.buildings b ON b.id = e.building_id
  WHERE e.enrollment_is_deleted IS NOT TRUE
    AND b.building_total_units IS NOT NULL
    AND e.enrollment_occupied_units IS DISTINCT FROM b.building_total_units;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'these enrollments still disagree with their building: %', v_bad;
  END IF;

  SELECT count(*) INTO v_full
  FROM public.page_layouts pl
  JOIN public.page_layout_sections s ON s.page_layout_id = pl.id AND s.is_deleted IS NOT TRUE
  JOIN public.page_layout_widgets w ON w.section_id = s.id AND w.is_deleted IS NOT TRUE
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
  WHERE pl.page_layout_record_number = 'PL-00404' AND s.section_label = 'Application'
    AND (f->>'full_width')::boolean IS TRUE;
  IF v_full < 1 THEN
    RAISE EXCEPTION 'the Application section has no full_width field, so `column` is not honoured';
  END IF;
END $$;
