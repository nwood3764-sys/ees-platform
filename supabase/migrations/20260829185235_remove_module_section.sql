-- A module tab can be REMOVED, not only hidden.
--
-- Nicholas, 2026-08-29, on Qualification: "how do I remove a section? I want to
-- get rid of EFR reports. It says visible or not visible, but I need to be able
-- to remove it totally."
--
-- set_module_sections only ever UPDATEs, so a tab added by mistake could be
-- hidden but never taken off the list: the editor grew and never shrank.
--
-- Removal is a soft delete, like everything else in LEAP, so the decision stays
-- auditable and a tab can be restored by clearing the flag. The module renderer
-- must then treat a soft-deleted CODE-backed section as removed rather than
-- re-appending it as "new in code" — that is handled in useModuleSections,
-- which reads the removed rows too.

CREATE OR REPLACE FUNCTION public.remove_module_section(
  p_module_id  text,
  p_section_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user      uuid;
  v_remaining int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Removing a module tab is admin-only' USING ERRCODE='insufficient_privilege';
  END IF;

  SELECT id INTO v_user FROM public.users WHERE auth_user_id = auth.uid();

  -- A module with no tabs left has no navigation at all, which is not a state
  -- an admin can mean to create.
  SELECT count(*) INTO v_remaining
  FROM   public.module_sections
  WHERE  ms_module_id = p_module_id
    AND  ms_is_deleted = false
    AND  ms_section_id <> p_section_id;

  IF v_remaining = 0 THEN
    RAISE EXCEPTION 'A module must keep at least one tab; % is the last one on %',
      p_section_id, p_module_id;
  END IF;

  UPDATE public.module_sections
  SET    ms_is_deleted = true,
         ms_updated_by = v_user
  WHERE  ms_module_id = p_module_id
    AND  ms_section_id = p_section_id
    AND  ms_is_deleted = false;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no such tab on this module');
  END IF;

  RETURN jsonb_build_object('ok', true, 'removed', p_section_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_module_section(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.remove_module_section(text, text) TO authenticated;

COMMENT ON FUNCTION public.remove_module_section(text, text) IS
  'Soft-delete one module tab. Admin-only, and refuses to remove a module''s last remaining tab. A removed CODE-backed section is kept out of the module''s tab strip by useModuleSections, which reads removed rows so the module does not re-append it as new-in-code.';
