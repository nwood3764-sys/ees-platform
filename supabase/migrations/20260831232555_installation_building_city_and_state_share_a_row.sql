-- City and State / Province sat on their own rows in Installation Building
-- Information, where the Focus On Energy form puts them side by side.
--
-- Neither was mis-columned -- City is already column 1 and State column 2. The
-- cause was 'full_width: true' on both, which the row-major renderer honours
-- ahead of the column (gridColumn '1 / -1'), so each spanned the pair and
-- pushed the other down. Dropping the flag lets the columns they already
-- declare take effect; they are adjacent in the field array, so they land on
-- the same row.
--
-- Installation Address and Postal / Zip Code keep full_width deliberately: the
-- street line wants the width, and Zip has no partner to sit beside. Keeping at
-- least one full_width field also keeps the section in row-major layout, which
-- is the only mode where `column` is honoured -- stripping the last one would
-- silently drop it back to the legacy column-fill path.

UPDATE public.page_layout_widgets w
SET widget_config = jsonb_set(
  w.widget_config,
  '{fields}',
  (
    SELECT COALESCE(jsonb_agg(
             CASE WHEN f->>'name' IN ('property_id.property_city','property_id.property_state')
                  THEN f - 'full_width'
                  ELSE f END
             ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb))
         WITH ORDINALITY AS t(f, ord)
  ))
FROM public.page_layouts pl
WHERE pl.id = w.page_layout_id
  AND pl.page_layout_record_number = 'PL-00382'
  AND pl.is_deleted IS NOT TRUE
  AND w.is_deleted IS NOT TRUE
  AND w.widget_title = 'Installation Building Information';

DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(f->>'name', ', ') INTO v_bad
  FROM public.page_layouts pl
  JOIN public.page_layout_widgets w ON w.page_layout_id = pl.id AND w.is_deleted IS NOT TRUE
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
  WHERE pl.page_layout_record_number = 'PL-00382' AND pl.is_deleted IS NOT TRUE
    AND w.widget_title = 'Installation Building Information'
    AND f->>'name' IN ('property_id.property_city','property_id.property_state')
    AND (f ? 'full_width');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Still full width, so still stacked: %', v_bad;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.page_layouts pl
    JOIN public.page_layout_widgets w ON w.page_layout_id = pl.id AND w.is_deleted IS NOT TRUE
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
    WHERE pl.page_layout_record_number = 'PL-00382' AND pl.is_deleted IS NOT TRUE
      AND w.widget_title = 'Installation Building Information'
      AND (f->>'full_width')::boolean IS TRUE
  ) THEN
    RAISE EXCEPTION 'No field carries full_width any more, so the section fell out of row-major layout';
  END IF;
END $$;
