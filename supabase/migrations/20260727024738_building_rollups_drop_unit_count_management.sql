-- Scope recompute_building_rollups to the In-Unit Information characteristic fields only.
--
-- Follow-up to 20260727023127. Nicholas (2026-07-27): the "number of units" total is being
-- reworked in a separate workstream (a building's units include non-dwelling spaces — Attic,
-- Mechanical Room, hallways, etc. — so a raw row count over-counts actual dwelling units).
-- This function must NOT manage building_number_of_units / building_total_units so it stops
-- fighting that workstream on every unit change. It keeps only the bedroom/sqft/bathroom
-- rollups we built. Property/account unit counts are unaffected — recompute_property_rollups
-- counts units directly from the units table, not from building_total_units.

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

REVOKE ALL ON FUNCTION public.recompute_building_rollups(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_building_rollups(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
