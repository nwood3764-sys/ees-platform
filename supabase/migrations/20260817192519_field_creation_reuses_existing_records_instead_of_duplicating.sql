-- Purpose-built matchers so "does this already exist?" is answered one way.
--
-- Nicholas, 2026-08-17, looking at 15008 Statesville Road - Huntersville:
-- "I've got multiple properties and mobile buildings for this address. I don't
-- know how it happened. Make sure there's some automation for creating records
-- so that they're not duplicating these."
--
-- How it happened. PROP-23734 and PROP-23736 (and BLD-00147 / BLD-00149) were
-- created 65 minutes apart, each property and its building in the SAME second —
-- the signature of create_mf_building_assessment_work_order, not hand entry.
-- Its property lookup was scoped to the account:
--     WHERE property_account_id = v_acct AND lower(street) = ... AND zip = ...
-- but v_acct had just been INSERTed from the typed owner name. A brand new
-- account can never own an existing property, so the lookup ALWAYS missed and a
-- duplicate property was ALWAYS created. The building was then INSERTed
-- unconditionally, with no check for one already on the property.
--
-- These three matchers are the shared answer. The RPC is rewritten to use them
-- in the migration that follows (20260817192730), which supersedes the version
-- applied here.
--
-- Deliberately NOT solved with a unique constraint: there are already 872
-- duplicate address groups from the HUD imports, and a hard constraint would
-- start rejecting field work — which breaks the standing rule that
-- documentation is never blocked.

CREATE OR REPLACE FUNCTION public.find_existing_property_at_address(
  p_street text, p_zip text, p_city text DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  -- Address identity, NOT account identity: the same building does not become a
  -- different property because a different owner name was typed. Matches the
  -- normalized street against the zip5, falling back to the city when a zip is
  -- not supplied. Oldest wins, so repeated calls keep converging on one record.
  SELECT p.id
  FROM properties p
  WHERE p.property_is_deleted IS NOT TRUE
    AND public.normalize_street_address(p.property_street)
        = public.normalize_street_address(p_street)
    AND (
      (NULLIF(btrim(coalesce(p_zip,'')), '') IS NOT NULL
        AND left(btrim(p.property_zip), 5) = left(btrim(p_zip), 5))
      OR (NULLIF(btrim(coalesce(p_zip,'')), '') IS NULL
        AND NULLIF(btrim(coalesce(p_city,'')), '') IS NOT NULL
        AND lower(btrim(p.property_city)) = lower(btrim(p_city)))
    )
  ORDER BY p.property_created_at ASC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.find_existing_building_on_property(
  p_property_id uuid, p_number_or_name text
)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  -- A building is identified by its number/name within its property. With no
  -- number supplied, the property's existing single building is the answer —
  -- a second "Building" row for the same structure is never what was meant.
  SELECT b.id
  FROM buildings b
  WHERE b.building_is_deleted IS NOT TRUE
    AND b.property_id = p_property_id
    AND (
      NULLIF(btrim(coalesce(p_number_or_name,'')), '') IS NULL
      OR lower(btrim(coalesce(b.building_number_or_name, ''))) = lower(btrim(p_number_or_name))
      OR lower(btrim(coalesce(b.building_name, ''))) = lower(btrim(p_number_or_name))
    )
  ORDER BY b.building_created_at ASC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.find_existing_account_by_name(p_name text)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  -- Normalized-name match ACROSS record types, per the 2026-07-25 ruling that a
  -- company is ONE account regardless of the role it plays.
  SELECT a.id
  FROM accounts a
  WHERE a.account_is_deleted IS NOT TRUE
    AND NULLIF(btrim(coalesce(p_name,'')), '') IS NOT NULL
    AND public.normalize_duplicate_match_name(a.account_name)
        = public.normalize_duplicate_match_name(p_name)
  ORDER BY a.account_created_at ASC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.find_existing_property_at_address(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_existing_property_at_address(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_existing_property_at_address(text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.find_existing_building_on_property(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_existing_building_on_property(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_existing_building_on_property(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.find_existing_account_by_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_existing_account_by_name(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_existing_account_by_name(text) TO service_role;

NOTIFY pgrst, 'reload schema';
