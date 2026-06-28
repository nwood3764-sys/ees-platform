-- Backfill: for every PRT that is currently Active but has no snapshot for
-- its current prt_version (i.e. it was published before the snapshot table
-- existed), write a snapshot now using the live row + sections. This
-- restores the invariant "every Active version has a corresponding
-- snapshot" so downstream code that reads from snapshots can rely on it.
--
-- The snapshot is dated as-of now() — there's no way to recover the true
-- original publish timestamp for the version. The prtsn_published_by is
-- set to the template's existing prt_updated_by (best available "who last
-- published this") and falls back to prt_owner if updated_by is null.
DO $$
DECLARE
  v_prt project_report_templates%ROWTYPE;
  v_sections_json jsonb;
  v_active_status_value text;
  v_published_by uuid;
BEGIN
  FOR v_prt IN
    SELECT t.*
    FROM project_report_templates t
    WHERE NOT t.prt_is_deleted
      AND public._prt_status_value(t.prt_status) = 'Active'
      AND NOT EXISTS (
        SELECT 1 FROM project_report_template_snapshots s
        WHERE s.prt_id = t.id AND s.prtsn_version = t.prt_version
      )
  LOOP
    SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.prts_section_order ASC), '[]'::jsonb)
      INTO v_sections_json
    FROM project_report_template_sections s
    WHERE s.prt_id = v_prt.id AND NOT s.prts_is_deleted;

    v_published_by := COALESCE(v_prt.prt_updated_by, v_prt.prt_owner);

    INSERT INTO project_report_template_snapshots (
      prtsn_record_number, prt_id, prtsn_version,
      prtsn_template_json, prtsn_sections_json,
      prtsn_published_at, prtsn_published_by,
      prtsn_owner, prtsn_created_by, prtsn_updated_by
    ) VALUES (
      '', v_prt.id, v_prt.prt_version,
      to_jsonb(v_prt), v_sections_json,
      COALESCE(v_prt.prt_published_at, v_prt.prt_updated_at, now()),
      v_published_by,
      v_published_by, v_published_by, v_published_by
    );
  END LOOP;
END;
$$;
