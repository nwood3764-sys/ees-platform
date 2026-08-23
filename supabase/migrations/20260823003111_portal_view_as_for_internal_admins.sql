-- =============================================================================
-- Property Owner Portal — View As, for internal system admins.
--
-- Nicholas, 2026-08-23: "All the system admins from our side should be able to
-- log in as a user to see what they use. I wanna be able to see what they see."
--
-- Salesforce "Login As" parity, with the same guard rails:
--   • Admin role ONLY (public.app_is_admin()).
--   • Read-only. The portal is viewing-only today; when portal writes are built
--     they must refuse while a view-as context is set.
--   • Every session is logged — who viewed as whom, when — in
--     portal_view_as_sessions.
--   • The portal renders a persistent banner naming who is being viewed, so a
--     preview can never be mistaken for the admin's own session or for a
--     customer's real screen.
--
-- Two modes, because most accounts have NO portal user yet (only two exist
-- platform-wide today), and "see what they'd see" has to work before anyone is
-- invited:
--
--   view as portal user  — exact fidelity: that user's own grants, their
--                          account guard. What THEY see, precisely.
--   preview an account   — hypothetical: every property on the account, i.e.
--                          what a full-portfolio owner there would be granted.
--
-- Exactly one may be supplied. Both are additive parameters on the existing
-- read RPCs, defaulted to NULL, so the portal's own calls are unchanged.
--
-- This replaces the hand-built stopgap of pointing an internal auth identity at
-- a portal_users row: that only ever worked for one account at a time, and
-- fetchPortalUserSelf()'s maybeSingle() would error outright the moment a
-- second such row existed.
-- =============================================================================

-- ─── 1. The audit trail ──────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS public.seq_portal_view_as_sessions;

CREATE TABLE IF NOT EXISTS public.portal_view_as_sessions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pva_record_number     text NOT NULL,
  pva_internal_user_id  uuid NOT NULL REFERENCES public.users(id),
  pva_portal_user_id    uuid REFERENCES public.portal_users(id),
  pva_account_id        uuid REFERENCES public.accounts(id),
  pva_started_at        timestamptz NOT NULL DEFAULT now(),
  pva_is_deleted        boolean NOT NULL DEFAULT false,
  pva_deleted_at        timestamptz,
  pva_deleted_by        uuid REFERENCES public.users(id),
  pva_deletion_reason   text,
  pva_created_at        timestamptz NOT NULL DEFAULT now(),
  pva_created_by        uuid REFERENCES public.users(id),
  pva_updated_at        timestamptz NOT NULL DEFAULT now(),
  pva_updated_by        uuid REFERENCES public.users(id),
  is_seed_data          boolean NOT NULL DEFAULT false,
  CONSTRAINT portal_view_as_sessions_target_check
    CHECK (num_nonnulls(pva_portal_user_id, pva_account_id) = 1)
);

COMMENT ON TABLE public.portal_view_as_sessions IS
  'One row per time an internal admin opened the Property Owner Portal as someone else. Written by portal_view_as_start(); never by the client.';

