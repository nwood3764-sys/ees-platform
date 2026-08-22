-- ============================================================================
-- Mark the four System Information fields as system-audit on every layout
-- ----------------------------------------------------------------------------
-- The record renderer must hold these four display-only: they are written by
-- the database (trg_record_audit_fields), so an editable Created By lookup —
-- which is what the pre-existing System Information groups actually rendered —
-- offers the user a change that the trigger silently reverts on save.
--
-- The renderer keys that off an explicit `system_audit: true` on the layout
-- field, NOT off a column-name heuristic. A name pattern would sweep in real
-- business timestamps that merely end in _updated_at (vehicles carries
-- vehicle_odometer_updated_at, a value a user legitimately edits) — the same
-- trap the clickable-contact-field work hit, where the fix belonged in the
-- field's declared type rather than in a guess about its name.
--
-- Scoped by BOTH the resolved audit column and the canonical label this
-- platform gives it, so a field an admin placed for their own reasons is left
-- alone.
-- ============================================================================

DO $mark$
DECLARE
  lay       record;
  r         record;
  v_marked  integer := 0;
  n         integer;
BEGIN
  FOR lay IN
    SELECT pl.id, pl.page_layout_object
    FROM public.page_layouts pl
    JOIN pg_class cl ON cl.relname = pl.page_layout_object AND cl.relkind = 'r'
    JOIN pg_namespace n2 ON n2.oid = cl.relnamespace AND n2.nspname = 'public'
    WHERE pl.is_deleted = false AND pl.page_layout_type = 'record_detail'
  LOOP
    SELECT * INTO r FROM public.resolve_record_audit_columns(lay.page_layout_object);
    CONTINUE WHEN NOT FOUND;

    UPDATE public.page_layout_widgets w
       SET widget_config = jsonb_set(
             w.widget_config, '{fields}',
             (SELECT COALESCE(jsonb_agg(
                       CASE
                         WHEN e.f->>'name' = ANY (ARRAY[r.created_at_column, r.created_by_column,
                                                        r.updated_at_column, r.updated_by_column])
                          AND e.f->>'label' = ANY (ARRAY['Created Date','Created By',
                                                         'Last Modified Date','Last Modified By'])
                         THEN e.f || '{"system_audit": true}'::jsonb
                         ELSE e.f
                       END ORDER BY e.ord), '[]'::jsonb)
                FROM jsonb_array_elements(w.widget_config->'fields') WITH ORDINALITY AS e(f, ord)))
      FROM public.page_layout_sections s
     WHERE w.section_id = s.id
       AND s.page_layout_id = lay.id
       AND s.is_deleted = false
       AND w.is_deleted = false
       AND w.widget_type = 'field_group'
       AND w.widget_config ? 'fields'
       AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(w.widget_config->'fields') AS x
              WHERE x->>'name' = ANY (ARRAY[r.created_at_column, r.created_by_column,
                                            r.updated_at_column, r.updated_by_column])
                AND x->>'label' = ANY (ARRAY['Created Date','Created By',
                                             'Last Modified Date','Last Modified By'])
                AND COALESCE((x->>'system_audit')::boolean, false) = false);
    GET DIAGNOSTICS n = ROW_COUNT;
    v_marked := v_marked + n;
  END LOOP;

  RAISE NOTICE 'system_audit flag set on % field group(s)', v_marked;
END $mark$;

NOTIFY pgrst, 'reload schema';
