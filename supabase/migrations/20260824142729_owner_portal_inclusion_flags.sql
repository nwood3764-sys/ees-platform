-- =============================================================================
-- Include in Property Owner Portal — explicit, per-record publication control.
--
-- Nicholas, 2026-08-23: "on the account record, the property record, and the
-- building record, there must be a radio button that says 'Include in property
-- owner portal'. I need some real tactile controls on what's viewable, what's
-- not, and then obviously anything under that property. And building for the
-- children that we've already outlined is viewable."
--
-- This is a SECOND, independent axis from the grants. They answer different
-- questions and BOTH must say yes before anything renders:
--
--   inclusion (this)  — is this record published to the owner portal at all?
--                       Content-side, set by internal staff on the record.
--   grant             — which portal user may see it? Person-side, set per
--                       portal user in portal_user_property_grants.
--
-- Inheritance is top-down, exactly as described: an account that is not
-- included publishes nothing; a property that is not included hides itself and
-- everything under it; a building that is not included hides itself and its
-- units, opportunities, projects, work orders, steps, photos and visits — while
-- its property still lists as an (empty) container.
--
-- Defaults are deliberately asymmetric:
--   accounts   DEFAULT false — the master switch. Publishing an organisation is
--                              an affirmative act, made once per organisation.
--   properties DEFAULT true  — inside a published organisation everything is
--   buildings  DEFAULT true    published unless deliberately excluded.
--
-- Backfill: the 34 accounts that already had portal content are set true, so
-- the previews reviewed on 2026-08-23 keep working. Every other account — and
-- every account created from now on — starts unpublished.
-- =============================================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS account_include_in_owner_portal boolean NOT NULL DEFAULT false;
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS property_include_in_owner_portal boolean NOT NULL DEFAULT true;
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS building_include_in_owner_portal boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.accounts.account_include_in_owner_portal IS
  'Master switch: may this organisation''s properties appear in the Property Owner Portal at all? Off by default; publishing is an affirmative act.';
COMMENT ON COLUMN public.properties.property_include_in_owner_portal IS
  'Publish this property (and everything beneath it) to the Property Owner Portal. Only takes effect when the owning account is also included.';
COMMENT ON COLUMN public.buildings.building_include_in_owner_portal IS
  'Publish this building (and its units, opportunities, projects, work orders, photos and visits) to the Property Owner Portal. Only takes effect when the property and account are also included.';

-- Backfill under replica so the audit logger does not record ~34 account edits
-- as if a person had made them.
SET session_replication_role = replica;

UPDATE public.accounts a
   SET account_include_in_owner_portal = true
 WHERE a.account_is_deleted IS NOT TRUE
   AND a.account_include_in_owner_portal = false
   AND EXISTS (
     SELECT 1
     FROM public.properties p
     JOIN public.buildings b ON b.property_id = p.id AND b.building_is_deleted = false
     JOIN public.opportunities o ON o.building_id = b.id AND o.opportunity_is_deleted = false
     WHERE p.property_account_id = a.id AND p.property_is_deleted = false
   );

SET session_replication_role = DEFAULT;

CREATE INDEX IF NOT EXISTS idx_accounts_include_in_owner_portal
  ON public.accounts (account_include_in_owner_portal) WHERE account_include_in_owner_portal;


-- ─── ONE definition of portal visibility ─────────────────────────────────────
-- Used by the project tracker, the calendar and the photo signer. Before this,
-- each read path carried its own copy of the grant + account-guard CTEs; adding
-- inclusion to three copies is exactly how they drift apart.

CREATE OR REPLACE FUNCTION public.portal_visible_property_ids(
  p_portal_user_id uuid,
  p_account_id     uuid,
  p_preview_account boolean
)
 RETURNS TABLE (property_id uuid)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT p.id
  FROM properties p
  JOIN accounts a ON a.id = p.property_account_id
                 AND a.account_is_deleted IS NOT TRUE
                 AND a.account_include_in_owner_portal
  WHERE p_preview_account
    AND p.property_is_deleted = false
    AND p.property_include_in_owner_portal
    AND p.property_account_id = p_account_id
  UNION
  SELECT DISTINCT g.pug_property_id
  FROM portal_user_property_grants g
  JOIN properties p ON p.id = g.pug_property_id
                   AND p.property_is_deleted = false
                   AND p.property_include_in_owner_portal
  JOIN accounts a ON a.id = p.property_account_id
                 AND a.account_is_deleted IS NOT TRUE
                 AND a.account_include_in_owner_portal
  WHERE NOT p_preview_account
    AND g.pug_portal_user_id = p_portal_user_id
    AND g.pug_is_deleted = false
    AND g.pug_property_id IS NOT NULL
    AND (p_account_id IS NULL OR p.property_account_id = p_account_id);
