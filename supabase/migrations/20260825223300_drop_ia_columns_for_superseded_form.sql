-- Drop the eight columns added earlier today against Formstack form 6324680.
-- The live /forms/ira_assessment_app asks none of them. Every one holds zero
-- values (asserted below before the drop) and no layout, view, function or
-- policy references them any more, so this removes a wrong artifact rather than
-- migrating data. ia_units_per_building is KEPT: the live form asks "How many
-- units are in the building?", which is the same fact.
DO $$
DECLARE
  v_col  text;
  v_rows bigint;
  v_used text;
BEGIN
  FOREACH v_col IN ARRAY ARRAY[
    'ia_property_type','ia_modeling_approach','ia_property_addresses',
    'ia_number_of_buildings','ia_property_lea_numbers','ia_building_details',
    'ia_estimated_assessment_date','ia_payment_address_different']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='incentive_applications'
                      AND column_name=v_col) THEN
      CONTINUE;
    END IF;

    -- Never drop a column carrying data, whatever this migration believes.
    EXECUTE format('SELECT count(*) FROM public.incentive_applications WHERE %I IS NOT NULL', v_col)
      INTO v_rows;
    IF v_rows > 0 THEN
      RAISE EXCEPTION 'Refusing to drop incentive_applications.% — % rows carry a value', v_col, v_rows;
    END IF;

    -- Never drop a column a live page layout still renders.
    SELECT string_agg(DISTINCT pl.page_layout_record_number, ', ') INTO v_used
      FROM public.page_layout_widgets w
      JOIN public.page_layouts pl ON pl.id = w.page_layout_id
     WHERE w.is_deleted IS NOT TRUE AND pl.is_deleted IS NOT TRUE
       AND pl.page_layout_object = 'incentive_applications'
       AND w.widget_config::text LIKE '%' || v_col || '%';
    IF v_used IS NOT NULL THEN
      RAISE EXCEPTION 'Refusing to drop incentive_applications.% — still on layout(s) %', v_col, v_used;
    END IF;

    EXECUTE format('ALTER TABLE public.incentive_applications DROP COLUMN %I', v_col);
  END LOOP;
END $$;
