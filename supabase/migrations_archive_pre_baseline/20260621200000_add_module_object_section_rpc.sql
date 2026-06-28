-- Admin RPC: add an object as a new tab on a module. Inserts an object-backed
-- module_sections row (ms_object_table set); rendering is handled generically
-- by ObjectListSection, so no code section is required. Idempotent: re-adding
-- the same object on the same module un-deletes / updates the existing row.
-- Applied via MCP 2026-06-21.

CREATE OR REPLACE FUNCTION public.add_module_object_section(
  p_module_id    text,
  p_object_table text,
  p_label        text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_user uuid;
  v_next int;
  v_id   uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Editing module sections is admin-only' USING ERRCODE='insufficient_privilege';
  END IF;
  SELECT id INTO v_user FROM public.users WHERE auth_user_id = auth.uid();

  SELECT id INTO v_id
  FROM public.module_sections
  WHERE ms_module_id = p_module_id AND ms_section_id = p_object_table
  LIMIT 1;

  SELECT COALESCE(max(ms_sort_order), 0) + 1 INTO v_next
  FROM public.module_sections
  WHERE ms_module_id = p_module_id AND ms_is_deleted = false;

  IF v_id IS NOT NULL THEN
    UPDATE public.module_sections
       SET ms_is_deleted = false, ms_is_visible = true,
           ms_label = COALESCE(p_label, ms_label),
           ms_object_table = p_object_table,
           ms_updated_by = v_user
     WHERE id = v_id;
  ELSE
    INSERT INTO public.module_sections
      (ms_module_id, ms_section_id, ms_label, ms_sort_order, ms_is_visible,
       ms_is_system, ms_object_table, ms_created_by, ms_updated_by)
    VALUES
      (p_module_id, p_object_table, COALESCE(p_label, initcap(replace(p_object_table,'_',' '))),
       v_next, true, false, p_object_table, v_user, v_user)
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $function$;

REVOKE ALL ON FUNCTION public.add_module_object_section(text,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_module_object_section(text,text,text) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
