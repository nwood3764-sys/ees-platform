-- Update publish_project_report_template to write a frozen PRTSN row
-- alongside the status flip. The snapshot captures whatever the live PRT +
-- its non-deleted PRTS sections look like at the exact moment of publish,
-- so future regenerations of historical reports can read from the snapshot
-- instead of the editable live rows.
--
-- The whole RPC runs in a single transaction, so the snapshot insert and
-- the status flip succeed or fail together — there's no window where
-- status=Active exists without a corresponding snapshot.
--
-- Re-publishing (which increments prt_version) writes a fresh snapshot at
-- the new version. The UNIQUE (prt_id, prtsn_version) constraint on the
-- snapshot table guarantees we never write two snapshots for the same
-- version of the same template.

CREATE OR REPLACE FUNCTION public.publish_project_report_template(p_prt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_caller uuid := public.current_app_user_id();
  v_current text;
  v_published_at timestamptz;
  v_version int;
  v_active_id uuid;
  v_section_count int;
  v_template_row project_report_templates%ROWTYPE;
  v_sections_json jsonb;
  v_snapshot_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'publish: must be authenticated as a registered user' USING ERRCODE = '42501';
  END IF;

  SELECT _prt_status_value(prt_status), prt_published_at, prt_version
    INTO v_current, v_published_at, v_version
  FROM project_report_templates
  WHERE id = p_prt_id AND NOT prt_is_deleted;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'publish: template not found';
  END IF;

  IF v_current = 'Active' THEN
    RAISE EXCEPTION 'publish: template is already Active';
  END IF;
  IF v_current = 'Archived' THEN
    RAISE EXCEPTION 'publish: cannot publish an Archived template — restore to Draft first';
  END IF;

  SELECT id INTO v_active_id
  FROM picklist_values
  WHERE picklist_object='project_report_templates'
    AND picklist_field='prt_status'
    AND picklist_value='Active'
    AND picklist_is_active=true
  LIMIT 1;
  IF v_active_id IS NULL THEN
    RAISE EXCEPTION 'publish: Active status not configured';
  END IF;

  SELECT COUNT(*) INTO v_section_count
  FROM project_report_template_sections
  WHERE prt_id = p_prt_id AND NOT prts_is_deleted;
  IF v_section_count = 0 THEN
    RAISE EXCEPTION 'publish: template has no sections — add at least one before publishing';
  END IF;

  -- Increment version on re-publish (already had a published_at).
  IF v_published_at IS NOT NULL THEN
    v_version := v_version + 1;
  END IF;

  -- Flip the status + bump version. Capture the post-update PRT row for
  -- the snapshot — that way prtsn_template_json reflects the true state
  -- of the row at the moment Active took effect, including the bumped
  -- version and freshly stamped prt_updated_at.
  UPDATE project_report_templates SET
    prt_status = v_active_id,
    prt_version = v_version,
    prt_published_at = COALESCE(prt_published_at, now()),
    prt_updated_by = v_caller,
    prt_updated_at = now()
  WHERE id = p_prt_id
  RETURNING * INTO v_template_row;

  -- Build the sections JSON: every non-deleted section in section_order,
  -- as an array of full row objects. Using jsonb_agg + ORDER BY in the
  -- aggregate guarantees stable ordering inside the array.
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.prts_section_order ASC), '[]'::jsonb)
    INTO v_sections_json
  FROM project_report_template_sections s
  WHERE s.prt_id = p_prt_id AND NOT s.prts_is_deleted;

  INSERT INTO project_report_template_snapshots (
    prtsn_record_number, prt_id, prtsn_version,
    prtsn_template_json, prtsn_sections_json,
    prtsn_published_at, prtsn_published_by,
    prtsn_owner, prtsn_created_by, prtsn_updated_by
  ) VALUES (
    '', p_prt_id, v_version,
    to_jsonb(v_template_row), v_sections_json,
    now(), v_caller,
    v_caller, v_caller, v_caller
  )
  RETURNING id INTO v_snapshot_id;

  RETURN jsonb_build_object(
    'ok', true,
    'prt_id', p_prt_id,
    'new_status', 'Active',
    'new_version', v_version,
    'first_publish', v_published_at IS NULL,
    'snapshot_id', v_snapshot_id
  );
END;
$function$;
