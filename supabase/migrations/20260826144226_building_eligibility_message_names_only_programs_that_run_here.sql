-- ---------------------------------------------------------------------------
-- The refusal message must name what is ACTUALLY available on this building.
--
-- Two independent rules narrow an opportunity's record type: the building's
-- housing type (the eligibility edges shipped in 20260826144116) and the
-- property's state (20260823002712). The first draft of the eligibility message
-- listed every record type eligible for the housing type, which on a Wisconsin
-- multifamily building meant offering MI-IRA-MF-HOMES and NC-IRA-MF-HOMES --
-- programs the state rule would refuse a second later. A refusal that names an
-- option that does not work is worse than no list at all.
--
-- The honest list is the intersection, so the message reads:
--   Available on this building: Field Operations, FOE-2026-WI, WI-IRA-MF-HEAR,
--   WI-IRA-MF-HOMES, WI-IRA-MF-HOMES-AUDIT.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_opportunity_record_type_building_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_building_rt    uuid;
  v_building_name  text;
  v_building_label text;
  v_opp_label      text;
  v_state          text;
  v_allowed        text;
BEGIN
  IF NEW.building_id IS NULL OR NEW.opportunity_record_type IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT building_record_type, building_name
    INTO v_building_rt, v_building_name
    FROM public.buildings WHERE id = NEW.building_id;

  -- A building that has not said what it is constrains nothing. That is a data
  -- gap, not a licence: fill in the building's record type and the rule applies.
  IF v_building_rt IS NULL THEN RETURN NEW; END IF;

  IF public.record_type_eligible('buildings', v_building_rt, 'opportunities', NEW.opportunity_record_type) THEN
    RETURN NEW;
  END IF;

  SELECT picklist_label INTO v_building_label FROM public.picklist_values WHERE id = v_building_rt;
  SELECT picklist_label INTO v_opp_label      FROM public.picklist_values WHERE id = NEW.opportunity_record_type;
  SELECT property_state INTO v_state FROM public.properties WHERE id = NEW.property_id;

  SELECT string_agg(pv.picklist_label, ', ' ORDER BY pv.picklist_label)
    INTO v_allowed
    FROM public.record_type_eligibility e
    JOIN public.picklist_values pv ON pv.id = e.rte_child_record_type_id
   WHERE e.rte_parent_object = 'buildings' AND e.rte_parent_record_type_id = v_building_rt
     AND e.rte_child_object = 'opportunities'
     AND e.rte_is_active AND NOT e.rte_is_deleted
     AND pv.picklist_is_active
     AND (v_state IS NULL OR pv.picklist_state IS NULL OR pv.picklist_state = v_state);

  RAISE EXCEPTION
    'Opportunity record type "%" does not run on a % building ("%"). Available on this building: %.',
    COALESCE(v_opp_label, '(unknown)'), COALESCE(v_building_label, '(untyped)'),
    COALESCE(v_building_name, '(unnamed)'), COALESCE(v_allowed, '(none configured)');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_opportunity_record_type_building_eligibility() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_opportunity_record_type_building_eligibility() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_opportunity_record_type_building_eligibility() FROM authenticated;

NOTIFY pgrst, 'reload schema';
