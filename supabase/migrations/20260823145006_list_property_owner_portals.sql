-- =============================================================================
-- Portal module → Property Owner Portals.
--
-- Nicholas, 2026-08-23: "it shouldn't be such a closed loop. Admin users should
-- be able to go to open portals and view it as anyone could from an
-- organization. So like, open up the property owner portal, view it as
-- [an organization]."
--
-- Until now the only ways into a portal were record-page Actions — View Owner
-- Portal on an account, View Portal as This User on a portal user. That means
-- finding a record before you can look at a portal, which is backwards: the
-- Portal module is where you go to look at portals, so the organizations belong
-- there. This function backs that list, and the organization switcher inside
-- the portal banner.
--
-- One row per account that owns property, with everything needed to decide
-- whether a portal is worth opening: how much content it would show, and
-- whether anyone has been invited yet.
--
-- SECURITY DEFINER with an explicit internal-staff guard rather than INVOKER:
-- aggregating 17.5k properties under per-row RLS is the exact shape that timed
-- out before on this platform (outreach_properties_v, 2026-07-06). Listing an
-- account name and some counts is not privileged — internal staff can already
-- see all of it. OPENING a portal as an organization stays Admin-only, enforced
-- separately inside get_portal_project_tracker / get_portal_calendar.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.list_property_owner_portals(
  p_only_with_content boolean DEFAULT true
)
 RETURNS TABLE (
   account_id            uuid,
   account_record_number text,
   account_name          text,
   account_record_type   text,
   properties            int,
   buildings             int,
   opportunities         int,
   work_orders           int,
   scheduled_visits      int,
   portal_users          int,
   active_portal_users   int
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF public.current_app_user_id() IS NULL THEN
    RETURN;   -- external / unauthenticated callers get nothing
  END IF;

  RETURN QUERY
  WITH props AS (
    SELECT p.property_account_id AS acct, p.id
    FROM properties p
    WHERE p.property_is_deleted = false AND p.property_account_id IS NOT NULL
  ),
  blds AS (
    SELECT pr.acct, b.id
    FROM props pr
    JOIN buildings b ON b.property_id = pr.id AND b.building_is_deleted = false
  ),
  opps AS (
    SELECT bl.acct, o.id
    FROM blds bl
    JOIN opportunities o ON o.building_id = bl.id AND o.opportunity_is_deleted = false
  ),
  projs AS (
    SELECT bl.acct, prj.id
    FROM blds bl
    JOIN projects prj ON prj.building_id = bl.id AND prj.project_is_deleted IS NOT TRUE
  ),
  wos AS (
    SELECT pj.acct, wo.id
    FROM projs pj
    JOIN work_orders wo ON wo.project_id = pj.id AND wo.work_order_is_deleted IS NOT TRUE
  ),
  visits AS (
    SELECT w.acct, sa.id
    FROM wos w
    JOIN service_appointments sa ON sa.work_order_id = w.id
      AND sa.sa_is_deleted IS NOT TRUE AND sa.sa_scheduled_start_time IS NOT NULL
  ),
  pus AS (
    SELECT pu.portal_user_account_id AS acct,
           count(*)::int AS total,
           count(*) FILTER (WHERE pu.status IN ('Portal User Active', 'Portal User Invited'))::int AS active
    FROM portal_users pu
    WHERE pu.is_deleted IS NOT TRUE AND pu.portal_user_account_id IS NOT NULL
    GROUP BY 1
  ),
  agg AS (
    SELECT pr.acct,
           count(DISTINCT pr.id)::int AS properties
    FROM props pr GROUP BY 1
  )
  SELECT a.id,
         a.account_record_number,
         a.account_name,
         rt.picklist_label,
         COALESCE(agg.properties, 0),
         COALESCE((SELECT count(DISTINCT b.id)::int FROM blds b WHERE b.acct = a.id), 0),
         COALESCE((SELECT count(DISTINCT o.id)::int FROM opps o WHERE o.acct = a.id), 0),
         COALESCE((SELECT count(DISTINCT w.id)::int FROM wos w WHERE w.acct = a.id), 0),
         COALESCE((SELECT count(DISTINCT v.id)::int FROM visits v WHERE v.acct = a.id), 0),
         COALESCE(pus.total, 0),
         COALESCE(pus.active, 0)
  FROM accounts a
  JOIN agg ON agg.acct = a.id
  LEFT JOIN picklist_values rt ON rt.id = a.account_record_type
  LEFT JOIN pus ON pus.acct = a.id
  WHERE a.account_is_deleted IS NOT TRUE
    AND (
      NOT p_only_with_content
      OR EXISTS (SELECT 1 FROM opps o WHERE o.acct = a.id)
    )
  ORDER BY a.account_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_property_owner_portals(boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_property_owner_portals(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_property_owner_portals(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_property_owner_portals(boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
