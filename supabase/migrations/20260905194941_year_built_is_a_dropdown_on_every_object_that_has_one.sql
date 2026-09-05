-- ===========================================================================
-- Year Built is a dropdown on EVERY object that has one.
--
-- Nicholas, 2026-09-05: "Year built should be a dropdown everywhere."
--
-- The mechanism shipped the same day on buildings (field_metadata.fm_choice_range
-- + src/lib/numberChoiceRange.js).  This registers the rest, so the same year
-- list appears wherever a person records a year a building was built.
--
-- WHICH COLUMNS -- read off the catalog, not guessed from a name.  Every column
-- on a real table matching year_built / construction_year was listed and judged
-- one at a time, and NONE of them is trigger-written (checked against
-- trigger_written_columns on all five objects), so every one is a value a
-- person or an importer supplies rather than a number the platform computes:
--
--   REGISTERED
--     buildings.building_year_built                (already, 2026-09-05)
--     properties.property_year_built               1,555 of 16,665 filled, 1953-2025
--     assessments.assessment_year_built            on 3 layouts, labelled Year Built
--     opportunities.opportunity_year_built         copied from the property on create
--     manual_j_reports.mjr_neep_construction_year  the equipment-selection workstream
--
--   DELIBERATELY NOT REGISTERED, and these are the interesting two:
--
--     properties.property_average_building_year_built -- an AVERAGE across a
--       property's buildings.  It is `numeric`, not `integer`, precisely so it
--       can hold 1974.5, and nobody CHOOSES it.  A dropdown of whole years
--       would both misrepresent it and refuse the value it actually holds.
--       It is on 4 layouts, so this is the one that would have looked right.
--
--     properties.property_ph_earliest_construction_year -- the HUD Public
--       Housing import's earliest-of aggregate over a property's buildings,
--       carried on no page layout at all.  Same reason: derived, not chosen.
--
-- Two of the five are on no layout today (opportunities, manual_j_reports).
-- Registering them anyway is the point of holding the rule in field_metadata:
-- the day somebody places the field, it is already a dropdown.
-- ===========================================================================

-- One expression, so the four rows cannot drift apart.  1800 through one year
-- past today -- derived from the clock at render time, never enumerated.
do $$
DECLARE
  c_range constant jsonb :=
    '{"min": 1800, "max_offset_from_current_year": 1, "step": 1, "order": "desc"}'::jsonb;
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('properties',       'property_year_built',           'Year Built'),
      ('assessments',      'assessment_year_built',         'Year Built'),
      ('opportunities',    'opportunity_year_built',        'Year Built'),
      ('manual_j_reports', 'mjr_neep_construction_year',    'Year of Construction')
    ) AS v(obj, col, label)
  LOOP
    -- The whole premise is that the column stays numeric.  Refuse rather than
    -- declare a number dropdown on something that cannot hold a number.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=r.obj AND column_name=r.col
         AND data_type IN ('integer','bigint','smallint','numeric','double precision','real')
    ) THEN
      RAISE EXCEPTION '%.% is not a numeric column', r.obj, r.col;
    END IF;

    IF EXISTS (SELECT 1 FROM public.field_metadata
                WHERE fm_object=r.obj AND fm_column=r.col AND fm_is_deleted IS NOT TRUE) THEN
      UPDATE public.field_metadata
         SET fm_choice_range = c_range
       WHERE fm_object=r.obj AND fm_column=r.col AND fm_is_deleted IS NOT TRUE;
    ELSE
      INSERT INTO public.field_metadata (fm_object, fm_column, fm_label, fm_choice_range, fm_field_kind)
      VALUES (r.obj, r.col, r.label, c_range, 'standard');
    END IF;
  END LOOP;
END $$;

do $$
DECLARE
  v_n int;
  v_ranges int;
BEGIN
  -- All five year columns, and the buildings storeys row, and nothing else.
  SELECT count(*) INTO v_ranges FROM public.field_metadata
   WHERE fm_choice_range IS NOT NULL AND fm_is_deleted IS NOT TRUE;
  IF v_ranges <> 6 THEN
    RAISE EXCEPTION 'expected 6 number-dropdown columns (5 year built + storeys), found %', v_ranges;
  END IF;

  SELECT count(*) INTO v_n FROM public.field_metadata
   WHERE fm_choice_range IS NOT NULL AND fm_is_deleted IS NOT TRUE
     AND fm_column IN ('building_year_built','property_year_built','assessment_year_built',
                       'opportunity_year_built','mjr_neep_construction_year');
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'expected all 5 year-built columns registered, found %', v_n;
  END IF;

  -- Every year list has to reach the years actually stored, or opening a record
  -- would offer a list that cannot represent its own value.
  IF EXISTS (SELECT 1 FROM public.properties
              WHERE property_is_deleted IS NOT TRUE
                AND property_year_built IS NOT NULL
                AND (property_year_built < 1800
                     OR property_year_built > extract(year from now())::int + 1)) THEN
    RAISE EXCEPTION 'a stored property year built falls outside the declared range';
  END IF;

  -- CONTROLS -- the two derived columns must NOT have been swept in.
  IF EXISTS (SELECT 1 FROM public.field_metadata
              WHERE fm_column = 'property_average_building_year_built'
                AND fm_choice_range IS NOT NULL AND fm_is_deleted IS NOT TRUE) THEN
    RAISE EXCEPTION 'the average-year-built roll-up was given a dropdown';
  END IF;
  IF EXISTS (SELECT 1 FROM public.field_metadata
              WHERE fm_column = 'property_ph_earliest_construction_year'
                AND fm_choice_range IS NOT NULL AND fm_is_deleted IS NOT TRUE) THEN
    RAISE EXCEPTION 'the HUD earliest-construction-year aggregate was given a dropdown';
  END IF;
END $$;

notify pgrst, 'reload schema';