CREATE INDEX IF NOT EXISTS idx_pva_internal_user ON public.portal_view_as_sessions (pva_internal_user_id, pva_started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pva_portal_user   ON public.portal_view_as_sessions (pva_portal_user_id);
CREATE INDEX IF NOT EXISTS idx_pva_account       ON public.portal_view_as_sessions (pva_account_id);

CREATE OR REPLACE FUNCTION public.set_portal_view_as_record_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.pva_record_number IS NULL OR NEW.pva_record_number = '' THEN
    NEW.pva_record_number := public.generate_record_number('PVA-', 'seq_portal_view_as_sessions');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pva_record_number ON public.portal_view_as_sessions;
CREATE TRIGGER trg_pva_record_number
  BEFORE INSERT ON public.portal_view_as_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_portal_view_as_record_number();

DROP TRIGGER IF EXISTS trg_pva_updated_at ON public.portal_view_as_sessions;
CREATE TRIGGER trg_pva_updated_at
  BEFORE UPDATE ON public.portal_view_as_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.portal_view_as_sessions ENABLE ROW LEVEL SECURITY;

-- Admins read the log; nobody writes it directly (the RPC is SECURITY DEFINER).
DROP POLICY IF EXISTS pva_admin_select ON public.portal_view_as_sessions;
CREATE POLICY pva_admin_select ON public.portal_view_as_sessions
  FOR SELECT TO authenticated
  USING (public.app_is_admin());


-- ─── 2. Starting a session ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.portal_view_as_start(
  p_portal_user_id uuid DEFAULT NULL,
  p_account_id     uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_caller     uuid;
  v_label      text;
  v_account    uuid;
  v_mode       text;
BEGIN
  v_caller := public.current_app_user_id();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT public.app_is_admin() THEN
    RETURN jsonb_build_object('error', 'not_authorized');
  END IF;
  IF num_nonnulls(p_portal_user_id, p_account_id) <> 1 THEN
    RETURN jsonb_build_object('error', 'supply_exactly_one_target');
  END IF;

  IF p_portal_user_id IS NOT NULL THEN
    SELECT pu.full_name, pu.portal_user_account_id
      INTO v_label, v_account
    FROM public.portal_users pu
    WHERE pu.id = p_portal_user_id AND pu.is_deleted = false;
    IF v_label IS NULL THEN
      RETURN jsonb_build_object('error', 'portal_user_not_found');
    END IF;
    v_mode := 'portal_user';
  ELSE
    SELECT a.account_name INTO v_label
    FROM public.accounts a
    WHERE a.id = p_account_id AND a.account_is_deleted IS NOT TRUE;
    IF v_label IS NULL THEN
      RETURN jsonb_build_object('error', 'account_not_found');
    END IF;
    v_account := p_account_id;
    v_mode := 'account_preview';
  END IF;

  INSERT INTO public.portal_view_as_sessions
    (pva_record_number, pva_internal_user_id, pva_portal_user_id, pva_account_id,
     pva_created_by, pva_updated_by)
  VALUES
    ('', v_caller, p_portal_user_id, p_account_id, v_caller, v_caller);

  RETURN jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'label', v_label,
    'portal_user_id', p_portal_user_id,
    'account_id', v_account
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.portal_view_as_start(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.portal_view_as_start(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.portal_view_as_start(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_view_as_start(uuid, uuid) TO service_role;


-- ─── 3. The two portal reads gain the view-as parameters ─────────────────────
-- Signature change, so DROP + CREATE (and re-issue grants). With every
-- parameter defaulted, the portal's existing no-argument calls are unchanged.

DROP FUNCTION IF EXISTS public.get_portal_project_tracker();

CREATE FUNCTION public.get_portal_project_tracker(
  p_view_as_portal_user_id uuid DEFAULT NULL,
  p_preview_account_id     uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_portal_user_id  uuid;
  v_account_id      uuid;
  v_preview_account boolean := false;
  v_result jsonb;
BEGIN
  IF p_view_as_portal_user_id IS NOT NULL OR p_preview_account_id IS NOT NULL THEN
    IF NOT public.app_is_admin() THEN
      RETURN jsonb_build_object('error', 'not_authorized', 'properties', '[]'::jsonb);
    END IF;
    IF num_nonnulls(p_view_as_portal_user_id, p_preview_account_id) <> 1 THEN
      RETURN jsonb_build_object('error', 'supply_exactly_one_target', 'properties', '[]'::jsonb);
    END IF;
    IF p_view_as_portal_user_id IS NOT NULL THEN
      SELECT pu.id, pu.portal_user_account_id INTO v_portal_user_id, v_account_id
      FROM portal_users pu
      WHERE pu.id = p_view_as_portal_user_id AND pu.is_deleted = false;
      IF v_portal_user_id IS NULL THEN
        RETURN jsonb_build_object('error', 'no_portal_user', 'properties', '[]'::jsonb);
      END IF;
    ELSE
      v_preview_account := true;
      v_account_id      := p_preview_account_id;
    END IF;
  ELSE
    SELECT pu.id, pu.portal_user_account_id
      INTO v_portal_user_id, v_account_id
    FROM portal_users pu
    WHERE pu.auth_user_id = auth.uid()
      AND pu.is_deleted = false
      AND pu.status NOT IN ('Portal User Suspended', 'Portal User Deactivated')
    LIMIT 1;

    IF v_portal_user_id IS NULL THEN
      RETURN jsonb_build_object('error', 'no_portal_user', 'properties', '[]'::jsonb);
    END IF;
  END IF;

  WITH granted_properties AS (
    -- Account preview: every property on the account, which is what a
    -- full-portfolio owner there would be granted.
    SELECT p.id AS property_id
    FROM properties p
    WHERE v_preview_account
      AND p.property_is_deleted = false
      AND p.property_account_id = v_account_id
    UNION
    SELECT DISTINCT g.pug_property_id AS property_id
    FROM portal_user_property_grants g
    JOIN properties p ON p.id = g.pug_property_id AND p.property_is_deleted = false
    WHERE NOT v_preview_account
      AND g.pug_portal_user_id = v_portal_user_id AND g.pug_is_deleted = false
      AND g.pug_property_id IS NOT NULL
      AND (v_account_id IS NULL OR p.property_account_id = v_account_id)
  ),
  granted_buildings AS (
    SELECT DISTINCT g.pug_building_id AS building_id
    FROM portal_user_property_grants g
    JOIN buildings b ON b.id = g.pug_building_id AND b.building_is_deleted = false
    JOIN properties p ON p.id = b.property_id
    WHERE NOT v_preview_account
      AND g.pug_portal_user_id = v_portal_user_id AND g.pug_is_deleted = false
      AND g.pug_building_id IS NOT NULL
      AND (v_account_id IS NULL OR p.property_account_id = v_account_id)
  ),
  rt_stages AS (
    SELECT a.pvrta_record_type_id AS record_type_id, sv.id AS stage_value_id, sv.picklist_label AS stage_label,
           (ROW_NUMBER() OVER (PARTITION BY a.pvrta_record_type_id
             ORDER BY COALESCE(a.pvrta_sort_order, sv.picklist_sort_order), sv.picklist_label))::int AS rank
    FROM picklist_value_record_type_assignments a
    JOIN picklist_values sv ON a.pvrta_picklist_value_id = sv.id
    WHERE a.pvrta_is_deleted = false AND sv.picklist_object = 'opportunities' AND sv.picklist_field = 'opportunity_stage'
  ),
  rt_stage_lists AS (
    SELECT record_type_id, jsonb_agg(jsonb_build_object('label', stage_label, 'sort_order', rank) ORDER BY rank) AS stages
    FROM rt_stages GROUP BY record_type_id
  ),
  scoped_opps AS (
    SELECT o.id, o.opportunity_record_number, o.opportunity_name, o.property_id, o.building_id,
           sv.picklist_label AS stage_label, COALESCE(cur.rank, 0) AS stage_order,
           COALESCE(rsl.stages, '[]'::jsonb) AS stages, rt.picklist_label AS program_label,
           rt.picklist_description AS record_type_description
    FROM opportunities o
    LEFT JOIN picklist_values sv ON o.opportunity_stage = sv.id
    LEFT JOIN picklist_values rt ON o.opportunity_record_type = rt.id
    LEFT JOIN rt_stages cur ON cur.record_type_id = o.opportunity_record_type AND cur.stage_value_id = o.opportunity_stage
    LEFT JOIN rt_stage_lists rsl ON rsl.record_type_id = o.opportunity_record_type
    WHERE o.opportunity_is_deleted = false AND o.building_id IS NOT NULL
      AND (o.property_id IN (SELECT property_id FROM granted_properties)
           OR o.building_id IN (SELECT building_id FROM granted_buildings))
  ),
  visible_buildings AS (
    SELECT b.id, b.building_name, b.building_record_number, b.building_address,
           b.building_total_units, b.building_number_of_units, b.property_id
    FROM buildings b
    WHERE b.building_is_deleted = false
      AND (b.property_id IN (SELECT property_id FROM granted_properties)
           OR b.id IN (SELECT building_id FROM granted_buildings))
  ),
  visible_properties AS (
    SELECT DISTINCT p.id, p.property_name, p.property_record_number, p.property_city, p.property_state,
           p.property_total_units, p.property_total_buildings
    FROM properties p
    WHERE p.property_is_deleted = false
      AND (p.id IN (SELECT property_id FROM granted_properties)
           OR p.id IN (SELECT property_id FROM visible_buildings))
  ),
  scoped_projects AS (
    SELECT pr.id, pr.opportunity_id, pr.building_id, pr.project_name,
           prt.picklist_label AS record_type, ps.picklist_label AS status_label
    FROM projects pr
    LEFT JOIN picklist_values prt ON pr.project_record_type = prt.id
    LEFT JOIN picklist_values ps ON pr.project_status = ps.id
    WHERE pr.project_is_deleted IS NOT TRUE
      AND pr.building_id IN (SELECT id FROM visible_buildings)
  ),
  scoped_work_orders AS (
    SELECT wo.id, wo.project_id, wo.unit_id, wo.work_order_name,
           wrt.picklist_label AS record_type, ws.picklist_label AS status_label, u.unit_number
    FROM work_orders wo
    LEFT JOIN picklist_values wrt ON wo.work_order_record_type = wrt.id
    LEFT JOIN picklist_values ws ON wo.work_order_status = ws.id
    LEFT JOIN units u ON wo.unit_id = u.id
    WHERE wo.work_order_is_deleted IS NOT TRUE
      AND wo.project_id IN (SELECT id FROM scoped_projects)
  ),
  scoped_work_steps AS (
    SELECT wst.id, wst.work_order_id, wst.work_step_name, wst.work_step_execution_order AS ord,
           wsv.picklist_label AS status_label, wst.work_step_reference_photo_url AS photo_url
    FROM work_steps wst
    LEFT JOIN picklist_values wsv ON wst.work_step_status = wsv.id
    WHERE wst.work_step_is_deleted IS NOT TRUE
      AND wst.work_order_id IN (SELECT id FROM scoped_work_orders)
  ),
  scoped_photos AS (
    SELECT p.work_step_id,
      jsonb_agg(jsonb_build_object(
        'id', p.id, 'url', p.file_url, 'thumb', p.thumbnail_url,
        'caption', p.caption, 'type', p.photo_type
      ) ORDER BY p.photo_type, p.created_at) AS photos
    FROM photos p
    WHERE p.is_deleted IS NOT TRUE
      AND p.work_step_id IN (SELECT id FROM scoped_work_steps)
    GROUP BY p.work_step_id
  ),
  step_json AS (
    SELECT sws.work_order_id, sws.ord,
      jsonb_build_object(
        'id', sws.id, 'name', sws.work_step_name, 'status', sws.status_label, 'order', sws.ord,
        'photo_url', sws.photo_url, 'photos', COALESCE(sp.photos, '[]'::jsonb)
      ) AS obj
    FROM scoped_work_steps sws
    LEFT JOIN scoped_photos sp ON sp.work_step_id = sws.id
  ),
  ws_by_wo AS (
    SELECT work_order_id, jsonb_agg(obj ORDER BY ord) AS steps
    FROM step_json GROUP BY work_order_id
  ),
  wo_by_project AS (
    SELECT swo.project_id,
      jsonb_agg(jsonb_build_object(
        'id', swo.id, 'name', swo.work_order_name, 'record_type', swo.record_type,
        'status', swo.status_label, 'unit_id', swo.unit_id, 'unit_number', swo.unit_number,
        'work_steps', COALESCE(wsb.steps, '[]'::jsonb)
      ) ORDER BY swo.unit_number, swo.record_type) AS wos
    FROM scoped_work_orders swo
    LEFT JOIN ws_by_wo wsb ON wsb.work_order_id = swo.id
    GROUP BY swo.project_id
  ),
  projects_by_opp AS (
    SELECT sp.opportunity_id,
      jsonb_agg(jsonb_build_object(
        'id', sp.id, 'name', sp.project_name, 'record_type', sp.record_type,
        'status', sp.status_label, 'work_orders', COALESCE(wp.wos, '[]'::jsonb)
      ) ORDER BY sp.record_type, sp.project_name) AS projects
    FROM scoped_projects sp
    LEFT JOIN wo_by_project wp ON wp.project_id = sp.id
    GROUP BY sp.opportunity_id
  ),
  opps_by_building AS (
    SELECT so.building_id,
      jsonb_agg(jsonb_build_object(
        'id', so.id, 'record_number', so.opportunity_record_number, 'name', so.opportunity_name,
        'program', so.program_label, 'record_type_description', so.record_type_description,
        'stage_label', so.stage_label, 'stage_order', so.stage_order,
        'stages', so.stages, 'projects', COALESCE(pbo.projects, '[]'::jsonb)
      ) ORDER BY so.program_label, so.opportunity_name) AS opps
    FROM scoped_opps so
    LEFT JOIN projects_by_opp pbo ON pbo.opportunity_id = so.id
    GROUP BY so.building_id
  ),
  buildings_by_property AS (
    SELECT vb.property_id,
      jsonb_agg(jsonb_build_object(
        'id', vb.id, 'name', vb.building_name, 'record_number', vb.building_record_number,
        'address', vb.building_address,
        'total_units', COALESCE(vb.building_total_units, vb.building_number_of_units),
        'unit_count', (SELECT count(*) FROM units u WHERE u.building_id = vb.id AND u.unit_is_deleted IS NOT TRUE),
        'opportunities', COALESCE(ob.opps, '[]'::jsonb)
      ) ORDER BY vb.building_name) AS buildings
    FROM visible_buildings vb
    LEFT JOIN opps_by_building ob ON ob.building_id = vb.id
    GROUP BY vb.property_id
  )
  SELECT jsonb_build_object(
    'portal_user_id', v_portal_user_id,
    'properties', COALESCE(jsonb_agg(jsonb_build_object(
      'id', vp.id, 'name', vp.property_name, 'record_number', vp.property_record_number,
      'city', vp.property_city, 'state', vp.property_state,
      'total_units', vp.property_total_units, 'total_buildings', vp.property_total_buildings,
      'buildings', COALESCE(bp.buildings, '[]'::jsonb)
    ) ORDER BY vp.property_name), '[]'::jsonb)
  ) INTO v_result
  FROM visible_properties vp
  LEFT JOIN buildings_by_property bp ON bp.property_id = vp.id;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_portal_project_tracker(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_portal_project_tracker(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_portal_project_tracker(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_portal_project_tracker(uuid, uuid) TO service_role;


DROP FUNCTION IF EXISTS public.get_portal_calendar();

CREATE FUNCTION public.get_portal_calendar(
  p_view_as_portal_user_id uuid DEFAULT NULL,
  p_preview_account_id     uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_portal_user_id  uuid;
  v_account_id      uuid;
  v_preview_account boolean := false;
  v_result jsonb;
BEGIN
  IF p_view_as_portal_user_id IS NOT NULL OR p_preview_account_id IS NOT NULL THEN
    IF NOT public.app_is_admin() THEN
      RETURN jsonb_build_object('error', 'not_authorized', 'appointments', '[]'::jsonb);
    END IF;
    IF num_nonnulls(p_view_as_portal_user_id, p_preview_account_id) <> 1 THEN
      RETURN jsonb_build_object('error', 'supply_exactly_one_target', 'appointments', '[]'::jsonb);
    END IF;
    IF p_view_as_portal_user_id IS NOT NULL THEN
      SELECT pu.id, pu.portal_user_account_id INTO v_portal_user_id, v_account_id
      FROM portal_users pu
      WHERE pu.id = p_view_as_portal_user_id AND pu.is_deleted = false;
      IF v_portal_user_id IS NULL THEN
        RETURN jsonb_build_object('error', 'no_portal_user', 'appointments', '[]'::jsonb);
      END IF;
    ELSE
      v_preview_account := true;
      v_account_id      := p_preview_account_id;
    END IF;
  ELSE
    SELECT pu.id, pu.portal_user_account_id
      INTO v_portal_user_id, v_account_id
    FROM portal_users pu
    WHERE pu.auth_user_id = auth.uid()
      AND pu.is_deleted = false
      AND pu.status NOT IN ('Portal User Suspended', 'Portal User Deactivated')
    LIMIT 1;

    IF v_portal_user_id IS NULL THEN
      RETURN jsonb_build_object('error', 'no_portal_user', 'appointments', '[]'::jsonb);
    END IF;
  END IF;

  WITH granted_properties AS (
    SELECT p.id AS property_id
    FROM properties p
    WHERE v_preview_account
      AND p.property_is_deleted = false
      AND p.property_account_id = v_account_id
    UNION
    SELECT DISTINCT g.pug_property_id AS property_id
    FROM portal_user_property_grants g
    JOIN properties p ON p.id = g.pug_property_id AND p.property_is_deleted = false
    WHERE NOT v_preview_account
      AND g.pug_portal_user_id = v_portal_user_id AND g.pug_is_deleted = false
      AND g.pug_property_id IS NOT NULL
      AND (v_account_id IS NULL OR p.property_account_id = v_account_id)
  ),
  granted_buildings AS (
    SELECT DISTINCT g.pug_building_id AS building_id
    FROM portal_user_property_grants g
    JOIN buildings b ON b.id = g.pug_building_id AND b.building_is_deleted = false
    JOIN properties p ON p.id = b.property_id
    WHERE NOT v_preview_account
      AND g.pug_portal_user_id = v_portal_user_id AND g.pug_is_deleted = false
      AND g.pug_building_id IS NOT NULL
      AND (v_account_id IS NULL OR p.property_account_id = v_account_id)
  ),
  visits AS (
    SELECT sa.id,
           COALESCE(sa.sa_subject, sa.sa_name) AS subject,
           st.picklist_label AS status,
           sa.sa_scheduled_start_time AS start_ts,
           sa.sa_scheduled_end_time AS end_ts,
           p.id AS property_id, p.property_name,
           NULLIF(trim(BOTH ', ' FROM concat_ws(', ',
             p.property_street,
             p.property_city,
             nullif(concat_ws(' ', p.property_state, p.property_zip), ''))), '') AS property_address,
           b.id AS building_id, b.building_name, b.building_address,
           u.id AS unit_id, u.unit_number,
           wrt.picklist_label AS work_order_type
    FROM service_appointments sa
    JOIN work_orders wo ON sa.work_order_id = wo.id AND wo.work_order_is_deleted IS NOT TRUE
    LEFT JOIN properties p ON wo.property_id = p.id
    LEFT JOIN buildings b ON wo.building_id = b.id
    LEFT JOIN units u ON wo.unit_id = u.id
    LEFT JOIN picklist_values st ON sa.sa_status = st.id
    LEFT JOIN picklist_values wrt ON wo.work_order_record_type = wrt.id
    WHERE sa.sa_is_deleted IS NOT TRUE
      AND sa.sa_scheduled_start_time IS NOT NULL
      AND (wo.property_id IN (SELECT property_id FROM granted_properties)
           OR wo.building_id IN (SELECT building_id FROM granted_buildings))
  )
  SELECT jsonb_build_object('appointments', COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'subject', subject, 'status', status,
    'start', start_ts, 'end', end_ts,
    'property_id', property_id, 'property_name', property_name, 'property_address', property_address,
    'building_id', building_id, 'building_name', building_name, 'building_address', building_address,
    'unit_id', unit_id, 'unit_number', unit_number, 'work_order_type', work_order_type
  ) ORDER BY start_ts), '[]'::jsonb)) INTO v_result
  FROM visits;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_portal_calendar(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_portal_calendar(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_portal_calendar(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_portal_calendar(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
