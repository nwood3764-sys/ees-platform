-- A Manual J report lands on the assessment as data, not as a PDF nobody can query.
--
-- Nicholas, 2026-09-05: "I'll upload the Conduit Tech report, and then I want
-- the software to scrape all of the relevant fields and put the information in.
-- This is going to support the equipment selection to make sure that we are
-- selecting the proper equipment for HVAC and that we're satisfying the heating
-- and cooling load." And, on where it belongs: "I think it belongs on the
-- assessment record… The user, probably the project coordinator, will drag it
-- on top of this widget you're making, and then you'll scrape the information
-- from it and then save the PDF to the assessment object."
--
-- ─── Why this is four tables and not 90 columns on `assessments` ────────────
--
-- `assessments` already carries 250 columns. The real report for 2506 Frazier
-- Ave holds 17 load blocks (whole home, two proposed systems, two zones, ten
-- room pages, two rooms no system serves), 15 load components against 4
-- measures in each of them, and 14 building material assemblies. That is a
-- shape, not a set of fields, and it cannot be flattened onto a parent row
-- without throwing most of it away.
--
-- So the report is its own record, the assessment is its REQUIRED parent, and
-- the card renders on the assessment page. "It belongs on the assessment"
-- decides ownership and where it is read — not which table the columns sit in.
--
-- ─── The design load is stored as a decision, with its basis ───────────────
--
-- docs/leap-equipment-selection.md §2e: every column in production was searched
-- for design_load / heating_load / weather_station / manual_j / balance_point,
-- and one matched, unrelated. LEAP has had nowhere to put a design load, which
-- is the blocker the whole equipment-selection workstream sits behind.
--
-- A Manual J prints several loads and the right one is a judgement. On this
-- report the printed Whole Home heating load is 46,735 Btu/h and the building
-- actually needs 29,882 — the difference is Zone 1 counted once per proposed
-- system (see src/lib/manualJDesignLoad.js). So the chosen load is stored
-- ALONGSIDE the basis it was chosen on (mjr_design_load_basis), every block is
-- kept exactly as printed, and no trigger picks for anybody. A person reviews
-- the scrape and presses Save; that is the second set of eyes this platform
-- requires, and the PDF on the assessment is the evidence artifact.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. The report
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.manual_j_reports (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mjr_record_number                 text NOT NULL DEFAULT '',
  mjr_name                          text NOT NULL DEFAULT '',

  -- The assessment is the parent, per Nicholas 2026-09-05. The rest are
  -- inherited so the equipment-selection engine can find a building's load
  -- without walking back up through the assessment every time.
  assessment_id                     uuid NOT NULL REFERENCES public.assessments(id),
  property_id                       uuid REFERENCES public.properties(id),
  building_id                       uuid REFERENCES public.buildings(id),
  unit_id                           uuid REFERENCES public.units(id),
  opportunity_id                    uuid REFERENCES public.opportunities(id),
  project_id                        uuid REFERENCES public.projects(id),

  -- Provenance. The PDF itself is a row in `documents` on the assessment.
  document_id                       uuid REFERENCES public.documents(id),
  mjr_source_software               text,
  mjr_manual_j_version              text,
  mjr_report_title                  text,
  mjr_report_created_by             text,
  mjr_report_created_at_text        text,
  mjr_report_updated_at_text        text,
  mjr_source_file_name              text,

  -- What the report says it is about. Kept as the report printed it: it may
  -- disagree with the LEAP building, and that disagreement is worth seeing.
  mjr_subject_name                  text,
  mjr_subject_address               text,
  mjr_subject_street                text,
  mjr_subject_city                  text,
  mjr_subject_state                 text,
  mjr_subject_postal_code           text,

  -- Design conditions. The winter outdoor dry bulb is the single number cold
  -- climate capacity is rated against.
  mjr_weather_station               text,
  mjr_elevation_ft                  numeric(10,2),
  mjr_latitude                      numeric(10,5),
  mjr_altitude_correction_factor    numeric(8,4),
  mjr_heating_outdoor_db_f          numeric(6,1),
  mjr_heating_indoor_db_f           numeric(6,1),
  mjr_heating_temp_difference_f     numeric(6,1),
  mjr_cooling_outdoor_db_f          numeric(6,1),
  mjr_cooling_indoor_db_f           numeric(6,1),
  mjr_cooling_temp_difference_f     numeric(6,1),
  mjr_cooling_indoor_rh_pct         numeric(6,2),
  mjr_cooling_daily_range           text,
  mjr_cooling_grains_difference     numeric(8,2),

  -- The answer: the load a person chose, and what they chose it on.
  mjr_design_heating_load_btuh      numeric(12,2),
  mjr_design_cooling_load_btuh      numeric(12,2),
  mjr_design_sensible_cooling_btuh  numeric(12,2),
  mjr_design_latent_cooling_btuh    numeric(12,2),
  mjr_design_load_basis             text,
  mjr_design_load_basis_id          text,
  mjr_conditioned_floor_area_sq_ft  numeric(12,2),

  -- The NEEP Cold Climate Air Source Heat Pump List advanced search asks for
  -- exactly these. The construction year is the only one a Manual J does not
  -- carry, so it comes from the building and is asked for, never guessed.
  mjr_neep_construction_year        integer,
  mjr_neep_ducting_configuration    text,

  mjr_notes                         text,
  -- The import's own transcript, the pattern the HUD importers already use: if
  -- the parser is ever wrong, the evidence of what it read is still here.
  mjr_raw_extract                   jsonb,
  mjr_parser_version                text,
  mjr_extracted_at                  timestamptz,
  mjr_reviewed_by                   uuid REFERENCES public.users(id),
  mjr_reviewed_at                   timestamptz,

  mjr_owner                         uuid REFERENCES public.users(id),
  mjr_created_by                    uuid REFERENCES public.users(id),
  mjr_created_at                    timestamptz NOT NULL DEFAULT now(),
  mjr_updated_by                    uuid REFERENCES public.users(id),
  mjr_updated_at                    timestamptz NOT NULL DEFAULT now(),
  mjr_is_deleted                    boolean NOT NULL DEFAULT false,
  mjr_deleted_at                    timestamptz,
  mjr_deleted_by                    uuid REFERENCES public.users(id),
  mjr_deletion_reason               text,
  is_seed_data                      boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE public.manual_j_reports IS
  'An ACCA Manual J load calculation scraped from its source report (Conduit '
  'Tech today) and attached to the assessment that produced it. The design '
  'load LEAP sizes equipment against, and the first place in the platform a '
  'design load can be stored at all.';
COMMENT ON COLUMN public.manual_j_reports.mjr_design_load_basis IS
  'Which of the report''s several loads the design load was taken from, in the '
  'words a person read when they chose it. A multi-system report prints a '
  'Whole Home total that counts every shared room once per proposed system, so '
  'the number alone does not say what it means.';
COMMENT ON COLUMN public.manual_j_reports.mjr_neep_construction_year IS
  'Not present in a Manual J. Comes from the building; left null and asked for '
  'rather than guessed, because NEEP brackets its results on it.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Every load table the report prints, at every scope
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.manual_j_load_blocks (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mjl_record_number             text NOT NULL DEFAULT '',
  manual_j_report_id            uuid NOT NULL REFERENCES public.manual_j_reports(id),

  mjl_scope                     text NOT NULL,
  mjl_block_name                text,
  mjl_system_name               text,
  mjl_zone_name                 text,
  mjl_room_name                 text,
  mjl_story                     text,
  mjl_sequence                  integer NOT NULL DEFAULT 0,
  mjl_source_page               integer,

  mjl_total_heating_btuh        numeric(12,2),
  mjl_total_cooling_btuh        numeric(12,2),
  mjl_sensible_cooling_btuh     numeric(12,2),
  mjl_latent_cooling_btuh       numeric(12,2),

  mjl_floor_area_sq_ft          numeric(12,2),
  mjl_volume_cu_ft              numeric(14,2),
  mjl_ceiling_height_ft         numeric(8,2),
  mjl_exposed_wall_gross_sq_ft  numeric(12,2),
  mjl_exposed_wall_net_sq_ft    numeric(12,2),
  mjl_glazing_area_sq_ft        numeric(12,2),
  mjl_running_exposed_wall_ft   numeric(12,2),
  mjl_sensible_heat_ratio       numeric(8,4),
  mjl_envelope_tightness        text,
  mjl_appliance_scenario        text,
  mjl_occupants                 numeric(8,2),
  mjl_design_cfm                numeric(10,2),
  mjl_exposed_wall_by_orientation jsonb,
  mjl_rooms                     jsonb,

  mjl_system_type               text,
  mjl_distribution_type         text,
  mjl_ducts                     text,
  mjl_supply_run_location       text,
  mjl_leakage_class             text,
  mjl_duct_wall_insulation      text,
  mjl_airway_configuration      text,
  mjl_ehlf                      numeric(8,4),
  mjl_esgf                      numeric(8,4),
  mjl_elg                       numeric(12,2),

  mjl_owner                     uuid REFERENCES public.users(id),
  mjl_created_by                uuid REFERENCES public.users(id),
  mjl_created_at                timestamptz NOT NULL DEFAULT now(),
  mjl_updated_by                uuid REFERENCES public.users(id),
  mjl_updated_at                timestamptz NOT NULL DEFAULT now(),
  mjl_is_deleted                boolean NOT NULL DEFAULT false,
  mjl_deleted_at                timestamptz,
  mjl_deleted_by                uuid REFERENCES public.users(id),
  mjl_deletion_reason           text,
  is_seed_data                  boolean NOT NULL DEFAULT false,

  CONSTRAINT manual_j_load_blocks_scope_check
    CHECK (mjl_scope IN ('whole_home', 'system', 'zone', 'room', 'unassigned_room'))
);

COMMENT ON TABLE public.manual_j_load_blocks IS
  'One load table from a Manual J report. A report prints the same 16-component '
  'breakdown for the whole home, for each proposed system, for each zone and '
  'for each room; the scope says which. Stored exactly as printed — including '
  'a whole-home total that double counts rooms served by two proposed systems, '
  'because correcting the source silently is how a wrong number becomes a fact.';
COMMENT ON COLUMN public.manual_j_load_blocks.mjl_scope IS
  'whole_home | system | zone | room | unassigned_room. An unassigned_room is a '
  'room no modelled system serves — a basement or a stairwell.';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. The component breakdown — a real table, because "how much of this load is
--    ducts?" is a question a report should be able to answer
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.manual_j_load_components (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mjc_record_number             text NOT NULL DEFAULT '',
  manual_j_load_block_id        uuid NOT NULL REFERENCES public.manual_j_load_blocks(id),
  manual_j_report_id            uuid NOT NULL REFERENCES public.manual_j_reports(id),

  mjc_component_name            text NOT NULL,
  mjc_sequence                  integer NOT NULL DEFAULT 0,
  mjc_sensible_cooling_btuh     numeric(12,2),
  mjc_latent_cooling_btuh       numeric(12,2),
  mjc_total_cooling_btuh        numeric(12,2),
  mjc_total_heating_btuh        numeric(12,2),

  mjc_owner                     uuid REFERENCES public.users(id),
  mjc_created_by                uuid REFERENCES public.users(id),
  mjc_created_at                timestamptz NOT NULL DEFAULT now(),
  mjc_updated_by                uuid REFERENCES public.users(id),
  mjc_updated_at                timestamptz NOT NULL DEFAULT now(),
  mjc_is_deleted                boolean NOT NULL DEFAULT false,
  mjc_deleted_at                timestamptz,
  mjc_deleted_by                uuid REFERENCES public.users(id),
  mjc_deletion_reason           text,
  is_seed_data                  boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE public.manual_j_load_components IS
  'Where a load block''s load comes from — walls, glazing, ceilings, floors, '
  'ducts, infiltration, blower heat and the rest, against all four measures. '
  'Blower heat is the reason a building load cannot simply be re-summed from '
  'its rooms: it is a system-level gain that appears in no room.';

-- ───────────────────────────────────────────────────────────────────────────
-- 4. The building the load was calculated from
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.manual_j_building_materials (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mjm_record_number           text NOT NULL DEFAULT '',
  manual_j_report_id          uuid NOT NULL REFERENCES public.manual_j_reports(id),

  mjm_construction_type       text,
  mjm_construction_number     text,
  mjm_orientation             text,
  mjm_area_sq_ft              numeric(12,2),
  mjm_cooling_btuh            numeric(12,2),
  mjm_heating_btuh            numeric(12,2),
  mjm_u_value                 numeric(10,4),
  mjm_description             text,
  -- Conduit closes a multi-orientation assembly with a "total" row. Summing
  -- areas across the table without honouring this counts every window twice.
  mjm_is_total_row            boolean NOT NULL DEFAULT false,
  mjm_sequence                integer NOT NULL DEFAULT 0,

  mjm_owner                   uuid REFERENCES public.users(id),
  mjm_created_by              uuid REFERENCES public.users(id),
  mjm_created_at              timestamptz NOT NULL DEFAULT now(),
  mjm_updated_by              uuid REFERENCES public.users(id),
  mjm_updated_at              timestamptz NOT NULL DEFAULT now(),
  mjm_is_deleted              boolean NOT NULL DEFAULT false,
  mjm_deleted_at              timestamptz,
  mjm_deleted_by              uuid REFERENCES public.users(id),
  mjm_deletion_reason         text,
  is_seed_data                boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE public.manual_j_building_materials IS
  'The envelope assemblies a Manual J was calculated from, with their U-values '
  'and areas. The R-values an auditor is already hunting for are in here.';

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Record numbers, derived name, soft delete, audit stamping
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_mjr_record_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.mjr_record_number IS NULL OR NEW.mjr_record_number = '' THEN
    SELECT 'MJR-' || lpad((COALESCE(max(substring(mjr_record_number from 5)::int), 0) + 1)::text, 5, '0')
      INTO NEW.mjr_record_number FROM public.manual_j_reports
     WHERE mjr_record_number ~ '^MJR-[0-9]+$';
  END IF;
  -- The name is composed, never typed: what the report is about, and the
  -- design load it settled on once one has been chosen.
  IF NEW.mjr_name IS NULL OR NEW.mjr_name = '' OR TG_OP = 'UPDATE' THEN
    NEW.mjr_name := trim(
      coalesce(nullif(NEW.mjr_subject_name, ''), nullif(NEW.mjr_subject_street, ''),
               nullif(NEW.mjr_subject_address, ''), 'Manual J Report')
      || CASE WHEN NEW.mjr_design_heating_load_btuh IS NOT NULL
              THEN ' - ' || to_char(round(NEW.mjr_design_heating_load_btuh), 'FM999,999,999') || ' Btu/h heating'
              ELSE '' END);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_mjr_record_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_mjr_rn ON public.manual_j_reports;
CREATE TRIGGER trg_mjr_rn BEFORE INSERT OR UPDATE ON public.manual_j_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_mjr_record_number();

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('manual_j_load_blocks',      'mjl', 'MJL'),
      ('manual_j_load_components',  'mjc', 'MJC'),
      ('manual_j_building_materials','mjm', 'MJM')
    ) v(tbl, prefix, code)
  LOOP
    EXECUTE format($f$
      CREATE OR REPLACE FUNCTION public.set_%s_record_number()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $body$
      BEGIN
        -- The prefix is concatenated onto a column name, so it is %%s and not
        -- %%I: quoting it first yields NEW."mjl"_record_number, which is not an
        -- identifier at all. The TABLE name is still %%I.
        IF NEW.%s_record_number IS NULL OR NEW.%s_record_number = '' THEN
          SELECT '%s-' || lpad((COALESCE(max(substring(%s_record_number from 5)::int), 0) + 1)::text, 5, '0')
            INTO NEW.%s_record_number FROM public.%I
           WHERE %s_record_number ~ '^%s-[0-9]+$';
        END IF;
        RETURN NEW;
      END;
      $body$;
    $f$, r.prefix, r.prefix, r.prefix, r.code, r.prefix, r.prefix, r.tbl, r.prefix, r.code);

    EXECUTE format('REVOKE ALL ON FUNCTION public.set_%s_record_number() FROM PUBLIC, anon, authenticated', r.prefix);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_rn ON public.%I', r.prefix, r.tbl);
    EXECUTE format('CREATE TRIGGER trg_%s_rn BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_%s_record_number()',
                   r.prefix, r.tbl, r.prefix);
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['manual_j_reports','manual_j_load_blocks','manual_j_load_components','manual_j_building_materials']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS app_select_%s ON public.%I', t, t);
    EXECUTE format($p$CREATE POLICY app_select_%s ON public.%I FOR SELECT USING ((SELECT public.app_user_can('%s','read')))$p$, t, t, t);

    EXECUTE format('DROP POLICY IF EXISTS app_insert_%s ON public.%I', t, t);
    EXECUTE format($p$CREATE POLICY app_insert_%s ON public.%I FOR INSERT WITH CHECK ((SELECT public.app_user_can('%s','create')))$p$, t, t, t);

    EXECUTE format('DROP POLICY IF EXISTS app_update_%s ON public.%I', t, t);
    EXECUTE format($p$CREATE POLICY app_update_%s ON public.%I FOR UPDATE USING ((SELECT public.app_user_can('%s','update'))) WITH CHECK ((SELECT public.app_user_can('%s','update')))$p$, t, t, t, t);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_no_hard_delete ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_no_hard_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete()', t, t);

    PERFORM public.install_record_audit_stamping(t);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_manual_j_reports_assessment ON public.manual_j_reports(assessment_id) WHERE mjr_is_deleted IS NOT TRUE;
CREATE INDEX IF NOT EXISTS idx_manual_j_reports_building   ON public.manual_j_reports(building_id)   WHERE mjr_is_deleted IS NOT TRUE;
CREATE INDEX IF NOT EXISTS idx_manual_j_load_blocks_report ON public.manual_j_load_blocks(manual_j_report_id);
CREATE INDEX IF NOT EXISTS idx_manual_j_load_components_block ON public.manual_j_load_components(manual_j_load_block_id);
CREATE INDEX IF NOT EXISTS idx_manual_j_building_materials_report ON public.manual_j_building_materials(manual_j_report_id);

