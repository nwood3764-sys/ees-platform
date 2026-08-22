-- Advisor cleanup for the two migrations immediately before this one.
--
-- The security advisor went 219 -> 223 after 20260822213141 and 20260822213503.
-- Three of those four are expected and match the known baseline category
-- (`authenticated_security_definer_function_executable` — every SECURITY DEFINER
-- function in LEAP carries it). Two of the three were avoidable, and the fourth
-- was a brand-new category. Both are fixed here.
--
-- 1. `function_search_path_mutable` on clone_page_layout — NEW category, zero of
--    these in the baseline. 20260822213141 rewrote the function with
--    CREATE OR REPLACE to carry section_placement, and CREATE OR REPLACE
--    replaces the whole function definition including its SET clauses. The
--    baseline definition pinned search_path; the rewrite silently dropped it.
--    Restored here, with the section_placement fix intact.
--
-- 2. derive_assessment_record_type() and
--    enforce_assessment_record_type_eligibility() are TRIGGER functions. Nothing
--    calls them directly — triggers execute as the table owner — so no role
--    needs EXECUTE. 20260822213503 revoked from public and anon but not from
--    authenticated, which left each carrying an avoidable
--    `authenticated_security_definer_function_executable` lint. Same fix as the
--    opportunity-account trigger pair on 2026-07-09.
--
-- eligible_record_types_for_parent() keeps its authenticated GRANT: the record
-- type picker calls it, so that one lint is the standard, expected kind.
--
-- Expected post-migration total: 220 (baseline 219 + the one real RPC).

CREATE OR REPLACE FUNCTION public.clone_page_layout(
  p_source_layout_id uuid,
  p_new_name text,
  p_new_description text DEFAULT NULL::text,
  p_new_role_id uuid DEFAULT NULL::uuid,
  p_new_record_type_id uuid DEFAULT NULL::uuid,
  p_new_is_default boolean DEFAULT false,
  p_owner uuid DEFAULT NULL::uuid,
  p_created_by uuid DEFAULT NULL::uuid
) RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE
  v_source_layout  public.page_layouts%ROWTYPE;
  v_new_layout_id  uuid;
  v_section_map    jsonb := '{}'::jsonb;
  v_new_sec_id     uuid;
  v_sec_row        public.page_layout_sections%ROWTYPE;
  v_owner          uuid;
  v_created_by     uuid;
BEGIN
  SELECT * INTO v_source_layout
  FROM public.page_layouts
  WHERE id = p_source_layout_id AND is_deleted = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'clone_page_layout: source layout % not found or deleted', p_source_layout_id;
  END IF;

  v_owner      := COALESCE(p_owner,      v_source_layout.page_layout_owner);
  v_created_by := COALESCE(p_created_by, v_source_layout.page_layout_created_by);

  INSERT INTO public.page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, role_id, record_type_id, page_layout_is_default,
    page_layout_description, page_layout_owner, page_layout_created_by
  )
  VALUES (
    '', p_new_name, v_source_layout.page_layout_object,
    v_source_layout.page_layout_type, p_new_role_id, p_new_record_type_id,
    COALESCE(p_new_is_default, false),
    COALESCE(p_new_description, v_source_layout.page_layout_description),
    v_owner, v_created_by
  )
  RETURNING id INTO v_new_layout_id;

  FOR v_sec_row IN
    SELECT *
    FROM public.page_layout_sections
    WHERE page_layout_id = p_source_layout_id AND is_deleted = false
    ORDER BY section_order
  LOOP
    INSERT INTO public.page_layout_sections (
      page_layout_id, section_order, section_label, section_columns,
      section_is_collapsible, section_is_collapsed_by_default,
      section_tab, section_placement
    )
    VALUES (
      v_new_layout_id, v_sec_row.section_order, v_sec_row.section_label,
      v_sec_row.section_columns, v_sec_row.section_is_collapsible,
      v_sec_row.section_is_collapsed_by_default,
      v_sec_row.section_tab, v_sec_row.section_placement
    )
    RETURNING id INTO v_new_sec_id;

    v_section_map := v_section_map || jsonb_build_object(v_sec_row.id::text, v_new_sec_id::text);
  END LOOP;

  INSERT INTO public.page_layout_widgets (
    page_layout_widget_record_number, page_layout_id, section_id, widget_type,
    widget_title, widget_column, widget_position, widget_size, widget_config,
    widget_is_user_customizable, widget_is_required
  )
  SELECT
    '', v_new_layout_id, (v_section_map ->> w.section_id::text)::uuid,
    w.widget_type, w.widget_title, w.widget_column, w.widget_position,
    w.widget_size, w.widget_config, w.widget_is_user_customizable, w.widget_is_required
  FROM public.page_layout_widgets w
  WHERE w.page_layout_id = p_source_layout_id
    AND w.is_deleted = false
    AND (v_section_map ? w.section_id::text);

  RETURN v_new_layout_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.clone_page_layout(uuid, text, text, uuid, uuid, boolean, uuid, uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.derive_assessment_record_type()
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_assessment_record_type_eligibility()
  FROM public, anon, authenticated;

NOTIFY pgrst, 'reload schema';
