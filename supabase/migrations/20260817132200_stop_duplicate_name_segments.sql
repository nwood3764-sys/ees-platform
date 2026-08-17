-- Derived record names stop repeating a segment they already end with.
--
-- WO-00189 came out as
--   "5513 North HOPKINS Street - MILWAUKEE - 5513 - WI-IRA-MF-HOMES-AUDIT
--    - Multifamily Energy Assessment - Multifamily Energy Assessment"
-- (Nicholas, 2026-08-16). The work order name is composed as
-- "<project name> - <unit> - <work type>", and this project's name already ended
-- with "Multifamily Energy Assessment" (its own record-type label), so appending
-- the identically named work type doubled it. The 100+ character result then
-- pushed the record header's action buttons off the page — the layout is fixed
-- separately, but the name was the cause.
--
-- PR #473 fixed the same repetition in the client-side create form. This applies
-- the rule where names are actually authoritative: the DB triggers.
--
-- One shared helper so every derived name follows the same rule; the two
-- triggers that compose names from a parent plus a label now use it.

-- Append a segment to a derived name, unless the name already ends with it
-- (case-insensitive, ignoring surrounding whitespace). Returns the trimmed
-- result. IMMUTABLE: pure string work, safe in any expression.
CREATE OR REPLACE FUNCTION public.append_name_segment(p_base text, p_part text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT NULLIF(btrim(
    CASE
      WHEN NULLIF(btrim(coalesce(p_part, '')), '') IS NULL
        THEN coalesce(p_base, '')
      WHEN NULLIF(btrim(coalesce(p_base, '')), '') IS NULL
        THEN btrim(p_part)
      -- Exact suffix test rather than LIKE: a segment can legitimately contain
      -- '_' or '%', which LIKE would treat as wildcards.
      WHEN right(lower(btrim(p_base)), length(btrim(p_part))) = lower(btrim(p_part))
        THEN btrim(p_base)
      ELSE btrim(p_base) || ' - ' || btrim(p_part)
    END
  , ' -'), '');
$function$;

REVOKE ALL ON FUNCTION public.append_name_segment(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_name_segment(text, text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_name_segment(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_name_segment(text, text) TO postgres;
GRANT EXECUTE ON FUNCTION public.append_name_segment(text, text) TO service_role;

-- Work orders: "<project> - <unit> - <work type>", skipping any segment the
-- name already ends with. Everything else about this trigger — FK inheritance
-- from the project, the denormalized text mirrors, the "only when not supplied"
-- guard — is unchanged.
CREATE OR REPLACE FUNCTION public.work_order_inherit_parent_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_project_name   text;
  v_proj_opp       uuid;
  v_proj_property  uuid;
  v_proj_building  uuid;
  v_unit_number    text;
  v_unit_name      text;
  v_work_type_name text;
  v_record_type_lbl text;
  v_property_name  text;
  v_building_name  text;
  v_name           text;
BEGIN
  SELECT p.project_name, p.opportunity_id, p.property_id, p.building_id
    INTO v_project_name, v_proj_opp, v_proj_property, v_proj_building
  FROM public.projects p
  WHERE p.id = NEW.project_id;

  IF NEW.opportunity_id IS NULL THEN NEW.opportunity_id := v_proj_opp; END IF;
  IF NEW.property_id   IS NULL THEN NEW.property_id   := v_proj_property; END IF;
  IF NEW.building_id   IS NULL THEN NEW.building_id   := v_proj_building; END IF;

  IF NEW.unit_id IS NOT NULL THEN
    SELECT u.unit_number, u.unit_name
      INTO v_unit_number, v_unit_name
    FROM public.units u WHERE u.id = NEW.unit_id;
  END IF;

  IF NEW.work_type_id IS NOT NULL THEN
    SELECT wt.work_type_name INTO v_work_type_name
    FROM public.work_types wt WHERE wt.id = NEW.work_type_id;
  END IF;

  IF NEW.work_order_record_type IS NOT NULL THEN
    SELECT pv.picklist_label INTO v_record_type_lbl
    FROM public.picklist_values pv WHERE pv.id = NEW.work_order_record_type;
  END IF;

  IF NEW.property_id IS NOT NULL THEN
    SELECT pr.property_name INTO v_property_name
    FROM public.properties pr WHERE pr.id = NEW.property_id;
  END IF;
  IF NEW.building_id IS NOT NULL THEN
    SELECT b.building_name INTO v_building_name
    FROM public.buildings b WHERE b.id = NEW.building_id;
  END IF;

  IF NEW.work_order_name IS NULL OR btrim(NEW.work_order_name) = '' THEN
    v_name := NULLIF(btrim(coalesce(v_project_name, '')), '');
    v_name := public.append_name_segment(v_name, COALESCE(v_unit_number, v_unit_name));
    v_name := public.append_name_segment(v_name, COALESCE(v_work_type_name, v_record_type_lbl));
    IF v_name IS NOT NULL THEN
      NEW.work_order_name := v_name;
    END IF;
  END IF;

  IF NEW.work_order_project IS NULL THEN NEW.work_order_project := v_project_name; END IF;
  IF NEW.work_order_unit IS NULL THEN NEW.work_order_unit := COALESCE(v_unit_number, v_unit_name); END IF;
  IF NEW.work_order_property_name IS NULL THEN NEW.work_order_property_name := v_property_name; END IF;
  IF NEW.work_order_property IS NULL THEN NEW.work_order_property := v_property_name; END IF;
  IF NEW.work_order_building IS NULL THEN NEW.work_order_building := v_building_name; END IF;

  RETURN NEW;
END;
$function$;

-- Projects: "<opportunity> - <record type label>", same rule. An opportunity
-- named for its program already ends with that program's label often enough
-- that this would have doubled too.
CREATE OR REPLACE FUNCTION public.derive_project_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_opportunity_name text;
  v_record_label     text;
BEGIN
  SELECT o.opportunity_name INTO v_opportunity_name
    FROM opportunities o WHERE o.id = NEW.opportunity_id;

  SELECT pv.picklist_label INTO v_record_label
    FROM picklist_values pv WHERE pv.id = NEW.project_record_type;

  NEW.project_name := public.append_name_segment(v_opportunity_name, v_record_label);
  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
