-- =============================================================================
-- Property geocoding support
--
-- The property record page's Map card pins from stored coordinates
-- (property_latitude / property_longitude) and never geocodes client-side.
-- Imports that carry no coordinates (LSS_WI managed portfolio, parts of the
-- prior unverified import) and manually created properties therefore showed
-- "no map coordinates yet" forever.
--
-- This migration adds the tracking columns for a server-side geocoding sweep
-- (edge function `geocode-property-coordinates`, invoked by pg_cron — the
-- cron job and its internal_cron_auth secret are prod-only config, per the
-- established pattern for dispatch-scheduled-reports):
--
--   property_geocode_attempted_at  when the sweep last tried this property
--   property_geocode_status        'Geocode Matched' | 'Geocode No Match' | 'Geocode Error'
--   property_geocode_source        provider that produced the coordinates ('US_CENSUS')
--
-- Plus a BEFORE UPDATE trigger: when any address component changes and the
-- caller did not supply new coordinates in the same update, the stored
-- coordinates and geocode tracking are cleared so the sweep re-geocodes the
-- new address. Updates that change address AND coordinates together (e.g.
-- HUD refreshes) are left alone.
-- =============================================================================

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS property_geocode_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS property_geocode_status text,
  ADD COLUMN IF NOT EXISTS property_geocode_source text;

ALTER TABLE public.properties
  DROP CONSTRAINT IF EXISTS properties_property_geocode_status_check;
ALTER TABLE public.properties
  ADD CONSTRAINT properties_property_geocode_status_check
  CHECK (property_geocode_status IS NULL OR property_geocode_status IN
         ('Geocode Matched', 'Geocode No Match', 'Geocode Error'));

-- Cheap sweep: only rows that still need an attempt.
CREATE INDEX IF NOT EXISTS idx_properties_needs_geocode
  ON public.properties (property_created_at)
  WHERE property_latitude IS NULL
    AND property_geocode_attempted_at IS NULL
    AND property_is_deleted IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.clear_property_geocode_on_address_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (   NEW.property_street IS DISTINCT FROM OLD.property_street
      OR NEW.property_city   IS DISTINCT FROM OLD.property_city
      OR NEW.property_state  IS DISTINCT FROM OLD.property_state
      OR NEW.property_zip    IS DISTINCT FROM OLD.property_zip)
     AND NEW.property_latitude  IS NOT DISTINCT FROM OLD.property_latitude
     AND NEW.property_longitude IS NOT DISTINCT FROM OLD.property_longitude
  THEN
    NEW.property_latitude             := NULL;
    NEW.property_longitude            := NULL;
    NEW.property_geocode_attempted_at := NULL;
    NEW.property_geocode_status       := NULL;
    NEW.property_geocode_source       := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_properties_clear_geocode_on_address_change ON public.properties;
CREATE TRIGGER trg_properties_clear_geocode_on_address_change
  BEFORE UPDATE ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_property_geocode_on_address_change();
