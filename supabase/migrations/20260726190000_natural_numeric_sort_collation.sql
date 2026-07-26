-- "If it looks like a number, sort like a number" (Nicholas, 2026-07-26).
-- Text identifier columns that carry numbers sorted lexicographically
-- ("1, 10, 11, 2") wherever the database ordered them — most visibly the
-- Units related list on a property page sorted by unit_number.
--
-- Fix at the database level, not in app code: an ICU collation with numeric
-- ordering enabled (-u-kn-true), applied to the column itself, so EVERY sort
-- of that column — related lists, list views, reports, RPCs — orders digit
-- runs numerically ("1, 2, …, 9, 10, 11") with no query changes anywhere.
-- Deterministic collation, so equality/uniqueness semantics are unchanged;
-- Postgres rebuilds dependent indexes automatically.
--
-- Applied to the field-hierarchy naming columns where numeric naming is the
-- convention (building naming = street address number; units are numbered):
-- reuse public.leap_numeric_natural for future columns of the same kind.

CREATE COLLATION IF NOT EXISTS public.leap_numeric_natural
  (provider = icu, locale = 'en-u-kn-true');

-- trg_cascade_building_name's WHEN clause references building_name, which
-- blocks ALTER COLUMN TYPE. Recreated verbatim below, same transaction.
DROP TRIGGER trg_cascade_building_name ON public.buildings;

ALTER TABLE public.units
  ALTER COLUMN unit_number TYPE text COLLATE public.leap_numeric_natural;
ALTER TABLE public.units
  ALTER COLUMN unit_name TYPE text COLLATE public.leap_numeric_natural;
ALTER TABLE public.buildings
  ALTER COLUMN building_number_or_name TYPE text COLLATE public.leap_numeric_natural;
ALTER TABLE public.buildings
  ALTER COLUMN building_name TYPE text COLLATE public.leap_numeric_natural;

CREATE TRIGGER trg_cascade_building_name
  AFTER UPDATE ON public.buildings
  FOR EACH ROW
  WHEN ((old.building_name IS DISTINCT FROM new.building_name))
  EXECUTE FUNCTION cascade_building_name_to_children();
