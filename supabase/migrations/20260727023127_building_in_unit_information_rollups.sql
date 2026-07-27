-- Building "In-Unit Information" fields become trigger-maintained rollups from child units.
--
-- Nicholas (2026-07-27): the # studio / # 1-4 bedroom counts, # bedrooms, average unit
-- square footage, and full/half bathroom counts on a building should be DERIVED from the
-- unit rows, not hand-entered. building_number_of_units was already a rollup; the rest were
-- static columns left over from the HUD import and empty on all 45 buildings.
--
-- Units carry a single combined unit_bathrooms today, which cannot populate the building's
-- separate Full/Half bathroom fields, so we add explicit unit_full_bathrooms /
-- unit_half_bathrooms as the source of truth and roll each up separately (Nicholas's
-- chosen approach). The building fields are made read-only in the UI (see
-- src/components/RecordDetail.jsx DERIVED_READONLY) so users edit the units, not the aggregate.

-- 1. Source-of-truth bathroom split on units.
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS unit_full_bathrooms integer,
  ADD COLUMN IF NOT EXISTS unit_half_bathrooms integer;

COMMENT ON COLUMN public.units.unit_full_bathrooms IS 'Number of full bathrooms in the unit. Rolls up to buildings.building_full_bathrooms via recompute_building_rollups.';
COMMENT ON COLUMN public.units.unit_half_bathrooms IS 'Number of half bathrooms in the unit. Rolls up to buildings.building_half_bathrooms via recompute_building_rollups.';

-- 2. Normalize building_number_of_four_bedrooms to a numeric count (was varchar(18), a HUD-import
--    artifact; empty on every building). All other bedroom-count columns are already numeric(18,0).
ALTER TABLE public.buildings
  ALTER COLUMN building_number_of_four_bedrooms TYPE numeric(18,0)
  USING NULLIF(building_number_of_four_bedrooms::text, '')::numeric;

-- 3. Extend the existing building rollup (was unit count only) to aggregate the full
--    In-Unit Information set from child units. Fires through the existing
--    units_recompute_rollups trigger -> trg_units_recompute_rollups -> recompute_building_rollups,
--    so any unit insert/update/delete recomputes the parent building (and up the chain).
--    Studio = exactly 0 bedrooms; the "four bedrooms" bucket captures 4+ (no 5+ field exists).
--    Counts are 0 when no matching units; sums/average are NULL when no underlying data.
CREATE OR REPLACE FUNCTION public.recompute_building_rollups(p_building_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_property_id uuid;
BEGIN
  IF p_building_id IS NULL THEN RETURN; END IF;

  UPDATE buildings b SET
    building_number_of_units               = agg.units_ct::numeric,
    building_total_units                   = agg.units_ct,
    building_number_of_studio              = agg.studio_ct,
    building_number_of_one_bedrooms        = agg.one_ct,
    building_number_of_two_bedrooms        = agg.two_ct,
    building_number_of_three_bedroom_units = agg.three_ct,
    building_number_of_four_bedrooms       = agg.four_plus_ct,
    building_number_of_bedrooms            = agg.bedrooms_sum,
    building_average_sq_ft_of_units        = agg.avg_sqft,
    building_full_bathrooms                = agg.full_bath_sum,
    building_half_bathrooms                = agg.half_bath_sum
  FROM (
    SELECT
      count(*)::int                                     AS units_ct,
      count(*) FILTER (WHERE u.unit_bedrooms = 0)::int  AS studio_ct,
      count(*) FILTER (WHERE u.unit_bedrooms = 1)::int  AS one_ct,
      count(*) FILTER (WHERE u.unit_bedrooms = 2)::int  AS two_ct,
      count(*) FILTER (WHERE u.unit_bedrooms = 3)::int  AS three_ct,
      count(*) FILTER (WHERE u.unit_bedrooms >= 4)::int AS four_plus_ct,
      sum(u.unit_bedrooms)::int                         AS bedrooms_sum,
      round(avg(u.unit_square_footage))::numeric        AS avg_sqft,
      sum(u.unit_full_bathrooms)::int                   AS full_bath_sum,
      sum(u.unit_half_bathrooms)::int                   AS half_bath_sum
    FROM units u
    WHERE u.building_id = p_building_id AND NOT u.unit_is_deleted
  ) agg
  WHERE b.id = p_building_id
  RETURNING b.property_id INTO v_property_id;

  PERFORM recompute_property_rollups(v_property_id);
END;
$function$;

-- Preserve the pre-existing ACL (authenticated + service_role EXECUTE; anon never granted)
-- and reload PostgREST after the function replace.
REVOKE ALL ON FUNCTION public.recompute_building_rollups(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_building_rollups(uuid) TO authenticated, service_role;

-- 4. Move the unit page layout from a single combined "Bathrooms" field to explicit
--    Full / Half Bathrooms (the new rollup sources). Targeted by object/section/type, not id.
UPDATE public.page_layout_widgets plw
SET widget_config = jsonb_set(
      plw.widget_config,
      '{fields}',
      '[
        {"name":"unit_bedrooms","type":"number","label":"Bedrooms","column":1},
        {"name":"unit_full_bathrooms","type":"number","label":"Full Bathrooms","column":1},
        {"name":"unit_half_bathrooms","type":"number","label":"Half Bathrooms","column":2},
        {"name":"unit_square_footage","type":"number","label":"Square Footage","column":2},
        {"name":"unit_floor_level","type":"number","label":"Floor Level","column":3}
      ]'::jsonb
    ),
    updated_at = now()
FROM public.page_layout_sections pls
JOIN public.page_layouts pl ON pl.id = pls.page_layout_id
WHERE plw.section_id = pls.id
  AND pl.page_layout_object = 'units'
  AND pl.page_layout_type = 'record_detail'
  AND pls.section_label = 'Unit Characteristics'
  AND plw.widget_type = 'field_group'
  AND plw.is_deleted IS NOT TRUE;

-- 5. Backfill every building from its current units (no-op on a fresh branch DB with no data).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM buildings WHERE building_is_deleted IS NOT TRUE LOOP
    PERFORM recompute_building_rollups(r.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
