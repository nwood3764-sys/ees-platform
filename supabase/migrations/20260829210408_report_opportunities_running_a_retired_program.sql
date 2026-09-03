-- =============================================================================
-- RPT-00046 "Opportunities Running a Retired Program Report"
--
-- Nicholas, 2026-08-29, on the 9 opportunities still carrying the retired
-- SINGLE-FAMILY-ENERGY-ASSESSMENT program: "give me a report in the software...
-- so I can go to the records and clean them up."
--
-- A retired program cannot be chosen for a NEW opportunity, but the records
-- already carrying one keep it — and keep needing their eligibility edge alive
-- so they stay editable (see 20260829204506). That makes them a standing
-- cleanup queue, and a queue needs a list you can open, not a number in a chat
-- message.
--
-- Driven by the record type being INACTIVE, not by naming one program, so a
-- program retired next year appears here on its own with nothing to edit. The
-- filter stores the retired ids because report_filters compares values, not
-- predicates; the same rule is re-applied on every replay, so the stored set is
-- always the set that was retired at the time this ran.
--
-- Tabular, sorted by opportunity number, and the first column is the record
-- number so TabularLayout renders it as a link straight to the record — the
-- whole point being to get from the list to the record in one click.
--
-- Idempotent: a report by this name is left exactly as it is, so replaying this
-- against prod (where it already exists) neither duplicates it nor overwrites a
-- change made in the Report Builder since.
-- =============================================================================

DO $$
DECLARE
  v_report_id uuid;
  v_retired   jsonb;
  v_rows      int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.reports
     WHERE rpt_name = 'Opportunities Running a Retired Program Report'
       AND NOT is_deleted
  ) THEN
    RAISE NOTICE 'RPT "Opportunities Running a Retired Program Report" already present - left as is';
    RETURN;
  END IF;

  SELECT jsonb_agg(id::text ORDER BY picklist_value) INTO v_retired
    FROM public.picklist_values
   WHERE picklist_object = 'opportunities'
     AND picklist_field  = 'record_type'
     AND picklist_is_active = false;

  IF v_retired IS NULL THEN
    RAISE EXCEPTION 'aborting: no retired opportunity record types, so this report would match nothing';
  END IF;

  -- '' for the record number: trg_reports_rn fills it.
  INSERT INTO public.reports (
    rpt_record_number, rpt_name, rpt_description, rpt_format, rpt_primary_object,
    rpt_selected_fields, rpt_filter_logic, rpt_sort_config, rpt_column_groupings,
    rpt_runtime_prompts, rpt_charts, rpt_owner_user_id
  ) VALUES (
    '',
    'Opportunities Running a Retired Program Report',
    'Every live opportunity whose program (opportunity record type) has been retired. '
    'A retired program cannot be chosen for a new opportunity, so each of these needs to be '
    'repointed at the program that replaced it — or closed. Driven by the record type being '
    'inactive, so it picks up any program retired later with no edit.',
    'tabular', 'opportunities',
    $fields$[
      {"name":"opportunity_record_number","type":"text","label":"Opportunity Number","table":"opportunities","via_path":null},
      {"name":"opportunity_name","type":"text","label":"Opportunity Name","table":"opportunities","via_path":null},
      {"name":"opportunity_record_type","type":"uuid","label":"Program (Record Type)","table":"opportunities","via_path":null},
      {"name":"opportunity_stage","type":"uuid","label":"Stage","table":"opportunities","via_path":null},
      {"name":"opportunity_state","type":"text","label":"State","table":"opportunities","via_path":null},
      {"name":"property_id","type":"uuid","label":"Property","table":"opportunities","via_path":null},
      {"name":"building_id","type":"uuid","label":"Building","table":"opportunities","via_path":null},
      {"name":"opportunity_account_id","type":"uuid","label":"Account","table":"opportunities","via_path":null},
      {"name":"opportunity_owner","type":"uuid","label":"Opportunity Owner","table":"opportunities","via_path":null},
      {"name":"opportunity_created_at","type":"timestamptz","label":"Created","table":"opportunities","via_path":null}
    ]$fields$::jsonb,
    'all',
    '[{"name":"opportunity_record_number","direction":"asc"}]'::jsonb,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    (SELECT id FROM public.users
      WHERE user_email = 'nicholas.wood@ees-wi.org' AND user_is_active LIMIT 1)
  )
  RETURNING id INTO v_report_id;

  -- report_filters is the authoritative source of a report's active filters —
  -- never the inline rpt_runtime_prompts JSON.
  INSERT INTO public.report_filters (
    rfilt_report_id, rfilt_filter_index, rfilt_field_name, rfilt_field_table,
    rfilt_field_via_path, rfilt_operator, rfilt_value, rfilt_is_cross_filter,
    rfilt_cross_subfilters, rfilt_is_runtime_prompt
  ) VALUES (
    v_report_id, 1, 'opportunity_record_type', 'opportunities',
    NULL, 'equals', v_retired, false, '[]'::jsonb, false
  );

  SELECT count(*) INTO v_rows
    FROM public.opportunities o
   WHERE NOT o.opportunity_is_deleted
     AND o.opportunity_record_type::text IN (SELECT jsonb_array_elements_text(v_retired));

  RAISE NOTICE 'report created; % opportunity(ies) currently running a retired program', v_rows;
END
$$;
