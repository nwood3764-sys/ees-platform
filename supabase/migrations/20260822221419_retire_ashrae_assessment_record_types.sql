-- Retire the ASHRAE Level 1 and ASHRAE Level 2 assessment record types.
--
-- Nicholas, 2026-08-22: "the ASHRAE Level 1 and ASHRAE Level 2 are removed. If I
-- ever need to add those, I'll add them back later."
--
-- Earlier today these two were seeded as eligible on all six IRA audit programs
-- as a deliberate holding position ("for now, just do the ASHRAE ones, and I'll
-- select them later"). That selection is now made: every IRA program offers its
-- own assessment record type and nothing else.
--
-- Same retirement as the seven programs retired in 20260822212041 — deactivate
-- the record type, soft-delete its page layout — plus the eligibility edges,
-- which did not exist when that migration ran. Both carry ZERO assessments,
-- verified before writing, and neither is the default record type (that moved to
-- WI-IRA-MF-HOMES-AUDIT earlier today). Rows survive, so adding them back is one
-- UPDATE plus re-ticking them in Setup.
--
-- Consequence worth knowing: each IRA program is now left with exactly ONE
-- eligible assessment record type. RecordTypePicker auto-picks a single option
-- and derive_assessment_record_type() resolves the same one server-side, so
-- creating an assessment on a program opportunity no longer prompts at all.
--
-- Scope note: the ASHRAE-LEVEL-1 record types on `projects` and `work_orders`
-- are different objects on a different axis and are untouched here.

DO $do$
DECLARE
  v_retired  text[] := ARRAY['ASHRAE-LEVEL-1', 'ASHRAE-LEVEL-2'];
  v_actor    uuid;
  v_in_use   text;
  v_rt       integer;
  v_pl       integer;
  v_edges    integer;
  v_orphans  text;
BEGIN
  SELECT id INTO v_actor FROM public.users WHERE user_email = 'nicholas.wood@ees-wi.org' LIMIT 1;

  -- Guard 1: never retire a record type that has picked up records.
  SELECT string_agg(pv.picklist_value || ' (' || c.n || ')', ', ')
    INTO v_in_use
    FROM public.picklist_values pv
    CROSS JOIN LATERAL (
      SELECT count(*) AS n FROM public.assessments a WHERE a.assessment_record_type = pv.id
    ) c
   WHERE pv.picklist_object = 'assessments'
     AND pv.picklist_field  = 'record_type'
     AND pv.picklist_value  = ANY(v_retired)
     AND c.n > 0;
  IF v_in_use IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to retire assessment record types that carry assessments: %', v_in_use;
  END IF;

  -- Guard 2: never leave a constrained program with nothing to offer. Removing
  -- these two must not strand an opportunity record type whose only remaining
  -- eligible assessment type is one of them — that would make every assessment
  -- on that program unsaveable.
  SELECT string_agg(DISTINCT opp.picklist_value, ', ')
    INTO v_orphans
    FROM public.record_type_eligibility e
    JOIN public.picklist_values opp ON opp.id = e.rte_parent_record_type_id
   WHERE e.rte_parent_object = 'opportunities'
     AND e.rte_child_object  = 'assessments'
     AND e.rte_is_active AND NOT e.rte_is_deleted
     AND NOT EXISTS (
       SELECT 1
         FROM public.record_type_eligibility keep
         JOIN public.picklist_values kv ON kv.id = keep.rte_child_record_type_id
        WHERE keep.rte_parent_object = 'opportunities'
          AND keep.rte_parent_record_type_id = e.rte_parent_record_type_id
          AND keep.rte_child_object = 'assessments'
          AND keep.rte_is_active AND NOT keep.rte_is_deleted
          AND kv.picklist_is_active
          AND kv.picklist_value <> ALL(v_retired)
     );
  IF v_orphans IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to retire: these opportunity record types would be left with no eligible assessment record type: %',
      v_orphans;
  END IF;

  -- 1. Retire the eligibility edges. Soft-deleted, so the audit trail keeps what
  --    each program used to allow and the Setup pane can re-tick them later.
  UPDATE public.record_type_eligibility e
     SET rte_is_deleted = true,
         rte_updated_by = v_actor,
         rte_updated_at = now()
    FROM public.picklist_values pv
   WHERE e.rte_child_record_type_id = pv.id
     AND e.rte_child_object = 'assessments'
     AND e.rte_is_deleted IS NOT TRUE
     AND pv.picklist_object = 'assessments'
     AND pv.picklist_field  = 'record_type'
     AND pv.picklist_value  = ANY(v_retired);
  GET DIAGNOSTICS v_edges = ROW_COUNT;

  -- 2. Soft-delete the layouts, before the record types are touched (see
  --    20260822212041 for why that order matters).
  UPDATE public.page_layouts pl
     SET is_deleted      = true,
         deletion_reason = 'Record type retired 2026-08-22 — ASHRAE Level 1 / Level 2 removed from the assessment record types.',
         updated_at      = now()
    FROM public.picklist_values pv
   WHERE pl.record_type_id = pv.id
     AND pl.page_layout_object = 'assessments'
     AND pl.is_deleted IS NOT TRUE
     AND pv.picklist_object = 'assessments'
     AND pv.picklist_field  = 'record_type'
     AND pv.picklist_value  = ANY(v_retired);
  GET DIAGNOSTICS v_pl = ROW_COUNT;

  -- 3. Deactivate the record types.
  UPDATE public.picklist_values
     SET picklist_is_active = false,
         picklist_is_default_record_type = false,
         picklist_description = COALESCE(picklist_description || ' ', '')
                                || '[Retired 2026-08-22: removed from the assessment record types.]'
   WHERE picklist_object = 'assessments'
     AND picklist_field  = 'record_type'
     AND picklist_value  = ANY(v_retired)
     AND picklist_is_active;
  GET DIAGNOSTICS v_rt = ROW_COUNT;

  RAISE NOTICE 'Retired % record type(s), % layout(s), % eligibility edge(s).', v_rt, v_pl, v_edges;
END $do$;

-- The help article's table listed ASHRAE Level 1 and Level 2 in every program's
-- allowed column. Bring it in line rather than leave documentation describing a
-- choice that no longer exists.
UPDATE public.help_articles
   SET ha_body_markdown = replace(ha_body_markdown, 'ASHRAE Level 1, ASHRAE Level 2, ', ''),
       ha_updated_at    = now(),
       ha_updated_by    = (SELECT id FROM public.users WHERE user_email = 'nicholas.wood@ees-wi.org' LIMIT 1)
 WHERE ha_slug = 'state-specific-assessment-record-types'
   AND ha_body_markdown LIKE '%ASHRAE Level 1, ASHRAE Level 2, %';

NOTIFY pgrst, 'reload schema';
