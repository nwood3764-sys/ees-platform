-- Incentive applications: auto-generate the name, drop legacy required columns
--
-- Two legacy NOT NULL columns (ia_name, ia_program_name) forced the create form
-- to demand "Name" and "Program Name" — neither of which is part of any intake
-- form (they predate the JotForm-mirrored layouts). Fix:
--   * ia_name       — auto-composed from the opportunity/property + record type
--                     label, like every other object's name. Made nullable so
--                     the create form stops requiring it (required_fields is the
--                     NOT NULL set); the trigger still always fills it.
--   * ia_program_name — a dead legacy column, not on any form. Made nullable and
--                     defaulted from the linked program / record type so it's
--                     never asked for and never blocks a save.
-- Applies to ALL incentive_applications record types, not just the payment
-- request — naming is now automatic object-wide.

ALTER TABLE public.incentive_applications ALTER COLUMN ia_name         DROP NOT NULL;
ALTER TABLE public.incentive_applications ALTER COLUMN ia_program_name DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.incentive_application_autoname()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_base text;
  v_rt   text;
  v_prog text;
BEGIN
  -- Record type label (used for both the name suffix and the program fallback).
  SELECT pv.picklist_label INTO v_rt
  FROM public.picklist_values pv
  WHERE pv.id = NEW.ia_record_type;

  -- Auto-compose ia_name when the caller left it blank. Base = the most specific
  -- parent name available (opportunity, else property, else building).
  IF nullif(btrim(coalesce(NEW.ia_name, '')), '') IS NULL THEN
    SELECT coalesce(o.opportunity_name, p.property_name, b.building_name)
      INTO v_base
    FROM (SELECT 1) z
    LEFT JOIN public.opportunities o ON o.id = NEW.opportunity_id
    LEFT JOIN public.properties    p ON p.id = NEW.property_id
    LEFT JOIN public.buildings     b ON b.id = NEW.building_id;

    NEW.ia_name := nullif(btrim(concat_ws(' - ', nullif(v_base, ''), nullif(v_rt, ''))), '');
    IF NEW.ia_name IS NULL THEN
      NEW.ia_name := 'Incentive Application';
    END IF;
  END IF;

  -- Default the legacy program-name column so it never has to be entered.
  IF nullif(btrim(coalesce(NEW.ia_program_name, '')), '') IS NULL THEN
    SELECT pr.name INTO v_prog FROM public.programs pr WHERE pr.id = NEW.program_id;
    NEW.ia_program_name := coalesce(nullif(btrim(coalesce(v_prog, '')), ''), v_rt);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ia_autoname ON public.incentive_applications;
CREATE TRIGGER trg_ia_autoname
  BEFORE INSERT OR UPDATE ON public.incentive_applications
  FOR EACH ROW EXECUTE FUNCTION public.incentive_application_autoname();

NOTIFY pgrst, 'reload schema';
