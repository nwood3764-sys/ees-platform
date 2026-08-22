-- Retire the assessment record types for programs EES will never run again.
--
-- Nicholas, 2026-08-22, reviewing the assessments record-type list ahead of the
-- state-specific IRA build: Denver-EFR Application, HES-Assessment, the MEC/MFES
-- pilots, both Nicor programs and PACE-WI are dead. None of them will ever carry
-- an assessment record. Verified live before writing: all seven carry ZERO
-- assessments, zero picklist_value_record_type_assignments, zero
-- record_type_eligibility edges and zero work_types.
--
-- Retirement = deactivate the record type + soft-delete its page layout, which is
-- how this platform retires a picklist value: picklist_values has no is_deleted
-- column, and picklist_is_active = false already removes a value from every
-- picker, from fetchAvailableRecordTypes(), and from picklist_values_for_record_type().
-- The rows survive, so bringing a program back is one UPDATE rather than a reseed.
-- The layouts' sections and widgets are deliberately left in place under the
-- soft-deleted layout for the same reason (fetchPageLayout filters on
-- page_layouts.is_deleted, so they are already unreachable).
--
-- Also moves the default assessments record type off ASHRAE Level 1 and onto the
-- multifamily assessment, per Nicholas. default_record_type_for('assessments')
-- reads picklist_is_default_record_type among ACTIVE values, so this is what a
-- record-type-less insert (enforce_rt__assessments) now lands on.

DO $$
DECLARE
  v_retired    text[] := ARRAY[
    'DENVER-EFR-APPLICATION',
    'HES-ASSESSMENT',
    'MEC-MF-AIR-PILOT',
    'MFES-2023',
    'NICOR-IQ-ASSESSMENT',
    'NICOR-REBUILDING-TOGETHER',
    'PACE-WI'
  ];
  v_in_use     text;
  v_rt_count   integer;
  v_pl_count   integer;
  v_new_default uuid;
BEGIN
  -- Guard: never retire a record type that has picked up records since the
  -- verification above. If one has, fail loudly rather than hide live data.
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
      'Refusing to retire assessment record types that now carry assessments: %', v_in_use;
  END IF;

  -- 1. Soft-delete each retired record type's page layout FIRST. Order matters if
  --    this is ever followed by a hard delete: page_layouts.record_type_id is
  --    ON DELETE SET NULL, and several nulled defaults would collide on the
  --    page_layouts_one_default_per_scope unique index.
  UPDATE public.page_layouts pl
     SET is_deleted      = true,
         deletion_reason = 'Program retired 2026-08-22 — EES will not run this program again.',
         updated_at      = now()
    FROM public.picklist_values pv
   WHERE pl.record_type_id = pv.id
     AND pl.page_layout_object = 'assessments'
     AND pl.is_deleted IS NOT TRUE
     AND pv.picklist_object = 'assessments'
     AND pv.picklist_field  = 'record_type'
     AND pv.picklist_value  = ANY(v_retired);
  GET DIAGNOSTICS v_pl_count = ROW_COUNT;

  -- 2. Deactivate the record types.
  UPDATE public.picklist_values
     SET picklist_is_active = false,
         picklist_is_default_record_type = false,
         picklist_description = COALESCE(picklist_description || ' ', '')
                                || '[Retired 2026-08-22: program discontinued.]'
   WHERE picklist_object = 'assessments'
     AND picklist_field  = 'record_type'
     AND picklist_value  = ANY(v_retired)
     AND picklist_is_active;
  GET DIAGNOSTICS v_rt_count = ROW_COUNT;

  RAISE NOTICE 'Retired % assessment record type(s), soft-deleted % page layout(s).',
    v_rt_count, v_pl_count;

  -- 3. Default assessments record type -> the multifamily assessment.
  SELECT id INTO v_new_default
    FROM public.picklist_values
   WHERE picklist_object = 'assessments'
     AND picklist_field  = 'record_type'
     AND picklist_value  = 'WI-IRA-MF-HOMES-AUDIT'
     AND picklist_is_active
   LIMIT 1;

  IF v_new_default IS NULL THEN
    RAISE EXCEPTION 'Multifamily assessment record type not found — default not moved.';
  END IF;

  UPDATE public.picklist_values
     SET picklist_is_default_record_type = false
   WHERE picklist_object = 'assessments'
     AND picklist_field  = 'record_type'
     AND picklist_is_default_record_type
     AND id <> v_new_default;

  UPDATE public.picklist_values
     SET picklist_is_default_record_type = true
   WHERE id = v_new_default
     AND picklist_is_default_record_type IS DISTINCT FROM true;
END $$;
