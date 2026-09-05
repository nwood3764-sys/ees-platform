-- ===========================================================================
-- Stories and Year Built are CHOSEN, not typed.
--
-- Nicholas, 2026-09-05, on a building record: "should the number of stories be
-- a pick list? Not just a free-form text field also, the year built should also
-- be a pick list."
--
-- Both are numeric columns and both stay numeric.  buildings.building_year_built
-- is an integer that the Asset Score report prints, the bulk property importer
-- validates as a year, four page layouts carry as a related field typed
-- `number`, and a report filters as "before 1980".  Turning it into a uuid FK
-- -- which is how an ordinary LEAP picklist stores its value -- would put a
-- record id where a year belongs on every one of those.  What was wrong is the
-- CONTROL: a spinner that accepts 19855, or -3 storeys, or a blank.
--
-- So the declaration is a RANGE, held in field_metadata beside the display type
-- and the lookup scope this table already governs, and the client expands it
-- into a dropdown.  DERIVED, not enumerated: 227 year rows in picklist_values
-- would be wrong every January, whereas "1800 through one year past today" is
-- right forever.
--
-- Bounds are deliberately generous, for the reason the disposal-facility field
-- was left as free text on 2026-09-03: a dropdown that does not contain the
-- answer in front of you blocks the person filling it in.  50 storeys is well
-- past the tallest building EES will survey, and raising it is a data edit.
-- A value already stored outside the range is never hidden either -- the client
-- folds it back in (src/lib/numberChoiceRange.js).
--
-- Note what this ALSO fixes, which nobody had reported: `type: 'number'` on the
-- record page renders through Number(v).toLocaleString(), so the three
-- buildings that carry a year built have been reading "1,986" and "1,987".
-- ===========================================================================

alter table public.field_metadata
  add column if not exists fm_choice_range jsonb;

comment on column public.field_metadata.fm_choice_range is
  'Declares a NUMERIC column as a dropdown over a range: {min, max | max_offset_from_current_year, step, order}. Expanded client-side by src/lib/numberChoiceRange.js. The column keeps its numeric type and stores the number, never a picklist_values id.';

-- Storeys: 1 to 50.
insert into public.field_metadata (fm_object, fm_column, fm_label, fm_choice_range, fm_field_kind)
values ('buildings', 'building_stories_of_building', 'Stories of Building',
        '{"min": 1, "max": 50, "step": 1, "order": "asc"}'::jsonb, 'standard')
on conflict do nothing;

-- Year built: 1800 through next year -- new construction is a building record
-- type here, so a building can legitimately be completing next year.
insert into public.field_metadata (fm_object, fm_column, fm_label, fm_choice_range, fm_field_kind)
values ('buildings', 'building_year_built', 'Year Built',
        '{"min": 1800, "max_offset_from_current_year": 1, "step": 1, "order": "desc"}'::jsonb, 'standard')
on conflict do nothing;

-- A row may already have existed for either column (field_metadata carries
-- labels, help text and tiers as well); make sure the range landed on it.
update public.field_metadata
   set fm_choice_range = '{"min": 1, "max": 50, "step": 1, "order": "asc"}'::jsonb
 where fm_object = 'buildings' and fm_column = 'building_stories_of_building'
   and fm_is_deleted is not true and fm_choice_range is null;

update public.field_metadata
   set fm_choice_range = '{"min": 1800, "max_offset_from_current_year": 1, "step": 1, "order": "desc"}'::jsonb
 where fm_object = 'buildings' and fm_column = 'building_year_built'
   and fm_is_deleted is not true and fm_choice_range is null;

do $$
DECLARE
  v_n int;
  v_type text;
BEGIN
  SELECT count(*) INTO v_n FROM public.field_metadata
   WHERE fm_object='buildings' AND fm_is_deleted IS NOT TRUE AND fm_choice_range IS NOT NULL;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'expected 2 building columns declared as number dropdowns, found %', v_n;
  END IF;

  -- The whole point is that the columns stay numeric. If either has become a
  -- uuid, the range is meaningless and the dropdown would write a number into
  -- a foreign key.
  FOR v_type IN
    SELECT data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name='buildings'
       AND column_name IN ('building_stories_of_building','building_year_built')
  LOOP
    IF v_type NOT IN ('integer','numeric','bigint','smallint','double precision','real') THEN
      RAISE EXCEPTION 'a number dropdown was declared on a % column', v_type;
    END IF;
  END LOOP;

  -- CONTROL: nothing else on the platform picked up a range.
  SELECT count(*) INTO v_n FROM public.field_metadata
   WHERE fm_object <> 'buildings' AND fm_choice_range IS NOT NULL AND fm_is_deleted IS NOT TRUE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'a range was declared outside buildings (%)', v_n;
  END IF;
END $$;

notify pgrst, 'reload schema';