$function$;

CREATE OR REPLACE FUNCTION public.portal_visible_building_ids(
  p_portal_user_id uuid,
  p_account_id     uuid,
  p_preview_account boolean
)
 RETURNS TABLE (building_id uuid)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT DISTINCT g.pug_building_id
  FROM portal_user_property_grants g
  JOIN buildings b ON b.id = g.pug_building_id
                  AND b.building_is_deleted = false
                  AND b.building_include_in_owner_portal
  JOIN properties p ON p.id = b.property_id
                   AND p.property_is_deleted = false
                   AND p.property_include_in_owner_portal
  JOIN accounts a ON a.id = p.property_account_id
                 AND a.account_is_deleted IS NOT TRUE
                 AND a.account_include_in_owner_portal
  WHERE NOT p_preview_account
    AND g.pug_portal_user_id = p_portal_user_id
    AND g.pug_is_deleted = false
    AND g.pug_building_id IS NOT NULL
    AND (p_account_id IS NULL OR p.property_account_id = p_account_id);
$function$;

-- Internals of the portal RPCs, not an API.
REVOKE ALL ON FUNCTION public.portal_visible_property_ids(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_visible_property_ids(uuid, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.portal_visible_property_ids(uuid, uuid, boolean) FROM authenticated;
REVOKE ALL ON FUNCTION public.portal_visible_building_ids(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_visible_building_ids(uuid, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.portal_visible_building_ids(uuid, uuid, boolean) FROM authenticated;


-- ─── The control, on every account / property / building record layout ───────
-- Purpose-named section so it is unmistakable rather than buried among
-- unrelated checkboxes.

DO $seed$
DECLARE
  lay        record;
  v_column   text;
  v_label    text;
  v_section  uuid;
  v_widget   uuid;
  v_fields   jsonb;
  v_order    integer;
  v_position integer;
  v_count    integer := 0;
BEGIN
  FOR lay IN
    SELECT pl.id, pl.page_layout_object, pl.page_layout_name
    FROM public.page_layouts pl
    WHERE pl.is_deleted = false
      AND pl.page_layout_type = 'record_detail'
      AND pl.page_layout_object IN ('accounts', 'properties', 'buildings')
    ORDER BY pl.page_layout_object, pl.page_layout_name
  LOOP
    v_column := CASE lay.page_layout_object
                  WHEN 'accounts'   THEN 'account_include_in_owner_portal'
                  WHEN 'properties' THEN 'property_include_in_owner_portal'
                  WHEN 'buildings'  THEN 'building_include_in_owner_portal'
                END;
    v_label := 'Include in Property Owner Portal';

    -- Never render twice.
    UPDATE public.page_layout_widgets w
       SET widget_config = jsonb_set(
             w.widget_config, '{fields}',
             (SELECT COALESCE(jsonb_agg(e.f ORDER BY e.ord), '[]'::jsonb)
                FROM jsonb_array_elements(w.widget_config->'fields') WITH ORDINALITY AS e(f, ord)
               WHERE COALESCE(e.f->>'name', '') <> v_column))
      FROM public.page_layout_sections s
     WHERE w.section_id = s.id
       AND s.page_layout_id = lay.id
       AND s.is_deleted = false
       AND w.is_deleted = false
       AND w.widget_type = 'field_group'
       AND w.widget_config ? 'fields'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(w.widget_config->'fields') AS x
                    WHERE x->>'name' = v_column);

    SELECT s.id INTO v_section
    FROM public.page_layout_sections s
    WHERE s.page_layout_id = lay.id AND s.is_deleted = false
      AND s.section_label = 'Property Owner Portal'
    ORDER BY s.section_order
    LIMIT 1;

    IF v_section IS NULL THEN
      -- Above System Information where that exists, else at the end.
      SELECT COALESCE(min(s.section_order), (SELECT COALESCE(max(s2.section_order), 0) + 1
                                               FROM public.page_layout_sections s2
                                              WHERE s2.page_layout_id = lay.id AND s2.is_deleted = false))
        INTO v_order
      FROM public.page_layout_sections s
      WHERE s.page_layout_id = lay.id AND s.is_deleted = false
        AND s.section_label = 'System Information';

      INSERT INTO public.page_layout_sections
        (page_layout_id, section_order, section_label, section_columns, section_tab,
         section_placement, section_is_collapsible, section_is_collapsed_by_default)
      VALUES (lay.id, v_order, 'Property Owner Portal', 1, 'Details', 'main', true, false)
      RETURNING id INTO v_section;
    END IF;

    SELECT w.id, w.widget_config->'fields' INTO v_widget, v_fields
    FROM public.page_layout_widgets w
    WHERE w.section_id = v_section AND w.is_deleted = false
      AND w.widget_type = 'field_group'
    ORDER BY w.widget_position
    LIMIT 1;

    IF v_widget IS NULL THEN
      SELECT COALESCE(max(w.widget_position), 0) + 1 INTO v_position
      FROM public.page_layout_widgets w
      WHERE w.section_id = v_section AND w.is_deleted = false;

      INSERT INTO public.page_layout_widgets
        (page_layout_id, section_id, widget_type, widget_title, widget_position, widget_config)
      VALUES (lay.id, v_section, 'field_group', 'Property Owner Portal', COALESCE(v_position, 1),
              jsonb_build_object('fields', '[]'::jsonb))
      RETURNING id, widget_config->'fields' INTO v_widget, v_fields;
    END IF;

    UPDATE public.page_layout_widgets
       SET widget_config = jsonb_set(
             widget_config, '{fields}',
             COALESCE(v_fields, '[]'::jsonb) || jsonb_build_array(
               jsonb_build_object('name', v_column, 'label', v_label, 'type', 'boolean')))
     WHERE id = v_widget;

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Include in Property Owner Portal placed on % layouts', v_count;
END;
$seed$;


-- ─── The Portal module list surfaces publication state ───────────────────────

DROP FUNCTION IF EXISTS public.list_property_owner_portals(boolean);

CREATE FUNCTION public.list_property_owner_portals(
  p_only_with_content boolean DEFAULT true
)
 RETURNS TABLE (
   account_id            uuid,
   account_record_number text,
   account_name          text,
   account_record_type   text,
   included              boolean,
   properties            int,
   properties_included   int,
   buildings             int,
   buildings_included    int,
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
    RETURN;
  END IF;

  RETURN QUERY
  WITH props AS (
    SELECT p.property_account_id AS acct, p.id, p.property_include_in_owner_portal AS inc
    FROM properties p
    WHERE p.property_is_deleted = false AND p.property_account_id IS NOT NULL
  ),
  blds AS (
    SELECT pr.acct, b.id, (b.building_include_in_owner_portal AND pr.inc) AS inc
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
           count(DISTINCT pr.id)::int AS properties,
           count(DISTINCT pr.id) FILTER (WHERE pr.inc)::int AS properties_included
    FROM props pr GROUP BY 1
  )
  SELECT a.id,
         a.account_record_number,
         a.account_name,
         rt.picklist_label,
         a.account_include_in_owner_portal,
         COALESCE(agg.properties, 0),
         COALESCE(agg.properties_included, 0),
         COALESCE((SELECT count(DISTINCT b.id)::int FROM blds b WHERE b.acct = a.id), 0),
         COALESCE((SELECT count(DISTINCT b.id)::int FROM blds b WHERE b.acct = a.id AND b.inc), 0),
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
    AND (NOT p_only_with_content OR EXISTS (SELECT 1 FROM opps o WHERE o.acct = a.id))
  ORDER BY a.account_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_property_owner_portals(boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_property_owner_portals(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_property_owner_portals(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_property_owner_portals(boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
