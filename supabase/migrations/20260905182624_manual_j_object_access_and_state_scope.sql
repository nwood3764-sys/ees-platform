-- Who may read a Manual J, and whether a state-restricted user can see one.
--
-- Split out of the same change that created the objects. Both answers are
-- inherited from `assessments` rather than invented: the load calculation is
-- part of the assessment, so a second answer to "who may see this" would only
-- be a way for the two to drift.

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Object access — whoever can read an assessment can read its Manual J
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.role_object_access (roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete)
SELECT a.roa_role_id, t.tbl, a.roa_read, a.roa_create, a.roa_update, a.roa_delete
FROM public.role_object_access a
CROSS JOIN (VALUES ('manual_j_reports'),('manual_j_load_blocks'),('manual_j_load_components'),('manual_j_building_materials')) t(tbl)
WHERE a.roa_object_name = 'assessments'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_object_access x
    WHERE x.roa_role_id = a.roa_role_id AND x.roa_object_name = t.tbl);

-- ───────────────────────────────────────────────────────────────────────────
-- 7. Geographic (state) record access
-- ───────────────────────────────────────────────────────────────────────────
--
-- The engine fails closed: an object with no registered resolution path is
-- invisible to every state-restricted user. Registering the parent chain is
-- not optional bookkeeping — it is what stops a Manual J vanishing for anyone
-- whose access is scoped to a state.

INSERT INTO public.record_state_scope_sources
  (rsss_record_number, rsss_object_name, rsss_resolution_kind, rsss_parent_object_name, rsss_parent_fk_column, rsss_path_order, rsss_is_active, rsss_notes)
SELECT '', v.obj, 'parent_lookup', v.parent, v.fk, v.ord, true, v.note
FROM (VALUES
  ('manual_j_reports',           'assessments',          'assessment_id',          1, 'A Manual J belongs to the assessment that produced it.'),
  ('manual_j_reports',           'properties',           'property_id',            2, 'Inherited from the assessment; present when the report was filed against a property.'),
  ('manual_j_load_blocks',       'manual_j_reports',     'manual_j_report_id',     1, 'A load block resolves through its report.'),
  ('manual_j_load_components',   'manual_j_load_blocks', 'manual_j_load_block_id', 1, 'A component resolves through its block.'),
  ('manual_j_building_materials','manual_j_reports',     'manual_j_report_id',     1, 'An assembly resolves through its report.')
) v(obj, parent, fk, ord, note)
WHERE NOT EXISTS (
  SELECT 1 FROM public.record_state_scope_sources s
  WHERE s.rsss_object_name = v.obj AND s.rsss_parent_fk_column = v.fk AND s.rsss_is_deleted IS NOT TRUE);

DO $$
DECLARE t text; v_bad int;
BEGIN
  -- Resolvers first, parents before children: a child's predicate calls its
  -- parent's resolver, and a LANGUAGE sql body is parsed whole on first call,
  -- so a missing parent takes the whole dispatcher down rather than one branch.
  FOREACH t IN ARRAY ARRAY['manual_j_reports','manual_j_load_blocks','manual_j_load_components','manual_j_building_materials']
  LOOP
    PERFORM public.install_record_state_scope_resolver(t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['manual_j_reports','manual_j_load_blocks','manual_j_load_components','manual_j_building_materials']
  LOOP
    PERFORM public.install_record_state_scoping(t);
  END LOOP;

  PERFORM public.rebuild_record_state_scope_dispatcher();

  SELECT count(*) INTO v_bad FROM public.record_state_scope_integrity();
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'record_state_scope_integrity() returned % rows after registering the Manual J objects', v_bad;
  END IF;
END $$;

