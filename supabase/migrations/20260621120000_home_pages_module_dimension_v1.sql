-- Per-module home pages. Adds a module dimension to home_pages so every module
-- can have its own page-builder home (no hardcoded module dashboards), plus a
-- module-aware resolver and one-default-per-module uniqueness.
-- Applied via MCP 2026-06-21; reproduced here for version parity.

ALTER TABLE public.home_pages ADD COLUMN IF NOT EXISTS hp_module_id text;
COMMENT ON COLUMN public.home_pages.hp_module_id IS
  'Module this home page belongs to. NULL = global Home module. Non-null = that module''s home tab (e.g. qualification, outreach).';

UPDATE public.home_pages SET hp_module_id = 'qualification'
  WHERE hp_name = 'Qualification Home' AND hp_module_id IS NULL;

DROP INDEX IF EXISTS public.uq_hp_one_default;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hp_one_default_per_module
  ON public.home_pages (COALESCE(hp_module_id, '__global__'))
  WHERE hp_is_default = true AND hp_is_deleted = false;

CREATE OR REPLACE FUNCTION public.resolve_home_page_for_module(p_module text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public','pg_catalog'
AS $function$
DECLARE
  v_role uuid; v_page public.home_pages%ROWTYPE; v_components jsonb;
BEGIN
  SELECT role_id INTO v_role FROM public.users WHERE auth_user_id = auth.uid();

  SELECT * INTO v_page FROM public.home_pages
   WHERE hp_is_deleted = false AND hp_is_active = true
     AND hp_module_id IS NOT DISTINCT FROM p_module AND hp_role_id = v_role
   ORDER BY hp_updated_at DESC LIMIT 1;

  IF v_page.id IS NULL THEN
    SELECT * INTO v_page FROM public.home_pages
     WHERE hp_is_deleted = false AND hp_is_active = true
       AND hp_module_id IS NOT DISTINCT FROM p_module AND hp_is_default = true
     ORDER BY hp_updated_at DESC LIMIT 1;
  END IF;

  IF v_page.id IS NULL AND p_module IS NULL THEN
    SELECT * INTO v_page FROM public.home_pages
     WHERE hp_is_deleted = false AND hp_is_active = true AND hp_role_id = v_role
     ORDER BY hp_updated_at DESC LIMIT 1;
    IF v_page.id IS NULL THEN
      SELECT * INTO v_page FROM public.home_pages
       WHERE hp_is_deleted = false AND hp_is_active = true AND hp_is_default = true
       ORDER BY hp_updated_at DESC LIMIT 1;
    END IF;
  END IF;

  IF v_page.id IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_agg(jsonb_build_object(
            'id', hpc.id, 'region', hpc.hpc_region, 'type', hpc.hpc_type,
            'source_id', hpc.hpc_source_id, 'title', hpc.hpc_title,
            'config', hpc.hpc_config, 'sort_order', hpc.hpc_sort_order
          ) ORDER BY hpc.hpc_region, hpc.hpc_sort_order)
    INTO v_components FROM public.home_page_components hpc
   WHERE hpc.hpc_page_id = v_page.id AND hpc.hpc_is_deleted = false;

  RETURN jsonb_build_object(
    'id', v_page.id, 'name', v_page.hp_name, 'template', v_page.hp_template,
    'role_id', v_page.hp_role_id, 'module_id', v_page.hp_module_id,
    'is_default', v_page.hp_is_default,
    'components', COALESCE(v_components, '[]'::jsonb));
END; $function$;

REVOKE ALL ON FUNCTION public.resolve_home_page_for_module(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_home_page_for_module(text) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
