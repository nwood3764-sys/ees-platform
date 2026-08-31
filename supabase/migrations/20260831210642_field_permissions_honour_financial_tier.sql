-- app_user_field_permissions now answers the tier question too.
--
-- This is the RPC every page layout already calls, so extending it enforces
-- tiers on record pages without touching RecordDetail at all. Same body as
-- before apart from the tier lookup and the one line that applies it.
--
-- The tier is a HARD floor, applied after the role/permission-set resolution:
-- an explicit "visible" grant on a field cannot un-hide a tier the caller does
-- not hold. That direction matters -- the permission matrix is edited far more
-- often than the tier registry, so the restrictive one has to win.

create or replace function public.app_user_field_permissions(p_object text, p_fields text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_role_id uuid;
  v_role_name text;
  v_result jsonb := '{}'::jsonb;
  v_field text;
  v_role_visible boolean;
  v_role_editable boolean;
  v_pset_visible boolean;
  v_pset_editable boolean;
  v_visible boolean;
  v_editable boolean;
  v_tier smallint;
  v_field_tier smallint;
BEGIN
  IF p_fields IS NULL OR array_length(p_fields, 1) IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT u.id, u.role_id, r.role_name
    INTO v_user_id, v_role_id, v_role_name
  FROM public.users u
  LEFT JOIN public.roles r ON r.id = u.role_id
  WHERE u.auth_user_id = auth.uid();

  -- No app-level user row -> return empty (caller should treat as fully hidden).
  IF v_user_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  -- Admin short-circuit: every requested field is visible + editable.
  IF v_role_name = 'Admin' THEN
    FOREACH v_field IN ARRAY p_fields LOOP
      v_result := v_result || jsonb_build_object(
        v_field, jsonb_build_object('visible', true, 'editable', true)
      );
    END LOOP;
    RETURN v_result;
  END IF;

  v_tier := public.app_user_financial_tier();

  FOREACH v_field IN ARRAY p_fields LOOP
    -- Role baseline (NULL when no row exists)
    SELECT fp_visible, fp_editable
      INTO v_role_visible, v_role_editable
    FROM public.field_permissions
    WHERE fp_role_id = v_role_id
      AND fp_object = p_object
      AND fp_field  = v_field;

    -- Pset overrides -- if any rows exist, most restrictive wins
    SELECT bool_and(psfp.psfp_visible), bool_and(psfp.psfp_editable)
      INTO v_pset_visible, v_pset_editable
    FROM public.permission_set_field_permissions psfp
    JOIN public.user_permission_sets ups
      ON ups.ups_permission_set_id = psfp.psfp_permission_set_id
    WHERE ups.ups_user_id = v_user_id
      AND psfp.psfp_object = p_object
      AND psfp.psfp_field  = v_field;

    -- Visibility: pset override wins if present, else role, else default true
    IF v_pset_visible IS NOT NULL THEN
      v_visible := v_pset_visible;
    ELSE
      v_visible := COALESCE(v_role_visible, true);
    END IF;

    -- Editability: pset override wins if present, else role, else default true.
    -- Hidden fields are not editable regardless.
    IF v_pset_editable IS NOT NULL THEN
      v_editable := v_pset_editable;
    ELSE
      v_editable := COALESCE(v_role_editable, true);
    END IF;
    IF NOT v_visible THEN v_editable := false; END IF;

    -- Financial tier: a hard floor over everything above it. A field the caller
    -- does not hold the tier for is hidden however generous the role or
    -- permission-set grant is.
    SELECT fm.fm_financial_tier INTO v_field_tier
    FROM public.field_metadata fm
    WHERE fm.fm_object = p_object AND fm.fm_column = v_field
      AND fm.fm_is_deleted IS NOT TRUE
    LIMIT 1;

    IF v_field_tier IS NOT NULL AND v_field_tier > v_tier THEN
      v_visible  := false;
      v_editable := false;
    END IF;

    v_result := v_result || jsonb_build_object(
      v_field, jsonb_build_object('visible', v_visible, 'editable', v_editable)
    );
  END LOOP;

  RETURN v_result;
END;
$function$;

notify pgrst, 'reload schema';
