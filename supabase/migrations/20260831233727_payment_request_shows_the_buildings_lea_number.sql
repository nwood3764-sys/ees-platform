-- The payment request shows the building's LEA number.
--
-- incentive_applications has NO LEA column of its own -- the number lives on
-- the building, as buildings.ira_confirmation_code_lea, which is also where the
-- pre-approval enrollment reads it from. So this is a related field off the
-- existing building_id foreign key rather than a new column and a copy: one
-- number, stored once, and a correction on the building shows here immediately
-- instead of leaving two versions to disagree.
--
-- Labelled "Property LEA#s" to match what the Focus On Energy forms call it.
--
-- Paired with Postal / Zip Code on one row: Zip's full_width is dropped so the
-- two sit side by side. Installation Address keeps full_width, which is what
-- holds the section in row-major layout -- the only mode where `column` is
-- honoured.

UPDATE public.page_layout_widgets w
SET widget_config = jsonb_set(
  w.widget_config,
  '{fields}',
  (
    SELECT COALESCE(jsonb_agg(
             CASE WHEN f->>'name' = 'property_id.property_zip'
                  THEN f - 'full_width'
                  ELSE f END
             ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb))
         WITH ORDINALITY AS t(f, ord)
  )
  || jsonb_build_array(
       jsonb_build_object(
         'name','building_id.ira_confirmation_code_lea',
         'type','related_field',
         'label','Property LEA#s',
         'column',2,
         'related', jsonb_build_object('table','buildings','column','ira_confirmation_code_lea',
                                       'fk_column','building_id','column_type','text')))
)
FROM public.page_layouts pl
WHERE pl.id = w.page_layout_id
  AND pl.page_layout_record_number = 'PL-00382'
  AND pl.is_deleted IS NOT TRUE
  AND w.is_deleted IS NOT TRUE
  AND w.widget_title = 'Installation Building Information'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
     WHERE f->>'name' = 'building_id.ira_confirmation_code_lea');

DO $$
DECLARE v_ok boolean; v_rowmajor boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.page_layouts pl
    JOIN public.page_layout_widgets w ON w.page_layout_id = pl.id AND w.is_deleted IS NOT TRUE
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
    WHERE pl.page_layout_record_number = 'PL-00382' AND pl.is_deleted IS NOT TRUE
      AND w.widget_title = 'Installation Building Information'
      AND f->>'name' = 'building_id.ira_confirmation_code_lea'
      AND f#>>'{related,table}'  = 'buildings'
      AND f#>>'{related,column}' = 'ira_confirmation_code_lea'
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'The LEA field was not added, or is not wired to buildings.ira_confirmation_code_lea';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.page_layouts pl
    JOIN public.page_layout_widgets w ON w.page_layout_id = pl.id AND w.is_deleted IS NOT TRUE
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
    WHERE pl.page_layout_record_number = 'PL-00382' AND pl.is_deleted IS NOT TRUE
      AND w.widget_title = 'Installation Building Information'
      AND (f->>'full_width')::boolean IS TRUE
  ) INTO v_rowmajor;
  IF NOT v_rowmajor THEN
    RAISE EXCEPTION 'No field carries full_width, so the section left row-major layout and `column` is ignored';
  END IF;
END $$;
