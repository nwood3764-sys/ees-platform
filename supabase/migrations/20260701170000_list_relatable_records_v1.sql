-- Returns the connected parent records a user can link an activity to when
-- logging from a given record (its property/account/building/opportunity),
-- so the Log Activity composer can offer them as includable checkboxes.
-- Contacts are handled separately by the composer's Contact picker.
CREATE OR REPLACE FUNCTION public.list_relatable_records(
  p_object text,
  p_id     uuid
)
RETURNS TABLE (
  rel_object     text,
  rel_id         uuid,
  rel_label      text,
  rel_type_label text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_object = 'opportunities' THEN
    RETURN QUERY
      SELECT 'properties', p.id, p.property_name, 'Property'
      FROM opportunities o JOIN properties p ON p.id = o.property_id
      WHERE o.id = p_id
      UNION ALL
      SELECT 'accounts', a.id, a.account_name, 'Account'
      FROM opportunities o JOIN accounts a ON a.id = o.opportunity_account_id
      WHERE o.id = p_id
      UNION ALL
      SELECT 'buildings', b.id, b.building_name, 'Building'
      FROM opportunities o JOIN buildings b ON b.id = o.building_id
      WHERE o.id = p_id;

  ELSIF p_object = 'projects' THEN
    RETURN QUERY
      SELECT 'opportunities', o.id, o.opportunity_name, 'Opportunity'
      FROM projects pr JOIN opportunities o ON o.id = pr.opportunity_id
      WHERE pr.id = p_id
      UNION ALL
      SELECT 'properties', p.id, p.property_name, 'Property'
      FROM projects pr JOIN properties p ON p.id = pr.property_id
      WHERE pr.id = p_id
      UNION ALL
      SELECT 'accounts', a.id, a.account_name, 'Account'
      FROM projects pr JOIN accounts a ON a.id = pr.project_account_id
      WHERE pr.id = p_id
      UNION ALL
      SELECT 'buildings', b.id, b.building_name, 'Building'
      FROM projects pr JOIN buildings b ON b.id = pr.building_id
      WHERE pr.id = p_id;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_relatable_records(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_relatable_records(text, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
