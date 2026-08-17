-- A property's name is always derived from its own address.
--
-- Nicholas, 2026-08-17: PROP-07214 displayed "5513 North HOPKINS Street -
-- MILWAUKEE" while its own address fields read "5513 North Hopkins Street" and
-- "Milwaukee". He checked every field and found no capitalized value anywhere —
-- correctly, because the shouty text was not in any address field. It was frozen
-- into properties.property_name at HUD-import time and never recomposed.
--
-- The chain that spread it is entirely trigger-derived, no hardcoding anywhere:
--
--   properties.property_name  = <street> - <city>            <- THE BROKEN LINK
--   buildings.building_name   = <property name> - <number>   (derive_building_name)
--   opportunities             = <building name> - <RT label> (derive_opportunity_name)
--   projects                  = <opportunity>  - <RT label>  (derive_project_name)
--   work_orders               = <project> - <unit> - <work type>
--
-- normalize_property_address() already title-cases the street (via
-- normalize_street_address, which expands N -> North, ST -> Street and initcaps
-- the rest) and the city (initcap). But it only rewrote property_name when the
-- name was blank or exactly equalled the RAW street. For a name shaped
-- "<street> - <city>" it left the old value alone, so the address got cleaned
-- and the name kept the import text — then every child name inherited it.
--
-- Now the name is unconditionally recomposed from the normalized street and
-- city, using the same append_name_segment helper the other derived names use.
-- Nothing is hardcoded and nothing is import-specific: change a street or city
-- and the name follows, every time.
--
-- property_name is NOT NULL, so if an address is somehow empty the previous
-- value is kept rather than composing a null.
CREATE OR REPLACE FUNCTION public.normalize_property_address()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  NEW.property_street := public.normalize_street_address(NEW.property_street);
  NEW.property_city   := initcap(lower(trim(coalesce(NEW.property_city, ''))));
  NEW.property_state  := upper(trim(coalesce(NEW.property_state, '')));
  NEW.property_zip    := trim(coalesce(NEW.property_zip, ''));

  NEW.property_name := COALESCE(
    public.append_name_segment(
      NULLIF(btrim(coalesce(NEW.property_street, '')), ''),
      NULLIF(btrim(coalesce(NEW.property_city, '')), '')
    ),
    NULLIF(btrim(coalesce(NEW.property_name, '')), ''),
    NEW.property_name
  );

  RETURN NEW;
END;
$function$;

-- Work order names recompose on UPDATE too, not only INSERT. Without this a
-- work order keeps a stale name forever once its project is renamed — which is
-- exactly how the import text survived down here. The function already only
-- composes when the name is blank, so add an explicit refresh path: blanking
-- work_order_name and updating re-derives it.
--
-- (The trigger stays BEFORE INSERT for composition; UPDATE support comes from
-- the same function seeing a blank name.)
DROP TRIGGER IF EXISTS trg_work_order_inherit_parent_fields ON public.work_orders;
CREATE TRIGGER trg_work_order_inherit_parent_fields
  BEFORE INSERT OR UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.work_order_inherit_parent_fields();

NOTIFY pgrst, 'reload schema';
