-- ============================================================================
-- Preview a user's geographic access
--
-- Nicholas, 2026-08-23: "I want to be able to test this and see what he sees,
-- so he's not seeing anything he shouldn't." James has no login yet, so nobody
-- can sign in as him to check. This answers the question directly instead:
-- for every scoped object, how many records exist and how many that user can
-- see, computed with the same generated predicate the policies use.
--
-- Administrator-only, and it counts rows rather than returning them, so it
-- reports on access without disclosing the records themselves.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.preview_user_state_scope_access(
  p_user_id   uuid,
  p_max_rows  bigint DEFAULT 200000
)
RETURNS TABLE (
  object_name      text,
  resolution_kind  text,
  records_total    bigint,
  records_visible  bigint,
  note             text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_states  text[];
  v_pred    text;
  v_kind    text;
  v_est     bigint;
  r         record;
  v_total   bigint;
  v_visible bigint;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Only an Administrator may preview another user''s record access.';
  END IF;

  SELECT NULLIF(ARRAY(
           SELECT DISTINCT upper(btrim(uss.uss_state_code))
           FROM public.user_state_scopes uss
           WHERE uss.uss_user_id = p_user_id AND uss.uss_is_deleted = false
           ORDER BY 1
         ), ARRAY[]::text[])
    INTO v_states;

  FOR r IN
    SELECT s.rsss_object_name AS obj,
           string_agg(DISTINCT s.rsss_resolution_kind, ', ') AS kinds,
           (SELECT c.reltuples::bigint FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = s.rsss_object_name AND c.relkind = 'r') AS est
    FROM public.record_state_scope_sources s
    WHERE s.rsss_is_active = true AND s.rsss_is_deleted = false
      AND s.rsss_resolution_kind <> 'platform_configuration'
    GROUP BY s.rsss_object_name
    ORDER BY s.rsss_object_name
  LOOP
    object_name := r.obj;
    resolution_kind := r.kinds;
    records_total := NULL;
    records_visible := NULL;
    note := NULL;

    IF v_states IS NULL THEN
      note := 'User has no state grants — unrestricted, sees every record their role allows.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF COALESCE(r.est, 0) > p_max_rows THEN
      note := format('Not counted: about %s rows, above the preview limit.', r.est);
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_pred := public.build_record_state_scope_predicate(
      r.obj, r.obj, quote_literal(v_states) || '::text[]');

    BEGIN
      EXECUTE format(
        'SELECT count(*), count(*) FILTER (WHERE %s) FROM public.%I',
        v_pred, r.obj)
      INTO v_total, v_visible;
      records_total := v_total;
      records_visible := v_visible;
      IF v_total > 0 AND v_visible = 0 THEN
        note := 'Nothing in this object resolves to the granted states.';
      END IF;
    EXCEPTION WHEN others THEN
      note := 'Could not count: ' || left(SQLERRM, 120);
    END;

    RETURN NEXT;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public.preview_user_state_scope_access(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_user_state_scope_access(uuid, bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
