-- "Conditioned Floor Area of Multifamily Building (sq ft)" on the HEAR
-- reservation read buildings.building_conditioned_floor_area_sq_ft, which is
-- empty on all 88 live buildings and has never held a value.
--
-- Nicholas, 2026-09-02: "It's a square footage on the building record. That's
-- the conditioned square foot." The building's square footage IS the
-- conditioned floor area; there is no second measurement to collect.
-- BLD-00178 carries 5,292 -- the same figure the Asset Score reports as roof
-- area and the proposal prices the Focus on Energy rebate on.
--
-- So the field is repointed at the column that holds the number, rather than a
-- second column being filled to satisfy a binding. One measurement, stored
-- once, read wherever it is needed -- the same rule the LEA number follows.
--
-- building_conditioned_floor_area_sq_ft is now referenced by no layout. It is
-- left in place rather than dropped: retiring a column is its own change, with
-- its own dependency sweep, and nothing reads it today.

UPDATE public.page_layout_widgets w
   SET widget_config = jsonb_set(
         w.widget_config, '{fields}',
         (SELECT jsonb_agg(
            CASE WHEN f->>'name' = 'building_id.building_conditioned_floor_area_sq_ft'
                 THEN jsonb_set(
                        jsonb_set(f, '{name}', '"building_id.building_square_footage"'::jsonb),
                        '{related,column}', '"building_square_footage"'::jsonb)
                 ELSE f END
            ORDER BY ord)
          FROM jsonb_array_elements(w.widget_config->'fields') WITH ORDINALITY AS t(f, ord)))
  FROM public.page_layout_sections s, public.page_layouts pl
 WHERE s.id = w.section_id AND pl.id = s.page_layout_id
   AND w.is_deleted IS NOT TRUE AND s.is_deleted IS NOT TRUE AND pl.is_deleted IS NOT TRUE
   AND w.widget_config::text LIKE '%building_id.building_conditioned_floor_area_sq_ft%';

DO $$
DECLARE v_old int; v_new int; v_label text;
BEGIN
  SELECT count(*) INTO v_old
  FROM public.page_layout_widgets w
  JOIN public.page_layout_sections s ON s.id = w.section_id AND s.is_deleted IS NOT TRUE
  JOIN public.page_layouts pl ON pl.id = s.page_layout_id AND pl.is_deleted IS NOT TRUE
  WHERE w.is_deleted IS NOT TRUE
    AND w.widget_config::text LIKE '%building_conditioned_floor_area_sq_ft%';
  IF v_old <> 0 THEN
    RAISE EXCEPTION '% widgets still bind the empty conditioned-floor-area column', v_old;
  END IF;

  SELECT count(*), max(f->>'label') INTO v_new, v_label
  FROM public.page_layouts pl
  JOIN public.page_layout_sections s ON s.page_layout_id = pl.id AND s.is_deleted IS NOT TRUE
  JOIN public.page_layout_widgets w ON w.section_id = s.id AND w.is_deleted IS NOT TRUE
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
  WHERE pl.is_deleted IS NOT TRUE
    AND f->>'name' = 'building_id.building_square_footage'
    AND f->>'label' ILIKE '%conditioned floor area%';
  IF v_new < 1 THEN
    RAISE EXCEPTION 'the conditioned floor area field did not survive the repoint';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.buildings
                  WHERE building_record_number = 'BLD-00178'
                    AND building_square_footage = 5292) THEN
    RAISE EXCEPTION 'BLD-00178 no longer carries the square footage this was verified against';
  END IF;
  RAISE NOTICE 'repointed to building_square_footage (label: %)', v_label;
END $$;
